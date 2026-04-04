//! Модели данных для XAM Messenger Server

use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::sync::mpsc::UnboundedSender;

/// Пользователь
#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub struct User {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub avatar: String,
}

/// Данные файла
#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub struct FileData {
    pub name: String,
    pub size: u64,
    pub path: String,
}

/// Сообщение чата
#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
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

/// PERF-3: Targeted delivery — мапа user_id → список отправителей
/// Заменяет broadcast::channel для целевой рассылки сообщений
pub type UserSenders = Arc<Mutex<HashMap<String, Vec<UnboundedSender<serde_json::Value>>>>>;

/// Состояние приложения
///
/// PERF-1: Используем r2d2 pool вместо Arc<Mutex<Connection>>
///         для параллельного доступа к БД без сериализации.
/// PERF-3: Используем user_senders для targeted delivery вместо broadcast канала.
#[derive(Clone)]
pub struct AppState {
    /// PERF-1: Pool соединений SQLite (вместо Mutex<Connection>)
    pub db: Pool<SqliteConnectionManager>,
    /// PERF-3: Targeted delivery — user_id → Vec<senders>
    pub user_senders: UserSenders,
    pub online_users: Arc<Mutex<HashMap<String, u64>>>,
    /// Директория для загруженных файлов (для валидации path traversal)
    pub upload_dir: PathBuf,
    /// Максимальный размер файла в байтах
    pub max_file_size: usize,
}
