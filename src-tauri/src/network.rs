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

        let mut buffer = [0u8; 65536]; // Увеличенный буфер

        loop {
            match stream.read(&mut buffer) {
                Ok(0) => {
                    eprintln!("⚠️ Соединение закрыто {}", peer_address);
                    break;
                }
                Ok(n) => {
                    // Проверяем, не файл ли это (по первым байтам)
                    let header_check = String::from_utf8_lossy(&buffer[..n.min(100)]);
                    
                    if header_check.starts_with("FILE|") {
                        eprintln!("📁 Получен файл");
                        // Находим конец заголовка (newline или первый | после размера)
                        if let Some(newline_pos) = header_check.find('\n') {
                            let header = header_check[..newline_pos].trim().to_string();
                            // Пропускаем заголовок в буфере
                            let data_start = newline_pos + 1;
                            let remaining = n - data_start;

                            // Передаем поток и оставшиеся данные в handle_file_transfer
                            Self::handle_file_transfer_stream(&mut stream, &header, &peer_address, &event_tx, &history_mgr, remaining, &buffer[data_start..]);
                        } else {
                            // Заголовок без newline - читаем до конца заголовка
                            let header = header_check.trim().to_string();
                            Self::handle_file_transfer_stream(&mut stream, &header, &peer_address, &event_tx, &history_mgr, 0, &[]);
                        }
                        continue;
                    }

                    let msg_data = String::from_utf8_lossy(&buffer[..n]).trim().to_string();
                    eprintln!("📩 Получено от {}: {}", peer_address, msg_data);

                    // Проверяем тип сообщения
                    if msg_data.starts_with("ACK|") {
                        eprintln!("📨 ACK подтверждение");
                        let ack_data = &msg_data[4..];
                        let message_ids: Vec<String> = ack_data.split(',').map(|s| s.to_string()).collect();
                        let _ = stream.write_all(b"ACK_OK\n");

                        // Обновляем статус доставки на ✓✓ (прочитано)
                        let _ = event_tx.send(NetworkEvent::DeliveryStatusUpdate {
                            message_ids: message_ids.clone(),
                            status: 2,
                        });

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
                        let _ = stream.write_all(b"OK\n");
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
                        id: msg_id.clone(),
                        timestamp: chrono::Utc::now(),
                        sender,
                        text,
                        is_mine: false,
                        delivery_status: 1, // ✓ Доставлено получателю
                        files: Vec::new(),
                    };

                    history_mgr.save_message(&normalized_peer_address, &message);

                    // Отправляем подтверждение доставки (OK)
                    let _ = stream.write_all(b"OK\n");
                    eprintln!("📤 Отправлено подтверждение OK");

                    // Отправляем ACK обратно для обновления статуса (✓ доставлено)
                    let ack_message = format!("ACK|{}\n", msg_id);
                    let _ = stream.write_all(ack_message.as_bytes());
                    eprintln!("📤 Отправлен ACK: {}", ack_message);

                    // Отправляем событие во фронтенд
                    let event = NetworkEvent::MessageReceived {
                        message: message.clone(),
                        peer_address: normalized_peer_address.clone(),
                    };
                    let _ = event_tx.send(event);
                    eprintln!("✅ Сообщение обработано, отправлено событие");

                    // Примечание: peer_address должен устанавливаться через set_peer_address из фронтенда
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

        // Проверяем существующее подключение
        let mut connections = self.peer_connections.lock().map_err(|e| e.to_string())?;
        
        // Если подключения нет - создаём
        if !connections.contains_key(peer_address) {
            match TcpStream::connect(peer_address) {
                Ok(s) => {
                    s.set_read_timeout(Some(Duration::from_secs(30))).ok();
                    eprintln!("🔗 Подключение к {}", peer_address);
                    connections.insert(peer_address.to_string(), s);
                }
                Err(e) => {
                    eprintln!("❌ Не удалось подключиться к {}: {}", peer_address, e);
                    return Ok(false);
                }
            }
        }
        
        let stream = connections.get_mut(peer_address).ok_or("Connection not found")?;

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

        // Ждём подтверждение (OK + ACK)
        let mut buffer = [0u8; 1024];
        stream.set_read_timeout(Some(Duration::from_secs(5))).ok();

        match stream.read(&mut buffer) {
            Ok(n) if n > 0 => {
                let response = String::from_utf8_lossy(&buffer[..n]);
                eprintln!("✅ Подтверждение получено: {}", response);
                
                // Проверяем есть ли ACK в ответе
                if response.starts_with("ACK|") {
                    eprintln!("✅ ACK получен сразу");
                    return Ok(true);
                }
                
                let ok_received = response.contains("OK");
                
                // Если получили OK, пробуем прочитать ACK отдельно
                if ok_received {
                    stream.set_read_timeout(Some(Duration::from_millis(500))).ok();
                    let mut ack_buffer = [0u8; 1024];
                    if let Ok(ack_n) = stream.read(&mut ack_buffer) {
                        if ack_n > 0 {
                            let ack_response = String::from_utf8_lossy(&ack_buffer[..ack_n]);
                            eprintln!("✅ ACK получен: {}", ack_response);
                            if ack_response.starts_with("ACK|") {
                                return Ok(true);
                            }
                        }
                    }
                }
                
                Ok(ok_received)
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

    // Обработка файла с учётом данных уже прочитанных в буфер
    fn handle_file_transfer_stream(
        stream: &mut TcpStream,
        header: &str,
        peer_address: &str,
        event_tx: &Sender<NetworkEvent>,
        history_mgr: &HistoryManager,
        initial_remaining: usize,
        initial_data: &[u8],
    ) {
        let parts: Vec<&str> = header.split('|').collect();

        // Формат: FILE|name|size|sender_port (4 части)
        if parts.len() < 3 {
            eprintln!("❌ Неверный формат заголовка файла: {}", header);
            let _ = stream.write_all(b"FILE_ERR\n");
            return;
        }

        let file_name = parts[1];
        let file_size: usize = match parts[2].parse() {
            Ok(s) => s,
            Err(_) => {
                eprintln!("❌ Неверный размер файла");
                let _ = stream.write_all(b"FILE_ERR\n");
                return;
            }
        };

        // Получаем порт отправителя если есть
        let sender_port = if parts.len() >= 4 {
            parts[3].trim().to_string()
        } else {
            String::new()
        };

        // Нормализуем peer_address: IP клиента + порт отправителя из заголовка
        // Это адрес ОТПРАВИТЕЛЯ (кто отправил файл)
        let normalized_peer_address = if !sender_port.is_empty() {
            // Берем IP из адреса подключения (peer_address)
            let client_ip = peer_address.split(':').next().unwrap_or("127.0.0.1");
            format!("{}:{}", client_ip, sender_port)
        } else {
            peer_address.to_string()
        };

        eprintln!("📁 Получение файла: {} ({} байт) от {}", file_name, file_size, normalized_peer_address);
        eprintln!("🔍 peer_address подключения: {}, sender_port: {}", peer_address, sender_port);

        let download_dir = dirs::download_dir()
            .unwrap_or_else(|| std::path::PathBuf::from("."))
            .join("xam-messenger");

        if let Err(e) = std::fs::create_dir_all(&download_dir) {
            eprintln!("❌ Ошибка создания директории: {}", e);
            let _ = stream.write_all(b"FILE_ERR\n");
            return;
        }

        let file_path = download_dir.join(format!("{}_{}",
            chrono::Utc::now().format("%Y%m%d_%H%M%S"),
            file_name
        ));

        eprintln!("📂 Сохраняем в: {:?}", file_path);

        // Создаём файл для записи
        let mut file = match std::fs::File::create(&file_path) {
            Ok(f) => f,
            Err(e) => {
                eprintln!("❌ Ошибка создания файла: {}", e);
                let _ = stream.write_all(b"FILE_ERR\n");
                return;
            }
        };

        // Записываем данные из начального буфера если есть
        let mut total_written: usize = 0;
        if initial_remaining > 0 && !initial_data.is_empty() {
            let to_write = initial_remaining.min(file_size);
            if let Err(e) = file.write_all(&initial_data[..to_write]) {
                eprintln!("❌ Ошибка записи: {}", e);
                let _ = stream.write_all(b"FILE_ERR\n");
                return;
            }
            total_written = to_write;
            eprintln!("📝 Записано {} байт из буфера", to_write);
        }

        // Читаем остальное из потока
        let mut buffer = [0u8; 65536];
        while total_written < file_size {
            let remaining = file_size - total_written;
            let to_read = remaining.min(buffer.len());
            
            match stream.read(&mut buffer[..to_read]) {
                Ok(0) => {
                    eprintln!("❌ Соединение разорвано при чтении файла");
                    let _ = stream.write_all(b"FILE_ERR\n");
                    return;
                }
                Ok(n) => {
                    if let Err(e) = file.write_all(&buffer[..n]) {
                        eprintln!("❌ Ошибка записи файла: {}", e);
                        let _ = stream.write_all(b"FILE_ERR\n");
                        return;
                    }
                    total_written += n;
                }
                Err(e) => {
                    eprintln!("❌ Ошибка чтения файла: {}", e);
                    let _ = stream.write_all(b"FILE_ERR\n");
                    return;
                }
            }
        }

        drop(file); // Закрываем файл

        // Сохраняем сообщение о файле в историю
        let file_msg = ChatMessage {
            id: uuid::Uuid::new_v4().to_string(),
            timestamp: chrono::Utc::now(),
            sender: "Собеседник".to_string(),
            text: format!("📎 Файл: {}", file_name),
            is_mine: false,
            delivery_status: 2, // ✓✓ Прочитано
            files: vec![crate::types::FileInfo {
                name: file_name.to_string(),
                size: file_size,
            }],
        };

        eprintln!("💾 Сохранение файла в историю для: {}", normalized_peer_address);
        // Сохраняем в историю
        history_mgr.save_message(&normalized_peer_address, &file_msg);

        match std::fs::write(&file_path, &std::fs::read(&file_path).unwrap_or_default()) {
            Ok(_) => {
                eprintln!("✅ Файл сохранён: {:?}", file_path);
                let _ = stream.write_all(b"FILE_OK\n");

                // Отправляем событие о получении файла с нормализованным адресом
                let _ = event_tx.send(NetworkEvent::MessageReceived {
                    message: file_msg,
                    peer_address: normalized_peer_address,
                });
            }
            Err(e) => {
                eprintln!("❌ Ошибка сохранения: {}", e);
                let _ = stream.write_all(b"FILE_ERR\n");
            }
        }
    }
}
