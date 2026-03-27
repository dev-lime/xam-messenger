// XAM Messenger Server - WebSocket + HTTP

use actix_web::{web, App, HttpServer, HttpResponse, middleware, Error as ActixError, HttpRequest};
use actix_cors::Cors;
use actix_ws::{Message, MessageStream};
use actix_multipart::Multipart;
use futures_util::{StreamExt, TryStreamExt};
use serde::{Deserialize, Serialize};
use serde_json::json;
use rusqlite::{Connection, params};
use std::sync::{Arc, Mutex};
use tokio::sync::broadcast;
use uuid::Uuid;
use chrono::Utc;
use std::collections::HashMap;
use std::time::SystemTime;

#[derive(Clone, Serialize, Deserialize)]
struct User { id: String, name: String }

#[derive(Clone, Serialize, Deserialize)]
struct ChatMessage {
    id: String, sender_id: String, sender_name: String,
    text: String, timestamp: i64, delivery_status: u8,
    recipient_id: Option<String>,
}

#[derive(Clone)]
struct AppState {
    db: Arc<Mutex<Connection>>,
    tx: broadcast::Sender<serde_json::Value>,
    online_users: Arc<Mutex<HashMap<String, u64>>>, // user_id -> timestamp последнего подключения
}

#[derive(Deserialize)]
struct RegisterReq { name: String }

#[derive(Deserialize)]
struct ClientMsg {
    #[serde(rename = "type")] msg_type: String,
    #[serde(default)] text: String,
    #[serde(default)] name: String,
    #[serde(default)] message_id: String,
    #[serde(default)] status: String,
    #[serde(default)] limit: usize,
    #[serde(default)] recipient_id: Option<String>,
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
    
    // Таблицы
    conn.execute(
        "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT UNIQUE)",
        [],
    )?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY, sender_id TEXT, sender_name TEXT,
            text TEXT, timestamp INTEGER, delivery_status INTEGER DEFAULT 0,
            recipient_id TEXT
        )",
        [],
    )?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS files (
            id TEXT PRIMARY KEY, name TEXT, path TEXT, size INTEGER, 
            sender_id TEXT, recipient_id TEXT, timestamp INTEGER
        )",
        [],
    )?;
    
    let db = Arc::new(Mutex::new(conn));
    let (tx, _rx) = broadcast::channel::<serde_json::Value>(1000);
    let online_users = Arc::new(Mutex::new(HashMap::new()));
    let state = AppState { db, tx, online_users };

    log::info!("🚀 XAM Server на 0.0.0.0:8080");

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
            .route("/ws", web::get().to(ws_handler))
            .route("/api/register", web::post().to(register))
            .route("/api/users", web::get().to(get_users))
            .route("/api/messages", web::get().to(get_messages))
            .route("/api/files", web::post().to(upload_file))
            .route("/api/online", web::get().to(get_online_users))
    })
    .bind("0.0.0.0:8080")?
    .run()
    .await?;
    
    Ok(())
}

async fn ws_handler(
    req: HttpRequest, stream: web::Payload, data: web::Data<AppState>,
) -> Result<HttpResponse, ActixError> {
    let (response, session, msg_stream) = actix_ws::handle(&req, stream)?;
    let state = data.get_ref().clone();
    actix_web::rt::spawn(handle_ws(session, msg_stream, state));
    Ok(response)
}

async fn handle_ws(
    mut session: actix_ws::Session,
    mut msg_stream: MessageStream,
    state: AppState,
) {
    let mut user_id: Option<String> = None;
    let mut rx = state.tx.subscribe();
    
    loop {
        tokio::select! {
            Some(msg) = msg_stream.next() => {
                if let Ok(Message::Text(text)) = msg {
                    if let Ok(client_msg) = serde_json::from_str::<ClientMsg>(&text) {
                        match client_msg.msg_type.as_str() {
                            "register" => {
                                let conn = state.db.lock().unwrap_or_else(|e| e.into_inner());
                                let user: User = conn.query_row(
                                    "INSERT OR IGNORE INTO users (id, name) VALUES (?1, ?2) RETURNING id, name",
                                    params![Uuid::new_v4().to_string(), client_msg.name],
                                    |row| Ok(User { id: row.get(0)?, name: row.get(1)? })
                                ).or_else(|_| {
                                    conn.query_row(
                                        "SELECT id, name FROM users WHERE name = ?1",
                                        params![client_msg.name],
                                        |row| Ok(User { id: row.get(0)?, name: row.get(1)? })
                                    )
                                }).unwrap();

                                user_id = Some(user.id.clone());
                                
                                // Добавляем в онлайн
                                let timestamp = SystemTime::now()
                                    .duration_since(SystemTime::UNIX_EPOCH)
                                    .unwrap()
                                    .as_secs();
                                state.online_users.lock().unwrap().insert(user.id.clone(), timestamp);
                                
                                // Отправляем список текущих онлайн пользователей
                                let online_list: Vec<String> = state.online_users.lock().unwrap().keys().cloned().collect();
                                for online_id in &online_list {
                                    let _ = session.text(json!({
                                        "type": "user_online",
                                        "user_id": online_id.clone(),
                                        "online": true
                                    }).to_string()).await;
                                }
                                
                                // Рассылаем остальным что этот пользователь подключился
                                let _ = state.tx.send(json!({
                                    "type": "user_online",
                                    "user_id": user.id.clone(),
                                    "online": true
                                }));

                                let _ = session.text(json!({
                                    "type": "registered", "user": user
                                }).to_string()).await;

                                log::info!("✅ {}: {}", user.name, user.id);
                            }
                            "message" => {
                                let uid = user_id.clone().unwrap();
                                let conn = state.db.lock().unwrap_or_else(|e| e.into_inner());
                                let uname: String = conn.query_row(
                                    "SELECT name FROM users WHERE id = ?1", params![uid],
                                    |row| row.get(0)
                                ).unwrap_or_default();
                                drop(conn);

                                let msg = ChatMessage {
                                    id: Uuid::new_v4().to_string(),
                                    sender_id: uid.clone(),
                                    sender_name: uname,
                                    text: client_msg.text.clone(),
                                    timestamp: Utc::now().timestamp(),
                                    delivery_status: 1,
                                    recipient_id: client_msg.recipient_id.clone(),
                                };

                                state.db.lock().unwrap_or_else(|e| e.into_inner()).execute(
                                    "INSERT INTO messages (id, sender_id, sender_name, text, timestamp, delivery_status, recipient_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                                    params![msg.id, msg.sender_id, msg.sender_name, msg.text, msg.timestamp, msg.delivery_status, msg.recipient_id],
                                ).unwrap();

                                let _ = state.tx.send(json!({ "type": "message", "message": msg }));
                            }
                            "ack" => {
                                let status = if client_msg.status == "read" { 2 } else { 1 };
                                let msg_id = client_msg.message_id.clone();
                                log::info!("📨 ACK {} для {}", client_msg.status, msg_id);
                                
                                state.db.lock().unwrap_or_else(|e| e.into_inner()).execute(
                                    "UPDATE messages SET delivery_status = ?1 WHERE id = ?2",
                                    params![status, client_msg.message_id],
                                ).unwrap();
                                
                                let ack_msg = json!({
                                    "type": "ack", "message_id": msg_id, "status": client_msg.status
                                });
                                log::info!("📤 Рассылка ACK: {}", ack_msg);
                                let _ = state.tx.send(ack_msg);
                            }
                            "get_messages" => {
                                let conn = state.db.lock().unwrap_or_else(|e| e.into_inner());
                                let mut stmt = conn.prepare(
                                    "SELECT id, sender_id, sender_name, text, timestamp, delivery_status, recipient_id FROM messages ORDER BY timestamp ASC LIMIT ?1"
                                ).unwrap();
                                let msgs: Vec<ChatMessage> = stmt.query_map(
                                    params![client_msg.limit.max(100)],
                                    |row| Ok(ChatMessage {
                                        id: row.get(0)?, sender_id: row.get(1)?, sender_name: row.get(2)?,
                                        text: row.get(3)?, timestamp: row.get(4)?, delivery_status: row.get(5)?,
                                        recipient_id: row.get(6)?,
                                    })
                                ).unwrap().filter_map(|r| r.ok()).collect();
                                let _ = session.text(json!({ "type": "messages", "messages": msgs }).to_string()).await;
                            }
                            _ => {}
                        }
                    }
                } else if matches!(msg, Ok(Message::Close(_)) | Err(_)) {
                    log::info!("🔌 Клиент отключился");
                    
                    // Удаляем из онлайн и рассылаем уведомление
                    if let Some(uid) = &user_id {
                        state.online_users.lock().unwrap().remove(uid);
                        let _ = state.tx.send(json!({ 
                            "type": "user_online", 
                            "user_id": uid.clone(),
                            "online": false
                        }));
                        log::info!("🔴 Пользователь {} офлайн", uid);
                    }
                    
                    break;
                }
            }
            Ok(msg) = rx.recv() => {
                if let Some(uid) = &user_id {
                    if msg.get("type").and_then(|v| v.as_str()) == Some("message") {
                        if msg.get("message").and_then(|m| m.get("sender_id").and_then(|v| v.as_str())) == Some(uid) {
                            continue;
                        }
                    }
                }
                let _ = session.text(msg.to_string()).await;
            }
        }
    }
}

async fn register(data: web::Data<AppState>, body: web::Json<RegisterReq>) -> HttpResponse {
    let db = data.db.lock().unwrap_or_else(|e| e.into_inner());
    let name = body.name.trim();
    if name.is_empty() {
        return HttpResponse::BadRequest().json(json!({"success": false, "error": "Empty name"}));
    }

    // Пробуем найти существующего пользователя или создать нового
    let user = match db.query_row(
        "SELECT id, name FROM users WHERE name = ?1",
        params![name],
        |row| Ok(User { id: row.get(0)?, name: row.get(1)? })
    ) {
        Ok(u) => u,
        Err(_) => {
            match db.query_row(
                "INSERT INTO users (id, name) VALUES (?1, ?2) RETURNING id, name",
                params![Uuid::new_v4().to_string(), name],
                |row| Ok(User { id: row.get(0)?, name: row.get(1)? })
            ) {
                Ok(u) => u,
                Err(e) => return HttpResponse::InternalServerError().json(json!({"success": false, "error": e.to_string()})),
            }
        }
    };
    
    HttpResponse::Ok().json(json!({"success": true, "data": user}))
}

async fn get_users(data: web::Data<AppState>) -> HttpResponse {
    let conn = data.db.lock().unwrap_or_else(|e| e.into_inner());
    let mut stmt = conn.prepare("SELECT id, name FROM users ORDER BY name").unwrap();
    let users: Vec<User> = stmt.query_map(
        params![],
        |row| Ok(User { id: row.get(0)?, name: row.get(1)? })
    ).unwrap().filter_map(|r| r.ok()).collect();
    HttpResponse::Ok().json(json!({"success": true, "data": users}))
}

async fn get_online_users(data: web::Data<AppState>) -> HttpResponse {
    let online = data.online_users.lock().unwrap();
    let online_list: Vec<String> = online.keys().cloned().collect();
    HttpResponse::Ok().json(json!({"success": true, "data": online_list}))
}

async fn get_messages(
    data: web::Data<AppState>, query: web::Query<std::collections::HashMap<String, String>>,
) -> HttpResponse {
    let limit: usize = query.get("limit").and_then(|s| s.parse().ok()).unwrap_or(100);
    let conn = match data.db.lock() {
        Ok(c) => c,
        Err(e) => return HttpResponse::InternalServerError().json(json!({"success": false, "error": e.to_string()})),
    };
    
    let result = conn.prepare(
        "SELECT id, sender_id, sender_name, text, timestamp, delivery_status, recipient_id FROM messages ORDER BY timestamp ASC LIMIT ?1"
    );
    
    let mut stmt = match result {
        Ok(s) => s,
        Err(e) => return HttpResponse::InternalServerError().json(json!({"success": false, "error": e.to_string()})),
    };
    
    let msgs: Vec<ChatMessage> = stmt.query_map(
        params![limit],
        |row| Ok(ChatMessage {
            id: row.get(0)?, sender_id: row.get(1)?, sender_name: row.get(2)?,
            text: row.get(3)?, timestamp: row.get(4)?, delivery_status: row.get(5)?,
            recipient_id: row.get(6)?,
        })
    ).ok()
        .map(|iter| iter.filter_map(|r| r.ok()).collect())
        .unwrap_or_default();
    
    HttpResponse::Ok().json(json!({"success": true, "data": msgs}))
}

async fn upload_file(
    data: web::Data<AppState>,
    mut payload: Multipart,
) -> HttpResponse {
    let upload_dir = dirs::data_local_dir()
        .unwrap_or_else(|| ".".into())
        .join("xam-messenger")
        .join("files");

    if let Err(e) = std::fs::create_dir_all(&upload_dir) {
        return HttpResponse::InternalServerError().json(json!({
            "success": false,
            "error": format!("Failed to create upload dir: {}", e)
        }));
    }

    while let Ok(Some(mut field)) = payload.try_next().await {
        // Сначала получаем имя файла
        let filename: String = field.content_disposition()
            .as_ref()
            .and_then(|cd| cd.get_filename())
            .unwrap_or("unnamed")
            .to_string();

        let filepath = upload_dir.join(format!("{}_{}", Uuid::new_v4(), filename));

        let mut size = 0u64;
        let mut file_bytes = Vec::new();

        while let Some(chunk) = field.try_next().await.ok().flatten() {
            size += chunk.len() as u64;
            file_bytes.extend_from_slice(&chunk);
        }

        if let Err(e) = std::fs::write(&filepath, &file_bytes) {
            return HttpResponse::InternalServerError().json(json!({
                "success": false,
                "error": format!("Failed to save file: {}", e)
            }));
        }

        let file_id = Uuid::new_v4().to_string();
        let conn = data.db.lock().unwrap_or_else(|e| e.into_inner());
        let _ = conn.execute(
            "INSERT INTO files (id, name, path, size, sender_id, recipient_id, timestamp) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![file_id, &filename, filepath.to_string_lossy(), size, "", "", Utc::now().timestamp()],
        );

        return HttpResponse::Ok().json(json!({
            "success": true,
            "data": {
                "id": file_id,
                "name": filename,
                "size": size,
                "path": filepath.to_string_lossy()
            }
        }));
    }

    HttpResponse::BadRequest().json(json!({
        "success": false,
        "error": "No file uploaded"
    }))
}

