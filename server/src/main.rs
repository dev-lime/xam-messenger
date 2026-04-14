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

// FIX L-05: выносим mDNS service type в константу
const MDNS_SERVICE_TYPE: &str = "_xam-messenger._tcp.local.";

/// PERF-1: Создаём r2d2 pool соединений SQLite
fn create_db_pool(
    config: &AppConfig,
) -> Result<Pool<SqliteConnectionManager>, Box<dyn std::error::Error>> {
    let db_path = &config.db_path;
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    // Сначала инициализируем БД отдельным соединением (создание таблиц, миграции)
    {
        let init_conn = rusqlite::Connection::open(db_path)?;
        db::init_database(&init_conn)?;
        init_conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")?;
        drop(init_conn);
    }

    // Каждое соединение pool получает PRAGMA для конкурентной работы
    let manager = SqliteConnectionManager::file(db_path.clone()).with_init(|conn| {
        conn.execute_batch(
            "PRAGMA busy_timeout = 10000;
             PRAGMA synchronous = NORMAL;
             PRAGMA foreign_keys = ON;
             PRAGMA cache_size = -5000;",
        )?;
        Ok(())
    });

    let pool = Pool::builder().max_size(16).build(manager)?;

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
        let instance_name = format!("XAM Messenger.{}", MDNS_SERVICE_TYPE);

        let mut txt_props = HashMap::new();
        txt_props.insert("version".to_string(), "1.0.0".to_string());
        txt_props.insert("protocol".to_string(), "ws".to_string());

        match ServiceInfo::new(
            MDNS_SERVICE_TYPE,
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
        // FIX M-05: проверяем конкретное значение "1", а не просто наличие переменной
        let skip_governor = std::env::var("XAM_SKIP_RATE_LIMIT").ok().as_deref() == Some("1");

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
            .route("/health", web::get().to(handlers::health_check))
    })
    .bind(format!("{}:{}", server_config.host, server_config.port))?
    .run();

    // Graceful shutdown
    let state_for_shutdown = state.clone();
    let server_handle = server.handle();
    tokio::spawn(async move {
        if let Ok(()) = tokio::signal::ctrl_c().await {
            info!("📥 Получен сигнал завершения");

            // PERF-3: Отправляем уведомление о завершении всем подключённым клиентам
            let shutdown_payload = serde_json::json!({ "type": "server_shutdown", "message": "Server is shutting down" });
            let senders = state_for_shutdown.user_senders.lock().await;
            for (user_id, user_senders) in senders.iter() {
                for tx in user_senders {
                    let _ = tx.send(shutdown_payload.clone());
                }
                info!("📤 Отправлено server_shutdown пользователю {}", user_id);
            }
            drop(senders);

            // Небольшая задержка чтобы клиенты получили уведомление
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;

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
    // Используем временный файл для тестов чтобы все соединения pool работали с одной БД
    let temp_path: std::path::PathBuf =
        std::env::temp_dir().join(format!("xam-test-{}.db", uuid::Uuid::new_v4()));

    // Инициализируем БД один раз
    {
        let init_conn = rusqlite::Connection::open(&temp_path).expect("Failed to open test DB");
        db::init_database(&init_conn).expect("Failed to init test DB");
        init_conn
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
            .expect("Failed to checkpoint");
        drop(init_conn);
    }

    let manager = SqliteConnectionManager::file(&temp_path).with_init(|conn| {
        conn.execute_batch(
            "PRAGMA busy_timeout = 10000;
             PRAGMA synchronous = NORMAL;
             PRAGMA foreign_keys = ON;
             PRAGMA cache_size = -5000;",
        )?;
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
            // FIX M-01: сообщение без получателя НЕ должно попадать в приватный чат
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
        // FIX M-01: после убирания ветки "OR recipient_id IS NULL" общие сообщения
        // НЕ возвращаются в приватном чате. Ожидаем только msg1 и msg2.
        assert_eq!(messages.len(), 2);

        // Проверяем что msg4 (общее сообщение) НЕ вернулся в чате user2
        let has_general = messages.iter().any(|m| m["id"] == "msg4");
        assert!(
            !has_general,
            "General message should NOT appear in private chat"
        );
    }

    /// FIX M-01/M-06: тест что сообщения без recipient_id НЕ существуют в системе.
    /// Все сообщения ДОЛЖНЫ иметь recipient_id — это гарантирует БД.
    #[actix_rt::test]
    async fn test_all_messages_must_have_recipient() {
        let state = create_test_state().await;

        {
            let conn = state.db.get().expect("Failed to get connection");
            // Вставляем сообщение с recipient_id
            conn.execute(
                "INSERT INTO messages (id, sender_id, sender_name, text, timestamp, recipient_id) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    "msg-with-recipient",
                    "user1",
                    "User 1",
                    "Private",
                    1000,
                    "user2"
                ],
            )
            .expect("Failed to insert message");

            // Вставляем сообщение БЕЗ recipient_id (NULL) — это должно быть возможно в БД
            // но НЕ должно возвращаться в get_messages_for_chat
            conn.execute(
                "INSERT INTO messages (id, sender_id, sender_name, text, timestamp, recipient_id) \
                 VALUES (?1, ?2, ?3, ?4, ?5, NULL)",
                params!["msg-no-recipient", "user1", "User 1", "General", 1001],
            )
            .expect("Failed to insert general message");
        }

        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(state))
                .route("/api/v1/messages", web::get().to(handlers::get_messages)),
        )
        .await;

        // Запрос чата user2 — должен вернуть ТОЛЬКО msg-with-recipient
        let req = test::TestRequest::get()
            .uri("/api/v1/messages?chat_peer_id=user2")
            .to_request();

        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());

        let body: serde_json::Value = test::read_body_json(resp).await;
        let messages = body["data"].as_array().expect("Expected data array");

        // FIX M-01: msg-no-recipient НЕ должен возвращаться в приватном чате
        assert_eq!(
            messages.len(),
            1,
            "Should only return messages involving user2"
        );
        assert_eq!(messages[0]["id"], "msg-with-recipient");
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

    /// FIX L-10: Тест is_chat_participant из db.rs
    #[actix_rt::test]
    async fn test_is_chat_participant_both_exist() {
        let state = create_test_state().await;
        {
            let conn = state.db.get().expect("Failed to get connection");
            conn.execute(
                "INSERT INTO users (id, name, avatar) VALUES (?1, ?2, ?3)",
                params!["alice", "Alice", "👩"],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO users (id, name, avatar) VALUES (?1, ?2, ?3)",
                params!["bob", "Bob", "👨"],
            )
            .unwrap();
        }
        let conn = state.db.get().expect("Failed to get connection");
        assert!(db::is_chat_participant(&conn, "alice", "bob").unwrap());
        assert!(db::is_chat_participant(&conn, "bob", "alice").unwrap());
    }

    #[actix_rt::test]
    async fn test_is_chat_participant_one_missing() {
        let state = create_test_state().await;
        {
            let conn = state.db.get().expect("Failed to get connection");
            conn.execute(
                "INSERT INTO users (id, name, avatar) VALUES (?1, ?2, ?3)",
                params!["alice", "Alice", "👩"],
            )
            .unwrap();
        }
        let conn = state.db.get().expect("Failed to get connection");
        assert!(!db::is_chat_participant(&conn, "alice", "nonexistent").unwrap());
    }

    /// FIX L-10 + C-01: тест get_or_create_user — новый пользователь создаётся
    #[actix_rt::test]
    async fn test_get_or_create_user_new() {
        let state = create_test_state().await;
        let conn = state.db.get().expect("Failed to get connection");
        let user = db::get_or_create_user(&conn, "NewUser", "👤").unwrap();
        assert_eq!(user.name, "NewUser");
        assert_eq!(user.avatar, "👤");
        assert!(!user.id.is_empty());
    }

    /// FIX L-10 + C-01: тест get_or_create_user — существующий пользователь возвращается
    #[actix_rt::test]
    async fn test_get_or_create_user_existing() {
        let state = create_test_state().await;
        {
            let conn = state.db.get().expect("Failed to get connection");
            conn.execute(
                "INSERT INTO users (id, name, avatar) VALUES (?1, ?2, ?3)",
                params!["existing-id", "ExistingUser", "🌟"],
            )
            .unwrap();
        }
        let conn = state.db.get().expect("Failed to get connection");
        let user = db::get_or_create_user(&conn, "ExistingUser", "👤").unwrap();
        assert_eq!(user.id, "existing-id");
        assert_eq!(user.avatar, "🌟"); // Возвращаем существующий avatar, не перезаписываем
    }

    /// FIX L-10: тест get_messages_for_chat — общие сообщения НЕ возвращаются
    #[actix_rt::test]
    async fn test_get_messages_for_chat_excludes_general() {
        let state = create_test_state().await;
        {
            let conn = state.db.get().expect("Failed to get connection");
            conn.execute(
                "INSERT INTO users (id, name, avatar) VALUES (?1, ?2, ?3)",
                params!["u1", "User1", "👤"],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO users (id, name, avatar) VALUES (?1, ?2, ?3)",
                params!["u2", "User2", "👤"],
            )
            .unwrap();
            // Приватное сообщение между u1 и u2
            conn.execute(
                "INSERT INTO messages (id, sender_id, sender_name, text, timestamp, recipient_id) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params!["m1", "u1", "User1", "Private", 1000, "u2"],
            )
            .unwrap();
            // Общее сообщение без получателя
            conn.execute(
                "INSERT INTO messages (id, sender_id, sender_name, text, timestamp) \
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params!["m2", "u3", "User3", "General", 1001],
            )
            .unwrap();
        }
        let conn = state.db.get().expect("Failed to get connection");
        let (msgs, _, _) = db::get_messages_for_chat(&conn, 50, None, "u2").unwrap();
        // FIX M-01: только m1 (приватное), m2 (общее) НЕ должно быть
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].id, "m1");
    }

    /// Тест удаления чата между двумя пользователями
    #[actix_rt::test]
    async fn test_delete_chat_messages() {
        let state = create_test_state().await;
        {
            let conn = state.db.get().expect("Failed to get connection");
            conn.execute(
                "INSERT INTO users (id, name, avatar) VALUES (?1, ?2, ?3)",
                params!["alice", "Alice", "👩"],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO users (id, name, avatar) VALUES (?1, ?2, ?3)",
                params!["bob", "Bob", "👨"],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO users (id, name, avatar) VALUES (?1, ?2, ?3)",
                params!["charlie", "Charlie", "👤"],
            )
            .unwrap();
            // Сообщения между Alice и Bob
            conn.execute(
                "INSERT INTO messages (id, sender_id, sender_name, text, timestamp, recipient_id) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params!["m1", "alice", "Alice", "Hi Bob", 1000, "bob"],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO messages (id, sender_id, sender_name, text, timestamp, recipient_id) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params!["m2", "bob", "Bob", "Hi Alice", 1001, "alice"],
            )
            .unwrap();
            // Сообщения между Alice и Charlie (не должны удалиться)
            conn.execute(
                "INSERT INTO messages (id, sender_id, sender_name, text, timestamp, recipient_id) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params!["m3", "alice", "Alice", "Hi Charlie", 1002, "charlie"],
            )
            .unwrap();
        }

        // Удаляем чат между Alice и Bob
        let conn = state.db.get().expect("Failed to get connection");
        let file_ids = db::delete_chat_messages(&conn, "alice", "bob").unwrap();
        assert_eq!(file_ids.len(), 0); // нет файлов

        // Проверяем что сообщения между Alice и Bob удалены
        let (msgs, _, _) = db::get_messages_for_chat(&conn, 50, None, "bob").unwrap();
        assert_eq!(msgs.len(), 0);

        // Проверяем что сообщения между Alice и Charlie остались
        let (msgs, _, _) = db::get_messages_for_chat(&conn, 50, None, "charlie").unwrap();
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].id, "m3");
    }
}
