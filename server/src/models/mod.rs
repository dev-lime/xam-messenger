// Модели данных для XAM Messenger Server

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::broadcast;

/// Пользователь
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct User {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub avatar: String,
}

/// Данные файла
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct FileData {
    pub name: String,
    pub size: u64,
    pub path: String,
}

/// Сообщение чата
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

/// Сообщение от клиента (WebSocket)
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

/// Состояние приложения
#[derive(Clone)]
pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
    pub tx: broadcast::Sender<serde_json::Value>,
    pub online_users: Arc<Mutex<HashMap<String, u64>>>,
}
