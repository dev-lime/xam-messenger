//! XAM Messenger Server - WebSocket + HTTP
//!
//! Сервер мессенджера для локальной сети с поддержкой:
//! - WebSocket для обмена сообщениями в реальном времени
//! - HTTP API для регистрации, получения пользователей и загрузки файлов
//! - SQLite для хранения данных

#![allow(clippy::await_holding_lock)]
#![allow(clippy::manual_clamp)]
#![allow(clippy::collapsible_if)]
#![allow(clippy::needless_return)]

mod db;
mod handlers;
mod models;
mod websocket;

use actix_cors::Cors;
use actix_web::{middleware, web, App, HttpServer};
use log::info;
use rusqlite::Connection;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::broadcast;

use models::AppState;
use websocket::ws_handler;

/// Получение всех локальных IP адресов
fn get_local_ips() -> Vec<String> {
    let mut ips = Vec::new();

    // Получаем список всех сетевых интерфейсов
    if let Ok(interfaces) = get_if_addrs::get_if_addrs() {
        for iface in interfaces {
            // Пропускаем loopback и не IPv4 адреса
            if !iface.is_loopback() {
                if let get_if_addrs::IfAddr::V4(ipv4) = iface.addr {
                    ips.push(ipv4.ip.to_string());
                }
            }
        }
    }

    ips
}

#[actix_web::main]
async fn main() -> std::result::Result<(), Box<dyn std::error::Error>> {
    env_logger::init_from_env(env_logger::Env::default().default_filter_or("info"));

    // Инициализация БД
    let db_path = dirs::config_dir()
        .unwrap_or_else(|| ".".into())
        .join("xam-messenger")
        .join("xam.db");

    std::fs::create_dir_all(db_path.parent().unwrap())?;

    let conn = Connection::open(&db_path)?;

    // Инициализация схемы БД
    db::init_database(&conn)?;

    info!("✅ База данных: {}", db_path.display());

    // Получаем и выводим локальные IP адреса
    let local_ips = get_local_ips();
    if !local_ips.is_empty() {
        info!("📡 Локальные IP адреса:");
        for ip in &local_ips {
            info!("   └─ http://{}:8080", ip);
        }
        info!("💡 Используйте эти адреса для подключения клиентов");
    }

    let db = Arc::new(Mutex::new(conn));
    let (tx, _rx) = broadcast::channel::<serde_json::Value>(1000);
    let online_users = Arc::new(Mutex::new(HashMap::new()));
    let state = AppState {
        db,
        tx,
        online_users,
    };

    info!("🚀 XAM Server на 0.0.0.0:8080");

    HttpServer::new(move || {
        let cors = Cors::default()
            .allow_any_origin()
            .allow_any_method()
            .allow_any_header()
            .send_wildcard()
            .max_age(3600);

        App::new()
            .wrap(cors)
            .app_data(web::Data::new(state.clone()))
            .wrap(middleware::Logger::default())
            .app_data(web::PayloadConfig::new(100 * 1024 * 1024))
            .route("/ws", web::get().to(ws_handler))
            .route("/api/register", web::post().to(handlers::register))
            .route("/api/users", web::get().to(handlers::get_users))
            .route("/api/messages", web::get().to(handlers::get_messages))
            .route("/api/files", web::post().to(handlers::upload_file))
            .route(
                "/api/files/download",
                web::get().to(handlers::download_file),
            )
            .route("/api/online", web::get().to(handlers::get_online_users))
    })
    .bind("0.0.0.0:8080")?
    .run()
    .await?;

    Ok(())
}

// ============================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ДЛЯ ТЕСТОВ
// ============================================

/// Создаёт тестовое состояние с временной БД (в памяти)
#[cfg(test)]
pub fn create_test_state() -> AppState {
    let db = Arc::new(Mutex::new(
        Connection::open(":memory:").expect("Failed to create in-memory DB"),
    ));

    // Инициализация тестовой БД
    let conn = db.lock().unwrap();
    conn.execute("PRAGMA journal_mode = WAL", []).ok();
    conn.execute(
        "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT UNIQUE, avatar TEXT DEFAULT '👤')",
        [],
    )
    .unwrap();
    conn.execute(
        "CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY, sender_id TEXT, sender_name TEXT,
            text TEXT, timestamp INTEGER, delivery_status INTEGER DEFAULT 0,
            recipient_id TEXT, files TEXT DEFAULT '[]'
        )",
        [],
    )
    .unwrap();
    conn.execute(
        "CREATE TABLE IF NOT EXISTS files (
            id TEXT PRIMARY KEY, name TEXT, path TEXT, size INTEGER,
            sender_id TEXT, recipient_id TEXT, timestamp INTEGER
        )",
        [],
    )
    .unwrap();
    drop(conn);

    let (tx, _rx) = broadcast::channel::<serde_json::Value>(1000);
    let online_users = Arc::new(Mutex::new(HashMap::new()));

    AppState {
        db,
        tx,
        online_users,
    }
}

// ============================================
// ТЕСТЫ
// ============================================

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::{test, web, App};
    use rusqlite::params;
    use serde_json::json;

    // ============================================
    // ТЕСТЫ РЕГИСТРАЦИИ ПОЛЬЗОВАТЕЛЕЙ
    // ============================================

    #[actix_rt::test]
    async fn test_register_new_user() {
        let state = create_test_state();
        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(state))
                .route("/api/register", web::post().to(handlers::register)),
        )
        .await;

        let req = test::TestRequest::post()
            .uri("/api/register")
            .set_json(json!({ "name": "Тестовый Пользователь" }))
            .to_request();

        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());

        let body: serde_json::Value = test::read_body_json(resp).await;
        assert_eq!(body["success"], true);
        assert_eq!(body["data"]["name"], "Тестовый Пользователь");
        assert!(body["data"]["id"].as_str().unwrap().len() > 0);
    }

    #[actix_rt::test]
    async fn test_register_existing_user() {
        let state = create_test_state();

        // Создаём пользователя
        {
            let conn = state.db.lock().unwrap();
            conn.execute(
                "INSERT INTO users (id, name, avatar) VALUES (?1, ?2, ?3)",
                params!["test-id", "Existing User", "👤"],
            )
            .unwrap();
        }

        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(state))
                .route("/api/register", web::post().to(handlers::register)),
        )
        .await;

        let req = test::TestRequest::post()
            .uri("/api/register")
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
        let state = create_test_state();
        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(state))
                .route("/api/register", web::post().to(handlers::register)),
        )
        .await;

        let req = test::TestRequest::post()
            .uri("/api/register")
            .set_json(json!({ "name": "" }))
            .to_request();

        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), 400);

        let body: serde_json::Value = test::read_body_json(resp).await;
        assert_eq!(body["success"], false);
        assert_eq!(body["error"], "Empty name");
    }

    // ============================================
    // ТЕСТЫ ПОЛЬЗОВАТЕЛЕЙ
    // ============================================

    #[actix_rt::test]
    async fn test_get_users() {
        let state = create_test_state();

        // Добавляем тестовых пользователей
        {
            let conn = state.db.lock().unwrap();
            conn.execute(
                "INSERT INTO users (id, name, avatar) VALUES (?1, ?2, ?3)",
                params!["user1", "Alice", "👩"],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO users (id, name, avatar) VALUES (?1, ?2, ?3)",
                params!["user2", "Bob", "👨"],
            )
            .unwrap();
        }

        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(state))
                .route("/api/users", web::get().to(handlers::get_users)),
        )
        .await;

        let req = test::TestRequest::get().uri("/api/users").to_request();

        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());

        let body: serde_json::Value = test::read_body_json(resp).await;
        assert_eq!(body["success"], true);
        let users = body["data"].as_array().unwrap();
        assert_eq!(users.len(), 2);
    }

    #[actix_rt::test]
    async fn test_get_online_users() {
        let state = create_test_state();

        // Добавляем пользователя в онлайн
        {
            let mut online = state.online_users.lock().unwrap();
            online.insert("user1".to_string(), 12345);
            online.insert("user2".to_string(), 12346);
        }

        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(state))
                .route("/api/online", web::get().to(handlers::get_online_users)),
        )
        .await;

        let req = test::TestRequest::get().uri("/api/online").to_request();

        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());

        let body: serde_json::Value = test::read_body_json(resp).await;
        assert_eq!(body["success"], true);
        let online = body["data"].as_array().unwrap();
        assert_eq!(online.len(), 2);
    }

    // ============================================
    // ТЕСТЫ СООБЩЕНИЙ
    // ============================================

    #[actix_rt::test]
    async fn test_get_messages_empty() {
        let state = create_test_state();
        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(state))
                .route("/api/messages", web::get().to(handlers::get_messages)),
        )
        .await;

        let req = test::TestRequest::get().uri("/api/messages").to_request();

        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());

        let body: serde_json::Value = test::read_body_json(resp).await;
        assert_eq!(body["success"], true);
        assert_eq!(body["data"].as_array().unwrap().len(), 0);
    }

    #[actix_rt::test]
    async fn test_get_messages_with_limit() {
        let state = create_test_state();

        // Добавляем тестовые сообщения
        {
            let conn = state.db.lock().unwrap();
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
                .unwrap();
            }
        }

        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(state))
                .route("/api/messages", web::get().to(handlers::get_messages)),
        )
        .await;

        let req = test::TestRequest::get()
            .uri("/api/messages?limit=5")
            .to_request();

        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());

        let body: serde_json::Value = test::read_body_json(resp).await;
        assert_eq!(body["success"], true);
        let messages = body["data"].as_array().unwrap();
        assert_eq!(messages.len(), 5);
    }

    #[actix_rt::test]
    async fn test_get_messages_for_chat() {
        let state = create_test_state();

        // Добавляем тестовые сообщения для разных чатов
        {
            let conn = state.db.lock().unwrap();
            // Личные сообщения между user1 и user2
            conn.execute(
                "INSERT INTO messages (id, sender_id, sender_name, text, timestamp, recipient_id) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params!["msg1", "user1", "User 1", "Hello", 1000, "user2"],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO messages (id, sender_id, sender_name, text, timestamp, recipient_id) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params!["msg2", "user2", "User 2", "Hi", 1001, "user1"],
            )
            .unwrap();

            // Сообщение от user3 к user4 (другой чат)
            conn.execute(
                "INSERT INTO messages (id, sender_id, sender_name, text, timestamp, recipient_id) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params!["msg3", "user3", "User 3", "Other chat", 1002, "user4"],
            )
            .unwrap();

            // Общее сообщение (без получателя)
            conn.execute(
                "INSERT INTO messages (id, sender_id, sender_name, text, timestamp) \
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params!["msg4", "user5", "User 5", "General message", 1003],
            )
            .unwrap();
        }

        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(state))
                .route("/api/messages", web::get().to(handlers::get_messages)),
        )
        .await;

        // Запрашиваем сообщения для чата user1-user2
        let req = test::TestRequest::get()
            .uri("/api/messages?chat_peer_id=user2")
            .to_request();

        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());

        let body: serde_json::Value = test::read_body_json(resp).await;
        assert_eq!(body["success"], true);
        let messages = body["data"].as_array().unwrap();
        // Должны вернуться: msg1, msg2 (личные) и msg4 (общее), но не msg3
        assert_eq!(messages.len(), 3);
    }

    // ============================================
    // ТЕСТЫ ФАЙЛОВ
    // ============================================

    #[actix_rt::test]
    async fn test_upload_file_no_file() {
        let state = create_test_state();
        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(state))
                .route("/api/files", web::post().to(handlers::upload_file)),
        )
        .await;

        let req = test::TestRequest::post().uri("/api/files").to_request();

        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), 400);

        let body: serde_json::Value = test::read_body_json(resp).await;
        assert_eq!(body["success"], false);
        assert_eq!(body["error"], "No file uploaded");
    }

    #[actix_rt::test]
    async fn test_download_file_not_found() {
        let state = create_test_state();
        let app = test::init_service(App::new().app_data(web::Data::new(state)).route(
            "/api/files/download",
            web::get().to(handlers::download_file),
        ))
        .await;

        let req = test::TestRequest::get()
            .uri("/api/files/download?path=/nonexistent")
            .to_request();

        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), 404);

        let body: serde_json::Value = test::read_body_json(resp).await;
        assert_eq!(body["success"], false);
        assert_eq!(body["error"], "File not found");
    }
}
