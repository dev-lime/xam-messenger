// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod types;
mod network;
mod history;
mod state;

use state::AppState;
use types::{ChatMessage, ConnectionStatus, Message, PeerInfo};
use std::sync::Mutex;

// ============ Tauri Commands ============

#[tauri::command]
fn init_app(app_state: tauri::State<Mutex<AppState>>) -> Result<(), String> {
    let mut state = app_state.lock().map_err(|e| e.to_string())?;
    state.initialize().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_peers(app_state: tauri::State<Mutex<AppState>>) -> Result<Vec<PeerInfo>, String> {
    let state = app_state.lock().map_err(|e| e.to_string())?;
    Ok(state.get_peers())
}

#[tauri::command]
fn get_messages(
    app_state: tauri::State<Mutex<AppState>>,
    peer_address: String,
) -> Result<Vec<Message>, String> {
    let state = app_state.lock().map_err(|e| e.to_string())?;
    let messages = state.get_messages(&peer_address);
    Ok(messages
        .into_iter()
        .map(|m| Message {
            id: m.id,
            text: m.text,
            is_mine: m.is_mine,
            timestamp: m.timestamp.timestamp(),
            sender: m.sender,
            delivery_status: m.delivery_status,
            files: m.files,
        })
        .collect())
}

#[tauri::command]
fn start_server(
    app_state: tauri::State<Mutex<AppState>>,
    port: String,
    name: String,
) -> Result<(), String> {
    let mut state = app_state.lock().map_err(|e| e.to_string())?;
    state.start_server(&port, &name)
}

#[tauri::command]
fn connect_to_peer(
    app_state: tauri::State<Mutex<AppState>>,
    peer_address: String,
) -> Result<(), String> {
    let mut state = app_state.lock().map_err(|e| e.to_string())?;
    state.connect_to_peer(&peer_address)
}

#[tauri::command]
fn send_message(
    app_state: tauri::State<Mutex<AppState>>,
    peer_address: String,
    text: String,
) -> Result<bool, String> {
    let mut state = app_state.lock().map_err(|e| e.to_string())?;
    state.send_message(&peer_address, &text)
}

#[tauri::command]
fn get_connection_status(
    app_state: tauri::State<Mutex<AppState>>,
) -> Result<ConnectionStatus, String> {
    let state = app_state.lock().map_err(|e| e.to_string())?;
    Ok(state.get_status())
}

#[tauri::command]
fn disconnect(app_state: tauri::State<Mutex<AppState>>) -> Result<(), String> {
    let mut state = app_state.lock().map_err(|e| e.to_string())?;
    state.disconnect();
    Ok(())
}

#[tauri::command]
fn set_peer_address(
    app_state: tauri::State<Mutex<AppState>>,
    peer_address: String,
) -> Result<(), String> {
    let mut state = app_state.lock().map_err(|e| e.to_string())?;
    state.peer_address = Some(peer_address);
    state.connected = true;
    Ok(())
}

#[tauri::command]
fn get_current_peer(
    app_state: tauri::State<Mutex<AppState>>,
) -> Result<Option<String>, String> {
    let state = app_state.lock().map_err(|e| e.to_string())?;
    Ok(state.peer_address.clone())
}

#[tauri::command]
async fn send_file(
    app_state: tauri::State<'_, Mutex<AppState>>,
    peer_address: String,
    file_path: String,
) -> Result<(), String> {
    let mut state = app_state.lock().map_err(|e| e.to_string())?;
    state.send_file(&peer_address, &file_path)
}

#[tauri::command]
fn send_ack(
    app_state: tauri::State<Mutex<AppState>>,
    peer_address: String,
    message_ids: Vec<String>,
) -> Result<(), String> {
    let mut state = app_state.lock().map_err(|e| e.to_string())?;
    state.send_ack(&peer_address, message_ids, false)
}

#[tauri::command]
fn send_read_ack(
    app_state: tauri::State<Mutex<AppState>>,
    peer_address: String,
    message_ids: Vec<String>,
) -> Result<(), String> {
    let mut state = app_state.lock().map_err(|e| e.to_string())?;
    state.send_ack(&peer_address, message_ids, true)
}

#[tauri::command]
fn get_cached_messages(
    app_state: tauri::State<Mutex<AppState>>,
    peer_address: String,
) -> Result<Vec<Message>, String> {
    let state = app_state.lock().map_err(|e| e.to_string())?;
    let messages = state.get_cached_messages(&peer_address);
    Ok(messages
        .into_iter()
        .map(|m| Message {
            id: m.id,
            text: m.text,
            is_mine: m.is_mine,
            timestamp: m.timestamp.timestamp(),
            sender: m.sender,
            delivery_status: m.delivery_status,
            files: m.files,
        })
        .collect())
}

#[tauri::command]
fn mark_delivered(
    app_state: tauri::State<Mutex<AppState>>,
    peer_address: String,
    message_id: String,
) -> Result<(), String> {
    let mut state = app_state.lock().map_err(|e| e.to_string())?;
    state.mark_delivered(&peer_address, &message_id);
    Ok(())
}

#[tauri::command]
fn retry_undelivered(
    app_state: tauri::State<Mutex<AppState>>,
    peer_address: String,
) -> Result<usize, String> {
    let mut state = app_state.lock().map_err(|e| e.to_string())?;
    state.retry_undelivered(&peer_address)
}

#[tauri::command]
async fn send_file_base64(
    app_state: tauri::State<'_, Mutex<AppState>>,
    peer_address: String,
    file_name: String,
    file_data: String,
) -> Result<(), String> {
    let mut state = app_state.lock().map_err(|e| e.to_string())?;

    // Парсим base64 (удаляем data:...;base64,)
    let base64_data = file_data.split(',').nth(1).unwrap_or(&file_data);

    // Декодируем base64
    use base64::Engine;
    let file_bytes = base64::engine::general_purpose::STANDARD.decode(base64_data)
        .map_err(|e| format!("Ошибка декодирования base64: {}", e))?;

    eprintln!("📁 Отправка файла: {} ({} байт) -> {}", file_name, file_bytes.len(), peer_address);

    // Отправляем файл по TCP
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::time::Duration;

    let mut stream = TcpStream::connect(&peer_address)
        .map_err(|e| format!("Не удалось подключиться к {}: {}", peer_address, e))?;

    stream.set_read_timeout(Some(Duration::from_secs(30)))
        .map_err(|e| format!("Ошибка установки таймаута: {}", e))?;

    // Отправляем заголовок: FILE|name|size|sender_port\n
    let my_port = state.my_port.clone().unwrap_or_else(|| "0".to_string());
    let header = format!("FILE|{}|{}|{}\n", file_name, file_bytes.len(), my_port);
    stream.write_all(header.as_bytes())
        .map_err(|e| format!("Ошибка отправки заголовка: {}", e))?;

    // Отправляем данные файла
    stream.write_all(&file_bytes)
        .map_err(|e| format!("Ошибка отправки данных: {}", e))?;

    // Ждём подтверждение
    let mut buffer = [0u8; 1024];
    match stream.read(&mut buffer) {
        Ok(n) => {
            let response = String::from_utf8_lossy(&buffer[..n]);
            eprintln!("📥 Ответ от получателя: {}", response);
            if response != "FILE_OK" {
                return Err(format!("Получен неверный ответ: {}", response));
            }
        }
        Err(e) => {
            return Err(format!("Таймаут подтверждения: {}", e));
        }
    }

    eprintln!("✅ Файл успешно отправлен");

    // Сохраняем сообщение о файле в кэш и историю отправителя (is_mine: true)
    let file_msg = ChatMessage {
        id: uuid::Uuid::new_v4().to_string(),
        timestamp: chrono::Utc::now(),
        sender: state.my_name.clone(),
        text: format!("📎 Файл: {}", file_name),
        is_mine: true,
        delivery_status: 1,
        files: vec![types::FileInfo {
            name: file_name.clone(),
            size: file_bytes.len(),
        }],
    };

    // Сохраняем в кэш
    state.message_cache
        .entry(peer_address.clone())
        .or_insert_with(Vec::new)
        .push(file_msg.clone());

    // Сохраняем в историю
    state.history_mgr.save_message(&peer_address, &file_msg);

    eprintln!("💾 Файл сохранён в историю отправителя для: {}", peer_address);

    Ok(())
}

#[tauri::command]
fn mark_read(
    app_state: tauri::State<Mutex<AppState>>,
    peer_address: String,
    message_ids: Vec<String>,
) -> Result<(), String> {
    let mut state = app_state.lock().map_err(|e| e.to_string())?;
    state.mark_read(&peer_address, &message_ids);
    Ok(())
}

#[tauri::command]
fn update_delivery_status(
    app_state: tauri::State<Mutex<AppState>>,
    peer_address: String,
    message_ids: Vec<String>,
    status: u8,
) -> Result<(), String> {
    let mut state = app_state.lock().map_err(|e| e.to_string())?;
    state.update_delivery_status(&peer_address, &message_ids, status);
    Ok(())
}

// ============ Main ============

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Mutex::new(AppState::new()))
        .invoke_handler(tauri::generate_handler![
            init_app,
            get_peers,
            get_messages,
            get_cached_messages,
            start_server,
            connect_to_peer,
            send_message,
            send_ack,
            send_read_ack,
            mark_delivered,
            retry_undelivered,
            mark_read,
            update_delivery_status,
            get_connection_status,
            disconnect,
            set_peer_address,
            get_current_peer,
            send_file,
            send_file_base64,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
