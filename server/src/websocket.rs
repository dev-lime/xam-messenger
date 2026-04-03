//! Обработчики WebSocket соединений

use actix_web::{HttpRequest, HttpResponse, web};
use actix_ws::{Message, MessageStream};
use chrono::Utc;
use futures_util::{FutureExt, StreamExt};
use serde_json::json;
use std::panic::AssertUnwindSafe;
use std::time::SystemTime;
use uuid::Uuid;

use crate::db;
use crate::models::{AppState, ChatMessage, ClientMsg, User};

/// Обработка клиентского сообщения с защитой от паник
pub async fn handle_client_message(
    client_msg: ClientMsg,
    user_id: &mut Option<String>,
    session: &mut actix_ws::Session,
    state: &AppState,
) {
    let msg_type = client_msg.msg_type.clone();

    // Используем AssertUnwindSafe для защиты от паник в async контексте
    let future = AssertUnwindSafe(async {
        match client_msg.msg_type.as_str() {
            "register" => handle_register(client_msg, user_id, session, state).await,
            "update_profile" => handle_update_profile(client_msg, user_id, session, state).await,
            "message" => handle_message(client_msg, user_id, session, state).await,
            "ack" => handle_ack(client_msg, user_id, session, state).await,
            "get_messages" => handle_get_messages(client_msg, session, state).await,
            _ => log::warn!("⚠️ Неизвестный тип сообщения: {}", client_msg.msg_type),
        }
    });

    // Ловим паники внутри future
    match future.catch_unwind().await {
        Ok(()) => {}
        Err(e) => {
            let msg = if let Some(s) = e.downcast_ref::<&str>() {
                s.to_string()
            } else if let Some(s) = e.downcast_ref::<String>() {
                s.clone()
            } else {
                "Неизвестная паника".to_string()
            };
            log::error!(
                "❌ Паника при обработке сообщения типа '{}': {}",
                msg_type,
                msg
            );
            // Отправляем сообщение об ошибке клиенту
            let _ = session
                .text(
                    json!({
                        "type": "error",
                        "message": format!("Ошибка обработки: {}", msg)
                    })
                    .to_string(),
                )
                .await;
        }
    }
}

/// Обработка регистрации пользователя
async fn handle_register(
    client_msg: ClientMsg,
    user_id: &mut Option<String>,
    session: &mut actix_ws::Session,
    state: &AppState,
) {
    let avatar = if !client_msg.text.is_empty() {
        client_msg.text.clone()
    } else {
        "👤".to_string()
    };

    let user: User = {
        let conn = state.db.lock().await;
        match db::get_or_create_user(&conn, &client_msg.name, &avatar) {
            Ok(u) => u,
            Err(e) => {
                log::error!("Failed to create user: {}", e);
                return;
            }
        }
    };

    *user_id = Some(user.id.clone());

    // Добавляем в онлайн (#11: замена unwrap на unwrap_or_default)
    let timestamp = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    state
        .online_users
        .lock()
        .await
        .insert(user.id.clone(), timestamp);

    // Отправляем список текущих онлайн пользователей
    let online_list: Vec<String> = state.online_users.lock().await.keys().cloned().collect();
    for online_id in &online_list {
        let _ = session
            .text(
                json!({
                    "type": "user_online",
                    "user_id": online_id,
                    "online": true
                })
                .to_string(),
            )
            .await;
    }

    // Рассылаем остальным что этот пользователь подключился
    let _ = state.tx.send(json!({
        "type": "user_online",
        "user_id": user.id,
        "online": true
    }));

    let _ = session
        .text(json!({ "type": "registered", "user": user }).to_string())
        .await;

    log::info!("✅ {}: {}", user.name, user.id);
}

/// Обработка обновления профиля
async fn handle_update_profile(
    client_msg: ClientMsg,
    user_id: &Option<String>,
    _session: &mut actix_ws::Session,
    state: &AppState,
) {
    let uid = match user_id {
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

    {
        let conn = state.db.lock().await;
        if let Err(e) = db::update_user_avatar(&conn, &uid, &new_avatar) {
            log::error!("Failed to update avatar: {}", e);
            return;
        }
    }

    // Обновляем онлайн пользователей и рассылаем новый аватар
    let _ = state.tx.send(json!({
        "type": "user_updated",
        "user_id": uid,
        "avatar": new_avatar
    }));
}

/// Обработка сообщения
async fn handle_message(
    client_msg: ClientMsg,
    user_id: &Option<String>,
    _session: &mut actix_ws::Session,
    state: &AppState,
) {
    let uid = match user_id {
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

    let uname = {
        let conn = state.db.lock().await;
        match db::get_user_name(&conn, &uid) {
            Ok(name) => name,
            Err(e) => {
                log::error!("Failed to get user name: {}", e);
                return;
            }
        }
    };

    log::info!(
        "📩 Получено сообщение: text={}, files={}",
        client_msg.text,
        client_msg.files.len()
    );

    let message = ChatMessage {
        id: Uuid::new_v4().to_string(),
        sender_id: uid.clone(),
        sender_name: uname,
        text: client_msg.text.clone(),
        timestamp: Utc::now().timestamp(),
        delivery_status: 1,
        recipient_id: client_msg.recipient_id.clone(),
        files: client_msg.files.clone(),
    };

    log::info!("💾 Сохраняем сообщение с {} файлами", message.files.len());

    {
        let conn = state.db.lock().await;
        if let Err(e) = db::save_message(&conn, &message) {
            log::error!("Failed to save message: {}", e);
            return;
        }
    }

    log::info!(
        "📤 Рассылка сообщения: id={}, files={}",
        message.id,
        message.files.len()
    );
    let _ = state
        .tx
        .send(json!({ "type": "message", "message": message }));
}

/// Обработка подтверждения прочтения (ACK)
async fn handle_ack(
    client_msg: ClientMsg,
    user_id: &Option<String>,
    _session: &mut actix_ws::Session,
    state: &AppState,
) {
    let ack_sender_id = match user_id {
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

    {
        let conn = state.db.lock().await;
        if let Err(e) = db::update_message_delivery_status(&conn, &client_msg.message_id, status) {
            log::error!("Failed to update delivery status: {}", e);
            return;
        }
    }

    let ack_msg = json!({
        "type": "ack",
        "message_id": msg_id,
        "status": client_msg.status,
        "sender_id": ack_sender_id
    });
    log::info!("📤 Рассылка ACK: {}", ack_msg);
    let _ = state.tx.send(ack_msg);
}

/// Обработка запроса истории сообщений
async fn handle_get_messages(
    client_msg: ClientMsg,
    session: &mut actix_ws::Session,
    state: &AppState,
) {
    let limit = client_msg.limit.max(1).min(200);
    let before_id = &client_msg.before_id;

    let conn = state.db.lock().await;
    match db::get_messages_with_pagination(&conn, limit, before_id.as_deref()) {
        Ok((messages, next_before_id, has_more)) => {
            let response = json!({
                "type": "messages",
                "messages": messages,
                "before_id": before_id,
                "next_before_id": next_before_id,
                "limit": limit,
                "has_more": has_more
            });

            let _ = session.text(response.to_string()).await;
        }
        Err(e) => {
            log::error!("Failed to get messages: {}", e);
        }
    }
}

/// Обработка WebSocket сессии
pub async fn handle_websocket_session(
    mut session: actix_ws::Session,
    mut msg_stream: MessageStream,
    state: AppState,
) {
    let mut user_id: Option<String> = None;
    let mut rx = state.tx.subscribe();
    let mut text_fragment_buffer = String::new();

    loop {
        tokio::select! {
            Some(msg) = msg_stream.next() => {
                match msg {
                    Ok(Message::Text(text)) => {
                        log::debug!("📥 Получено WebSocket сообщение, размер: {} байт", text.len());

                        match serde_json::from_str::<ClientMsg>(&text) {
                            Ok(client_msg) => {
                                log::info!("✅ JSON распарсен успешно, тип: {}", client_msg.msg_type);
                                handle_client_message(client_msg, &mut user_id, &mut session, &state).await;
                            }
                            Err(e) => {
                                log::warn!("⚠️ Ошибка парсинга JSON: {}", e);
                                log::warn!("📝 Первые 200 символов: {}", text.chars().take(200).collect::<String>());
                                text_fragment_buffer = text.to_string();
                            }
                        }
                    }
                    Ok(Message::Continuation(item)) => {
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
                                handle_client_message(client_msg, &mut user_id, &mut session, &state).await;
                            }
                            Err(e) => {
                                log::debug!("⏳ Ждём ещё фрагментов... (текущий размер: {} байт, ошибка: {})", text_fragment_buffer.len(), e);
                            }
                        }
                    }
                    Ok(Message::Close(reason)) => {
                        log::info!("🔌 Клиент отключился (Close: {:?})", reason);
                        if let Some(uid) = &user_id {
                            remove_user_from_online(&state, uid).await;
                        }
                        break;
                    }
                    Err(e) => {
                        if e.to_string().contains("payload reached EOF") {
                            log::debug!("🔌 Клиент отключился (разрыв соединения)");
                        } else {
                            log::error!("❌ Ошибка WebSocket: {}", e);
                        }
                        if let Some(uid) = &user_id {
                            remove_user_from_online(&state, uid).await;
                        }
                        break;
                    }
                    _ => {}
                }
            }
            Ok(msg) = rx.recv() => {
                if let Some(uid) = &user_id {
                    // Пропускаем сообщения от себя
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

/// Удаление пользователя из списка онлайн
async fn remove_user_from_online(state: &AppState, user_id: &str) {
    state.online_users.lock().await.remove(user_id);
    let _ = state.tx.send(json!({
        "type": "user_online",
        "user_id": user_id,
        "online": false
    }));
    log::info!("🔴 Пользователь {} офлайн", user_id);
}

/// HTTP обработчик WebSocket подключений
pub async fn ws_handler(
    req: HttpRequest,
    stream: web::Payload,
    data: web::Data<AppState>,
) -> Result<HttpResponse, actix_web::Error> {
    let (response, session, msg_stream) = actix_ws::handle(&req, stream)?;
    let state = data.get_ref().clone();
    actix_web::rt::spawn(handle_websocket_session(session, msg_stream, state));
    Ok(response)
}
