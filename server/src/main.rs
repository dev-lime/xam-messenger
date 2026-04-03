//! XAM Messenger Server - WebSocket + HTTP
//!
//! Сервер мессенджера для локальной сети с поддержкой:
//! - WebSocket для обмена сообщениями в реальном времени
//! - HTTP API для регистрации, получения пользователей и загрузки файлов
//! - SQLite для хранения данных

mod config;
mod db;
mod handlers;
mod models;
mod websocket;

use actix_cors::Cors;
use actix_web::{App, HttpServer, middleware, web};
use log::{info, warn};
use mdns_sd::{ServiceDaemon, ServiceInfo};
use rusqlite::Connection;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, broadcast};

use config::AppConfig;
use models::AppState;
use websocket::ws_handler;

/// Получение всех локальных IP адресов (#28: if-addrs вместо get_if_addrs)
fn get_local_ips() -> Vec<String> {
    let mut ips = Vec::new();

    if let Ok(interfaces) = if_addrs::get_if_addrs() {
        for iface in interfaces {
            if !iface.is_loopback() {
                if let if_addrs::IfAddr::V4(ipv4) = iface.addr {
                    ips.push(ipv4.ip.to_string());
                }
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

    // Инициализация БД (#11: замена unwrap на ?)
    let db_path = &config.db_path;
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let conn = Connection::open(db_path)?;
    db::init_database(&conn)?;

    info!("✅ База данных: {}", db_path.display());

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

    let db = Arc::new(Mutex::new(conn));
    let broadcast_size = config.broadcast_channel_size;
    let (tx, _rx) = broadcast::channel::<serde_json::Value>(broadcast_size);
    let online_users = Arc::new(Mutex::new(HashMap::new()));

    // Новые поля AppState для валидации файлов
    let state = AppState {
        db,
        tx,
        online_users,
        upload_dir: config.upload_dir.clone(),
        max_file_size: config.max_file_size,
    };

    info!("🚀 Запуск сервера на {}:{}", config.host, config.port);

    let server_config = config.clone();
    let cors_origins = config.cors_origins.clone();
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

        // Rate Limiting (#7): корректная формула
        // rate_limit = запросов в минуту → milliseconds_per_request = 60_000 / rate_limit
        // При rate_limit=100: 600ms между запросами
        let milliseconds_per_request = (60_000.0 / server_config.rate_limit as f64) as u64;

        let governor_conf = actix_governor::GovernorConfigBuilder::default()
            .milliseconds_per_request(milliseconds_per_request)
            .burst_size(server_config.rate_limit)
            .finish()
            .expect("Failed to create GovernorConfig");

        App::new()
            .wrap(cors)
            .wrap(actix_governor::Governor::new(&governor_conf))
            .app_data(web::Data::new(state.clone()))
            .wrap(middleware::Logger::default())
            .app_data(web::PayloadConfig::new(server_config.max_file_size))
            .route("/ws", web::get().to(ws_handler))
            .route("/api/v1/register", web::post().to(handlers::register))
            .route("/api/v1/users", web::get().to(handlers::get_users))
            .route("/api/v1/messages", web::get().to(handlers::get_messages))
            .route("/api/v1/files", web::post().to(handlers::upload_file))
            .route(
                "/api/v1/files/download",
                web::get().to(handlers::download_file),
            )
            .route("/api/v1/online", web::get().to(handlers::get_online_users))
    })
    .bind(format!("{}:{}", server_config.host, server_config.port))?
    .run();

    // Graceful shutdown (#6): обработка Ctrl+C
    let server_handle = server.handle();
    tokio::spawn(async move {
        if let Ok(()) = tokio::signal::ctrl_c().await {
            info!("📥 Получен сигнал завершения");
            server_handle.stop(true).await;
        }
    });

    server.await?;

    // Отмена регистрации mDNS
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

/// Создаёт тестовое состояние с временной БД (в памяти)
#[cfg(test)]
pub async fn create_test_state() -> AppState {
    let db = Arc::new(Mutex::new(
        Connection::open(":memory:").expect("Failed to create in-memory DB"),
    ));

    {
        let conn = db.lock().await;
        conn.execute("PRAGMA journal_mode = WAL", []).ok();
        conn.execute(
            "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT UNIQUE, avatar TEXT DEFAULT '👤')",
            [],
        )
        .expect("Failed to create users table");
        conn.execute(
            "CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY, sender_id TEXT, sender_name TEXT,
                text TEXT, timestamp INTEGER, delivery_status INTEGER DEFAULT 0,
                recipient_id TEXT, files TEXT DEFAULT '[]'
            )",
            [],
        )
        .expect("Failed to create messages table");
        conn.execute(
            "CREATE TABLE IF NOT EXISTS files (
                id TEXT PRIMARY KEY, name TEXT, path TEXT, size INTEGER,
                sender_id TEXT, recipient_id TEXT, timestamp INTEGER
            )",
            [],
        )
        .expect("Failed to create files table");
    }

    let (tx, _rx) = broadcast::channel::<serde_json::Value>(1000);
    let online_users = Arc::new(Mutex::new(HashMap::new()));

    AppState {
        db,
        tx,
        online_users,
        upload_dir: std::path::PathBuf::from("/tmp/xam-test-files"),
        max_file_size: 100 * 1024 * 1024,
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

    // ============================================
    // ТЕСТЫ РЕГИСТРАЦИИ ПОЛЬЗОВАТЕЛЕЙ
    // ============================================

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

        // Создаём пользователя
        {
            let conn = state.db.lock().await;
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

    // ============================================
    // ТЕСТЫ ПОЛЬЗОВАТЕЛЕЙ
    // ============================================

    #[actix_rt::test]
    async fn test_get_users() {
        let state = create_test_state().await;

        // Добавляем тестовых пользователей
        {
            let conn = state.db.lock().await;
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

        // Добавляем пользователя в онлайн
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

    // ============================================
    // ТЕСТЫ СООБЩЕНИЙ
    // ============================================

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

        // Добавляем тестовые сообщения
        {
            let conn = state.db.lock().await;
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

        // Добавляем тестовые сообщения для разных чатов
        {
            let conn = state.db.lock().await;
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

    // ============================================
    // ТЕСТЫ ФАЙЛОВ
    // ============================================

    #[actix_rt::test]
    async fn test_upload_file_no_file() {
        let state = create_test_state().await;
        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(state))
                .route("/api/v1/files", web::post().to(handlers::upload_file)),
        )
        .await;

        let req = test::TestRequest::post().uri("/api/v1/files").to_request();

        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), 400);

        let body: serde_json::Value = test::read_body_json(resp).await;
        assert_eq!(body["success"], false);
        assert_eq!(body["error"], "No file uploaded");
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
            .uri("/api/v1/files/download?path=/nonexistent")
            .to_request();

        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), 404);

        let body: serde_json::Value = test::read_body_json(resp).await;
        assert_eq!(body["success"], false);
        assert_eq!(body["error"], "File not found");
    }
}
