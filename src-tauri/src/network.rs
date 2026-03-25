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

pub struct NetworkManager {
    port: String,
    event_tx: Sender<NetworkEvent>,
    history_mgr: HistoryManager,
    running: Arc<AtomicBool>,
    listener: Option<TcpListener>,
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

        // Запускаем сервер в отдельном потоке
        thread::spawn(move || {
            Self::run_server(listener, event_tx_clone, history_mgr_clone, running_clone);
        });

        Ok(Self {
            port,
            event_tx,
            history_mgr,
            running,
            listener: None,
        })
    }

    fn run_server(
        listener: TcpListener,
        event_tx: Sender<NetworkEvent>,
        history_mgr: HistoryManager,
        running: Arc<AtomicBool>,
    ) {
        listener.set_nonblocking(true).ok();
        eprintln!("🟢 Сервер запущен на порту {}", listener.local_addr().map(|a| a.port()).unwrap_or(0));

        while running.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((stream, addr)) => {
                    eprintln!("📥 Новое подключение от: {}", addr);
                    let event_tx = event_tx.clone();
                    let history_mgr = history_mgr.clone();

                    thread::spawn(move || {
                        Self::handle_connection(stream, event_tx, history_mgr);
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
        event_tx: Sender<NetworkEvent>,
        history_mgr: HistoryManager,
    ) {
        let peer_address = stream.peer_addr().map(|a| a.to_string()).unwrap_or_else(|_| "unknown".to_string());
        eprintln!("📥 Обработка подключения от {}", peer_address);
        
        let mut buffer = [0u8; 4096];

        match stream.read(&mut buffer) {
            Ok(n) if n > 0 => {
                let msg_data = String::from_utf8_lossy(&buffer[..n]).trim().to_string();
                eprintln!("📩 Получено: {}", msg_data);

                // Проверяем тип сообщения
                if msg_data.starts_with("ACK|") {
                    eprintln!("📨 ACK подтверждение");
                    let ack_data = &msg_data[4..];
                    let message_ids: Vec<String> = ack_data.split(',').map(|s| s.to_string()).collect();

                    let _ = stream.write_all(b"ACK_OK");
                    let _ = event_tx.send(NetworkEvent::AckReceived { message_ids });
                    return;
                }
                
                // Проверяем, не файл ли это
                if msg_data.starts_with("FILE|") {
                    eprintln!("📁 Получен файл");
                    Self::handle_file_transfer(&mut stream, &msg_data, &peer_address, &event_tx);
                    return;
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
                    eprintln!("⚠️ Пустое сообщение, игнорируем");
                    let _ = stream.write_all(b"OK");
                    return;
                }
                
                eprintln!("📨 Сообщение от {}: {}", sender, text);
                
                // Нормализуем peer_address - используем порт из сообщения если есть
                let normalized_peer_address = if !peer_port.is_empty() {
                    // Берём IP из текущего подключения, порт из сообщения
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
                    is_read: true,
                };

                // Сохраняем в историю с нормализованным адресом
                history_mgr.save_message(&normalized_peer_address, &message);

                // Отправляем подтверждение
                let _ = stream.write_all(b"OK");
                eprintln!("📤 Отправлено подтверждение OK");

                // Отправляем событие во фронтенд с нормализованным адресом
                let _ = event_tx.send(NetworkEvent::MessageReceived { 
                    message: message.clone(),
                    peer_address: normalized_peer_address.clone(),
                });
                eprintln!("✅ Сообщение обработано, адрес: {}", normalized_peer_address);
                
                // Сохраняем в кэш AppState
                // Это нужно для мгновенного обновления UI
            }
            Err(e) => {
                eprintln!("❌ Ошибка чтения: {}", e);
            }
            _ => {
                eprintln!("⚠️ Пустое чтение");
            }
        }
    }
    
    fn handle_file_transfer(
        stream: &mut TcpStream,
        header: &str,
        peer_address: &str,
        _event_tx: &Sender<NetworkEvent>,
    ) {
        // Парсим заголовок: FILE|name|size
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
        
        // Создаём директорию для загруженных файлов
        let download_dir = dirs::download_dir()
            .unwrap_or_else(|| std::path::PathBuf::from("."))
            .join("xam-messenger");
        
        if let Err(e) = std::fs::create_dir_all(&download_dir) {
            eprintln!("❌ Ошибка создания директории: {}", e);
            let _ = stream.write_all(b"FILE_ERR");
            return;
        }
        
        // Генерируем уникальное имя файла
        let file_path = download_dir.join(format!("{}_{}", 
            chrono::Utc::now().format("%Y%m%d_%H%M%S"),
            file_name
        ));
        
        eprintln!("📂 Сохраняем в: {:?}", file_path);
        
        // Читаем данные файла
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
                    eprintln!("📊 Прочитано {}/{} байт", total_read, file_size);
                }
                Err(e) => {
                    eprintln!("❌ Ошибка чтения: {}", e);
                    let _ = stream.write_all(b"FILE_ERR");
                    return;
                }
            }
        }
        
        // Сохраняем файл
        match std::fs::write(&file_path, &file_data) {
            Ok(_) => {
                eprintln!("✅ Файл сохранён: {:?}", file_path);
                let _ = stream.write_all(b"FILE_OK");
                
                // TODO: Отправить событие во фронтенд о полученном файле
            }
            Err(e) => {
                eprintln!("❌ Ошибка сохранения: {}", e);
                let _ = stream.write_all(b"FILE_ERR");
            }
        }
    }

    pub fn send_message(&mut self, peer_address: &str, message: &ChatMessage) -> Result<()> {
        eprintln!("📤 Отправка сообщения на {}: {}", peer_address, message.text);
        
        let stream = TcpStream::connect(peer_address)
            .with_context(|| format!("Не удалось подключиться к {}", peer_address))?;

        let mut stream = stream;
        stream.set_read_timeout(Some(Duration::from_secs(2)))?;

        // Формат: "MSG|ID|Sender|Port|Text"
        let full_message = format!(
            "MSG|{}|{}|{}|{}",
            message.id, message.sender, self.port, message.text
        );
        eprintln!("📝 Отправляем: {}", full_message);

        stream.write_all(full_message.as_bytes())?;

        // Ждём подтверждение
        let mut buffer = [0u8; 1024];
        match stream.read(&mut buffer) {
            Ok(n) => {
                eprintln!("✅ Подтверждение получено: {}", String::from_utf8_lossy(&buffer[..n]));
                Ok(())
            }
            Err(_) => {
                eprintln!("⚠️ Подтверждение не получено (таймаут)");
                Ok(()) // Не критично
            }
        }
    }

    pub fn stop(&mut self) {
        self.running.store(false, Ordering::Relaxed);
        // Подключаемся к себе чтобы разблокировать accept
        let _ = TcpStream::connect(format!("127.0.0.1:{}", self.port));
    }
}
