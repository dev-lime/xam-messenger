//! Обработчики WebSocket соединений

use actix_web::{HttpRequest, HttpResponse, web};
use actix_ws::{Message, MessageStream};
use chrono::Utc;
use futures_util::{FutureExt, StreamExt};
use serde_json::json;
use std::panic::AssertUnwindSafe;
use std::sync::atomic::Ordering;
use std::time::SystemTime;
use tokio::fs::File;
use tokio::io::AsyncWriteExt;
use tokio::sync::mpsc::unbounded_channel;
use uuid::Uuid;

use crate::db;
use crate::models::{AppState, ChatMessage, ClientMsg, FileUploadState, User};

/// Получить лимит имени из env
fn max_name_length() -> usize {
    std::env::var("MAX_NAME_LENGTH")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(50)
}

/// Получить лимит текста из env
fn max_message_length() -> usize {
    std::env::var("MAX_MESSAGE_LENGTH")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(10_000)
}

/// Получить лимит имени файла из env
fn max_file_name_length() -> usize {
    std::env::var("MAX_FILE_NAME_LENGTH")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(255)
}

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
/// FIX H-01: добавлен retain() для удаления мёртвых каналов
async fn broadcast_except(state: &AppState, except_user_id: &str, payload: serde_json::Value) {
    let mut senders = state.user_senders.lock().await;
    let mut dead_users = Vec::new();

    for (uid, user_senders) in senders.iter_mut() {
        if uid != except_user_id {
            // FIX H-01: удаляем мёртвые каналы при каждом broadcast
            user_senders.retain(|tx| tx.send(payload.clone()).is_ok());
            if user_senders.is_empty() {
                dead_users.push(uid.clone());
            }
        }
    }

    // Удаляем пользователей у которых не осталось живых каналов
    for uid in dead_users {
        senders.remove(&uid);
    }
}

/// PERF-3: Отправить сообщение двум пользователям (отправитель + получатель)
async fn send_to_chat_participants(
    state: &AppState,
    sender_id: &str,
    recipient_id: &Option<String>,
    payload: serde_json::Value,
) {
    send_to_user(state, sender_id, payload.clone()).await;

    if let Some(recip_id) = recipient_id {
        if recip_id != sender_id {
            send_to_user(state, recip_id, payload).await;
        }
    } else {
        broadcast_except(state, sender_id, payload).await;
    }
}

// ============================================================================
// WebSocket чанковая передача файлов
// ============================================================================

/// Обработка file_start — начало загрузки файла
async fn handle_file_start(
    client_msg: ClientMsg,
    user_id: &str,
    state: &AppState,
) -> Result<(), String> {
    let file_id = client_msg.file_id.ok_or("file_id is required")?;
    let file_name = client_msg.file_name.ok_or("file_name is required")?;
    let file_size = client_msg.file_size.ok_or("file_size is required")?;

    // Защита от Path Traversal: file_id должен быть UUID
    if Uuid::parse_str(&file_id).is_err() {
        return Err("Invalid file_id format: must be a valid UUID".to_string());
    }

    // FIX S7: Валидация имени файла
    if file_name.is_empty() {
        return Err("File name cannot be empty".to_string());
    }
    if file_name.len() > max_file_name_length() {
        return Err(format!(
            "File name too long (max {} characters)",
            max_file_name_length()
        ));
    }
    if file_name.contains('/') || file_name.contains('\\') {
        return Err("Invalid file name: path separators not allowed".to_string());
    }

    // Проверка размера
    if file_size > state.max_file_size as u64 {
        return Err(format!(
            "File too large (max {} MB)",
            state.max_file_size / 1024 / 1024
        ));
    }

    let sender_name = {
        let conn = state.db.get().map_err(|e| e.to_string())?;
        db::get_user_name(&conn, user_id).map_err(|e| e.to_string())?
    };

    let filepath = state.upload_dir.join(&file_id);

    // Дополнительно проверяем что путь внутри upload_dir
    if !filepath.starts_with(&state.upload_dir) {
        return Err("Invalid file path".to_string());
    }

    let upload = FileUploadState {
        id: file_id.clone(),
        name: file_name.clone(),
        size: file_size,
        sender_id: user_id.to_string(),
        recipient_id: client_msg.recipient_id.clone(),
        uploaded_bytes: 0,
        filepath,
        sender_name,
    };

    state.file_uploads.lock().await.insert(file_id, upload);
    Ok(())
}

/// Обработка бинарного чанка файла
async fn handle_file_chunk(file_id: &str, data: &[u8], state: &AppState) -> Result<(), String> {
    let mut uploads = state.file_uploads.lock().await;
    let upload = uploads.get_mut(file_id).ok_or("File upload not found")?;

    // Проверка что не превышаем размер
    if upload.uploaded_bytes + data.len() as u64 > upload.size {
        return Err("File size mismatch: received more than declared".to_string());
    }

    // Открываем файл в режиме append (создаём если нет)
    let mut file = File::options()
        .create(true)
        .append(true)
        .open(&upload.filepath)
        .await
        .map_err(|e| format!("Failed to open file for writing: {}", e))?;

    file.write_all(data)
        .await
        .map_err(|e| format!("Failed to write file chunk: {}", e))?;

    upload.uploaded_bytes += data.len() as u64;
    Ok(())
}

/// Обработка file_end — завершение загрузки, сохранение в БД, рассылка
async fn handle_file_end(
    client_msg: ClientMsg,
    user_id: &str,
    state: &AppState,
) -> Result<(), String> {
    let file_id = client_msg.file_id.ok_or("file_id is required")?;

    let upload = {
        let mut uploads = state.file_uploads.lock().await;
        uploads.remove(&file_id).ok_or("File upload not found")?
    };

    // Проверка что весь файл получен
    if upload.uploaded_bytes != upload.size {
        // FIX H-05 / L-03: Удаляем неполный файл
        let _ = tokio::fs::remove_file(&upload.filepath).await;
        return Err(format!(
            "File incomplete: {} of {} bytes",
            upload.uploaded_bytes, upload.size
        ));
    }

    // FIX H-05: Сохраняем metadata в БД в транзакции.
    // При ошибке — удаляем файл с диска чтобы не было файлов-сирот.
    let conn = state.db.get().map_err(|e| e.to_string())?;

    if let Err(e) = db::save_file_metadata(
        &conn,
        &file_id,
        &upload.name,
        upload.filepath.to_string_lossy().as_ref(),
        upload.size as i64,
        &upload.sender_id,
        upload.recipient_id.as_deref().unwrap_or(""),
    ) {
        // FIX H-05: cleanup — удаляем файл при ошибке записи метаданных
        let _ = tokio::fs::remove_file(&upload.filepath).await;
        return Err(format!("Failed to save file metadata: {}", e));
    }

    // Создаём сообщение с файлом
    let message = ChatMessage {
        id: Uuid::new_v4().to_string(),
        sender_id: user_id.to_string(),
        sender_name: upload.sender_name.clone(),
        text: format!("📎 {}", upload.name),
        timestamp: Utc::now().timestamp(),
        delivery_status: 1,
        recipient_id: upload.recipient_id.clone(),
        files: vec![crate::models::FileData {
            name: upload.name.clone(),
            size: upload.size,
            path: file_id.clone(),
        }],
    };

    // Сохраняем сообщение
    if let Err(e) = db::save_message(&conn, &message) {
        // FIX H-05: cleanup — удаляем файл и метаданные при ошибке сохранения сообщения
        let _ = tokio::fs::remove_file(&upload.filepath).await;
        // Пытаемся удалить запись о файле из БД (best effort)
        let _ = conn.execute(
            "DELETE FROM files WHERE id = ?1",
            rusqlite::params![file_id],
        );
        return Err(format!("Failed to save message with file: {}", e));
    }

    // Рассылаем сообщение
    let payload = json!({ "type": "message", "message": message });
    send_to_chat_participants(state, user_id, &upload.recipient_id, payload).await;

    log::info!("📁 Файл получен: {} ({} bytes)", upload.name, upload.size);

    Ok(())
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
            "get_messages" => handle_get_messages(client_msg, user_id, session, state).await,
            "delete_chat" => handle_delete_chat(client_msg, user_id, session, state).await,
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
    // FIX S2: Валидация имени (совпадает с handlers.rs)
    let name = client_msg.name.trim().to_string();
    if name.is_empty() {
        log::warn!("⚠️ Пустое имя при регистрации через WebSocket");
        let _ = session
            .text(json!({ "type": "error", "error": "Empty name" }).to_string())
            .await;
        return;
    }
    if name.len() > max_name_length() {
        log::warn!(
            "⚠️ Имя слишком длинное: {} символов (макс. {})",
            name.len(),
            max_name_length()
        );
        let _ = session
            .text(
                json!({
                    "type": "error",
                    "error": format!("Name too long (max {} characters)", max_name_length())
                })
                .to_string(),
            )
            .await;
        return;
    }

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

    let user: User = match db::get_or_create_user(&conn, &name, &avatar) {
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

    // FIX S1: Валидация длины текста (защита от DoS)
    if client_msg.text.len() > max_message_length() {
        log::warn!(
            "⚠️ Сообщение слишком длинное: {} символов (макс. {})",
            client_msg.text.len(),
            max_message_length()
        );
        return;
    }

    log::info!(
        "📩 Получено сообщение: text_len={}, files={}",
        client_msg.text.len(),
        client_msg.files.len()
    );

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

    // PERF-1: Получаем соединение из pool
    let conn = match state.db.get() {
        Ok(c) => c,
        Err(e) => {
            log::error!("Failed to get DB connection: {}", e);
            return;
        }
    };

    // Находим оригинальный sender сообщения чтобы отправить ACK ему
    let original_sender = match db::get_message_sender(&conn, &msg_id) {
        Ok(sender) => sender,
        Err(e) => {
            log::error!("Failed to get message sender for ACK: {}", e);
            return;
        }
    };

    log::info!(
        "📨 ACK {} для {} от {} → отправителю {}",
        client_msg.status,
        msg_id,
        ack_sender_id,
        original_sender
    );

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
    log::info!("📤 Отправка ACK отправителю: {}", original_sender);

    // PERF-3: Отправляем ACK оригинальному отправителю сообщения
    send_to_user(state, &original_sender, ack_msg).await;
}

/// Обработка запроса истории сообщений
async fn handle_get_messages(
    client_msg: ClientMsg,
    user_id: &Option<String>,
    session: &mut actix_ws::Session,
    state: &AppState,
) {
    let limit = client_msg.limit.clamp(1, 200);
    let before_id = &client_msg.before_id;

    // FIX C-03: Запрос должен быть от зарегистрированного пользователя
    let uid = match user_id {
        Some(id) => id.clone(),
        None => {
            log::warn!("⚠️ Запрос сообщений до регистрации пользователя");
            let _ = session
                .text(json!({"type": "error", "error": "Not registered"}).to_string())
                .await;
            return;
        }
    };

    // PERF-1: Получаем соединение из pool
    let conn = match state.db.get() {
        Ok(c) => c,
        Err(e) => {
            log::error!("Failed to get DB connection: {}", e);
            return;
        }
    };

    // FIX C-03 + M-01: При запросе чата проверяем что пользователь — участник чата.
    let result = if let Some(ref chat_peer_id) = client_msg.recipient_id {
        // FIX C-03: Проверяем что requester является участником чата
        let is_participant = db::is_chat_participant(&conn, &uid, chat_peer_id).unwrap_or(false);
        if !is_participant {
            log::warn!(
                "⚠️ Пользователь {} запросил чужой чат с {}",
                uid,
                chat_peer_id
            );
            let _ = session
                .text(json!({"type": "error", "error": "Access denied"}).to_string())
                .await;
            return;
        }
        db::get_messages_for_chat(&conn, limit, before_id.as_deref(), chat_peer_id)
    } else {
        db::get_messages_with_pagination(&conn, limit, before_id.as_deref())
    };

    match result {
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

/// Удаление чата между двумя пользователями
async fn handle_delete_chat(
    client_msg: ClientMsg,
    user_id: &Option<String>,
    session: &mut actix_ws::Session,
    state: &AppState,
) {
    let uid = match user_id {
        Some(id) => id.clone(),
        None => {
            log::warn!("⚠️ Запрос удаления чата до регистрации пользователя");
            let _ = session
                .text(json!({"type": "error", "error": "Not registered"}).to_string())
                .await;
            return;
        }
    };

    let peer_id = match &client_msg.recipient_id {
        Some(id) => id.clone(),
        None => {
            let _ = session
                .text(json!({"type": "error", "error": "recipient_id is required"}).to_string())
                .await;
            return;
        }
    };

    let conn = match state.db.get() {
        Ok(c) => c,
        Err(e) => {
            log::error!("Failed to get DB connection: {}", e);
            return;
        }
    };

    match db::delete_chat_messages(&conn, &uid, &peer_id) {
        Ok(file_ids) => {
            for file_id in &file_ids {
                let filepath = state.upload_dir.join(file_id);
                if filepath.starts_with(&state.upload_dir) {
                    let _ = tokio::fs::remove_file(&filepath).await;
                }
            }

            log::info!("🗑️ Чат удалён: user={}, peer={}", uid, peer_id);

            let payload = json!({
                "type": "chat_deleted",
                "peer_id": peer_id,
                "deleted_by": uid
            });

            let _ = session.text(payload.to_string()).await;

            send_to_user(
                state,
                &peer_id,
                json!({
                    "type": "chat_deleted",
                    "peer_id": uid,
                    "deleted_by": uid
                }),
            )
            .await;
        }
        Err(e) => {
            log::error!("Failed to delete chat: {}", e);
            let _ = session
                .text(json!({"type": "error", "error": "Failed to delete chat"}).to_string())
                .await;
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
    let mut active_file_id: Option<String> = None;
    // Track whether continuation frames are text or binary
    let mut continuation_is_binary = false;

    loop {
        tokio::select! {
            Some(msg) = msg_stream.next() => {
                match msg {
                    Ok(Message::Text(text)) => {
                        log::debug!("📥 Получено WebSocket сообщение, размер: {} байт", text.len());

                        match serde_json::from_str::<ClientMsg>(&text) {
                            Ok(client_msg) => {
                                log::debug!("✅ JSON распарсен успешно, тип: {}", client_msg.msg_type);

                                // file_start/file_end управляются здесь (не в handle_client_message)
                                // потому что они модифицируют active_file_id
                                match client_msg.msg_type.as_str() {
                                    "file_start" => {
                                        if let Some(uid) = &user_id {
                                            if let Err(e) = handle_file_start(client_msg.clone(), uid, &state).await {
                                                log::error!("file_start error: {}", e);
                                                let _ = session.text(json!({"type": "file_error", "error": e}).to_string()).await;
                                            } else if let Some(fid) = &client_msg.file_id {
                                                active_file_id = Some(fid.clone());
                                                continuation_is_binary = true;
                                            }
                                        }
                                    }
                                    "file_end" => {
                                        if let Some(uid) = &user_id
                                            && let Err(e) = handle_file_end(client_msg, uid, &state).await {
                                                log::error!("file_end error: {}", e);
                                                let _ = session.text(json!({"type": "file_error", "error": e}).to_string()).await;
                                            }
                                        active_file_id = None;
                                        continuation_is_binary = false;
                                    }
                                    _ => {
                                        handle_client_message(client_msg, &mut user_id, &mut session, &state).await;
                                    }
                                }
                            }
                            Err(e) => {
                                log::warn!("⚠️ Ошибка парсинга JSON: {}", e);
                                log::debug!("📝 Первые 200 символов: {}", text.chars().take(200).collect::<String>());
                                text_fragment_buffer = text.to_string();
                            }
                        }
                    }
                    // WebSocket чанки файлов: бинарные фреймы = chunks файла
                    Ok(Message::Binary(data)) => {
                        if let Some(ref file_id) = active_file_id {
                            if let Err(e) = handle_file_chunk(file_id, &data, &state).await {
                                log::error!("❌ Ошибка записи чанка файла {}: {}", file_id, e);
                                let _ = session.text(
                                    json!({"type": "file_error", "file_id": file_id, "error": e}).to_string()
                                ).await;
                                active_file_id = None;
                            }
                        } else {
                            log::warn!("⚠️ Получены бинарные данные без активного file_start");
                        }
                    }
                    Ok(Message::Continuation(item)) => {
                        let bytes: &[u8] = match &item {
                            actix_ws::Item::FirstBinary(b)
                            | actix_ws::Item::Continue(b)
                            | actix_ws::Item::Last(b)
                            | actix_ws::Item::FirstText(b) => b.as_ref(),
                        };

                        if continuation_is_binary {
                            if let Some(ref file_id) = active_file_id
                                && let Err(e) = handle_file_chunk(file_id, bytes, &state).await {
                                    log::error!("❌ Ошибка записи чанка файла {}: {}", file_id, e);
                                    let _ = session.text(
                                        json!({"type": "file_error", "file_id": file_id, "error": e}).to_string()
                                    ).await;
                                    active_file_id = None;
                                }
                        } else {
                            let cont_text = String::from_utf8_lossy(bytes);
                            text_fragment_buffer.push_str(&cont_text);

                            if let Ok(client_msg) = serde_json::from_str::<ClientMsg>(&text_fragment_buffer) {
                                text_fragment_buffer.clear();
                                handle_client_message(client_msg, &mut user_id, &mut session, &state).await;
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
    let state = data.get_ref().clone();

    // Лимит подключений (защита от DoS)
    const MAX_CONNECTIONS: usize = 100;
    let current = state.ws_connections.load(Ordering::Relaxed);
    if current >= MAX_CONNECTIONS {
        log::warn!(
            "⚠️ Превышен лимит подключений: {}/{}",
            current,
            MAX_CONNECTIONS
        );
        return Ok(HttpResponse::ServiceUnavailable().json(serde_json::json!({
            "success": false,
            "error": "Server is at capacity. Too many connections."
        })));
    }
    state.ws_connections.fetch_add(1, Ordering::Relaxed);

    let (response, session, msg_stream) = actix_ws::handle(&req, stream)?;
    let state_spawn = state.clone();
    actix_web::rt::spawn(async move {
        handle_websocket_session(session, msg_stream, state_spawn).await;
        state.ws_connections.fetch_sub(1, Ordering::Relaxed);
    });
    Ok(response)
}
