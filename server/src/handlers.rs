//! Обработчики HTTP запросов для XAM Messenger Server

use actix_multipart::Multipart;
use actix_web::{HttpResponse, web};
use futures_util::TryStreamExt;
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::db;
use crate::models::AppState;

/// Максимальная длина имени пользователя
const MAX_NAME_LENGTH: usize = 50;

/// Максимальная длина имени файла
const MAX_FILENAME_LENGTH: usize = 255;

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

/// Санитизация имени файла: удаление опасных символов
fn sanitize_filename(filename: &str) -> String {
    filename
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '.' || *c == '_' || *c == '-' || *c == ' ')
        .take(MAX_FILENAME_LENGTH)
        .collect::<String>()
        .trim()
        .to_string()
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

/// Регистрация нового пользователя
pub async fn register(data: web::Data<AppState>, body: web::Json<RegisterRequest>) -> HttpResponse {
    let name = body.name.trim();
    if name.is_empty() {
        return HttpResponse::BadRequest().json(json!({"success": false, "error": "Empty name"}));
    }
    if name.len() > MAX_NAME_LENGTH {
        return HttpResponse::BadRequest().json(json!({
            "success": false,
            "error": format!("Name too long (max {} characters)", MAX_NAME_LENGTH)
        }));
    }

    let db = data.db.lock().await;
    match db::get_or_create_user(&db, name, &body.avatar) {
        Ok(user) => HttpResponse::Ok().json(json!({"success": true, "data": user})),
        Err(e) => HttpResponse::InternalServerError()
            .json(json!({"success": false, "error": e.to_string()})),
    }
}

/// Получение списка всех пользователей
pub async fn get_users(data: web::Data<AppState>) -> HttpResponse {
    let db = data.db.lock().await;
    match db::get_all_users(&db) {
        Ok(users) => HttpResponse::Ok().json(json!({"success": true, "data": users})),
        Err(e) => HttpResponse::InternalServerError()
            .json(json!({"success": false, "error": e.to_string()})),
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
    /// ID пользователя для фильтрации сообщений конкретного чата
    /// Если не указан, возвращаются все сообщения (общие)
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
    let limit = query.limit.max(1).min(200);

    let db = data.db.lock().await;
    // Если указан chat_peer_id, используем фильтрацию по чату
    let (messages, next_before_id, has_more) = if let Some(chat_peer_id) = &query.chat_peer_id {
        match db::get_messages_for_chat(&db, limit, query.before_id.as_deref(), chat_peer_id) {
            Ok(result) => result,
            Err(e) => {
                return HttpResponse::InternalServerError()
                    .json(json!({"success": false, "error": e.to_string()}));
            }
        }
    } else {
        // Старое поведение: все сообщения без фильтрации
        match db::get_messages_with_pagination(&db, limit, query.before_id.as_deref()) {
            Ok(result) => result,
            Err(e) => {
                return HttpResponse::InternalServerError()
                    .json(json!({"success": false, "error": e.to_string()}));
            }
        }
    };

    HttpResponse::Ok().json(json!({
        "success": true,
        "data": messages,
        "before_id": query.before_id,
        "next_before_id": next_before_id,
        "has_more": has_more
    }))
}

/// Загрузка файла на сервер с проверкой размера и санитизацией имени
pub async fn upload_file(data: web::Data<AppState>, mut payload: Multipart) -> HttpResponse {
    let upload_dir = &data.upload_dir;
    let max_file_size = data.max_file_size;

    if let Err(e) = std::fs::create_dir_all(upload_dir) {
        return HttpResponse::InternalServerError().json(json!({
            "success": false,
            "error": format!("Failed to create upload dir: {}", e)
        }));
    }

    // Получаем первое поле (файл)
    match payload.try_next().await {
        Ok(Some(mut field)) => {
            let raw_filename = field
                .content_disposition()
                .as_ref()
                .and_then(|cd| cd.get_filename())
                .unwrap_or("unnamed")
                .to_string();

            // Санитизация имени файла (#10)
            let safe_filename = sanitize_filename(&raw_filename);
            if safe_filename.is_empty() {
                return HttpResponse::BadRequest().json(json!({
                    "success": false,
                    "error": "Invalid filename"
                }));
            }

            let file_id = Uuid::new_v4().to_string();
            let filepath = upload_dir.join(format!("{}_{}", file_id, safe_filename));

            let mut size = 0u64;
            let mut file_bytes = Vec::new();

            // Чтение чанков с проверкой лимита размера (#2)
            while let Some(chunk) = field.try_next().await.ok().flatten() {
                size += chunk.len() as u64;
                if size > max_file_size as u64 {
                    return HttpResponse::PayloadTooLarge().json(json!({
                        "success": false,
                        "error": format!("File too large (max {} MB)", max_file_size / 1024 / 1024)
                    }));
                }
                file_bytes.extend_from_slice(&chunk);
            }

            // Сначала сохраняем файл, потом записываем метаданные в БД (#14)
            if let Err(e) = std::fs::write(&filepath, &file_bytes) {
                return HttpResponse::InternalServerError().json(json!({
                    "success": false,
                    "error": format!("Failed to save file: {}", e)
                }));
            }

            // Если запись в БД не удалась — удаляем файл (rollback)
            {
                let db = data.db.lock().await;
                if let Err(e) = db::save_file_metadata(
                    &db,
                    &file_id,
                    &safe_filename,
                    filepath.to_string_lossy().as_ref(),
                    size as i64,
                ) {
                    let _ = std::fs::remove_file(&filepath);
                    return HttpResponse::InternalServerError().json(json!({
                        "success": false,
                        "error": format!("Failed to save file metadata: {}", e)
                    }));
                }
            }

            // Возвращаем только ID файла, а не полный путь
            HttpResponse::Ok().json(json!({
                "success": true,
                "data": {
                    "id": file_id,
                    "name": safe_filename,
                    "size": size,
                    "path": file_id
                }
            }))
        }
        Ok(None) | Err(_) => HttpResponse::BadRequest().json(json!({
            "success": false,
            "error": "No file uploaded"
        })),
    }
}

/// Скачивание файла по ID с защитой от Path Traversal (#1)
pub async fn download_file(
    data: web::Data<AppState>,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> HttpResponse {
    let file_id = match query.get("path") {
        Some(p) => p,
        None => {
            return HttpResponse::BadRequest().json(json!({
                "success": false,
                "error": "Path parameter is required"
            }));
        }
    };

    // Ищем файл в базе данных по ID
    let db = data.db.lock().await;
    let filepath = match db::get_file_path(&db, file_id) {
        Ok(Some(path)) => path,
        Ok(None) => {
            return HttpResponse::NotFound().json(json!({
                "success": false,
                "error": "File not found"
            }));
        }
        Err(e) => {
            return HttpResponse::InternalServerError()
                .json(json!({"success": false, "error": format!("Database error: {}", e)}));
        }
    };

    let file_path = std::path::Path::new(&filepath);

    // Path Traversal защита: проверяем что файл внутри upload_dir
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
