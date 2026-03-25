use crate::types::{ChatMessage, PeerInfo, ConnectionStatus};
use crate::history::HistoryManager;
use crate::network::NetworkManager;
use anyhow::Result;
use chrono::Timelike;
use std::collections::HashMap;
use std::sync::mpsc::{self, Receiver, Sender};

pub enum NetworkEvent {
    Connected { peer_address: String },
    MessageReceived { message: ChatMessage, peer_address: String },
    AckReceived { message_ids: Vec<String> },
    Disconnected,
}

pub struct AppState {
    pub network: Option<NetworkManager>,
    pub history_mgr: HistoryManager,
    pub my_name: String,
    pub my_port: Option<String>,
    pub peer_address: Option<String>,
    pub connected: bool,
    pub event_tx: Option<Sender<NetworkEvent>>,
    pub event_rx: Option<Receiver<NetworkEvent>>,
    pub message_cache: HashMap<String, Vec<ChatMessage>>,
}

impl AppState {
    pub fn new() -> Self {
        let history_mgr = HistoryManager::new().unwrap_or_else(|_| {
            eprintln!("Failed to initialize history manager");
            HistoryManager::new_unsafe()
        });

        Self {
            network: None,
            history_mgr,
            my_name: generate_random_name(),
            my_port: None,
            peer_address: None,
            connected: false,
            event_tx: None,
            event_rx: None,
            message_cache: HashMap::new(),
        }
    }

    pub fn initialize(&mut self) -> Result<()> {
        let (tx, rx) = mpsc::channel();
        self.event_tx = Some(tx);
        self.event_rx = Some(rx);
        Ok(())
    }

    pub fn start_server(&mut self, port: &str, name: &str) -> Result<(), String> {
        self.my_name = name.to_string();
        self.my_port = Some(port.to_string());

        let event_tx = self.event_tx.clone().ok_or("Event channel not initialized")?;
        let history_mgr = self.history_mgr.clone();

        let network = NetworkManager::new(
            port.to_string(),
            event_tx,
            history_mgr,
        ).map_err(|e| e.to_string())?;

        self.network = Some(network);
        self.connected = true;
        Ok(())
    }

    pub fn connect_to_peer(&mut self, peer_address: &str) -> Result<(), String> {
        self.peer_address = Some(peer_address.to_string());
        self.connected = true;
        Ok(())
    }

    pub fn send_message(&mut self, peer_address: &str, text: &str) -> Result<(), String> {
        // Автоматически устанавливаем peer_address если не установлен
        if self.peer_address.is_none() {
            self.peer_address = Some(peer_address.to_string());
        }

        if let Some(ref mut network) = self.network {
            let message = ChatMessage {
                id: uuid::Uuid::new_v4().to_string(),
                timestamp: chrono::Utc::now(),
                sender: self.my_name.clone(),
                text: text.to_string(),
                is_mine: true,
                is_read: false,
            };

            network.send_message(peer_address, &message).map_err(|e| e.to_string())?;

            // Сохраняем в кэш
            self.message_cache
                .entry(peer_address.to_string())
                .or_insert_with(Vec::new)
                .push(message.clone());

            // Сохраняем в историю
            self.history_mgr.save_message(peer_address, &message);
        }
        Ok(())
    }

    pub fn receive_message(&mut self, peer_address: &str, message: ChatMessage) {
        // Автоматически устанавливаем peer_address при первом сообщении
        if self.peer_address.is_none() {
            self.peer_address = Some(peer_address.to_string());
            self.connected = true;
            eprintln!("🟢 Установлено подключение к {}", peer_address);
        }

        // Сохраняем в кэш
        self.message_cache
            .entry(peer_address.to_string())
            .or_insert_with(Vec::new)
            .push(message);
    }

    pub fn get_peers(&self) -> Vec<PeerInfo> {
        self.history_mgr.load_peers()
    }

    pub fn get_messages(&self, peer_address: &str) -> Vec<ChatMessage> {
        // Сначала пробуем из кэша
        if let Some(messages) = self.message_cache.get(peer_address) {
            return messages.clone();
        }

        // Загружаем из истории
        self.history_mgr.load_messages(peer_address, 1000)
    }
    
    pub fn get_cached_messages(&self, peer_address: &str) -> Vec<ChatMessage> {
        // Возвращаем только из кэша
        self.message_cache.get(peer_address).cloned().unwrap_or_default()
    }

    pub fn get_status(&self) -> ConnectionStatus {
        ConnectionStatus {
            connected: self.connected,
            peer_address: self.peer_address.clone(),
            my_port: self.my_port.clone(),
            my_name: self.my_name.clone(),
        }
    }

    pub fn disconnect(&mut self) {
        self.connected = false;
        self.peer_address = None;
        if let Some(ref mut network) = self.network {
            network.stop();
        }
        self.network = None;
    }
    
    pub fn send_file(&mut self, peer_address: &str, file_path: &str) -> Result<(), String> {
        use std::io::{Read, Write};
        use std::fs::File;
        use std::net::TcpStream;
        use std::time::Duration;
        
        eprintln!("📁 Отправка файла: {} -> {}", file_path, peer_address);
        
        // Читаем файл
        let mut file = File::open(file_path)
            .map_err(|e| format!("Не удалось открыть файл: {}", e))?;
        
        let mut file_data = Vec::new();
        file.read_to_end(&mut file_data)
            .map_err(|e| format!("Не удалось прочитать файл: {}", e))?;
        
        let file_name = std::path::Path::new(file_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown");
        
        eprintln!("📊 Размер файла: {} байт", file_data.len());
        
        // Подключаемся к собеседнику
        let mut stream = TcpStream::connect(peer_address)
            .map_err(|e| format!("Не удалось подключиться: {}", e))?;
        
        stream.set_read_timeout(Some(Duration::from_secs(10)))
            .map_err(|e| format!("Ошибка установки таймаута: {}", e))?;
        
        // Отправляем заголовок: FILE|name|size
        let header = format!("FILE|{}|{}", file_name, file_data.len());
        stream.write_all(header.as_bytes())
            .map_err(|e| format!("Ошибка отправки заголовка: {}", e))?;
        
        // Отправляем данные файла
        stream.write_all(&file_data)
            .map_err(|e| format!("Ошибка отправки данных: {}", e))?;
        
        eprintln!("📤 Файл отправлен");
        
        // Ждём подтверждение
        let mut buffer = [0u8; 1024];
        match stream.read(&mut buffer) {
            Ok(n) => {
                let response = String::from_utf8_lossy(&buffer[..n]);
                eprintln!("📥 Ответ: {}", response);
                if response == "FILE_OK" {
                    eprintln!("✅ Файл успешно отправлен");
                    Ok(())
                } else {
                    Err(format!("Получен неверный ответ: {}", response))
                }
            }
            Err(e) => Err(format!("Таймаут подтверждения: {}", e))
        }
    }
}

fn generate_random_name() -> String {
    let names = ["Кот", "Пёс", "Лис", "Волк", "Медведь", "Заяц", "Ёж", "Бобр", "Сова", "Орёл"];
    let name = names[chrono::Utc::now().nanosecond() as usize % names.len()];
    let num = chrono::Utc::now().nanosecond() % 100;
    format!("{}{}", name, num)
}
