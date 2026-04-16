//! Модели данных для XAM Messenger Server

use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicUsize;
use std::sync::{Arc, Mutex as StdMutex};
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
    /// Аватар (используется в register/update_profile).
    /// Поддерживает старое поле `text` для обратной совместимости.
    #[serde(default)]
    pub avatar: String,
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
    /// ID собеседника для get_messages (клиент шлёт chat_peer_id; recipient_id — совместимость)
    #[serde(default)]
    pub chat_peer_id: Option<String>,
    /// Метаданные файла для file_start
    #[serde(default)]
    pub file_id: Option<String>,
    /// Метаданные файла для file_start
    #[serde(default)]
    pub file_name: Option<String>,
    /// Метаданные файла для file_start
    #[serde(default)]
    pub file_size: Option<u64>,
    #[serde(default)]
    pub files: Vec<FileData>,
    /// Текст сообщения (используется в message/get_messages)
    #[serde(default, rename = "text")]
    pub text: String,
}

/// PERF-3: Targeted delivery — мапа user_id → список отправителей
pub type UserSenders = Arc<Mutex<HashMap<String, Vec<UnboundedSender<serde_json::Value>>>>>;

/// Состояние сборки файла из чанков
#[allow(dead_code)]
pub struct FileUploadState {
    pub id: String,
    pub name: String,
    pub size: u64,
    pub sender_id: String,
    pub recipient_id: Option<String>,
    pub uploaded_bytes: u64,
    pub filepath: PathBuf,
    pub sender_name: String,
}

/// Контейнер для активных загрузок файлов (std mutex — синхронная запись чанков в spawn_blocking)
pub type FileUploads = Arc<StdMutex<HashMap<String, FileUploadState>>>;

/// Состояние приложения
#[derive(Clone)]
pub struct AppState {
    /// Pool соединений SQLite
    pub db: Pool<SqliteConnectionManager>,
    /// Targeted delivery
    pub user_senders: UserSenders,
    pub online_users: Arc<Mutex<HashMap<String, u64>>>,
    /// Директория для загруженных файлов
    pub upload_dir: PathBuf,
    /// Максимальный размер файла
    pub max_file_size: usize,
    /// Активные загрузки файлов (chunk assembly)
    pub file_uploads: FileUploads,
    /// Счётчик WebSocket подключений (для лимита)
    pub ws_connections: Arc<AtomicUsize>,
}
