use crate::types::ChatMessage;
use crate::history::HistoryManager;
use crate::state::NetworkEvent;
use anyhow::{Result, Context};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::mpsc::Sender;
use std::sync::{Arc, atomic::{AtomicBool, Ordering}};
use std::thread;
use std::time::Duration;
use std::collections::HashMap;
use std::sync::Mutex;

pub struct NetworkManager {
    port: String,
    event_tx: Sender<NetworkEvent>,
    history_mgr: HistoryManager,
    running: Arc<AtomicBool>,
    listener: Option<TcpListener>,
    // Подключения к другим пирам
    peer_connections: Arc<Mutex<HashMap<String, TcpStream>>>,
}

impl NetworkManager {
    pub fn new(
        port: String,
        event_tx: Sender<NetworkEvent>,
        history_mgr: HistoryManager,
    ) -> Result<Self> {
        let listener = TcpListener::bind(format!("0.0.0.0:{}", port))
            .with_context(|| format!("Failed to bind to port {}", port))?;

        let running = Arc::new(AtomicBool::new(true));
        let running_clone = running.clone();
        let event_tx_clone = event_tx.clone();
        let history_mgr_clone = history_mgr.clone();
        let peer_connections = Arc::new(Mutex::new(HashMap::new()));

        // Запускаем сервер входящих подключений
        let peer_conn_clone = peer_connections.clone();
        thread::spawn(move || {
            Self::run_server(listener, event_tx_clone, history_mgr_clone, running_clone, peer_conn_clone);
        });

        Ok(Self {
            port,
            event_tx,
            history_mgr,
            running,
            listener: None,
            peer_connections,
        })
    }

    fn run_server(
        listener: TcpListener,
        event_tx: Sender<NetworkEvent>,
        history_mgr: HistoryManager,
        running: Arc<AtomicBool>,
        peer_connections: Arc<Mutex<HashMap<String, TcpStream>>>,
    ) {
        listener.set_nonblocking(true).ok();
        eprintln!("🟢 Сервер запущен на порту {}", listener.local_addr().map(|a| a.port()).unwrap_or(0));

        while running.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((stream, addr)) => {
                    eprintln!("📥 Новое подключение от: {}", addr);
                    let event_tx = event_tx.clone();
                    let history_mgr = history_mgr.clone();
                    let peer_conn = peer_connections.clone();

                    thread::spawn(move || {
                        Self::handle_connection(stream, addr.to_string(), event_tx, history_mgr, peer_conn);
                    });
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(100));
                }
                Err(_) => {
                    thread::sleep(Duration::from_millis(100));
                }
            }
        }
        eprintln!("🔴 Сервер остановлен");
    }

    fn handle_connection(
        mut stream: TcpStream,
        peer_address: String,
        event_tx: Sender<NetworkEvent>,
        history_mgr: HistoryManager,
        _peer_connections: Arc<Mutex<HashMap<String, TcpStream>>>,
    ) {
        eprintln!("📥 Обработка подключения от {}", peer_address);
        
        // Устанавливаем таймаут для чтения
        stream.set_read_timeout(Some(Duration::from_secs(60))).ok();
        
        let mut buffer = [0u8; 4096];

        loop {
            match stream.read(&mut buffer) {
                Ok(0) => {
                    eprintln!("⚠️ Соединение закрыто {}", peer_address);
                    break;
                }
                Ok(n) => {
                    let msg_data = String::from_utf8_lossy(&buffer[..n]).trim().to_string();
                    eprintln!("📩 Получено от {}: {}", peer_address, msg_data);

                    // Проверяем тип сообщения
                    if msg_data.starts_with("ACK|") {
                        eprintln!("📨 ACK подтверждение");
                        let ack_data = &msg_data[4..];
                        let message_ids: Vec<String> = ack_data.split(',').map(|s| s.to_string()).collect();
                        let _ = stream.write_all(b"ACK_OK");
                        let _ = event_tx.send(NetworkEvent::AckReceived { message_ids });
                        continue;
                    }

                    // Проверяем, не файл ли это
                    if msg_data.starts_with("FILE|") {
                        eprintln!("📁 Получен файл");
                        Self::handle_file_transfer(&mut stream, &msg_data, &peer_address, &event_tx);
                        continue;
                    }

                    // Парсим формат: "MSG|ID|Sender|Port|Text"
                    let parts: Vec<&str> = msg_data.splitn(5, '|').collect();

                    let (msg_id, sender, peer_port, text) = if parts.len() == 5 && parts[0] == "MSG" {
                        (parts[1].to_string(), parts[2].to_string(), parts[3].to_string(), parts[4].to_string())
                    } else if parts.len() == 2 {
                        (uuid::Uuid::new_v4().to_string(), parts[0].to_string(), "".to_string(), parts[1].to_string())
                    } else {
                        (uuid::Uuid::new_v4().to_string(), "Собеседник".to_string(), "".to_string(), msg_data)
                    };

                    if text.trim().is_empty() {
                        let _ = stream.write_all(b"OK");
                        continue;
                    }
                    
                    eprintln!("📨 Сообщение от {}: {}", sender, text);
                    
                    // Нормализуем peer_address
                    let normalized_peer_address = if !peer_port.is_empty() {
                        let local_addr = stream.local_addr().ok();
                        if let Some(addr) = local_addr {
                            let ip = addr.ip().to_string();
                            format!("{}:{}", ip, peer_port)
                        } else {
                            peer_address.clone()
                        }
                    } else {
                        peer_address.clone()
                    };
                    eprintln!("📍 Нормализованный адрес: {}", normalized_peer_address);

                    let message = ChatMessage {
                        id: msg_id,
                        timestamp: chrono::Utc::now(),
                        sender,
                        text,
                        is_mine: false,
                        delivery_status: 1, // ✓ Доставлено получателю
                    };

                    history_mgr.save_message(&normalized_peer_address, &message);

                    // Отправляем подтверждение
                    let _ = stream.write_all(b"OK");
                    eprintln!("📤 Отправлено подтверждение OK");

                    // Отправляем событие во фронтенд
                    let event = NetworkEvent::MessageReceived { 
                        message: message.clone(),
                        peer_address: normalized_peer_address.clone(),
                    };
                    let _ = event_tx.send(event);
                    eprintln!("✅ Сообщение обработано, отправлено событие");
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(100));
                }
                Err(e) => {
                    eprintln!("❌ Ошибка чтения от {}: {}", peer_address, e);
                    break;
                }
            }
        }
    }

    // Отправить сообщение с ожиданием ACK
    pub fn send_message_with_ack(&mut self, peer_address: &str, message: &ChatMessage) -> Result<bool, String> {
        eprintln!("📤 Отправка сообщения на {}: {}", peer_address, message.text);
        
        // Проверяем существующее подключение или создаём новое
        let mut connections = self.peer_connections.lock().map_err(|e| e.to_string())?;
        
        let stream = connections.entry(peer_address.to_string()).or_insert_with(|| {
            // Создаём новое подключение
            match TcpStream::connect(peer_address) {
                Ok(s) => {
                    s.set_read_timeout(Some(Duration::from_secs(30))).ok();
                    eprintln!("🔗 Подключение к {}", peer_address);
                    s
                }
                Err(_) => {
                    eprintln!("❌ Не удалось подключиться к {}", peer_address);
                    panic!("Failed to connect") // Временное решение
                }
            }
        });
        
        // Формат: "MSG|ID|Sender|Port|Text"
        let full_message = format!(
            "MSG|{}|{}|{}|{}",
            message.id, message.sender, self.port, message.text
        );
        eprintln!("📝 Отправляем: {}", full_message);

        if let Err(e) = stream.write_all(full_message.as_bytes()) {
            eprintln!("❌ Ошибка записи: {}", e);
            return Ok(false);
        }
        stream.flush().ok();

        // Ждём подтверждение
        let mut buffer = [0u8; 1024];
        stream.set_read_timeout(Some(Duration::from_secs(5))).ok();
        
        match stream.read(&mut buffer) {
            Ok(n) if n > 0 => {
                let response = String::from_utf8_lossy(&buffer[..n]);
                eprintln!("✅ Подтверждение получено: {}", response);
                Ok(response == "OK")
            }
            Ok(_) => {
                eprintln!("⚠️ Пустой ответ");
                Ok(false)
            }
            Err(e) => {
                eprintln!("⚠️ Таймаут подтверждения: {}", e);
                Ok(false)
            }
        }
    }

    // Отправить ACK
    pub fn send_ack(&mut self, peer_address: &str, message_ids: &[String]) -> Result<bool, String> {
        eprintln!("📤 Отправка ACK для {} сообщений", message_ids.len());
        
        let mut connections = self.peer_connections.lock().map_err(|e| e.to_string())?;
        
        let stream = match connections.get_mut(peer_address) {
            Some(s) => s,
            None => {
                // Создаём новое подключение для ACK
                match TcpStream::connect(peer_address) {
                    Ok(s) => {
                        eprintln!("🔗 Подключение к {} для ACK", peer_address);
                        connections.insert(peer_address.to_string(), s);
                        connections.get_mut(peer_address).unwrap()
                    }
                    Err(e) => {
                        eprintln!("❌ Не удалось подключиться: {}", e);
                        return Ok(false);
                    }
                }
            }
        };
        
        let ack_message = format!("ACK|{}", message_ids.join(","));
        eprintln!("📝 Отправляем ACK: {}", ack_message);
        
        if let Err(e) = stream.write_all(ack_message.as_bytes()) {
            eprintln!("❌ Ошибка отправки ACK: {}", e);
            return Ok(false);
        }
        stream.flush().ok();
        
        // Ждём подтверждение
        let mut buffer = [0u8; 1024];
        stream.set_read_timeout(Some(Duration::from_secs(2))).ok();
        
        match stream.read(&mut buffer) {
            Ok(n) if n > 0 => {
                let response = String::from_utf8_lossy(&buffer[..n]);
                eprintln!("✅ ACK подтверждение: {}", response);
                Ok(response == "ACK_OK")
            }
            _ => Ok(false)
        }
    }

    pub fn stop(&mut self) {
        self.running.store(false, Ordering::Relaxed);
        let mut connections = self.peer_connections.lock().unwrap();
        connections.clear();
        eprintln!("🔴 Все подключения закрыты");
    }
    
    fn handle_file_transfer(
        stream: &mut TcpStream,
        header: &str,
        _peer_address: &str,
        _event_tx: &Sender<NetworkEvent>,
    ) {
        let parts: Vec<&str> = header.split('|').collect();
        if parts.len() != 3 {
            eprintln!("❌ Неверный формат заголовка файла");
            let _ = stream.write_all(b"FILE_ERR");
            return;
        }
        
        let file_name = parts[1];
        let file_size: usize = match parts[2].parse() {
            Ok(s) => s,
            Err(_) => {
                eprintln!("❌ Неверный размер файла");
                let _ = stream.write_all(b"FILE_ERR");
                return;
            }
        };
        
        eprintln!("📁 Получение файла: {} ({} байт)", file_name, file_size);
        
        let download_dir = dirs::download_dir()
            .unwrap_or_else(|| std::path::PathBuf::from("."))
            .join("xam-messenger");
        
        if let Err(e) = std::fs::create_dir_all(&download_dir) {
            eprintln!("❌ Ошибка создания директории: {}", e);
            let _ = stream.write_all(b"FILE_ERR");
            return;
        }
        
        let file_path = download_dir.join(format!("{}_{}", 
            chrono::Utc::now().format("%Y%m%d_%H%M%S"),
            file_name
        ));
        
        eprintln!("📂 Сохраняем в: {:?}", file_path);
        
        let mut file_data = vec![0u8; file_size];
        let mut total_read = 0;
        
        while total_read < file_size {
            match stream.read(&mut file_data[total_read..]) {
                Ok(0) => {
                    eprintln!("❌ Соединение разорвано");
                    let _ = stream.write_all(b"FILE_ERR");
                    return;
                }
                Ok(n) => {
                    total_read += n;
                }
                Err(e) => {
                    eprintln!("❌ Ошибка чтения: {}", e);
                    let _ = stream.write_all(b"FILE_ERR");
                    return;
                }
            }
        }
        
        match std::fs::write(&file_path, &file_data) {
            Ok(_) => {
                eprintln!("✅ Файл сохранён: {:?}", file_path);
                let _ = stream.write_all(b"FILE_OK");
            }
            Err(e) => {
                eprintln!("❌ Ошибка сохранения: {}", e);
                let _ = stream.write_all(b"FILE_ERR");
            }
        }
    }
}
