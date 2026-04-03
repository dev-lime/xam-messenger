// XAM Messenger - Tauri приложение (работает с сервером)

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use mdns_sd::ServiceDaemon;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

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

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            search_mdns_servers,
            get_cached_servers,
            cache_server
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
