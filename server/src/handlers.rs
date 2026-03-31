//! Обработчики HTTP запросов для XAM Messenger Server

use actix_multipart::Multipart;
use actix_web::{web, HttpResponse};
use futures_util::TryStreamExt;
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::db;
use crate::models::AppState;

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

/// Регистрация нового пользователя
pub async fn register(data: web::Data<AppState>, body: web::Json<RegisterRequest>) -> HttpResponse {
    let db = match data.db.lock() {
        Ok(conn) => conn,
        Err(e) => {
            return HttpResponse::InternalServerError()
                .json(json!({"success": false, "error": format!("Database lock error: {}", e)}))
        }
    };

    let name = body.name.trim();
    if name.is_empty() {
        return HttpResponse::BadRequest().json(json!({"success": false, "error": "Empty name"}));
    }

    match db::get_or_create_user(&db, name, &body.avatar) {
        Ok(user) => HttpResponse::Ok().json(json!({"success": true, "data": user})),
        Err(e) => HttpResponse::InternalServerError()
            .json(json!({"success": false, "error": e.to_string()})),
    }
}

/// Получение списка всех пользователей
pub async fn get_users(data: web::Data<AppState>) -> HttpResponse {
    let db = match data.db.lock() {
        Ok(conn) => conn,
        Err(e) => {
            return HttpResponse::InternalServerError()
                .json(json!({"success": false, "error": format!("Database lock error: {}", e)}))
        }
    };

    match db::get_all_users(&db) {
        Ok(users) => HttpResponse::Ok().json(json!({"success": true, "data": users})),
        Err(e) => HttpResponse::InternalServerError()
            .json(json!({"success": false, "error": e.to_string()})),
    }
}

/// Получение списка пользователей онлайн
pub async fn get_online_users(data: web::Data<AppState>) -> HttpResponse {
    let online = data.online_users.lock().unwrap();
    let online_list: Vec<String> = online.keys().cloned().collect();
    HttpResponse::Ok().json(json!({"success": true, "data": online_list}))
}

/// Параметры запроса сообщений
#[derive(Deserialize)]
pub struct MessagesQuery {
    #[serde(default = "default_limit")]
    pub limit: usize,
    pub before_id: Option<String>,
}

fn default_limit() -> usize {
    50
}

/// Получение истории сообщений с пагинацией
pub async fn get_messages(
    data: web::Data<AppState>,
    query: web::Query<MessagesQuery>,
) -> HttpResponse {
    let db = match data.db.lock() {
        Ok(conn) => conn,
        Err(e) => {
            return HttpResponse::InternalServerError()
                .json(json!({"success": false, "error": format!("Database lock error: {}", e)}))
        }
    };

    let limit = query.limit.max(1).min(200);

    match db::get_messages_with_pagination(&db, limit, query.before_id.as_deref()) {
        Ok((messages, next_before_id, has_more)) => HttpResponse::Ok().json(json!({
            "success": true,
            "data": messages,
            "before_id": query.before_id,
            "next_before_id": next_before_id,
            "has_more": has_more
        })),
        Err(e) => HttpResponse::InternalServerError()
            .json(json!({"success": false, "error": e.to_string()})),
    }
}

/// Загрузка файла на сервер
pub async fn upload_file(data: web::Data<AppState>, mut payload: Multipart) -> HttpResponse {
    let upload_dir = match dirs::data_local_dir() {
        Some(dir) => dir.join("xam-messenger").join("files"),
        None => ".".into(),
    };

    if let Err(e) = std::fs::create_dir_all(&upload_dir) {
        return HttpResponse::InternalServerError().json(json!({
            "success": false,
            "error": format!("Failed to create upload dir: {}", e)
        }));
    }

    // Получаем первое поле (файл)
    match payload.try_next().await {
        Ok(Some(mut field)) => {
            let filename = field
                .content_disposition()
                .as_ref()
                .and_then(|cd| cd.get_filename())
                .unwrap_or("unnamed")
                .to_string();

            let file_id = Uuid::new_v4().to_string();
            let filepath = upload_dir.join(format!("{}_{}", file_id, filename));

            let mut size = 0u64;
            let mut file_bytes = Vec::new();

            while let Some(chunk) = field.try_next().await.ok().flatten() {
                size += chunk.len() as u64;
                file_bytes.extend_from_slice(&chunk);
            }

            if let Err(e) = std::fs::write(&filepath, &file_bytes) {
                return HttpResponse::InternalServerError().json(json!({
                    "success": false,
                    "error": format!("Failed to save file: {}", e)
                }));
            }

            let db = data.db.lock().unwrap_or_else(|e| e.into_inner());

            if let Err(e) = db::save_file_metadata(
                &db,
                &file_id,
                &filename,
                filepath.to_string_lossy().as_ref(),
                size as i64,
            ) {
                return HttpResponse::InternalServerError().json(json!({
                    "success": false,
                    "error": format!("Failed to save file metadata: {}", e)
                }));
            }

            // Возвращаем только ID файла, а не полный путь
            HttpResponse::Ok().json(json!({
                "success": true,
                "data": {
                    "id": file_id,
                    "name": filename,
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

/// Скачивание файла по ID
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
            }))
        }
    };

    // Ищем файл в базе данных по ID
    let db = match data.db.lock() {
        Ok(conn) => conn,
        Err(e) => {
            return HttpResponse::InternalServerError()
                .json(json!({"success": false, "error": format!("Database error: {}", e)}))
        }
    };

    let filepath = match db::get_file_path(&db, file_id) {
        Ok(Some(path)) => path,
        Ok(None) => {
            return HttpResponse::NotFound().json(json!({
                "success": false,
                "error": "File not found"
            }))
        }
        Err(e) => {
            return HttpResponse::InternalServerError()
                .json(json!({"success": false, "error": format!("Database error: {}", e)}))
        }
    };

    if !std::path::Path::new(&filepath).exists() {
        return HttpResponse::NotFound().json(json!({
            "success": false,
            "error": "File not found on disk"
        }));
    }

    let filename = std::path::Path::new(&filepath)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("download");

    match std::fs::read(&filepath) {
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
