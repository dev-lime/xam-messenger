// Модуль конфигурации для XAM Messenger Server

use std::path::PathBuf;

/// Адрес сервера по умолчанию
pub const DEFAULT_HOST: &str = "0.0.0.0";

/// Порт сервера по умолчанию
pub const DEFAULT_PORT: u16 = 8080;

/// Максимальный размер payload (100 MB)
pub const MAX_PAYLOAD_SIZE: usize = 100 * 1024 * 1024;

/// Размер канала для широковещательных сообщений
pub const BROADCAST_CHANNEL_SIZE: usize = 1000;

/// Лимит сообщений по умолчанию при пагинации
pub const DEFAULT_MESSAGES_LIMIT: usize = 50;

/// Минимальный лимит сообщений
pub const MIN_MESSAGES_LIMIT: usize = 1;

/// Максимальный лимит сообщений
pub const MAX_MESSAGES_LIMIT: usize = 200;

/// Аватар по умолчанию
pub const DEFAULT_AVATAR: &str = "👤";

/// Статусы доставки сообщений
pub mod delivery_status {
    /// Сообщение отправляется
    pub const SENDING: u8 = 0;
    /// Сообщение отправлено
    pub const SENT: u8 = 1;
    /// Сообщение прочитано
    pub const READ: u8 = 2;
}

/// Конфигурация приложения
#[derive(Clone, Debug)]
pub struct AppConfig {
    /// Хост для прослушивания
    pub host: String,
    /// Порт для прослушивания
    pub port: u16,
    /// Путь к базе данных
    pub db_path: PathBuf,
    /// Путь к директории загрузок
    pub upload_dir: PathBuf,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            host: DEFAULT_HOST.to_string(),
            port: DEFAULT_PORT,
            db_path: get_default_db_path(),
            upload_dir: get_default_upload_dir(),
        }
    }
}

impl AppConfig {
    /// Создаёт конфигурацию с заданными параметрами
    pub fn new(host: impl Into<String>, port: u16) -> Self {
        Self {
            host: host.into(),
            port,
            ..Default::default()
        }
    }

    /// Создаёт конфигурацию из переменных окружения
    pub fn from_env() -> Self {
        let host = std::env::var("XAM_HOST").unwrap_or_else(|_| DEFAULT_HOST.to_string());
        let port = std::env::var("XAM_PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(DEFAULT_PORT);

        Self::new(host, port)
    }

    /// Возвращает адрес для привязки сервера
    pub fn bind_address(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }
}

/// Получает путь к директории конфигурации приложения
fn get_config_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("xam-messenger")
}

/// Получает путь к базе данных по умолчанию
pub fn get_default_db_path() -> PathBuf {
    get_config_dir().join("xam.db")
}

/// Получает путь к директории загрузок по умолчанию
pub fn get_default_upload_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("xam-messenger")
        .join("files")
}

/// Инициализирует директорию для базы данных
pub fn init_db_directory(db_path: &PathBuf) -> std::io::Result<()> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    Ok(())
}

/// Инициализирует директорию для загрузок
pub fn init_upload_directory(upload_dir: &PathBuf) -> std::io::Result<()> {
    std::fs::create_dir_all(upload_dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = AppConfig::default();
        assert_eq!(config.host, DEFAULT_HOST);
        assert_eq!(config.port, DEFAULT_PORT);
    }

    #[test]
    fn test_custom_config() {
        let config = AppConfig::new("127.0.0.1", 3000);
        assert_eq!(config.host, "127.0.0.1");
        assert_eq!(config.port, 3000);
    }

    #[test]
    fn test_bind_address() {
        let config = AppConfig::new("0.0.0.0", 8080);
        assert_eq!(config.bind_address(), "0.0.0.0:8080");
    }

    #[test]
    fn test_delivery_status_constants() {
        assert_eq!(delivery_status::SENDING, 0);
        assert_eq!(delivery_status::SENT, 1);
        assert_eq!(delivery_status::READ, 2);
    }

    #[test]
    fn test_limit_constants() {
        assert_eq!(DEFAULT_MESSAGES_LIMIT, 50);
        assert_eq!(MIN_MESSAGES_LIMIT, 1);
        assert_eq!(MAX_MESSAGES_LIMIT, 200);
    }

    #[test]
    fn test_default_avatar() {
        assert_eq!(DEFAULT_AVATAR, "👤");
    }
}
