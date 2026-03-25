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
            is_read: m.is_read,
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

// ============ Main ============

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Mutex::new(AppState::new()))
        .invoke_handler(tauri::generate_handler![
            init_app,
            get_peers,
            get_messages,
            start_server,
            connect_to_peer,
            send_message,
            get_connection_status,
            disconnect,
            set_peer_address,
            get_current_peer,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
