// XAM Messenger - Tauri приложение (работает с сервером)

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use mdns_sd::ServiceDaemon;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use futures_util::{SinkExt, StreamExt};
use tauri::{Emitter, Manager};

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

/// Состояние WebSocket подключения
struct WsState {
    tx: Option<tokio::sync::mpsc::UnboundedSender<String>>,
}

impl WsState {
    fn new() -> Self {
        Self { tx: None }
    }
}

/// Поиск серверов через mDNS (асинхронный — не блокирует UI)
#[tauri::command]
async fn search_mdns_servers() -> Result<Vec<ServerInfo>, String> {
    println!("🔍 Запуск поиска mDNS серверов...");

    // Запускаем mDNS поиск в отдельном потоке чтобы не блокировать UI
    let servers = tokio::task::spawn_blocking(|| {
        let daemon = ServiceDaemon::new()
            .map_err(|e| format!("Failed to create mDNS daemon: {}", e))?;

        let receiver = daemon
            .browse("_xam-messenger._tcp.local.")
            .map_err(|e| format!("Failed to browse mDNS: {}", e))?;

        println!("✅ mDNS поиск запущен, ждём 3 секунды...");

        let start = std::time::Instant::now();
        let timeout = std::time::Duration::from_secs(3);
        let mut seen_services: HashMap<String, ServerInfo> = HashMap::new();

        // Читаем события из receiver с таймаутом
        while start.elapsed() < timeout {
            match receiver.recv_timeout(std::time::Duration::from_millis(100)) {
                Ok(event) => {
                    if let mdns_sd::ServiceEvent::ServiceResolved(info) = event {
                        println!("✅ Найдено: {}", info.get_fullname());

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
                Err(_) => break,
            }
        }

        println!("📊 Найдено серверов: {}", seen_services.len());
        let _ = daemon.stop_browse("_xam-messenger._tcp.local.");
        println!("🛑 mDNS поиск остановлен");

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
        .unwrap()
        .as_secs();

    let cached = CachedServer {
        ip,
        port,
        last_seen: timestamp,
        source,
    };

    // В реальной реализации будет запись в localStorage через JS
    // Здесь просто логируем
    println!("📦 Кэширование сервера: {:?}", cached);

    Ok(())
}

// ============================================================================
// Нативный WebSocket (работает без интернета)
// ============================================================================

/// Проверка наличия активного сетевого интерфейса
fn has_network_interface() -> bool {
    if let Ok(interfaces) = get_if_addrs::get_if_addrs() {
        for iface in interfaces {
            // Проверяем не-loopback интерфейсы (Wi-Fi, Ethernet)
            if !iface.is_loopback() {
                return true;
            }
        }
    }
    false
}

/// Проверка: является ли URL локальным (loopback)
fn is_local_url(url: &str) -> bool {
    url.contains("127.0.0.1") || url.contains("localhost") || url.contains("::1")
}

/// Подключение к серверу через нативный WebSocket
#[tauri::command]
async fn ws_connect(url: String, app: tauri::AppHandle) -> Result<(), String> {
    println!("🔌 Подключение к {}", url);

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
        println!("✅ Локальный адрес — подключаемся напрямую");
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
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();

    // Сохраняем канал для отправки
    app.state::<Mutex<WsState>>().lock().unwrap().tx = Some(tx);

    // Задача для отправки сообщений из JS
    tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if write.send(Message::Text(msg)).await.is_err() {
                println!("❌ Ошибка отправки WebSocket");
                break;
            }
        }
    });

    // Задача для чтения сообщений от сервера
    let app_clone = app.clone();
    tokio::spawn(async move {
        println!("✅ WebSocket подключён");
        app_clone.emit("ws_connected", ()).ok();

        while let Some(msg) = read.next().await {
            match msg {
                Ok(Message::Text(text)) => {
                    app_clone.emit("ws_message", text).ok();
                }
                Ok(Message::Close(_)) => {
                    println!("🔌 WebSocket закрыт сервером");
                    app_clone.emit("ws_disconnected", ()).ok();
                    break;
                }
                Ok(Message::Ping(_)) => {
                    // tungstenite автоматически отвечает на ping
                }
                Err(e) => {
                    println!("❌ Ошибка WebSocket: {}", e);
                    app_clone.emit("ws_error", e.to_string()).ok();
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(())
}

/// Отправка сообщения через WebSocket
#[tauri::command]
async fn ws_send(message: String, app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<Mutex<WsState>>();
    let tx = state.lock().unwrap().tx.clone()
        .ok_or("Not connected")?;
    tx.send(message).map_err(|e| e.to_string())
}

/// Закрытие WebSocket соединения
#[tauri::command]
async fn ws_close(app: tauri::AppHandle) -> Result<(), String> {
    println!("🔌 Закрытие WebSocket");
    let state = app.state::<Mutex<WsState>>();
    state.lock().unwrap().tx = None;
    app.emit("ws_disconnected", ()).ok();
    Ok(())
}

fn main() {
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
            ws_close,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
