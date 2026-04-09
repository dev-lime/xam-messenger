//! XAM Messenger Server - WebSocket + HTTP
//!
//! Сервер мессенджера для локальной сети с поддержкой:
//! - WebSocket для обмена сообщениями в реальном времени
//! - HTTP API для регистрации, получения пользователей и загрузки файлов
//! - SQLite для хранения данных

mod config;
mod db;
mod error;
mod handlers;
mod models;
mod websocket;

use actix_cors::Cors;
use actix_web::{App, HttpServer, middleware, web};
use log::{info, warn};
use mdns_sd::{ServiceDaemon, ServiceInfo};
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use config::AppConfig;
use models::{AppState, FileUploads};
use websocket::ws_handler;

/// PERF-1: Создаём r2d2 pool соединений SQLite
fn create_db_pool(
    config: &AppConfig,
) -> Result<Pool<SqliteConnectionManager>, Box<dyn std::error::Error>> {
    let db_path = &config.db_path;
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let manager = SqliteConnectionManager::file(db_path).with_init(|conn| {
        // ARCH-3: PRAGMA применяются при каждом получении соединения
        conn.execute_batch(
            "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA cache_size = -5000;",
        )?;
        // Инициализируем схему БД (создаёт таблицы если нет)
        db::init_database(conn)?;
        Ok(())
    });

    let pool = Pool::builder()
        .max_size(16) // 16 соединений — достаточно для LAN мессенджера
        .build(manager)?;

    // Применяем миграции к одному соединению
    {
        let conn = pool.get()?;
        db::apply_migrations(&conn)?;
    }

    Ok(pool)
}

/// Получение всех локальных IP адресов
fn get_local_ips() -> Vec<String> {
    let mut ips = Vec::new();

    if let Ok(interfaces) = if_addrs::get_if_addrs() {
        for iface in interfaces {
            if !iface.is_loopback()
                && let if_addrs::IfAddr::V4(ipv4) = iface.addr
            {
                ips.push(ipv4.ip.to_string());
            }
        }
    }

    ips
}

#[actix_web::main]
async fn main() -> std::result::Result<(), Box<dyn std::error::Error>> {
    let config = AppConfig::from_env();

    env_logger::init_from_env(env_logger::Env::default().default_filter_or("info"));

    info!("🚀 XAM Server v1.0.0");
    info!("📡 Хост: {}, Порт: {}", config.host, config.port);

    // PERF-1: Инициализация pool БД (вместо Mutex<Connection>)
    let db_pool = create_db_pool(&config)?;
    info!("✅ База данных: {}", config.db_path.display());

    // Инициализация директории для загрузок
    std::fs::create_dir_all(&config.upload_dir)?;
    info!("📁 Директория загрузок: {}", config.upload_dir.display());

    // Локальные IP адреса
    let local_ips = get_local_ips();
    if !local_ips.is_empty() {
        info!("📡 Локальные IP адреса:");
        for ip in &local_ips {
            info!("   └─ http://{}:{}", ip, config.port);
        }
        info!("💡 Используйте эти адреса для подключения клиентов");
    }

    // Регистрация mDNS сервиса
    let mdns_daemon = ServiceDaemon::new();
    let mut mdns_daemon_opt: Option<ServiceDaemon> = None;

    if let Ok(daemon) = mdns_daemon {
        let service_ip = local_ips.first().map(|s| s.as_str()).unwrap_or("127.0.0.1");
        let instance_name = "XAM Messenger._xam-messenger._tcp.local.".to_string();

        let mut txt_props = HashMap::new();
        txt_props.insert("version".to_string(), "1.0.0".to_string());
        txt_props.insert("protocol".to_string(), "ws".to_string());

        match ServiceInfo::new(
            "_xam-messenger._tcp.local.",
            "XAM Messenger",
            instance_name.as_str(),
            service_ip,
            config.port,
            Some(txt_props),
        ) {
            Ok(info) => match daemon.register(info) {
                Ok(_) => {
                    info!("📢 Зарегистрирован в mDNS как _xam-messenger._tcp.local");
                    mdns_daemon_opt = Some(daemon);
                }
                Err(e) => {
                    warn!("⚠️ Не удалось зарегистрировать mDNS сервис: {}", e);
                }
            },
            Err(e) => {
                warn!("⚠️ Не удалось создать ServiceInfo: {}", e);
            }
        }
    } else {
        warn!("⚠️ mDNS не доступен, будет использоваться только IP-сканирование");
    }

    // PERF-3: user_senders вместо broadcast канала
    let user_senders = Arc::new(Mutex::new(HashMap::new()));
    let online_users = Arc::new(Mutex::new(HashMap::new()));
    let file_uploads: FileUploads = Arc::new(Mutex::new(HashMap::new()));
    let ws_connections = Arc::new(std::sync::atomic::AtomicUsize::new(0));

    let state = AppState {
        db: db_pool,
        user_senders,
        online_users,
        upload_dir: config.upload_dir.clone(),
        max_file_size: config.max_file_size,
        file_uploads,
        ws_connections,
    };

    info!("🚀 Запуск сервера на {}:{}", config.host, config.port);

    let server_config = config.clone();
    let cors_origins = config.cors_origins.clone();
    let state_clone = state.clone();
    let server = HttpServer::new(move || {
        let cors = if cors_origins == "*" {
            Cors::default()
                .allow_any_origin()
                .allow_any_method()
                .allow_any_header()
                .send_wildcard()
                .max_age(3600)
        } else {
            let origins: Arc<str> = cors_origins.clone().into();
            Cors::default()
                .allowed_origin_fn(move |origin, _req_head| {
                    origins.split(',').any(|s| s.trim() == origin)
                })
                .allowed_methods(vec!["GET", "POST", "PUT", "DELETE", "OPTIONS"])
                .allowed_headers(vec!["Content-Type", "Authorization"])
                .send_wildcard()
                .max_age(3600)
        };

        let milliseconds_per_request = (60_000.0 / server_config.rate_limit as f64) as u64;

        // PERF-2: для E2E тестов и быстрой регистрации нескольких пользователей
        // burst_size = max(rate_limit * 2, 200) — минимум 200 запросов подряд
        let burst = std::cmp::max(server_config.rate_limit * 2, 200);
        let skip_governor = std::env::var("XAM_SKIP_RATE_LIMIT").ok().is_some();

        let governor_conf = if skip_governor {
            log::info!("⚠️ Rate limiting отключен (XAM_SKIP_RATE_LIMIT=1)");
            // Практически бесконечный burst = отключение rate limiting
            actix_governor::GovernorConfigBuilder::default()
                .milliseconds_per_request(1)
                .burst_size(u32::MAX / 1000) // ~2M запросов
                .finish()
                .expect("Failed to create GovernorConfig")
        } else {
            actix_governor::GovernorConfigBuilder::default()
                .milliseconds_per_request(milliseconds_per_request)
                .burst_size(burst)
                .finish()
                .expect("Failed to create GovernorConfig")
        };

        // PERF-3: порядок wrap() — последний вызывается первым (луковица).
        // CORS должен быть внешним (последний .wrap()) чтобы OPTIONS проходил без rate limiting
        App::new()
            .app_data(web::Data::new(state_clone.clone()))
            .wrap(middleware::Logger::default())
            .app_data(web::PayloadConfig::new(server_config.max_file_size))
            .wrap(cors)
            .wrap(actix_governor::Governor::new(&governor_conf))
            .route("/ws", web::get().to(ws_handler))
            .route("/api/v1/register", web::post().to(handlers::register))
            .route("/api/v1/users", web::get().to(handlers::get_users))
            .route("/api/v1/messages", web::get().to(handlers::get_messages))
            .route(
                "/api/v1/files/download",
                web::get().to(handlers::download_file),
            )
            .route("/api/v1/online", web::get().to(handlers::get_online_users))
    })
    .bind(format!("{}:{}", server_config.host, server_config.port))?
    .run();

    // Graceful shutdown
    let server_handle = server.handle();
    tokio::spawn(async move {
        if let Ok(()) = tokio::signal::ctrl_c().await {
            info!("📥 Получен сигнал завершения");
            server_handle.stop(true).await;
        }
    });

    server.await?;

    if let Some(daemon) = mdns_daemon_opt.take() {
        let _ = daemon.shutdown();
        info!("📢 mDNS сервис остановлен");
    }

    info!("👋 Сервер остановлен");
    Ok(())
}

// ============================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ДЛЯ ТЕСТОВ
// ============================================

/// ARCH-3: Создаёт тестовое состояние с r2d2 pool и PRAGMA
#[cfg(test)]
pub async fn create_test_state() -> AppState {
    let manager = SqliteConnectionManager::file(":memory:").with_init(|conn| {
        conn.execute_batch(
            "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA cache_size = -5000;",
        )?;
        db::init_database(conn)?;
        Ok(())
    });

    let pool = Pool::builder()
        .max_size(4)
        .build(manager)
        .expect("Failed to create test DB pool");

    let (_tx, _rx) = tokio::sync::mpsc::unbounded_channel::<serde_json::Value>();
    let user_senders = Arc::new(Mutex::new(HashMap::new()));
    let online_users = Arc::new(Mutex::new(HashMap::new()));
    let file_uploads: FileUploads = Arc::new(Mutex::new(HashMap::new()));
    let ws_connections = Arc::new(std::sync::atomic::AtomicUsize::new(0));

    AppState {
        db: pool,
        user_senders,
        online_users,
        upload_dir: std::path::PathBuf::from("/tmp/xam-test-files"),
        max_file_size: 100 * 1024 * 1024,
        file_uploads,
        ws_connections,
    }
}

// ============================================
// ТЕСТЫ
// ============================================

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::{App, test, web};
    use rusqlite::params;
    use serde_json::json;

    #[actix_rt::test]
    async fn test_register_new_user() {
        let state = create_test_state().await;
        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(state))
                .route("/api/v1/register", web::post().to(handlers::register)),
        )
        .await;

        let req = test::TestRequest::post()
            .uri("/api/v1/register")
            .set_json(json!({ "name": "Тестовый Пользователь" }))
            .to_request();

        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());

        let body: serde_json::Value = test::read_body_json(resp).await;
        assert_eq!(body["success"], true);
        assert_eq!(body["data"]["name"], "Тестовый Пользователь");
        assert!(
            body["data"]["id"]
                .as_str()
                .expect("Expected id string")
                .len()
                > 0
        );
    }

    #[actix_rt::test]
    async fn test_register_existing_user() {
        let state = create_test_state().await;

        {
            let conn = state.db.get().expect("Failed to get connection");
            conn.execute(
                "INSERT INTO users (id, name, avatar) VALUES (?1, ?2, ?3)",
                params!["test-id", "Existing User", "👤"],
            )
            .expect("Failed to insert test user");
        }

        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(state))
                .route("/api/v1/register", web::post().to(handlers::register)),
        )
        .await;

        let req = test::TestRequest::post()
            .uri("/api/v1/register")
            .set_json(json!({ "name": "Existing User" }))
            .to_request();

        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());

        let body: serde_json::Value = test::read_body_json(resp).await;
        assert_eq!(body["success"], true);
        assert_eq!(body["data"]["name"], "Existing User");
        assert_eq!(body["data"]["id"], "test-id");
    }

    #[actix_rt::test]
    async fn test_register_empty_name() {
        let state = create_test_state().await;
        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(state))
                .route("/api/v1/register", web::post().to(handlers::register)),
        )
        .await;

        let req = test::TestRequest::post()
            .uri("/api/v1/register")
            .set_json(json!({ "name": "" }))
            .to_request();

        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), 400);

        let body: serde_json::Value = test::read_body_json(resp).await;
        assert_eq!(body["success"], false);
        assert_eq!(body["error"], "Empty name");
    }

    #[actix_rt::test]
    async fn test_register_name_too_long() {
        let state = create_test_state().await;
        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(state))
                .route("/api/v1/register", web::post().to(handlers::register)),
        )
        .await;

        let long_name = "a".repeat(51);
        let req = test::TestRequest::post()
            .uri("/api/v1/register")
            .set_json(json!({ "name": long_name }))
            .to_request();

        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), 400);

        let body: serde_json::Value = test::read_body_json(resp).await;
        assert_eq!(body["success"], false);
        assert!(
            body["error"]
                .as_str()
                .expect("Expected error string")
                .contains("Name too long")
        );
    }

    #[actix_rt::test]
    async fn test_get_users() {
        let state = create_test_state().await;

        {
            let conn = state.db.get().expect("Failed to get connection");
            conn.execute(
                "INSERT INTO users (id, name, avatar) VALUES (?1, ?2, ?3)",
                params!["user1", "Alice", "👩"],
            )
            .expect("Failed to insert user1");
            conn.execute(
                "INSERT INTO users (id, name, avatar) VALUES (?1, ?2, ?3)",
                params!["user2", "Bob", "👨"],
            )
            .expect("Failed to insert user2");
        }

        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(state))
                .route("/api/v1/users", web::get().to(handlers::get_users)),
        )
        .await;

        let req = test::TestRequest::get().uri("/api/v1/users").to_request();

        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());

        let body: serde_json::Value = test::read_body_json(resp).await;
        assert_eq!(body["success"], true);
        let users = body["data"].as_array().expect("Expected data array");
        assert_eq!(users.len(), 2);
    }

    #[actix_rt::test]
    async fn test_get_online_users() {
        let state = create_test_state().await;

        {
            let mut online = state.online_users.lock().await;
            online.insert("user1".to_string(), 12345);
            online.insert("user2".to_string(), 12346);
        }

        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(state))
                .route("/api/v1/online", web::get().to(handlers::get_online_users)),
        )
        .await;

        let req = test::TestRequest::get().uri("/api/v1/online").to_request();

        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());

        let body: serde_json::Value = test::read_body_json(resp).await;
        assert_eq!(body["success"], true);
        let online = body["data"].as_array().expect("Expected data array");
        assert_eq!(online.len(), 2);
    }

    #[actix_rt::test]
    async fn test_get_messages_empty() {
        let state = create_test_state().await;
        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(state))
                .route("/api/v1/messages", web::get().to(handlers::get_messages)),
        )
        .await;

        let req = test::TestRequest::get()
            .uri("/api/v1/messages")
            .to_request();

        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());

        let body: serde_json::Value = test::read_body_json(resp).await;
        assert_eq!(body["success"], true);
        assert_eq!(
            body["data"].as_array().expect("Expected data array").len(),
            0
        );
    }

    #[actix_rt::test]
    async fn test_get_messages_with_limit() {
        let state = create_test_state().await;

        {
            let conn = state.db.get().expect("Failed to get connection");
            for i in 0..10 {
                conn.execute(
                    "INSERT INTO messages (id, sender_id, sender_name, text, timestamp, delivery_status) \
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![
                        format!("msg{}", i),
                        "user1",
                        "Test User",
                        format!("Message {}", i),
                        1000 + i,
                        1
                    ],
                )
                .expect("Failed to insert message");
            }
        }

        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(state))
                .route("/api/v1/messages", web::get().to(handlers::get_messages)),
        )
        .await;

        let req = test::TestRequest::get()
            .uri("/api/v1/messages?limit=5")
            .to_request();

        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());

        let body: serde_json::Value = test::read_body_json(resp).await;
        assert_eq!(body["success"], true);
        let messages = body["data"].as_array().expect("Expected data array");
        assert_eq!(messages.len(), 5);
    }

    #[actix_rt::test]
    async fn test_get_messages_for_chat() {
        let state = create_test_state().await;

        {
            let conn = state.db.get().expect("Failed to get connection");
            conn.execute(
                "INSERT INTO messages (id, sender_id, sender_name, text, timestamp, recipient_id) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params!["msg1", "user1", "User 1", "Hello", 1000, "user2"],
            )
            .expect("Failed to insert msg1");
            conn.execute(
                "INSERT INTO messages (id, sender_id, sender_name, text, timestamp, recipient_id) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params!["msg2", "user2", "User 2", "Hi", 1001, "user1"],
            )
            .expect("Failed to insert msg2");
            conn.execute(
                "INSERT INTO messages (id, sender_id, sender_name, text, timestamp, recipient_id) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params!["msg3", "user3", "User 3", "Other chat", 1002, "user4"],
            )
            .expect("Failed to insert msg3");
            conn.execute(
                "INSERT INTO messages (id, sender_id, sender_name, text, timestamp) \
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params!["msg4", "user5", "User 5", "General message", 1003],
            )
            .expect("Failed to insert msg4");
        }

        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(state))
                .route("/api/v1/messages", web::get().to(handlers::get_messages)),
        )
        .await;

        let req = test::TestRequest::get()
            .uri("/api/v1/messages?chat_peer_id=user2")
            .to_request();

        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());

        let body: serde_json::Value = test::read_body_json(resp).await;
        assert_eq!(body["success"], true);
        let messages = body["data"].as_array().expect("Expected data array");
        assert_eq!(messages.len(), 3);
    }

    #[actix_rt::test]
    async fn test_download_file_not_found() {
        let state = create_test_state().await;
        let app = test::init_service(App::new().app_data(web::Data::new(state)).route(
            "/api/v1/files/download",
            web::get().to(handlers::download_file),
        ))
        .await;

        let req = test::TestRequest::get()
            .uri("/api/v1/files/download?file_id=nonexistent")
            .to_request();

        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), 404);

        let body: serde_json::Value = test::read_body_json(resp).await;
        assert_eq!(body["success"], false);
        assert_eq!(body["error"], "File not found");
    }
}
