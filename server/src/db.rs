//! Функции для работы с базой данных
//!
//! ARCH-1: Все функции работают с `&Connection` (из r2d2 pool).
//!         Миграции применяются при инициализации pool.

use chrono::Utc;
use rusqlite::{Connection, OptionalExtension, params};

use crate::models::{ChatMessage, FileData, User};

/// ARCH-1: Текущая версия схемы БД
pub const CURRENT_SCHEMA_VERSION: u32 = 1;

/// ARCH-1: Система миграций с версиями.
/// Каждая миграция — это пара (target_version, sql).
fn get_migrations() -> Vec<(u32, &'static str)> {
    vec![(
        1,
        "
            -- Миграция v1: индексы для производительности (PERF-5)
            CREATE INDEX IF NOT EXISTS idx_messages_timestamp
                ON messages(timestamp DESC, id DESC);
            CREATE INDEX IF NOT EXISTS idx_messages_sender
                ON messages(sender_id);
            CREATE INDEX IF NOT EXISTS idx_messages_recipient
                ON messages(recipient_id);
        ",
    )]
}

/// Применить мигра к подключению
pub fn apply_migrations(conn: &Connection) -> Result<(), rusqlite::Error> {
    // Создаём таблицу версий если нет
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER NOT NULL DEFAULT 0
        )",
        [],
    )?;

    // Получаем текущую версию
    let current_version: u32 = conn
        .query_row("SELECT version FROM schema_version LIMIT 1", [], |row| {
            row.get(0)
        })
        .unwrap_or(0);

    if current_version >= CURRENT_SCHEMA_VERSION {
        return Ok(());
    }

    log::info!(
        "🔄 Миграция БД: v{} → v{}",
        current_version,
        CURRENT_SCHEMA_VERSION
    );

    let migrations = get_migrations();
    for (target_version, sql) in migrations {
        if target_version > current_version {
            log::info!("  Применяем миграцию v{}...", target_version);
            // Выполняем все SQL в миграции (разделены ;)
            for stmt in sql.split(';').map(|s| s.trim()).filter(|s| !s.is_empty()) {
                conn.execute_batch(stmt)?;
            }
        }
    }

    // Обновляем версию
    conn.execute("DELETE FROM schema_version", [])?;
    conn.execute(
        "INSERT INTO schema_version (version) VALUES (?1)",
        params![CURRENT_SCHEMA_VERSION],
    )?;

    log::info!(
        "✅ Миграция завершена, версия схемы: {}",
        CURRENT_SCHEMA_VERSION
    );
    Ok(())
}

/// Получение или создание пользователя
///
/// FIX: Используем INSERT OR IGNORE для атомарной операции,
/// что исключает race condition между SELECT и INSERT.
pub fn get_or_create_user(
    conn: &Connection,
    name: &str,
    avatar: &str,
) -> Result<User, rusqlite::Error> {
    // Атомарная вставка: если имя уже существует — игнорируем конфликт
    let user_id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT OR IGNORE INTO users (id, name, avatar) VALUES (?1, ?2, ?3)",
        params![user_id, name, avatar],
    )?;

    // Всегда делаем SELECT — либо наш только что вставленный, либо существующий
    conn.query_row(
        "SELECT id, name, avatar FROM users WHERE name = ?1",
        params![name],
        |row| {
            Ok(User {
                id: row.get(0)?,
                name: row.get(1)?,
                avatar: row.get(2)?,
            })
        },
    )
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
    let query_limit = limit + 1;

    let sql = if before_id.is_some() {
        "SELECT id, sender_id, sender_name, text, timestamp, delivery_status, recipient_id, files \
         FROM messages \
         WHERE (timestamp, id) < (SELECT timestamp, id FROM messages WHERE id = ?1) \
         ORDER BY timestamp DESC, id DESC \
         LIMIT ?2"
    } else {
        "SELECT id, sender_id, sender_name, text, timestamp, delivery_status, recipient_id, files \
         FROM messages \
         ORDER BY timestamp DESC, id DESC \
         LIMIT ?1"
    };

    let mut stmt = conn.prepare(sql)?;
    let mut messages: Vec<ChatMessage> = if let Some(before_id_val) = before_id {
        stmt.query_map(
            params![before_id_val, query_limit as i64],
            parse_message_row,
        )?
    } else {
        stmt.query_map(params![query_limit as i64], parse_message_row)?
    }
    .filter_map(|r| r.ok())
    .collect();

    let loaded_count = messages.len();
    let has_more = loaded_count > limit;

    let next_before_id = if has_more {
        messages.pop().map(|m| m.id)
    } else {
        None
    };

    messages.reverse();

    Ok((messages, next_before_id, has_more))
}

/// Получение сообщений для конкретного чата с пагинацией
pub fn get_messages_for_chat(
    conn: &Connection,
    limit: usize,
    before_id: Option<&str>,
    chat_peer_id: &str,
) -> Result<(Vec<ChatMessage>, Option<String>, bool), rusqlite::Error> {
    let query_limit = limit + 1;

    let sql = if before_id.is_some() {
        "SELECT id, sender_id, sender_name, text, timestamp, delivery_status, recipient_id, files \
         FROM messages \
         WHERE (
             (sender_id = ?1 OR recipient_id = ?1)
             OR (recipient_id IS NULL OR recipient_id = '')
         )
         AND (timestamp, id) < (SELECT timestamp, id FROM messages WHERE id = ?2) \
         ORDER BY timestamp DESC, id DESC \
         LIMIT ?3"
    } else {
        "SELECT id, sender_id, sender_name, text, timestamp, delivery_status, recipient_id, files \
         FROM messages \
         WHERE (
             (sender_id = ?1 OR recipient_id = ?1)
             OR (recipient_id IS NULL OR recipient_id = '')
         )
         ORDER BY timestamp DESC, id DESC \
         LIMIT ?2"
    };

    let mut stmt = conn.prepare(sql)?;
    let mut messages: Vec<ChatMessage> = if let Some(before_id_val) = before_id {
        stmt.query_map(
            params![chat_peer_id, before_id_val, query_limit as i64],
            parse_message_row,
        )?
    } else {
        stmt.query_map(params![chat_peer_id, query_limit as i64], parse_message_row)?
    }
    .filter_map(|r| r.ok())
    .collect();

    let loaded_count = messages.len();
    let has_more = loaded_count > limit;

    let next_before_id = if has_more {
        messages.pop().map(|m| m.id)
    } else {
        None
    };

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

/// Получение пути к файлу по ID
pub fn get_file_path(conn: &Connection, file_id: &str) -> Result<Option<String>, rusqlite::Error> {
    conn.query_row(
        "SELECT path FROM files WHERE id = ?1",
        params![file_id],
        |row| row.get(0),
    )
    .optional()
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

/// Получение sender_id сообщения по ID (для targeted ACK delivery)
pub fn get_message_sender(conn: &Connection, message_id: &str) -> Result<String, rusqlite::Error> {
    conn.query_row(
        "SELECT sender_id FROM messages WHERE id = ?1",
        params![message_id],
        |row| row.get(0),
    )
}

/// Инициализация схемы базы данных
pub fn init_database(conn: &Connection) -> Result<(), rusqlite::Error> {
    // Включаем WAL mode
    conn.execute_batch("PRAGMA journal_mode = WAL")?;

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

    // Таблица сообщений
    conn.execute(
        "CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            sender_id TEXT NOT NULL,
            sender_name TEXT NOT NULL,
            text TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            delivery_status INTEGER DEFAULT 0,
            recipient_id TEXT,
            files TEXT DEFAULT '[]'
        )",
        [],
    )?;

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

    // ARCH-1: Применяем миграции (индексы и будущие изменения схемы)
    apply_migrations(conn)?;

    Ok(())
}
