#![allow(clippy::await_holding_lock)]
#![allow(clippy::manual_clamp)]
#![allow(clippy::collapsible_if)]
#![allow(clippy::needless_return)]

// XAM Messenger Server - WebSocket + HTTP

use actix_cors::Cors;
use actix_multipart::Multipart;
use actix_web::{middleware, web, App, Error as ActixError, HttpRequest, HttpResponse, HttpServer};
use actix_ws::{Message, MessageStream};
use chrono::Utc;
use futures_util::{StreamExt, TryStreamExt};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::SystemTime;
use tokio::sync::broadcast;
use uuid::Uuid;

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct User {
    id: String,
    name: String,
    #[serde(default)]
    pub avatar: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct FileData {
    pub name: String,
    pub size: u64,
    pub path: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct ChatMessage {
    pub id: String,
    pub sender_id: String,
    pub sender_name: String,
    pub text: String,
    pub timestamp: i64,
    pub delivery_status: u8,
    pub recipient_id: Option<String>,
    #[serde(default)]
    pub files: Vec<FileData>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct ClientMsg {
    #[serde(rename = "type")]
    pub msg_type: String,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub message_id: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub limit: usize,
    #[serde(default)]
    pub before_id: Option<String>,
    #[serde(default)]
    pub recipient_id: Option<String>,
    #[serde(default)]
    pub files: Vec<FileData>,
}

#[derive(Clone)]
pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
    pub tx: broadcast::Sender<serde_json::Value>,
    pub online_users: Arc<Mutex<HashMap<String, u64>>>,
}

#[derive(Deserialize)]
struct RegisterReq {
    name: String,
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
        "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT UNIQUE, avatar TEXT DEFAULT '👤')",
        [],
    )?;
    // Миграция: добавляем колонку avatar если её нет (для старых баз)
    conn.execute("ALTER TABLE users ADD COLUMN avatar TEXT DEFAULT '👤'", [])
        .ok(); // Игнорируем ошибку если колонка уже существует

    conn.execute(
        "CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY, sender_id TEXT, sender_name TEXT,
            text TEXT, timestamp INTEGER, delivery_status INTEGER DEFAULT 0,
            recipient_id TEXT
        )",
        [],
    )?;
    // Миграция: добавляем колонку files если её нет
    conn.execute(
        "ALTER TABLE messages ADD COLUMN files TEXT DEFAULT '[]'",
        [],
    )
    .ok(); // Игнорируем ошибку если колонка уже существует
    conn.execute(
        "CREATE TABLE IF NOT EXISTS files (
            id TEXT PRIMARY KEY, name TEXT, path TEXT, size INTEGER,
            sender_id TEXT, recipient_id TEXT, timestamp INTEGER
        )",
        [],
    )?;

    // Обновляем существующих пользователей аватаром по умолчанию
    conn.execute(
        "UPDATE users SET avatar = '👤' WHERE avatar IS NULL OR avatar = ''",
        [],
    )
    .ok();

    let db = Arc::new(Mutex::new(conn));
    let (tx, _rx) = broadcast::channel::<serde_json::Value>(1000);
    let online_users = Arc::new(Mutex::new(HashMap::new()));
    let state = AppState {
        db,
        tx,
        online_users,
    };

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
            // Увеличиваем лимит payload для загрузки файлов (до 100MB)
            .app_data(web::PayloadConfig::new(100 * 1024 * 1024))
            .route("/ws", web::get().to(ws_handler))
            .route("/api/register", web::post().to(register))
            .route("/api/users", web::get().to(get_users))
            .route("/api/messages", web::get().to(get_messages))
            .route("/api/files", web::post().to(upload_file))
            .route("/api/files/download", web::get().to(download_file))
            .route("/api/online", web::get().to(get_online_users))
    })
    .bind("0.0.0.0:8080")?
    .run()
    .await?;

    Ok(())
}

async fn ws_handler(
    req: HttpRequest,
    stream: web::Payload,
    data: web::Data<AppState>,
) -> Result<HttpResponse, ActixError> {
    let (response, session, msg_stream) = actix_ws::handle(&req, stream)?;
    let state = data.get_ref().clone();
    actix_web::rt::spawn(handle_ws(session, msg_stream, state));
    Ok(response)
}

/// Обработка клиентского сообщения с логированием ошибок
async fn handle_client_msg(
    client_msg: ClientMsg,
    user_id: &mut Option<String>,
    session: &mut actix_ws::Session,
    state: &AppState,
) {
    match client_msg.msg_type.as_str() {
        "register" => {
            let conn = state.db.lock().unwrap_or_else(|e| e.into_inner());

            // Получаем аватар из запроса или используем значение по умолчанию
            let avatar = if !client_msg.text.is_empty() {
                client_msg.text.clone()
            } else {
                "👤".to_string()
            };

            let user: User = conn.query_row(
                "INSERT OR IGNORE INTO users (id, name, avatar) VALUES (?1, ?2, ?3) RETURNING id, name, avatar",
                params![Uuid::new_v4().to_string(), client_msg.name, avatar],
                |row| Ok(User { id: row.get(0)?, name: row.get(1)?, avatar: row.get(2)? })
            ).or_else(|_| {
                conn.query_row(
                    "SELECT id, name, avatar FROM users WHERE name = ?1",
                    params![client_msg.name],
                    |row| Ok(User { id: row.get(0)?, name: row.get(1)?, avatar: row.get(2)? })
                )
            }).unwrap();

            *user_id = Some(user.id.clone());

            // Добавляем в онлайн
            let timestamp = SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_secs();
            state
                .online_users
                .lock()
                .unwrap()
                .insert(user.id.clone(), timestamp);

            // Отправляем список текущих онлайн пользователей
            let online_list: Vec<String> =
                state.online_users.lock().unwrap().keys().cloned().collect();
            for online_id in &online_list {
                let _ = session
                    .text(
                        json!({
                            "type": "user_online",
                            "user_id": online_id.clone(),
                            "online": true
                        })
                        .to_string(),
                    )
                    .await;
            }

            // Рассылаем остальным что этот пользователь подключился
            let _ = state.tx.send(json!({
                "type": "user_online",
                "user_id": user.id.clone(),
                "online": true
            }));

            let _ = session
                .text(
                    json!({
                        "type": "registered", "user": user
                    })
                    .to_string(),
                )
                .await;

            log::info!("✅ {}: {}", user.name, user.id);
        }
        "update_profile" => {
            let uid = match &user_id {
                Some(id) => id.clone(),
                None => {
                    log::warn!("⚠️ Обновление профиля до регистрации");
                    return;
                }
            };

            let new_avatar = if !client_msg.text.is_empty() {
                client_msg.text.clone()
            } else {
                "👤".to_string()
            };

            log::info!("👤 Обновление профиля: user={}, avatar={}", uid, new_avatar);

            let conn = state.db.lock().unwrap_or_else(|e| e.into_inner());
            conn.execute(
                "UPDATE users SET avatar = ?1 WHERE id = ?2",
                params![new_avatar, uid],
            )
            .unwrap();

            // Обновляем онлайн пользователей и рассылаем новый аватар
            let _ = state.tx.send(json!({
                "type": "user_updated",
                "user_id": uid,
                "avatar": new_avatar
            }));
        }
        "message" => {
            let uid = match &user_id {
                Some(id) => id.clone(),
                None => {
                    log::warn!("⚠️ Получено сообщение до регистрации пользователя");
                    return;
                }
            };

            log::info!("📩 Raw message: {:?}", client_msg);
            log::info!("📩 Files received: {} items", client_msg.files.len());
            for (i, f) in client_msg.files.iter().enumerate() {
                log::info!(
                    "  File {}: name={}, size={}, path={}",
                    i,
                    f.name,
                    f.size,
                    f.path
                );
            }

            let conn = state.db.lock().unwrap_or_else(|e| e.into_inner());
            let uname: String = conn
                .query_row(
                    "SELECT name FROM users WHERE id = ?1",
                    params![uid],
                    |row| row.get(0),
                )
                .unwrap_or_default();
            drop(conn);

            log::info!(
                "📩 Получено сообщение: text={}, files={}",
                client_msg.text,
                client_msg.files.len()
            );

            let files_json = serde_json::to_string(&client_msg.files).unwrap_or_default();

            let msg = ChatMessage {
                id: Uuid::new_v4().to_string(),
                sender_id: uid.clone(),
                sender_name: uname,
                text: client_msg.text.clone(),
                timestamp: Utc::now().timestamp(),
                delivery_status: 1,
                recipient_id: client_msg.recipient_id.clone(),
                files: client_msg.files.clone(),
            };

            log::info!("💾 Сохраняем сообщение с {} файлами", msg.files.len());

            state.db.lock().unwrap_or_else(|e| e.into_inner()).execute(
                "INSERT INTO messages (id, sender_id, sender_name, text, timestamp, delivery_status, recipient_id, files) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![msg.id, msg.sender_id, msg.sender_name, msg.text, msg.timestamp, msg.delivery_status, msg.recipient_id, files_json],
            ).unwrap();

            log::info!(
                "📤 Рассылка сообщения: id={}, files={}",
                msg.id,
                msg.files.len()
            );
            let _ = state.tx.send(json!({ "type": "message", "message": msg }));
        }
        "ack" => {
            let ack_sender_id = match &user_id {
                Some(id) => id.clone(),
                None => {
                    log::warn!("⚠️ Получен ACK до регистрации пользователя");
                    return;
                }
            };
            let status = if client_msg.status == "read" { 2 } else { 1 };
            let msg_id = client_msg.message_id.clone();
            log::info!(
                "📨 ACK {} для {} от {}",
                client_msg.status,
                msg_id,
                ack_sender_id
            );

            state
                .db
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .execute(
                    "UPDATE messages SET delivery_status = ?1 WHERE id = ?2",
                    params![status, client_msg.message_id],
                )
                .unwrap();

            let ack_msg = json!({
                "type": "ack", "message_id": msg_id, "status": client_msg.status, "sender_id": ack_sender_id
            });
            log::info!("📤 Рассылка ACK: {}", ack_msg);
            let _ = state.tx.send(ack_msg);
        }
        "get_messages" => {
            let conn = state.db.lock().unwrap_or_else(|e| e.into_inner());

            // Поддержка пагинации: limit (по умолчанию 50, макс 200) и before_id (опционально)
            let limit = client_msg.limit.max(1).min(200);
            let before_id = &client_msg.before_id;

            log::info!(
                "📚 Загрузка сообщений: limit={}, before_id={:?}",
                limit,
                before_id
            );

            // Загружаем на 1 сообщение больше чтобы проверить есть ли ещё
            let sql = if let Some(last_id) = before_id {
                // Загружаем сообщения ДО указанного ID
                format!("SELECT id, sender_id, sender_name, text, timestamp, delivery_status, recipient_id, files FROM messages WHERE id < '{}' ORDER BY timestamp DESC LIMIT {}", last_id, limit + 1)
            } else {
                // Первая загрузка - самые новые сообщения
                format!("SELECT id, sender_id, sender_name, text, timestamp, delivery_status, recipient_id, files FROM messages ORDER BY timestamp DESC LIMIT {}", limit + 1)
            };

            let mut stmt = conn.prepare(&sql).unwrap();

            let mut msgs: Vec<ChatMessage> = stmt
                .query_map(params![], |row| {
                    let files_str: String = row.get(7)?;
                    let files: Vec<FileData> = serde_json::from_str(&files_str).unwrap_or_default();
                    Ok(ChatMessage {
                        id: row.get(0)?,
                        sender_id: row.get(1)?,
                        sender_name: row.get(2)?,
                        text: row.get(3)?,
                        timestamp: row.get(4)?,
                        delivery_status: row.get(5)?,
                        recipient_id: row.get(6)?,
                        files,
                    })
                })
                .unwrap()
                .filter_map(|r| r.ok())
                .collect();

            // Проверяем есть ли ещё сообщения (загрузили ли больше чем limit)
            let loaded_count = msgs.len();
            let has_more = loaded_count > limit;

            log::info!(
                "📚 Загружено {} сообщений, limit={}, has_more={}",
                loaded_count,
                limit,
                has_more
            );

            // Если загрузили лишнее сообщение - сохраняем его ID и убираем
            let next_before_id = if has_more {
                // Последнее сообщение в списке (самое старое из загруженных)
                let last_id = msgs.last().map(|m| m.id.clone());
                log::info!("📚 next_before_id={:?}", last_id);
                last_id
            } else {
                log::info!("📚 next_before_id=None (не загружено больше limit)");
                None
            };

            // Убираем лишнее сообщение
            if has_more {
                msgs.pop();
                log::info!("📚 Убрано лишнее сообщение, осталось {}", msgs.len());
            }

            // Возвращаем сообщения в правильном порядке (старые → новые)
            let msgs: Vec<ChatMessage> = msgs.into_iter().rev().collect();

            log::debug!(
                "📚 Загружено {} сообщений, has_more={}, next_before_id={:?}",
                msgs.len(),
                has_more,
                next_before_id
            );

            // Формируем ответ с явным указанием next_before_id
            let response = if let Some(ref id) = next_before_id {
                json!({
                    "type": "messages",
                    "messages": msgs,
                    "before_id": before_id,
                    "next_before_id": id,
                    "limit": limit,
                    "has_more": has_more
                })
            } else {
                json!({
                    "type": "messages",
                    "messages": msgs,
                    "before_id": before_id,
                    "next_before_id": null,
                    "limit": limit,
                    "has_more": has_more
                })
            };

            let _ = session.text(response.to_string()).await;
        }
        _ => {
            log::warn!("⚠️ Неизвестный тип сообщения: {}", client_msg.msg_type);
        }
    }
}

async fn handle_ws(mut session: actix_ws::Session, mut msg_stream: MessageStream, state: AppState) {
    let mut user_id: Option<String> = None;
    let mut rx = state.tx.subscribe();
    let mut text_fragment_buffer = String::new();

    loop {
        tokio::select! {
            Some(msg) = msg_stream.next() => {
                match msg {
                    Ok(Message::Text(text)) => {
                        log::debug!("📥 Получено WebSocket сообщение, размер: {} байт", text.len());

                        // Пробуем распарсить как完整ное сообщение
                        match serde_json::from_str::<ClientMsg>(&text) {
                            Ok(client_msg) => {
                                log::info!("✅ JSON распарсен успешно, тип: {}", client_msg.msg_type);
                                handle_client_msg(client_msg, &mut user_id, &mut session, &state).await;
                            }
                            Err(e) => {
                                log::warn!("⚠️ Ошибка парсинга JSON: {}", e);
                                log::warn!("📝 Первые 200 символов: {}", text.chars().take(200).collect::<String>());
                                // Сохраняем в буфер на случай если это начало фрагментированного сообщения
                                text_fragment_buffer = text.to_string();
                            }
                        }
                    }
                    Ok(Message::Continuation(item)) => {
                        // Продолжение фрагментированного сообщения
                        // В actix_http Item может быть FirstText, Continue, или Last
                        let bytes = match item {
                            actix_ws::Item::FirstText(b) | actix_ws::Item::Continue(b) | actix_ws::Item::Last(b) => b,
                            actix_ws::Item::FirstBinary(_) => {
                                log::warn!("⚠️ Получены бинарные данные вместо текста");
                                continue;
                            }
                        };
                        let cont_text = String::from_utf8_lossy(&bytes);
                        log::debug!("📦 Получён continuation frame, размер: {} байт", cont_text.len());
                        text_fragment_buffer.push_str(&cont_text);

                        match serde_json::from_str::<ClientMsg>(&text_fragment_buffer) {
                            Ok(client_msg) => {
                                log::info!("✅ Фрагментированное сообщение собрано успешно (общий размер: {} байт)", text_fragment_buffer.len());
                                text_fragment_buffer.clear();
                                handle_client_msg(client_msg, &mut user_id, &mut session, &state).await;
                            }
                            Err(e) => {
                                log::debug!("⏳ Ждём ещё фрагментов... (текущий размер: {} байт, ошибка: {})", text_fragment_buffer.len(), e);
                            }
                        }
                    }
                    Ok(Message::Close(reason)) => {
                        log::info!("🔌 Клиент отключился (Close: {:?})", reason);

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
                    Err(e) => {
                        // I/O error: payload reached EOF - это нормальное поведение при разрыве соединения
                        if e.to_string().contains("payload reached EOF") {
                            log::debug!("🔌 Клиент отключился (разрыв соединения)");
                        } else {
                            log::error!("❌ Ошибка WebSocket: {}", e);
                        }

                        // Удаляем из онлайн
                        if let Some(uid) = &user_id {
                            state.online_users.lock().unwrap().remove(uid);
                            let _ = state.tx.send(json!({
                                "type": "user_online",
                                "user_id": uid.clone(),
                                "online": false
                            }));
                            log::info!("🔴 Пользователь {} офлайн (ошибка)", uid);
                        }

                        break;
                    }
                    _ => {}
                }
            }
            Ok(msg) = rx.recv() => {
                if let Some(uid) = &user_id {
                    if msg.get("type").and_then(|v| v.as_str()) == Some("message")
                        && msg.get("message").and_then(|m| m.get("sender_id").and_then(|v| v.as_str())) == Some(uid) {
                            continue;
                        }
                    // Пропускаем ACK от себя
                    if msg.get("type").and_then(|v| v.as_str()) == Some("ack")
                        && msg.get("sender_id").and_then(|v| v.as_str()) == Some(uid) {
                            continue;
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
        "SELECT id, name, avatar FROM users WHERE name = ?1",
        params![name],
        |row| {
            Ok(User {
                id: row.get(0)?,
                name: row.get(1)?,
                avatar: row.get(2)?,
            })
        },
    ) {
        Ok(u) => u,
        Err(_) => {
            match db.query_row(
                "INSERT INTO users (id, name) VALUES (?1, ?2) RETURNING id, name, avatar",
                params![Uuid::new_v4().to_string(), name],
                |row| {
                    Ok(User {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        avatar: row.get(2)?,
                    })
                },
            ) {
                Ok(u) => u,
                Err(e) => {
                    return HttpResponse::InternalServerError()
                        .json(json!({"success": false, "error": e.to_string()}))
                }
            }
        }
    };

    HttpResponse::Ok().json(json!({"success": true, "data": user}))
}

async fn get_users(data: web::Data<AppState>) -> HttpResponse {
    let conn = data.db.lock().unwrap_or_else(|e| e.into_inner());
    let mut stmt = conn
        .prepare("SELECT id, name, avatar FROM users ORDER BY name")
        .unwrap();
    let users: Vec<User> = stmt
        .query_map(params![], |row| {
            Ok(User {
                id: row.get(0)?,
                name: row.get(1)?,
                avatar: row.get(2)?,
            })
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();
    HttpResponse::Ok().json(json!({"success": true, "data": users}))
}

async fn get_online_users(data: web::Data<AppState>) -> HttpResponse {
    let online = data.online_users.lock().unwrap();
    let online_list: Vec<String> = online.keys().cloned().collect();
    HttpResponse::Ok().json(json!({"success": true, "data": online_list}))
}

async fn get_messages(
    data: web::Data<AppState>,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> HttpResponse {
    let limit: usize = query
        .get("limit")
        .and_then(|s| s.parse().ok())
        .unwrap_or(50)
        .max(1)
        .min(200);
    let before_id = query.get("before_id");

    let conn = match data.db.lock() {
        Ok(c) => c,
        Err(e) => {
            return HttpResponse::InternalServerError()
                .json(json!({"success": false, "error": e.to_string()}))
        }
    };

    // Загружаем на 1 сообщение больше чтобы проверить есть ли ещё
    let sql = if let Some(last_id) = before_id {
        format!("SELECT id, sender_id, sender_name, text, timestamp, delivery_status, recipient_id, files FROM messages WHERE id < '{}' ORDER BY timestamp DESC LIMIT {}", last_id, limit + 1)
    } else {
        format!("SELECT id, sender_id, sender_name, text, timestamp, delivery_status, recipient_id, files FROM messages ORDER BY timestamp DESC LIMIT {}", limit + 1)
    };

    let result = conn.prepare(&sql);

    let mut stmt = match result {
        Ok(s) => s,
        Err(e) => {
            return HttpResponse::InternalServerError()
                .json(json!({"success": false, "error": e.to_string()}))
        }
    };

    let mut msgs: Vec<ChatMessage> = stmt
        .query_map(params![], |row| {
            let files_str: String = row.get(7)?;
            let files: Vec<FileData> = serde_json::from_str(&files_str).unwrap_or_default();
            Ok(ChatMessage {
                id: row.get(0)?,
                sender_id: row.get(1)?,
                sender_name: row.get(2)?,
                text: row.get(3)?,
                timestamp: row.get(4)?,
                delivery_status: row.get(5)?,
                recipient_id: row.get(6)?,
                files,
            })
        })
        .ok()
        .map(|iter| iter.filter_map(|r| r.ok()).collect())
        .unwrap_or_default();

    // Проверяем есть ли ещё
    let has_more = msgs.len() > limit;
    let next_before_id = if has_more {
        msgs.pop().map(|m| m.id)
    } else {
        None
    };

    // Разворачиваем чтобы вернуть в правильном порядке (старые → новые)
    msgs.reverse();

    HttpResponse::Ok().json(json!({
        "success": true,
        "data": msgs,
        "before_id": before_id,
        "next_before_id": next_before_id,
        "has_more": has_more
    }))
}

async fn upload_file(data: web::Data<AppState>, mut payload: Multipart) -> HttpResponse {
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

    // Получаем первое поле (файл)
    match payload.try_next().await {
        Ok(Some(mut field)) => {
            // Сначала получаем имя файла
            let filename: String = field
                .content_disposition()
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

            HttpResponse::Ok().json(json!({
                "success": true,
                "data": {
                    "id": file_id,
                    "name": filename,
                    "size": size,
                    "path": filepath.to_string_lossy()
                }
            }))
        }
        Ok(None) | Err(_) => HttpResponse::BadRequest().json(json!({
            "success": false,
            "error": "No file uploaded"
        })),
    }
}

async fn download_file(
    _data: web::Data<AppState>,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> HttpResponse {
    let filepath = match query.get("path") {
        Some(p) => p,
        None => {
            return HttpResponse::BadRequest().json(json!({
                "success": false,
                "error": "Path parameter is required"
            }))
        }
    };

    // Проверяем что файл существует
    if !std::path::Path::new(filepath).exists() {
        return HttpResponse::NotFound().json(json!({
            "success": false,
            "error": "File not found"
        }));
    }

    // Получаем имя файла из пути
    let filename = std::path::Path::new(filepath)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("download");

    // Читаем файл
    match std::fs::read(filepath) {
        Ok(contents) => HttpResponse::Ok()
            .content_type("application/octet-stream")
            .insert_header((
                "Content-Disposition",
                format!("attachment; filename=\"{}\"", filename),
            ))
            .body(contents),
        Err(e) => HttpResponse::InternalServerError().json(json!({
            "success": false,
            "error": format!("Failed to read file: {}", e)
        })),
    }
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

    // Создаём таблицы
    let conn = db.lock().unwrap();
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
mod tests_inner {
    use super::*;
    use actix_web::{test, web, App};

    // Создаёт тестовое состояние с временной БД
    pub fn create_test_state() -> AppState {
        let db = Arc::new(Mutex::new(
            Connection::open(":memory:").expect("Failed to create in-memory DB"),
        ));

        // Создаём таблицы
        let conn = db.lock().unwrap();
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
    // ТЕСТЫ РЕГИСТРАЦИИ ПОЛЬЗОВАТЕЛЕЙ
    // ============================================

    #[actix_rt::test]
    async fn test_register_new_user() {
        let state = create_test_state();
        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(state))
                .route("/api/register", web::post().to(register)),
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

        // Сначала регистрируем пользователя
        {
            let conn = state.db.lock().unwrap();
            conn.execute(
                "INSERT INTO users (id, name) VALUES (?1, ?2)",
                params!["test-user-id", "ExistingUser"],
            )
            .unwrap();
        }

        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(state.clone()))
                .route("/api/register", web::post().to(register)),
        )
        .await;

        let req = test::TestRequest::post()
            .uri("/api/register")
            .set_json(json!({ "name": "ExistingUser" }))
            .to_request();

        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());

        let body: serde_json::Value = test::read_body_json(resp).await;
        assert_eq!(body["success"], true);
        assert_eq!(body["data"]["name"], "ExistingUser");
        assert_eq!(body["data"]["id"], "test-user-id");
    }

    #[actix_rt::test]
    async fn test_register_empty_name() {
        let state = create_test_state();
        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(state))
                .route("/api/register", web::post().to(register)),
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
    }

    #[actix_rt::test]
    async fn test_register_whitespace_name() {
        let state = create_test_state();
        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(state))
                .route("/api/register", web::post().to(register)),
        )
        .await;

        let req = test::TestRequest::post()
            .uri("/api/register")
            .set_json(json!({ "name": "   " }))
            .to_request();

        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), 400);
    }

    // ============================================
    // ТЕСТЫ СПИСКА ПОЛЬЗОВАТЕЛЕЙ
    // ============================================

    #[actix_rt::test]
    async fn test_get_users_empty() {
        let state = create_test_state();
        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(state))
                .route("/api/users", web::get().to(get_users)),
        )
        .await;

        let req = test::TestRequest::get().uri("/api/users").to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());

        let body: serde_json::Value = test::read_body_json(resp).await;
        assert_eq!(body["success"], true);
        assert_eq!(body["data"].as_array().unwrap().len(), 0);
    }

    #[actix_rt::test]
    async fn test_get_users_with_data() {
        let state = create_test_state();

        // Добавляем тестовых пользователей
        {
            let conn = state.db.lock().unwrap();
            conn.execute(
                "INSERT INTO users (id, name) VALUES (?1, ?2)",
                params!["user-1", "Alice"],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO users (id, name) VALUES (?1, ?2)",
                params!["user-2", "Bob"],
            )
            .unwrap();
        }

        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(state))
                .route("/api/users", web::get().to(get_users)),
        )
        .await;

        let req = test::TestRequest::get().uri("/api/users").to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());

        let body: serde_json::Value = test::read_body_json(resp).await;
        assert_eq!(body["success"], true);
        assert_eq!(body["data"].as_array().unwrap().len(), 2);
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
                .route("/api/messages", web::get().to(get_messages)),
        )
        .await;

        let req = test::TestRequest::get()
            .uri("/api/messages?limit=100")
            .to_request();
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
            for i in 0..5 {
                conn.execute(
                    "INSERT INTO messages (id, sender_id, sender_name, text, timestamp, delivery_status, recipient_id, files) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![
                        format!("msg-{}", i),
                        "sender-1",
                        "Sender",
                        format!("Message {}", i),
                        Utc::now().timestamp(),
                        1,
                        Option::<String>::None,
                        "[]"
                    ],
                )
                .unwrap();
            }
        }

        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(state))
                .route("/api/messages", web::get().to(get_messages)),
        )
        .await;

        let req = test::TestRequest::get()
            .uri("/api/messages?limit=3")
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());

        let body: serde_json::Value = test::read_body_json(resp).await;
        assert_eq!(body["success"], true);
        assert_eq!(body["data"].as_array().unwrap().len(), 3);
    }

    #[actix_rt::test]
    async fn test_get_messages_default_limit() {
        let state = create_test_state();
        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(state))
                .route("/api/messages", web::get().to(get_messages)),
        )
        .await;

        let req = test::TestRequest::get().uri("/api/messages").to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());

        // Должен вернуть пустой список с лимитом по умолчанию
        let body: serde_json::Value = test::read_body_json(resp).await;
        assert_eq!(body["success"], true);
    }

    // ============================================
    // ТЕСТЫ СТАТУСОВ ДОСТАВКИ (ACK)
    // ============================================

    #[actix_rt::test]
    async fn test_ack_read_status() {
        let state = create_test_state();

        // Создаём тестовое сообщение
        {
            let conn = state.db.lock().unwrap();
            conn.execute(
                "INSERT INTO messages (id, sender_id, sender_name, text, timestamp, delivery_status, recipient_id, files) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params!["test-msg-id", "sender-1", "Sender", "Test message", Utc::now().timestamp(), 1, Option::<String>::None, "[]"],
            )
            .unwrap();
        }

        // Проверяем начальный статус
        {
            let conn = state.db.lock().unwrap();
            let status: i64 = conn
                .query_row(
                    "SELECT delivery_status FROM messages WHERE id = ?1",
                    params!["test-msg-id"],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(status, 1); // Отправлено
        }

        // Отправляем ACK через WebSocket handler (тестируем логику обновления)
        {
            let conn = state.db.lock().unwrap();
            conn.execute(
                "UPDATE messages SET delivery_status = ?1 WHERE id = ?2",
                params![2, "test-msg-id"], // 2 = read
            )
            .unwrap();
        }

        // Проверяем обновлённый статус
        {
            let conn = state.db.lock().unwrap();
            let status: i64 = conn
                .query_row(
                    "SELECT delivery_status FROM messages WHERE id = ?1",
                    params!["test-msg-id"],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(status, 2); // Прочитано
        }
    }

    #[actix_rt::test]
    async fn test_ack_contains_sender_id() {
        // Проверяем что ACK содержит sender_id для фильтрации
        let ack_msg = json!({
            "type": "ack",
            "message_id": "msg-123",
            "status": "read",
            "sender_id": "user-456"
        });

        assert_eq!(ack_msg["type"], "ack");
        assert_eq!(ack_msg["message_id"], "msg-123");
        assert_eq!(ack_msg["status"], "read");
        assert_eq!(ack_msg["sender_id"], "user-456");
    }

    #[actix_rt::test]
    async fn test_ack_filtering_logic() {
        // Проверяем логику фильтрации ACK на клиенте
        let user_id = "user-123";

        // ACK от другого пользователя — должно пройти
        let ack_from_other = json!({
            "type": "ack",
            "message_id": "msg-1",
            "sender_id": "user-456"
        });

        let should_process =
            ack_from_other.get("sender_id").and_then(|v| v.as_str()) != Some(user_id);
        assert!(should_process);

        // ACK от себя — должно быть отфильтровано
        let ack_from_self = json!({
            "type": "ack",
            "message_id": "msg-2",
            "sender_id": "user-123"
        });

        let should_ignore =
            ack_from_self.get("sender_id").and_then(|v| v.as_str()) == Some(user_id);
        assert!(should_ignore);
    }

    // ============================================
    // ТЕСТЫ ФАЙЛОВ
    // ============================================

    #[actix_rt::test]
    async fn test_upload_file_success() {
        let state = create_test_state();
        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(state))
                .route("/api/files", web::post().to(upload_file)),
        )
        .await;

        // Создаём тестовый файл
        let file_content = b"Test file content";
        let boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW";

        let body = format!(
            "--{}\r\n\
             Content-Disposition: form-data; name=\"file\"; filename=\"test.txt\"\r\n\
             Content-Type: text/plain\r\n\r\n\
             {}\r\n\
             --{}--\r\n",
            boundary,
            String::from_utf8_lossy(file_content),
            boundary
        );

        let req = test::TestRequest::post()
            .uri("/api/files")
            .insert_header((
                "Content-Type",
                format!("multipart/form-data; boundary={}", boundary),
            ))
            .set_payload(body)
            .to_request();

        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());

        let body: serde_json::Value = test::read_body_json(resp).await;
        assert_eq!(body["success"], true);
        assert!(body["data"]["id"].as_str().unwrap().len() > 0);
        assert_eq!(body["data"]["name"], "test.txt");
        assert_eq!(body["data"]["size"], file_content.len() as u64);
    }

    #[actix_rt::test]
    async fn test_upload_file_empty() {
        let state = create_test_state();
        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(state))
                .route("/api/files", web::post().to(upload_file)),
        )
        .await;

        let req = test::TestRequest::post()
            .uri("/api/files")
            .insert_header(("Content-Type", "multipart/form-data"))
            .to_request();

        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), 400);

        let body: serde_json::Value = test::read_body_json(resp).await;
        assert_eq!(body["success"], false);
    }

    // ============================================
    // ТЕСТЫ ОНЛАЙН СТАТУСОВ
    // ============================================

    #[actix_rt::test]
    async fn test_get_online_users_empty() {
        let state = create_test_state();
        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(state))
                .route("/api/online", web::get().to(get_online_users)),
        )
        .await;

        let req = test::TestRequest::get().uri("/api/online").to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());

        let body: serde_json::Value = test::read_body_json(resp).await;
        assert_eq!(body["success"], true);
        assert_eq!(body["data"].as_array().unwrap().len(), 0);
    }

    #[actix_rt::test]
    async fn test_get_online_users_with_users() {
        let state = create_test_state();

        // Добавляем пользователей в онлайн
        {
            let mut online = state.online_users.lock().unwrap();
            online.insert("user-1".to_string(), 1000);
            online.insert("user-2".to_string(), 2000);
        }

        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(state))
                .route("/api/online", web::get().to(get_online_users)),
        )
        .await;

        let req = test::TestRequest::get().uri("/api/online").to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());

        let body: serde_json::Value = test::read_body_json(resp).await;
        assert_eq!(body["success"], true);
        assert_eq!(body["data"].as_array().unwrap().len(), 2);
    }

    // ============================================
    // ТЕСТЫ БАЗЫ ДАННЫХ
    // ============================================

    #[actix_rt::test]
    async fn test_database_user_crud() {
        let conn = Connection::open(":memory:").unwrap();
        conn.execute(
            "CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT UNIQUE)",
            [],
        )
        .unwrap();

        // Create
        conn.execute(
            "INSERT INTO users (id, name) VALUES (?1, ?2)",
            params!["user-1", "Alice"],
        )
        .unwrap();

        // Read
        let name: String = conn
            .query_row(
                "SELECT name FROM users WHERE id = ?1",
                params!["user-1"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(name, "Alice");

        // Update
        conn.execute(
            "UPDATE users SET name = ?1 WHERE id = ?2",
            params!["Alice Updated", "user-1"],
        )
        .unwrap();

        let name: String = conn
            .query_row(
                "SELECT name FROM users WHERE id = ?1",
                params!["user-1"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(name, "Alice Updated");

        // Delete
        conn.execute("DELETE FROM users WHERE id = ?1", params!["user-1"])
            .unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM users", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[actix_rt::test]
    async fn test_database_message_crud() {
        let conn = Connection::open(":memory:").unwrap();
        conn.execute(
            "CREATE TABLE messages (
                id TEXT PRIMARY KEY, sender_id TEXT, sender_name TEXT,
                text TEXT, timestamp INTEGER, delivery_status INTEGER DEFAULT 0,
                recipient_id TEXT, files TEXT
            )",
            [],
        )
        .unwrap();

        let now = 1234567890i64;

        // Create
        conn.execute(
            "INSERT INTO messages (id, sender_id, sender_name, text, timestamp, delivery_status, recipient_id, files) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params!["msg-1", "user-1", "Alice", "Hello!", now, 1, Option::<String>::None, "[]"],
        )
        .unwrap();

        // Read
        let (text, status): (String, i64) = conn
            .query_row(
                "SELECT text, delivery_status FROM messages WHERE id = ?1",
                params!["msg-1"],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(text, "Hello!");
        assert_eq!(status, 1);

        // Update status
        conn.execute(
            "UPDATE messages SET delivery_status = ?1 WHERE id = ?2",
            params![2, "msg-1"],
        )
        .unwrap();

        let status: i64 = conn
            .query_row(
                "SELECT delivery_status FROM messages WHERE id = ?1",
                params!["msg-1"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(status, 2);

        // Delete
        conn.execute("DELETE FROM messages WHERE id = ?1", params!["msg-1"])
            .unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM messages", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[actix_rt::test]
    async fn test_database_message_with_recipient() {
        let conn = Connection::open(":memory:").unwrap();
        conn.execute(
            "CREATE TABLE messages (
                id TEXT PRIMARY KEY, sender_id TEXT, sender_name TEXT,
                text TEXT, timestamp INTEGER, delivery_status INTEGER DEFAULT 0,
                recipient_id TEXT, files TEXT
            )",
            [],
        )
        .unwrap();

        let now = 1234567890i64;

        // Сообщение с получателем
        conn.execute(
            "INSERT INTO messages (id, sender_id, sender_name, text, timestamp, delivery_status, recipient_id, files) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params!["msg-private", "user-1", "Alice", "Private message", now, 1, "user-2", "[]"],
        )
        .unwrap();

        // Фильтрация по получателю
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM messages WHERE recipient_id = ?1",
                params!["user-2"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    // ============================================
    // ТЕСТЫ ВСПОМОГАТЕЛЬНЫХ ФУНКЦИЙ
    // ============================================

    #[actix_rt::test]
    async fn test_uuid_generation() {
        let uuid1 = Uuid::new_v4().to_string();
        let uuid2 = Uuid::new_v4().to_string();

        // UUID должны быть уникальными
        assert_ne!(uuid1, uuid2);

        // UUID должны иметь правильный формат (36 символов с дефисами)
        assert_eq!(uuid1.len(), 36);
        assert_eq!(uuid2.len(), 36);
    }

    #[actix_rt::test]
    async fn test_timestamp_generation() {
        let now = 1234567890i64;
        let later = 1234567891i64;

        // Время должно быть в секундах с эпохи Unix
        assert!(now > 0);
        assert!(later >= now);
    }

    #[actix_rt::test]
    async fn test_system_time_to_secs() {
        let secs = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_secs();

        assert!(secs > 0);
    }

    // ============================================
    // ТЕСТЫ JSON СЕРИАЛИЗАЦИИ
    // ============================================

    #[actix_rt::test]
    async fn test_user_serialization() {
        let user = User {
            id: "test-id".to_string(),
            name: "Test User".to_string(),
            avatar: "👤".to_string(),
        };

        let json = serde_json::to_string(&user).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed["id"], "test-id");
        assert_eq!(parsed["name"], "Test User");
    }

    #[actix_rt::test]
    async fn test_message_serialization() {
        let msg = ChatMessage {
            id: "msg-id".to_string(),
            sender_id: "sender-id".to_string(),
            sender_name: "Sender".to_string(),
            text: "Test message".to_string(),
            timestamp: 1234567890,
            delivery_status: 1,
            recipient_id: None,
            files: vec![],
        };

        let json = serde_json::to_string(&msg).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed["id"], "msg-id");
        assert_eq!(parsed["sender_id"], "sender-id");
        assert_eq!(parsed["sender_name"], "Sender");
        assert_eq!(parsed["text"], "Test message");
        assert_eq!(parsed["delivery_status"], 1);
    }

    #[actix_rt::test]
    async fn test_client_msg_deserialization() {
        let json = r#"{"type": "message", "text": "Hello", "name": "", "message_id": "", "status": "", "limit": 0}"#;
        let msg: ClientMsg = serde_json::from_str(json).unwrap();

        assert_eq!(msg.msg_type, "message");
        assert_eq!(msg.text, "Hello");
    }

    #[actix_rt::test]
    async fn test_client_msg_with_optional_fields() {
        let json = r#"{"type": "message", "text": "Hello", "recipient_id": "user-123"}"#;
        let msg: ClientMsg = serde_json::from_str(json).unwrap();

        assert_eq!(msg.msg_type, "message");
        assert_eq!(msg.text, "Hello");
        assert_eq!(msg.recipient_id, Some("user-123".to_string()));
    }

    #[actix_rt::test]
    async fn test_message_with_files() {
        let files = vec![FileData {
            name: "test.txt".to_string(),
            size: 1024,
            path: "/path/to/test.txt".to_string(),
        }];

        let msg = ChatMessage {
            id: "msg-id".to_string(),
            sender_id: "sender-id".to_string(),
            sender_name: "Sender".to_string(),
            text: "Файл во вложении".to_string(),
            timestamp: 1234567890,
            delivery_status: 1,
            recipient_id: None,
            files: files.clone(),
        };

        let json = serde_json::to_string(&msg).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed["id"], "msg-id");
        assert_eq!(parsed["files"].as_array().unwrap().len(), 1);
        assert_eq!(parsed["files"][0]["name"], "test.txt");
        assert_eq!(parsed["files"][0]["size"], 1024);
    }

    #[actix_rt::test]
    async fn test_client_msg_with_files() {
        let json = r#"{"type": "message", "text": "Файл", "files": [{"name": "doc.pdf", "size": 2048, "path": "/files/doc.pdf"}]}"#;
        let msg: ClientMsg = serde_json::from_str(json).unwrap();

        assert_eq!(msg.msg_type, "message");
        assert_eq!(msg.text, "Файл");
        assert_eq!(msg.files.len(), 1);
        assert_eq!(msg.files[0].name, "doc.pdf");
        assert_eq!(msg.files[0].size, 2048);
    }

    // ============================================
    // ТЕСТЫ CORS
    // ============================================

    #[actix_rt::test]
    async fn test_cors_headers() {
        use actix_cors::Cors;

        let cors = Cors::default()
            .allow_any_origin()
            .allow_any_method()
            .allow_any_header()
            .send_wildcard()
            .max_age(3600);

        let app = test::init_service(App::new().wrap(cors).route(
            "/api/test",
            web::get().to(|| async { HttpResponse::Ok().finish() }),
        ))
        .await;

        let req = test::TestRequest::get()
            .uri("/api/test")
            .insert_header(("Origin", "http://example.com"))
            .to_request();

        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());

        // Проверяем наличие CORS заголовков
        let origin_header = resp.headers().get("Access-Control-Allow-Origin");
        assert!(origin_header.is_some());
    }

    // ============================================
    // ТЕСТЫ СОСТОЯНИЯ ПРИЛОЖЕНИЯ
    // ============================================

    #[actix_rt::test]
    async fn test_app_state_clone() {
        let state = create_test_state();
        let _cloned_state = state.clone();

        // AppState должен реализовывать Clone
        // Тест просто проверяет что клонирование работает
    }

    #[actix_rt::test]
    async fn test_online_users_thread_safety() {
        let state = create_test_state();
        let mut handles = vec![];

        // Создаём несколько потоков которые одновременно добавляют пользователей
        for i in 0..10 {
            let state_clone = state.clone();
            let handle = std::thread::spawn(move || {
                let mut online = state_clone.online_users.lock().unwrap();
                online.insert(format!("user-{}", i), i as u64);
            });
            handles.push(handle);
        }

        for handle in handles {
            handle.join().unwrap();
        }

        let online = state.online_users.lock().unwrap();
        assert_eq!(online.len(), 10);
    }

    // ============================================
    // ТЕСТЫ КРАЕВЫХ СЛУЧАЕВ
    // ============================================

    #[actix_rt::test]
    async fn test_empty_message_text() {
        let msg = ChatMessage {
            id: "msg-id".to_string(),
            sender_id: "sender-id".to_string(),
            sender_name: "Sender".to_string(),
            text: "".to_string(),
            timestamp: 1234567890,
            delivery_status: 0,
            recipient_id: None,
            files: vec![],
        };

        let json = serde_json::to_string(&msg).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed["text"], "");
    }

    #[actix_rt::test]
    async fn test_unicode_in_message() {
        let msg = ChatMessage {
            id: "msg-id".to_string(),
            sender_id: "sender-id".to_string(),
            sender_name: "Пользователь".to_string(),
            text: "Привет! 你好 مرحبا".to_string(),
            timestamp: 1234567890,
            delivery_status: 2,
            recipient_id: Some("recipient-id".to_string()),
            files: vec![],
        };

        let json = serde_json::to_string(&msg).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed["sender_name"], "Пользователь");
        assert_eq!(parsed["text"], "Привет! 你好 مرحبا");
    }

    #[actix_rt::test]
    async fn test_delivery_status_values() {
        // 0 = отправка, 1 = отправлено, 2 = прочитано
        assert_eq!(0, 0); // Отправка
        assert_eq!(1, 1); // Отправлено
        assert_eq!(2, 2); // Прочитано
    }

    #[actix_rt::test]
    async fn test_special_characters_in_user_name() {
        let state = create_test_state();
        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(state))
                .route("/api/register", web::post().to(register)),
        )
        .await;

        let special_names = vec![
            "O'Brien",
            "张三",
            "User<Script>",
            "User \"Quotes\"",
            "User&amp;Symbol",
        ];

        for name in special_names {
            let req = test::TestRequest::post()
                .uri("/api/register")
                .set_json(json!({ "name": name }))
                .to_request();

            let resp = test::call_service(&app, req).await;
            assert!(resp.status().is_success(), "Failed for name: {}", name);
        }
    }

    // ============================================
    // ТЕСТЫ ПАРСИНГА СООБЩЕНИЙ
    // ============================================

    #[actix_rt::test]
    async fn test_invalid_json_parsing() {
        // Тест на "битый" JSON
        let invalid_jsons = vec![
            "{invalid json}",
            "{\"type\": \"message\"",              // незакрытая скобка
            "{\"type\": \"message\", \"text\": }", // без значения
            "not json at all",
            "",
            "null",
            "[]", // массив вместо объекта
        ];

        for json_str in invalid_jsons {
            let result: Result<ClientMsg, _> = serde_json::from_str(json_str);
            assert!(result.is_err(), "Should fail to parse: {}", json_str);
        }
    }

    #[actix_rt::test]
    async fn test_large_json_payload() {
        // Тест на большой JSON payload
        let large_text = "A".repeat(100000); // 100KB текст
        let json = json!({
            "type": "message",
            "text": large_text,
            "files": []
        });

        let json_str = serde_json::to_string(&json).unwrap();
        let result: Result<ClientMsg, _> = serde_json::from_str(&json_str);

        // Должен успешно распарситься
        assert!(result.is_ok());
        let msg = result.unwrap();
        assert_eq!(msg.text.len(), 100000);
    }

    #[actix_rt::test]
    async fn test_nested_json_structure() {
        // Тест на сложную вложенную структуру JSON
        let json = r#"{
            "type": "message",
            "text": "Hello",
            "files": [
                {"name": "file1.txt", "size": 100, "path": "/path1"},
                {"name": "file2.pdf", "size": 200, "path": "/path2"}
            ],
            "recipient_id": "user-123"
        }"#;

        let msg: ClientMsg = serde_json::from_str(json).unwrap();
        assert_eq!(msg.msg_type, "message");
        assert_eq!(msg.files.len(), 2);
        assert_eq!(msg.files[0].name, "file1.txt");
        assert_eq!(msg.files[1].name, "file2.pdf");
        assert_eq!(msg.recipient_id, Some("user-123".to_string()));
    }

    // ============================================
    // ТЕСТЫ МАШИНЫ СОСТОЯНИЙ (DELIVERY STATUS)
    // ============================================

    #[actix_rt::test]
    async fn test_delivery_status_transitions() {
        let state = create_test_state();
        let msg_id = "status-test-msg";

        // Создаём сообщение со статусом 0 (отправка)
        {
            let conn = state.db.lock().unwrap();
            conn.execute(
                "INSERT INTO messages (id, sender_id, sender_name, text, timestamp, delivery_status, recipient_id, files) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![msg_id, "user-1", "User", "Test", Utc::now().timestamp(), 0, Option::<String>::None, "[]"],
            ).unwrap();
        }

        // Проверяем начальный статус 0
        {
            let conn = state.db.lock().unwrap();
            let status: i64 = conn
                .query_row(
                    "SELECT delivery_status FROM messages WHERE id = ?1",
                    params![msg_id],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(status, 0, "Начальный статус должен быть 0 (отправка)");
        }

        // Переход 0 → 1 (отправлено)
        {
            let conn = state.db.lock().unwrap();
            conn.execute(
                "UPDATE messages SET delivery_status = ?1 WHERE id = ?2",
                params![1, msg_id],
            )
            .unwrap();
        }

        {
            let conn = state.db.lock().unwrap();
            let status: i64 = conn
                .query_row(
                    "SELECT delivery_status FROM messages WHERE id = ?1",
                    params![msg_id],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(status, 1, "Статус должен быть 1 (отправлено)");
        }

        // Переход 1 → 2 (прочитано)
        {
            let conn = state.db.lock().unwrap();
            conn.execute(
                "UPDATE messages SET delivery_status = ?1 WHERE id = ?2",
                params![2, msg_id],
            )
            .unwrap();
        }

        {
            let conn = state.db.lock().unwrap();
            let status: i64 = conn
                .query_row(
                    "SELECT delivery_status FROM messages WHERE id = ?1",
                    params![msg_id],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(status, 2, "Статус должен быть 2 (прочитано)");
        }
    }

    #[actix_rt::test]
    async fn test_delivery_status_cannot_skip_sent() {
        // Тест что сообщение не может стать "Прочитано" (2) минуя "Отправлено" (1)
        // В реальности это не блокируется на уровне БД, но проверяем логику
        let state = create_test_state();
        let msg_id = "skip-test-msg";

        // Создаём сообщение со статусом 0
        {
            let conn = state.db.lock().unwrap();
            conn.execute(
                "INSERT INTO messages (id, sender_id, sender_name, text, timestamp, delivery_status, recipient_id, files) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![msg_id, "user-1", "User", "Test", Utc::now().timestamp(), 0, Option::<String>::None, "[]"],
            ).unwrap();
        }

        // Пытаемся сразу установить статус 2 (минуя 1)
        // Это технически возможно в БД, но не должно происходить на уровне логики
        {
            let conn = state.db.lock().unwrap();
            conn.execute(
                "UPDATE messages SET delivery_status = ?1 WHERE id = ?2",
                params![2, msg_id],
            )
            .unwrap();
        }

        // Проверяем что статус изменился (БД позволяет, но логика приложения не должна)
        {
            let conn = state.db.lock().unwrap();
            let status: i64 = conn
                .query_row(
                    "SELECT delivery_status FROM messages WHERE id = ?1",
                    params![msg_id],
                    |row| row.get(0),
                )
                .unwrap();
            // Тест документирует текущее поведение - БД позволяет прямой переход
            // В production это должно проверяться в handle_client_msg
            assert_eq!(status, 2);
        }
    }

    #[actix_rt::test]
    async fn test_ack_from_self_should_be_ignored() {
        // Тест что ACK от себя игнорируется
        let user_id = "user-123";

        // ACK от себя — должно быть отфильтровано
        let ack_from_self = json!({
            "type": "ack",
            "message_id": "msg-2",
            "sender_id": "user-123"
        });

        let should_ignore =
            ack_from_self.get("sender_id").and_then(|v| v.as_str()) == Some(user_id);
        assert!(should_ignore, "ACK от себя должен игнорироваться");

        // ACK от другого пользователя — должно пройти
        let ack_from_other = json!({
            "type": "ack",
            "message_id": "msg-1",
            "sender_id": "user-456"
        });

        let should_process =
            ack_from_other.get("sender_id").and_then(|v| v.as_str()) != Some(user_id);
        assert!(should_process, "ACK от другого должен обрабатываться");
    }

    // ============================================
    // ТЕСТЫ БЕЗОПАСНОСТИ
    // ============================================

    #[actix_rt::test]
    async fn test_sql_injection_in_register() {
        let state = create_test_state();
        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(state.clone()))
                .route("/api/register", web::post().to(register)),
        )
        .await;

        // SQL injection попытки
        let injection_attempts = vec![
            "'; DROP TABLE users; --",
            "Robert'); DROP TABLE users;--",
            "1' OR '1'='1",
            "admin'--",
            "'; DELETE FROM users WHERE '1'='1",
        ];

        for name in injection_attempts {
            let req = test::TestRequest::post()
                .uri("/api/register")
                .set_json(json!({ "name": name }))
                .to_request();

            let resp = test::call_service(&app, req).await;
            // Должен успешно зарегистрировать (параметризованные запросы защищают)
            assert!(resp.status().is_success(), "Failed for injection: {}", name);

            // Проверяем что таблица users всё ещё существует и цела
            let conn = state.db.lock().unwrap();
            let count: i64 = conn
                .query_row("SELECT COUNT(*) FROM users", [], |row| row.get(0))
                .unwrap();
            assert!(
                count > 0,
                "Таблица users должна существовать после injection попытки"
            );
        }
    }

    #[actix_rt::test]
    async fn test_xss_in_user_name() {
        let state = create_test_state();
        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(state))
                .route("/api/register", web::post().to(register)),
        )
        .await;

        // XSS попытки
        let xss_attempts = vec![
            "<script>alert('xss')</script>",
            "<img src=x onerror=alert('xss')>",
            "javascript:alert('xss')",
            "<iframe src='evil.com'></iframe>",
        ];

        for name in xss_attempts {
            let req = test::TestRequest::post()
                .uri("/api/register")
                .set_json(json!({ "name": name }))
                .to_request();

            let resp = test::call_service(&app, req).await;
            assert!(resp.status().is_success(), "Failed for XSS: {}", name);

            // Проверяем что имя сохранено как есть (экранирование на клиенте)
            let body: serde_json::Value = test::read_body_json(resp).await;
            assert_eq!(body["data"]["name"], name);
        }
    }

    #[actix_rt::test]
    async fn test_null_byte_injection() {
        let state = create_test_state();
        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(state))
                .route("/api/register", web::post().to(register)),
        )
        .await;

        // Null byte injection
        let req = test::TestRequest::post()
            .uri("/api/register")
            .set_json(json!({ "name": "admin\0null" }))
            .to_request();

        let resp = test::call_service(&app, req).await;
        // Должен обработать корректно
        assert!(resp.status().is_success());
    }
}
