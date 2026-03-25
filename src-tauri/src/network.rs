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

        while running.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((stream, addr)) => {
                    eprintln!("New connection from: {}", addr);
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
    }

    fn handle_connection(
        mut stream: TcpStream,
        event_tx: Sender<NetworkEvent>,
        history_mgr: HistoryManager,
    ) {
        let peer_address = stream.peer_addr().map(|a| a.to_string()).unwrap_or_else(|_| "unknown".to_string());
        let mut buffer = [0u8; 4096];

        match stream.read(&mut buffer) {
            Ok(n) if n > 0 => {
                let msg_data = String::from_utf8_lossy(&buffer[..n]).trim().to_string();

                // Проверяем тип сообщения
                if msg_data.starts_with("ACK|") {
                    // Обработка подтверждения прочтения
                    let ack_data = &msg_data[4..];
                    let message_ids: Vec<String> = ack_data.split(',').map(|s| s.to_string()).collect();

                    let _ = stream.write_all(b"ACK_OK");

                    let _ = event_tx.send(NetworkEvent::AckReceived { message_ids });
                    return;
                }

                // Парсим формат: "MSG|ID|Sender|Port|Text"
                let parts: Vec<&str> = msg_data.splitn(5, '|').collect();

                let (msg_id, sender, text) = if parts.len() == 5 && parts[0] == "MSG" {
                    (parts[1].to_string(), parts[2].to_string(), parts[4].to_string())
                } else if parts.len() == 2 {
                    // Старый формат для совместимости
                    (uuid::Uuid::new_v4().to_string(), parts[0].to_string(), parts[1].to_string())
                } else {
                    (uuid::Uuid::new_v4().to_string(), "Собеседник".to_string(), msg_data)
                };

                if text.trim().is_empty() {
                    let _ = stream.write_all(b"OK");
                    return;
                }

                let message = ChatMessage {
                    id: msg_id,
                    timestamp: chrono::Utc::now(),
                    sender,
                    text,
                    is_mine: false,
                    is_read: true,
                };

                // Сохраняем в историю
                history_mgr.save_message(&peer_address, &message);

                // Отправляем подтверждение
                let _ = stream.write_all(b"OK");

                // Отправляем событие во фронтенд
                let _ = event_tx.send(NetworkEvent::MessageReceived { message });
            }
            Err(e) => {
                eprintln!("Error reading from stream: {}", e);
            }
            _ => {}
        }
    }

    pub fn send_message(&mut self, peer_address: &str, message: &ChatMessage) -> Result<()> {
        let stream = TcpStream::connect(peer_address)
            .with_context(|| format!("Failed to connect to {}", peer_address))?;

        let mut stream = stream;
        stream.set_read_timeout(Some(Duration::from_secs(2)))?;

        // Формат: "MSG|ID|Sender|Port|Text"
        let full_message = format!(
            "MSG|{}|{}|{}|{}",
            message.id, message.sender, self.port, message.text
        );

        stream.write_all(full_message.as_bytes())?;

        // Ждём подтверждение
        let mut buffer = [0u8; 1024];
        match stream.read(&mut buffer) {
            Ok(n) if &buffer[..n] == b"OK" => Ok(()),
            Ok(_) => Ok(()), // Принимаем любое подтверждение
            Err(_) => Ok(()), // Таймаут - не критично
        }
    }

    pub fn stop(&mut self) {
        self.running.store(false, Ordering::Relaxed);
        // Подключаемся к себе чтобы разблокировать accept
        let _ = TcpStream::connect(format!("127.0.0.1:{}", self.port));
    }
}
