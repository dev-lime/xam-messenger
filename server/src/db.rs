//! Функции для работы с базой данных

use chrono::Utc;
use rusqlite::{params, Connection};

use crate::models::{ChatMessage, FileData, User};

/// Получение или создание пользователя
pub fn get_or_create_user(
    conn: &Connection,
    name: &str,
    avatar: &str,
) -> Result<User, rusqlite::Error> {
    // Пробуем найти существующего пользователя
    if let Ok(user) = conn.query_row(
        "SELECT id, name, avatar FROM users WHERE name = ?1",
        params![name],
        |row| {
            Ok(User {
                id: row.get(0)?,
                name: row.get(1)?,
                avatar: row.get(2)?,
            })
        },
    ) {
        return Ok(user);
    }

    // Создаём нового пользователя
    let user_id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO users (id, name, avatar) VALUES (?1, ?2, ?3)",
        params![user_id, name, avatar],
    )?;

    Ok(User {
        id: user_id,
        name: name.to_string(),
        avatar: avatar.to_string(),
    })
}

/// Получение всех пользователей
pub fn get_all_users(conn: &Connection) -> Result<Vec<User>, rusqlite::Error> {
    let mut stmt = conn.prepare("SELECT id, name, avatar FROM users ORDER BY name")?;
    let users: Vec<User> = stmt
        .query_map(params![], |row| {
            Ok(User {
                id: row.get(0)?,
                name: row.get(1)?,
                avatar: row.get(2)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(users)
}

/// Получение сообщений с пагинацией
pub fn get_messages_with_pagination(
    conn: &Connection,
    limit: usize,
    before_id: Option<&str>,
) -> Result<(Vec<ChatMessage>, Option<String>, bool), rusqlite::Error> {
    // Загружаем на 1 сообщение больше чтобы проверить есть ли ещё
    let sql = if let Some(last_id) = before_id {
        format!(
            "SELECT id, sender_id, sender_name, text, timestamp, delivery_status, recipient_id, files \
             FROM messages WHERE id < '{}' ORDER BY timestamp DESC LIMIT {}",
            last_id,
            limit + 1
        )
    } else {
        format!(
            "SELECT id, sender_id, sender_name, text, timestamp, delivery_status, recipient_id, files \
             FROM messages ORDER BY timestamp DESC LIMIT {}",
            limit + 1
        )
    };

    let mut stmt = conn.prepare(&sql)?;
    let mut messages: Vec<ChatMessage> = stmt
        .query_map(params![], parse_message_row)?
        .filter_map(|r| r.ok())
        .collect();

    // Проверяем есть ли ещё
    let loaded_count = messages.len();
    let has_more = loaded_count > limit;

    let next_before_id = if has_more {
        messages.pop().map(|m| m.id)
    } else {
        None
    };

    // Разворачиваем чтобы вернуть в правильном порядке (старые → новые)
    messages.reverse();

    Ok((messages, next_before_id, has_more))
}

/// Парсинг строки базы данных в ChatMessage
fn parse_message_row(row: &rusqlite::Row) -> Result<ChatMessage, rusqlite::Error> {
    let files_str: String = row.get(7)?;
    let files: Vec<FileData> = serde_json::from_str(&files_str).unwrap_or_default();

    Ok(ChatMessage {
        id: row.get(0)?,
        sender_id: row.get(1)?,
        sender_name: row.get(2)?,
        text: row.get(3)?,
        timestamp: row.get(4)?,
        delivery_status: row.get(5)?,
        recipient_id: row.get(6)?,
        files,
    })
}

/// Сохранение сообщения в базу данных
pub fn save_message(conn: &Connection, message: &ChatMessage) -> Result<(), rusqlite::Error> {
    let files_json = serde_json::to_string(&message.files).unwrap_or_default();

    conn.execute(
        "INSERT INTO messages (id, sender_id, sender_name, text, timestamp, delivery_status, recipient_id, files) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            message.id,
            message.sender_id,
            message.sender_name,
            message.text,
            message.timestamp,
            message.delivery_status,
            message.recipient_id,
            files_json
        ],
    )?;

    Ok(())
}

/// Обновление статуса доставки сообщения
pub fn update_message_delivery_status(
    conn: &Connection,
    message_id: &str,
    status: u8,
) -> Result<usize, rusqlite::Error> {
    conn.execute(
        "UPDATE messages SET delivery_status = ?1 WHERE id = ?2",
        params![status, message_id],
    )
}

/// Сохранение метаданных файла
pub fn save_file_metadata(
    conn: &Connection,
    id: &str,
    name: &str,
    path: &str,
    size: i64,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO files (id, name, path, size, sender_id, recipient_id, timestamp) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, name, path, size, "", "", Utc::now().timestamp()],
    )?;
    Ok(())
}

/// Получение имени пользователя по ID
pub fn get_user_name(conn: &Connection, user_id: &str) -> Result<String, rusqlite::Error> {
    conn.query_row(
        "SELECT name FROM users WHERE id = ?1",
        params![user_id],
        |row| row.get(0),
    )
}

/// Обновление аватара пользователя
pub fn update_user_avatar(
    conn: &Connection,
    user_id: &str,
    avatar: &str,
) -> Result<usize, rusqlite::Error> {
    conn.execute(
        "UPDATE users SET avatar = ?1 WHERE id = ?2",
        params![avatar, user_id],
    )
}

/// Инициализация схемы базы данных
pub fn init_database(conn: &Connection) -> Result<(), rusqlite::Error> {
    // Включаем WAL mode (может вернуть ошибку если уже включён)
    let _wal_result: Result<String, rusqlite::Error> = conn.query_row("PRAGMA journal_mode = WAL", [], |row| {
        row.get::<_, String>(0)
    });
    
    // Увеличиваем размер кэша
    conn.execute("PRAGMA cache_size = -5000", [])?;
    
    // Включаем foreign keys
    conn.execute("PRAGMA foreign_keys = ON", [])?;

    // Таблица пользователей
    conn.execute(
        "CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            name TEXT UNIQUE NOT NULL,
            avatar TEXT DEFAULT '👤'
        )",
        [],
    )?;

    // Миграция: добавляем колонку avatar если её нет
    conn.execute("ALTER TABLE users ADD COLUMN avatar TEXT DEFAULT '👤'", [])
        .ok();

    // Таблица сообщений
    conn.execute(
        "CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            sender_id TEXT NOT NULL,
            sender_name TEXT NOT NULL,
            text TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            delivery_status INTEGER DEFAULT 0,
            recipient_id TEXT
        )",
        [],
    )?;

    // Миграция: добавляем колонку files
    conn.execute(
        "ALTER TABLE messages ADD COLUMN files TEXT DEFAULT '[]'",
        [],
    )
    .ok();

    // Таблица файлов
    conn.execute(
        "CREATE TABLE IF NOT EXISTS files (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            path TEXT NOT NULL,
            size INTEGER NOT NULL,
            sender_id TEXT,
            recipient_id TEXT,
            timestamp INTEGER NOT NULL
        )",
        [],
    )?;

    // Обновляем существующих пользователей аватаром по умолчанию
    conn.execute(
        "UPDATE users SET avatar = '👤' WHERE avatar IS NULL OR avatar = ''",
        [],
    )?;

    Ok(())
}
