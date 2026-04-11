// XAM Messenger - Tauri приложение (работает с сервером)

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use mdns_sd::ServiceDaemon;
use flume::RecvTimeoutError;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use futures_util::{SinkExt, StreamExt};
use tokio_util::sync::CancellationToken;
use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
use tauri::{Emitter, Manager};

// FIX L-05: выносим mDNS service type в константу
const MDNS_SERVICE_TYPE: &str = "_xam-messenger._tcp.local.";

/// Информация о найденном сервере
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerInfo {
    pub ip: String,
    pub port: u16,
    pub hostname: Option<String>,
    pub ws_url: String,
    pub http_url: String,
    pub source: String,
    pub txt_records: Option<HashMap<String, String>>,
}

/// Кэшированная запись сервера
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedServer {
    pub ip: String,
    pub port: u16,
    pub last_seen: u64,
    pub source: String,
}

/// Данные о перетаскиваемом файле
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DroppedFile {
    pub path: String,
    pub name: String,
}

/// Тип сообщения для WebSocket
enum WsOutgoing {
    Text(String),
    Binary(Vec<u8>),
}

/// Состояние WebSocket подключения
struct WsState {
    tx: Option<tokio::sync::mpsc::UnboundedSender<WsOutgoing>>,
    /// CancellationToken для graceful shutdown reader/writer задач
    shutdown: Option<CancellationToken>,
}

impl WsState {
    fn new() -> Self {
        Self { tx: None, shutdown: None }
    }
}

// ============================================================================
// mDNS обнаружение серверов
// ============================================================================

/// Поиск серверов через mDNS (асинхронный — не блокирует UI)
#[tauri::command]
async fn search_mdns_servers() -> Result<Vec<ServerInfo>, String> {
    log::info!("🔍 Запуск поиска mDNS серверов...");

    // Запускаем mDNS поиск в отдельном потоке чтобы не блокировать UI
    let servers = tokio::task::spawn_blocking(|| {
        let daemon = ServiceDaemon::new()
            .map_err(|e| format!("Failed to create mDNS daemon: {}", e))?;

        let receiver = daemon
            .browse(MDNS_SERVICE_TYPE)
            .map_err(|e| format!("Failed to browse mDNS: {}", e))?;

        log::info!("✅ mDNS поиск запущен, ждём 3 секунды...");

        let start = std::time::Instant::now();
        let timeout = std::time::Duration::from_secs(3);
        let mut seen_services: HashMap<String, ServerInfo> = HashMap::new();

        // BUG-12 FIX: при таймауте recv_timeout продолжаем цикл,
        // а не прерываем его. Цикл завершится только когда истечёт
        // общий 3-секундный timeout (start.elapsed() < timeout).
        while start.elapsed() < timeout {
            match receiver.recv_timeout(std::time::Duration::from_millis(100)) {
                Ok(event) => {
                    if let mdns_sd::ServiceEvent::ServiceResolved(info) = event {
                        log::info!("✅ Найдено: {}", info.get_fullname());

                        let addresses = info.get_addresses();
                        if addresses.is_empty() {
                            continue;
                        }
                        let ip = addresses.iter().next().unwrap().to_string();
                        let port = info.get_port();
                        let hostname = info.get_hostname().to_string();

                        let mut txt_records: HashMap<String, String> = HashMap::new();
                        for prop in info.get_properties().iter() {
                            let key = prop.key();
                            let val_bytes = prop.val();
                            if let Some(val_bytes) = val_bytes {
                                let val = String::from_utf8_lossy(val_bytes).to_string();
                                txt_records.insert(key.to_string(), val);
                            }
                        }

                        let server_info = ServerInfo {
                            ip: ip.clone(),
                            port,
                            hostname: Some(hostname),
                            ws_url: format!("ws://{}:{}/ws", ip, port),
                            http_url: format!("http://{}:{}/api", ip, port),
                            source: "mdns".to_string(),
                            txt_records: if txt_records.is_empty() { None } else { Some(txt_records) },
                        };

                        seen_services.insert(info.get_fullname().to_string(), server_info);
                    }
                }
                // BUG-12 FIX: Timeout — не ошибка, просто продолжаем ждать
                Err(RecvTimeoutError::Timeout) => continue,
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }

        log::info!("📊 Найдено серверов: {}", seen_services.len());
        let _ = daemon.stop_browse(MDNS_SERVICE_TYPE);
        log::info!("🛑 mDNS поиск остановлен");

        Ok::<Vec<ServerInfo>, String>(seen_services.into_values().collect())
    })
    .await
    .map_err(|e| format!("Task panicked: {}", e))??;

    Ok(servers)
}

/// Получение кэшированных серверов
#[tauri::command]
fn get_cached_servers() -> Result<Vec<CachedServer>, String> {
    // В реальной реализации будет чтение из localStorage через JS
    // Здесь возвращаем пустой список
    Ok(vec![])
}

/// Сохранение сервера в кэш
#[tauri::command]
fn cache_server(ip: String, port: u16, source: String) -> Result<(), String> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("SystemTime error: {}", e))?
        .as_secs();

    let cached = CachedServer {
        ip,
        port,
        last_seen: timestamp,
        source,
    };

    log::info!("📦 Кэширование сервера: {:?}", cached);

    Ok(())
}

// ============================================================================
// Нативный WebSocket (работает без интернета)
// ============================================================================

/// Проверка наличия активного сетевого интерфейса (#28: if-addrs вместо get_if_addrs)
fn has_network_interface() -> bool {
    if let Ok(interfaces) = if_addrs::get_if_addrs() {
        for iface in interfaces {
            if !iface.is_loopback() {
                return true;
            }
        }
    }
    false
}

/// FIX C-06: Проверяем что URL указывает на локальную/приватную сеть
/// Парсим URL через url::Url и проверяем IP через is_private()
fn is_local_url(url: &str) -> bool {
    match url::Url::parse(url) {
        Ok(parsed) => {
            if let Some(host) = parsed.host() {
                match host {
                    url::Host::Domain(_) => {
                        // Доменные имена — разрешаем localhost, запрещаем остальные
                        let h = parsed.host_str().unwrap_or("");
                        h == "localhost" || h == "localhost.local"
                    }
                    url::Host::Ipv4(ip) => ip.is_private() || ip.is_loopback(),
                    url::Host::Ipv6(ip) => ip.is_loopback(),
                }
            } else {
                false
            }
        }
        Err(_) => false, // Невалидный URL — не локальный
    }
}

/// Подключение к серверу через нативный WebSocket
#[tauri::command]
async fn ws_connect(url: String, app: tauri::AppHandle) -> Result<(), String> {
    log::info!("🔌 Подключение к {}", url);

    // Вариант 2: Локальные адреса работают всегда (loopback)
    if !is_local_url(&url) {
        // Вариант 1: Проверяем наличие сети для удалённых адресов
        if !has_network_interface() {
            return Err(
                "Нет активного сетевого подключения.\n\n".to_string() +
                "Включите Wi-Fi или подключите сетевой кабель.\n" +
                "Интернет не нужен — достаточно локальной сети."
            );
        }
    } else {
        log::info!("✅ Локальный адрес — подключаемся напрямую");
    }

    let (ws_stream, _) = connect_async(&url)
        .await
        .map_err(|e| {
            let err_str = e.to_string();
            if err_str.contains("Network is unreachable") || err_str.contains("os error 51") {
                "Сеть недоступна. Проверьте подключение к локальной сети.".to_string()
            } else {
                format!("Failed to connect: {}", err_str)
            }
        })?;

    let (mut write, mut read) = ws_stream.split();
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<WsOutgoing>();

    // Создаём CancellationToken для graceful shutdown
    let shutdown_token = CancellationToken::new();

    {
        let ws_state = app.state::<Mutex<WsState>>();
        let mut state = ws_state.lock()
            .map_err(|e| format!("WsState mutex poisoned: {}", e))?;

        // Отменяем предыдущий токен если был
        if let Some(old_token) = state.shutdown.take() {
            old_token.cancel();
        }
        if let Some(old_tx) = state.tx.take() {
            drop(old_tx);
        }
        state.tx = Some(tx);
        state.shutdown = Some(shutdown_token.clone());
    }

    let reader_token = shutdown_token.clone();
    let writer_token = shutdown_token.clone();

    // Задача для отправки сообщений из JS (текст + бинарные)
    tokio::spawn(async move {
        loop {
            tokio::select! {
                Some(msg) = rx.recv() => {
                    let result = match msg {
                        WsOutgoing::Text(t) => write.send(Message::Text(t)).await,
                        WsOutgoing::Binary(b) => write.send(Message::Binary(b)).await,
                    };
                    if result.is_err() {
                        log::error!("❌ Ошибка отправки WebSocket");
                        break;
                    }
                }
                _ = writer_token.cancelled() => {
                    log::info!("🔌 Writer задача завершена (shutdown)");
                    break;
                }
            }
        }
    });

    // Задача для чтения сообщений от сервера
    let app_clone = app.clone();
    tokio::spawn(async move {
        log::info!("✅ WebSocket подключён");
        app_clone.emit("ws_connected", ()).ok();

        loop {
            tokio::select! {
                Some(msg) = read.next() => {
                    match msg {
                        Ok(Message::Text(text)) => {
                            app_clone.emit("ws_message", text).ok();
                        }
                        Ok(Message::Close(_)) => {
                            log::info!("🔌 WebSocket закрыт сервером");
                            app_clone.emit("ws_disconnected", ()).ok();
                            break;
                        }
                        Ok(Message::Ping(_)) => {
                            // tungstenite автоматически отвечает на ping
                        }
                        Err(e) => {
                            log::error!("❌ Ошибка WebSocket: {}", e);
                            app_clone.emit("ws_error", e.to_string()).ok();
                            break;
                        }
                        _ => {}
                    }
                }
                _ = reader_token.cancelled() => {
                    log::info!("🔌 Reader задача завершена (shutdown)");
                    break;
                }
            }
        }
    });

    Ok(())
}

/// Отправка сообщения через WebSocket
#[tauri::command]
async fn ws_send(message: String, app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<Mutex<WsState>>();
    let tx = state.lock()
        .map_err(|e| format!("WsState mutex poisoned: {}", e))?
        .tx.clone()
        .ok_or("Not connected")?;
    tx.send(WsOutgoing::Text(message)).map_err(|e| e.to_string())
}

/// Отправка бинарных данных через WebSocket (для чанковой передачи файлов)
/// Принимает base64-строку — декодирует и отправляет как binary frame
#[tauri::command]
async fn ws_send_binary(data_b64: String, app: tauri::AppHandle) -> Result<(), String> {
    let data = BASE64.decode(&data_b64)
        .map_err(|e| format!("Invalid base64 data: {}", e))?;

    let state = app.state::<Mutex<WsState>>();
    let tx = state.lock()
        .map_err(|e| format!("WsState mutex poisoned: {}", e))?
        .tx.clone()
        .ok_or("Not connected")?;
    tx.send(WsOutgoing::Binary(data)).map_err(|e| e.to_string())
}

/// Закрытие WebSocket соединения
#[tauri::command]
async fn ws_close(app: tauri::AppHandle) -> Result<(), String> {
    log::info!("🔌 Закрытие WebSocket");
    let state = app.state::<Mutex<WsState>>();
    let mut guard = state.lock()
        .map_err(|e| format!("WsState mutex poisoned: {}", e))?;

    // Отменяем token — reader и writer задачи завершатся мгновенно
    if let Some(token) = guard.shutdown.take() {
        token.cancel();
    }
    guard.tx = None;

    drop(guard);
    app.emit("ws_disconnected", ()).ok();
    Ok(())
}

fn main() {
    // BP-1 FIX: инициализируем log через env_logger
    env_logger::Builder::from_env(
        env_logger::Env::default().default_filter_or("info")
    ).init();

    tauri::Builder::default()
        .manage(Mutex::new(WsState::new()))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            search_mdns_servers,
            get_cached_servers,
            cache_server,
            ws_connect,
            ws_send,
            ws_send_binary,
            ws_close,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
