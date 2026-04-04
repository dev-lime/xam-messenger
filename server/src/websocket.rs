//! Обработчики WebSocket соединений

use actix_web::{HttpRequest, HttpResponse, web};
use actix_ws::{Message, MessageStream};
use chrono::Utc;
use futures_util::{FutureExt, StreamExt};
use serde_json::json;
use std::panic::AssertUnwindSafe;
use std::time::SystemTime;
use tokio::sync::mpsc::unbounded_channel;
use uuid::Uuid;

use crate::db;
use crate::models::{AppState, ChatMessage, ClientMsg, User};

/// PERF-3: Отправить сообщение конкретному пользователю через targeted delivery
async fn send_to_user(state: &AppState, user_id: &str, payload: serde_json::Value) {
    let mut senders = state.user_senders.lock().await;
    if let Some(user_senders) = senders.get_mut(user_id) {
        // Удаляем мёртвые каналы и отправляем живым
        user_senders.retain(|tx| tx.send(payload.clone()).is_ok());
        // Если все каналы мёртвые, удаляем запись
        if user_senders.is_empty() {
            senders.remove(user_id);
        }
    }
}

/// PERF-3: Отправить сообщение всем КРОМЕ указанного пользователя
async fn broadcast_except(state: &AppState, except_user_id: &str, payload: serde_json::Value) {
    let senders = state.user_senders.lock().await;
    for (uid, user_senders) in senders.iter() {
        if uid != except_user_id {
            for tx in user_senders {
                let _ = tx.send(payload.clone());
            }
        }
    }
}

/// PERF-3: Отправить сообщение двум пользователям (отправитель + получатель)
async fn send_to_chat_participants(
    state: &AppState,
    sender_id: &str,
    recipient_id: &Option<String>,
    payload: serde_json::Value,
) {
    // Отправляем отправителю (для ACK обновления статуса)
    send_to_user(state, sender_id, payload.clone()).await;

    // Если есть получатель — отправляем и ему
    if let Some(recip_id) = recipient_id {
        if recip_id != sender_id {
            send_to_user(state, recip_id, payload).await;
        }
    } else {
        // Общее сообщение — отправляем всем кроме отправителя
        broadcast_except(state, sender_id, payload).await;
    }
}

/// Обработка клиентского сообщения с защитой от паник
pub async fn handle_client_message(
    client_msg: ClientMsg,
    user_id: &mut Option<String>,
    session: &mut actix_ws::Session,
    state: &AppState,
) {
    let msg_type = client_msg.msg_type.clone();

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

    // PERF-1: Получаем соединение из pool
    let conn = match state.db.get() {
        Ok(c) => c,
        Err(e) => {
            log::error!("Failed to get DB connection: {}", e);
            return;
        }
    };

    let user: User = match db::get_or_create_user(&conn, &client_msg.name, &avatar) {
        Ok(u) => u,
        Err(e) => {
            log::error!("Failed to create user: {}", e);
            return;
        }
    };

    *user_id = Some(user.id.clone());

    // PERF-3: Регистрируем sender для targeted delivery
    let (tx, mut rx) = unbounded_channel::<serde_json::Value>();
    {
        let mut senders = state.user_senders.lock().await;
        senders.entry(user.id.clone()).or_default().push(tx);
    }

    // Добавляем в онлайн
    let timestamp = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    state
        .online_users
        .lock()
        .await
        .insert(user.id.clone(), timestamp);

    // PERF-3: Запускаем задачу рассылки для этого пользователя
    let mut session_clone = session.clone();
    let user_id_clone = user.id.clone();
    let state_clone = state.clone();
    actix_web::rt::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if session_clone.text(msg.to_string()).await.is_err() {
                // Клиент отключился — удаляем его sender
                let mut senders = state_clone.user_senders.lock().await;
                if let Some(user_senders) = senders.get_mut(&user_id_clone) {
                    user_senders.retain(|tx| !tx.is_closed());
                    if user_senders.is_empty() {
                        senders.remove(&user_id_clone);
                    }
                }
                break;
            }
        }
    });

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

    // PERF-3: Рассылаем остальным что этот пользователь подключился
    broadcast_except(
        state,
        &user.id,
        json!({
            "type": "user_online",
            "user_id": user.id,
            "online": true
        }),
    )
    .await;

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

    // PERF-1: Получаем соединение из pool
    let conn = match state.db.get() {
        Ok(c) => c,
        Err(e) => {
            log::error!("Failed to get DB connection: {}", e);
            return;
        }
    };

    if let Err(e) = db::update_user_avatar(&conn, &uid, &new_avatar) {
        log::error!("Failed to update avatar: {}", e);
        return;
    }

    // PERF-3: Рассылаем обновление всем
    broadcast_except(
        state,
        &uid,
        json!({
            "type": "user_updated",
            "user_id": uid,
            "avatar": new_avatar
        }),
    )
    .await;
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

    // PERF-1: Получаем соединение из pool
    let conn = match state.db.get() {
        Ok(c) => c,
        Err(e) => {
            log::error!("Failed to get DB connection: {}", e);
            return;
        }
    };

    let uname = match db::get_user_name(&conn, &uid) {
        Ok(name) => name,
        Err(e) => {
            log::error!("Failed to get user name: {}", e);
            return;
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

    if let Err(e) = db::save_message(&conn, &message) {
        log::error!("Failed to save message: {}", e);
        return;
    }

    log::info!(
        "📤 Рассылка сообщения: id={}, files={}",
        message.id,
        message.files.len()
    );

    // PERF-3: Targeted delivery — только отправителю и получателю
    let payload = json!({ "type": "message", "message": message });
    send_to_chat_participants(state, &uid, &client_msg.recipient_id, payload).await;
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

    // PERF-1: Получаем соединение из pool
    let conn = match state.db.get() {
        Ok(c) => c,
        Err(e) => {
            log::error!("Failed to get DB connection: {}", e);
            return;
        }
    };

    if let Err(e) = db::update_message_delivery_status(&conn, &client_msg.message_id, status) {
        log::error!("Failed to update delivery status: {}", e);
        return;
    }

    let ack_msg = json!({
        "type": "ack",
        "message_id": msg_id,
        "status": client_msg.status,
        "sender_id": ack_sender_id
    });
    log::info!("📤 Рассылка ACK: {}", ack_msg);

    // PERF-3: Отправляем ACK только оригинальному отправителю сообщения
    send_to_user(state, &ack_sender_id, ack_msg).await;
}

/// Обработка запроса истории сообщений
async fn handle_get_messages(
    client_msg: ClientMsg,
    session: &mut actix_ws::Session,
    state: &AppState,
) {
    let limit = client_msg.limit.clamp(1, 200);
    let before_id = &client_msg.before_id;

    // PERF-1: Получаем соединение из pool
    let conn = match state.db.get() {
        Ok(c) => c,
        Err(e) => {
            log::error!("Failed to get DB connection: {}", e);
            return;
        }
    };

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
    let mut text_fragment_buffer = String::new();

    loop {
        tokio::select! {
            Some(msg) = msg_stream.next() => {
                match msg {
                    Ok(Message::Text(text)) => {
                        log::debug!("📥 Получено WebSocket сообщение, размер: {} байт", text.len());

                        match serde_json::from_str::<ClientMsg>(&text) {
                            Ok(client_msg) => {
                                log::debug!("✅ JSON распарсен успешно, тип: {}", client_msg.msg_type);
                                handle_client_message(client_msg, &mut user_id, &mut session, &state).await;
                            }
                            Err(e) => {
                                log::warn!("⚠️ Ошибка парсинга JSON: {}", e);
                                log::debug!("📝 Первые 200 символов: {}", text.chars().take(200).collect::<String>());
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
                                log::debug!("✅ Фрагментированное сообщение собрано успешно (общий размер: {} байт)", text_fragment_buffer.len());
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
        }
    }
}

/// Удаление пользователя из списка онлайн
async fn remove_user_from_online(state: &AppState, user_id: &str) {
    state.online_users.lock().await.remove(user_id);

    // PERF-3: Удаляем все sender'ы пользователя
    {
        let mut senders = state.user_senders.lock().await;
        senders.remove(user_id);
    }

    broadcast_except(
        state,
        user_id,
        json!({
            "type": "user_online",
            "user_id": user_id,
            "online": false
        }),
    )
    .await;

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
