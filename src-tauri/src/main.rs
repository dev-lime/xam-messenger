// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod types;
mod network;
mod history;
mod state;

use state::AppState;
use types::{Message, PeerInfo, ConnectionStatus};
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
) -> Result<(), String> {
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
    state.send_ack(&peer_address, message_ids)
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
fn mark_read(
    app_state: tauri::State<Mutex<AppState>>,
    peer_address: String,
    message_ids: Vec<String>,
) -> Result<(), String> {
    let mut state = app_state.lock().map_err(|e| e.to_string())?;
    state.mark_read(&peer_address, &message_ids);
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
            mark_delivered,
            mark_read,
            get_connection_status,
            disconnect,
            set_peer_address,
            get_current_peer,
            send_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
