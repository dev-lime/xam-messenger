// Модуль обработки ошибок для XAM Messenger Server

use actix_web::{HttpResponse, http::StatusCode};
use serde_json::json;

/// Типы ошибок приложения
///
/// NOTE: Некоторые варианты пока не используются в обработчиках,
/// но оставлены для будущего расширения API.
#[allow(dead_code)]
#[derive(Debug)]
pub enum AppError {
    /// Ошибка базы данных
    Database(String),
    /// Ошибка валидации входных данных
    Validation(String),
    /// Ошибка файла (не найден, не читается и т.д.)
    File(String),
    /// Ошибка WebSocket соединения
    WebSocket(String),
    /// Внутренняя ошибка сервера
    Internal(String),
    /// Пользователь не найден
    UserNotFound(String),
    /// Сообщение не найдено
    MessageNotFound(String),
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AppError::Database(msg) => write!(f, "Ошибка БД: {}", msg),
            AppError::Validation(msg) => write!(f, "Ошибка валидации: {}", msg),
            AppError::File(msg) => write!(f, "Ошибка файла: {}", msg),
            AppError::WebSocket(msg) => write!(f, "Ошибка WebSocket: {}", msg),
            AppError::Internal(msg) => write!(f, "Внутренняя ошибка: {}", msg),
            AppError::UserNotFound(id) => write!(f, "Пользователь не найден: {}", id),
            AppError::MessageNotFound(id) => write!(f, "Сообщение не найдено: {}", id),
        }
    }
}

impl std::error::Error for AppError {}

impl From<rusqlite::Error> for AppError {
    fn from(err: rusqlite::Error) -> Self {
        AppError::Database(err.to_string())
    }
}

impl From<actix_web::Error> for AppError {
    fn from(err: actix_web::Error) -> Self {
        AppError::WebSocket(err.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(err: serde_json::Error) -> Self {
        AppError::Internal(format!("Ошибка сериализации JSON: {}", err))
    }
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        AppError::Internal(format!("Ошибка ввода-вывода: {}", err))
    }
}

/// NOTE: Некоторые методы пока не используются в обработчиках,
/// но оставлены для будущего расширения API.
#[allow(dead_code)]
impl AppError {
    /// Создаёт ошибку валидации
    pub fn validation(msg: impl Into<String>) -> Self {
        AppError::Validation(msg.into())
    }

    /// Создаёт ошибку базы данных
    pub fn database(msg: impl Into<String>) -> Self {
        AppError::Database(msg.into())
    }

    /// Создаёт ошибку файла
    pub fn file(msg: impl Into<String>) -> Self {
        AppError::File(msg.into())
    }

    /// Создаёт внутреннюю ошибку
    pub fn internal(msg: impl Into<String>) -> Self {
        AppError::Internal(msg.into())
    }

    /// Конвертирует ошибку в HTTP ответ
    pub fn to_response(&self) -> HttpResponse {
        let (status, error_msg) = match self {
            AppError::Validation(msg) => (StatusCode::BAD_REQUEST, msg.clone()),
            AppError::UserNotFound(_) => (StatusCode::NOT_FOUND, self.to_string()),
            AppError::MessageNotFound(_) => (StatusCode::NOT_FOUND, self.to_string()),
            AppError::File(msg) => (StatusCode::NOT_FOUND, msg.clone()),
            AppError::Database(msg) => (StatusCode::INTERNAL_SERVER_ERROR, msg.clone()),
            AppError::WebSocket(msg) => (StatusCode::INTERNAL_SERVER_ERROR, msg.clone()),
            AppError::Internal(msg) => (StatusCode::INTERNAL_SERVER_ERROR, msg.clone()),
        };

        HttpResponse::build(status).json(json!({
            "success": false,
            "error": error_msg
        }))
    }

    /// Создаёт результат с ошибкой
    pub fn err<T>(self) -> Result<T, Self> {
        Err(self)
    }
}

/// Тип результата для операций приложения
/// NOTE: Оставлен для будущего расширения API.
#[allow(dead_code)]
pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_display() {
        let err = AppError::validation("Empty name");
        assert_eq!(format!("{}", err), "Ошибка валидации: Empty name");

        let err = AppError::database("Connection failed");
        assert!(format!("{}", err).contains("Ошибка БД"));
    }

    #[test]
    fn test_error_from_rusqlite() {
        let sql_err = rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(1),
            Some("test error".to_string()),
        );
        let app_err: AppError = sql_err.into();
        assert!(matches!(app_err, AppError::Database(_)));
    }

    #[test]
    fn test_error_to_response() {
        let err = AppError::validation("Invalid input");
        let response = err.to_response();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn test_app_result() {
        let result: AppResult<()> = Ok(());
        assert!(result.is_ok());

        let result: AppResult<()> = AppError::internal("test").err();
        assert!(result.is_err());
    }
}
