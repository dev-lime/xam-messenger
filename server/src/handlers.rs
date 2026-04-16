//! Обработчики HTTP запросов для XAM Messenger

use actix_web::{HttpResponse, web};
use chrono::Utc;
use serde::Deserialize;
use serde_json::json;

use crate::db;
use crate::error::AppError;
use crate::models::AppState;

/// Liveness: пул БД отдаёт соединение (без PRAGMA quick_check на каждый запрос)
pub async fn health_check(data: web::Data<AppState>) -> HttpResponse {
    let pool_ok = data.db.get().is_ok();
    let status_code = if pool_ok { 200 } else { 503 };
    HttpResponse::build(actix_web::http::StatusCode::from_u16(status_code).unwrap()).json(json!({
        "status": if pool_ok { "ok" } else { "degraded" },
        "version": "1.0.0",
        "db_pool": pool_ok,
        "timestamp": Utc::now().timestamp()
    }))
}

/// Readiness: PRAGMA quick_check + метрики contention
pub async fn health_ready(data: web::Data<AppState>) -> HttpResponse {
    let db_ok = match data.db.get() {
        Ok(conn) => {
            match conn.query_row("PRAGMA quick_check(1)", [], |row| row.get::<_, String>(0)) {
                Ok(result) => result == "ok",
                Err(e) => {
                    log::error!("Readiness: integrity failed: {}", e);
                    false
                }
            }
        }
        Err(e) => {
            log::error!("Readiness: pool error: {}", e);
            false
        }
    };

    let retry_ok = crate::db::BUSY_RETRY_OK.load(std::sync::atomic::Ordering::Relaxed);
    let retry_timeout = crate::db::BUSY_RETRY_TIMEOUT.load(std::sync::atomic::Ordering::Relaxed);

    let status_code = if db_ok { 200 } else { 503 };

    HttpResponse::build(actix_web::http::StatusCode::from_u16(status_code).unwrap()).json(json!({
        "status": if db_ok { "ok" } else { "degraded" },
        "version": "1.0.0",
        "db_available": db_ok,
        "contention": {
            "busy_retry_ok": retry_ok,
            "busy_retry_timeout": retry_timeout
        },
        "timestamp": Utc::now().timestamp()
    }))
}


/// Запрос регистрации пользователя
#[derive(Deserialize)]
pub struct RegisterRequest {
    pub name: String,
    #[serde(default = "default_avatar")]
    pub avatar: String,
}

fn default_avatar() -> String {
    "👤".to_string()
}

/// Проверить: это ошибка SQLITE_BUSY?
fn is_busy_error(e: &AppError) -> bool {
    let msg = e.to_string().to_lowercase();
    msg.contains("busy") || msg.contains("locked")
}

/// Регистрация нового пользователя
pub async fn register(data: web::Data<AppState>, body: web::Json<RegisterRequest>) -> HttpResponse {
    let max_name = std::env::var("MAX_NAME_LENGTH")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(50);

    let name = body.name.trim();
    if name.is_empty() {
        return HttpResponse::BadRequest().json(json!({"success": false, "error": "Empty name"}));
    }
    if name.len() > max_name {
        return HttpResponse::BadRequest().json(json!({
            "success": false,
            "error": format!("Name too long (max {} characters)", max_name)
        }));
    }

    // PERF-1: Получаем соединение из pool (без async mutex)
    let conn = match data.db.get() {
        Ok(c) => c,
        Err(e) => {
            return AppError::database(format!("Не удалось получить соединение с БД: {}", e))
                .to_response();
        }
    };

    match db::get_or_create_user(&conn, name, &body.avatar) {
        Ok(user) => HttpResponse::Ok().json(json!({"success": true, "data": user})),
        Err(e) => {
            let err = AppError::database(e.to_string());
            // SQLITE_BUSY → 503 с Retry-After
            if is_busy_error(&err) {
                log::warn!("⚠️ Регистрация: SQLITE_BUSY → 503");
                return HttpResponse::ServiceUnavailable()
                    .insert_header(("Retry-After", "2"))
                    .json(json!({"success": false, "error": "Server busy, please retry"}));
            }
            err.to_response()
        }
    }
}

/// Получение списка всех пользователей
pub async fn get_users(data: web::Data<AppState>) -> HttpResponse {
    let conn = match data.db.get() {
        Ok(c) => c,
        Err(e) => {
            return AppError::database(format!("Не удалось получить соединение с БД: {}", e))
                .to_response();
        }
    };

    match db::get_all_users(&conn) {
        Ok(users) => HttpResponse::Ok().json(json!({"success": true, "data": users})),
        Err(e) => AppError::database(e.to_string()).to_response(),
    }
}

/// Получение списка пользователей онлайн
pub async fn get_online_users(data: web::Data<AppState>) -> HttpResponse {
    let online = data.online_users.lock().await;
    let online_list: Vec<String> = online.keys().cloned().collect();
    HttpResponse::Ok().json(json!({"success": true, "data": online_list}))
}

/// Параметры запроса сообщений
#[derive(Deserialize)]
pub struct MessagesQuery {
    #[serde(default = "default_limit")]
    pub limit: usize,
    pub before_id: Option<String>,
    pub chat_peer_id: Option<String>,
}

fn default_limit() -> usize {
    50
}

/// Получение истории сообщений с пагинацией
pub async fn get_messages(
    data: web::Data<AppState>,
    query: web::Query<MessagesQuery>,
) -> HttpResponse {
    // Без аутентификации HTTP нельзя безопасно отдавать приватную историю по chat_peer_id (IDOR).
    if query.chat_peer_id.is_some() {
        log::warn!("Отклонён GET /messages с chat_peer_id (используйте WebSocket после register)");
        return HttpResponse::Forbidden().json(json!({
            "success": false,
            "error": "Private chat history is not available over HTTP; use WebSocket after register"
        }));
    }

    let limit = query.limit.clamp(1, 200);

    let conn = match data.db.get() {
        Ok(c) => c,
        Err(e) => {
            return AppError::database(format!("Не удалось получить соединение с БД: {}", e))
                .to_response();
        }
    };

    let (messages, next_before_id, has_more) =
        match db::get_messages_with_pagination(&conn, limit, query.before_id.as_deref()) {
            Ok(result) => result,
            Err(e) => return AppError::database(e.to_string()).to_response(),
        };

    HttpResponse::Ok().json(json!({
        "success": true,
        "data": messages,
        "before_id": query.before_id,
        "next_before_id": next_before_id,
        "has_more": has_more
    }))
}

/// Проверка: находится ли путь внутри разрешённой директории
fn is_path_safe(base_dir: &std::path::Path, file_path: &std::path::Path) -> bool {
    if let (Ok(canonical_base), Ok(canonical_file)) =
        (base_dir.canonicalize(), file_path.canonicalize())
    {
        canonical_file.starts_with(&canonical_base)
    } else {
        false
    }
}

/// Скачивание файла по ID с защитой от Path Traversal
pub async fn download_file(
    data: web::Data<AppState>,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> HttpResponse {
    let file_id = match query.get("file_id") {
        Some(p) => p,
        None => {
            return HttpResponse::BadRequest().json(json!({
                "success": false,
                "error": "file_id parameter is required"
            }));
        }
    };

    let conn = match data.db.get() {
        Ok(c) => c,
        Err(e) => {
            return AppError::database(format!("Не удалось получить соединение с БД: {}", e))
                .to_response();
        }
    };

    let filepath = match db::get_file_path(&conn, file_id) {
        Ok(Some(path)) => path,
        Ok(None) => {
            return HttpResponse::NotFound().json(json!({
                "success": false,
                "error": "File not found"
            }));
        }
        Err(e) => return AppError::database(e.to_string()).to_response(),
    };

    let file_path = std::path::Path::new(&filepath);

    if !is_path_safe(&data.upload_dir, file_path) {
        log::warn!("⚠️ Попытка Path Traversal: {:?}", filepath);
        return HttpResponse::Forbidden().json(json!({
            "success": false,
            "error": "Access denied"
        }));
    }

    if !file_path.exists() {
        return HttpResponse::NotFound().json(json!({
            "success": false,
            "error": "File not found on disk"
        }));
    }

    let filename = file_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("download");

    match std::fs::read(file_path) {
        Ok(contents) => HttpResponse::Ok()
            .content_type("application/octet-stream")
            .insert_header((
                "Content-Disposition",
                format!("attachment; filename=\"{}\"", filename),
            ))
            .body(contents),
        Err(e) => HttpResponse::InternalServerError().json(json!({
            "success": false,
            "error": format!("Failed to read file: {}", e)
        })),
    }
}
