use crate::types::{ChatMessage, PeerInfo};
use anyhow::{Result, Context};
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;

#[derive(Clone)]
pub struct HistoryManager {
    history_dir: PathBuf,
}

impl HistoryManager {
    pub fn new() -> Result<Self> {
        let history_dir = dirs::config_dir()
            .context("Failed to get config dir")?
            .join("xam-messenger")
            .join("history");

        fs::create_dir_all(&history_dir)?;

        Ok(Self { history_dir })
    }

    pub fn new_unsafe() -> Self {
        Self {
            history_dir: PathBuf::from("./history"),
        }
    }

    fn get_history_file(&self, peer_address: &str) -> PathBuf {
        // Заменяем недопустимые символы в имени файла
        let safe_name = peer_address
            .replace(':', "_")
            .replace('.', "_");
        self.history_dir.join(format!("{}.jsonl", safe_name))
    }

    pub fn save_message(&self, peer_address: &str, message: &ChatMessage) {
        let file_path = self.get_history_file(peer_address);

        if let Ok(mut file) = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&file_path)
        {
            if let Ok(json) = serde_json::to_string(message) {
                let _ = writeln!(file, "{}", json);
            }
        }
    }

    pub fn load_messages(&self, peer_address: &str, limit: usize) -> Vec<ChatMessage> {
        let file_path = self.get_history_file(peer_address);

        if !file_path.exists() {
            return Vec::new();
        }

        let file = match File::open(&file_path) {
            Ok(f) => f,
            Err(_) => return Vec::new(),
        };

        let reader = BufReader::new(file);
        let mut messages: Vec<ChatMessage> = reader
            .lines()
            .filter_map(|line| line.ok())
            .filter_map(|line| serde_json::from_str(&line).ok())
            .collect();

        // Сортируем по времени
        messages.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));

        // Возвращаем последние limit сообщений
        if messages.len() > limit {
            messages.drain(0..messages.len() - limit);
        }

        messages
    }

    pub fn load_peers(&self) -> Vec<PeerInfo> {
        let mut peers = Vec::new();

        if let Ok(entries) = fs::read_dir(&self.history_dir) {
            for entry in entries.filter_map(|e| e.ok()) {
                let path = entry.path();

                if !path.is_file() || path.extension().and_then(|s| s.to_str()) != Some("jsonl") {
                    continue;
                }

                let file_name = path.file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("");

                // Восстанавливаем адрес из имени файла
                let address = self.restore_address_from_filename(file_name);

                // Загружаем информацию о последнем сообщении
                if let Some((last_msg, unread_count)) = self.get_last_message_info(&path) {
                    peers.push(PeerInfo {
                        address,
                        name: last_msg.sender,
                        last_message: last_msg.timestamp.timestamp(),
                        unread_count,
                    });
                }
            }
        }

        // Сортируем по времени последнего сообщения (новые сверху)
        peers.sort_by(|a, b| b.last_message.cmp(&a.last_message));

        peers
    }

    fn restore_address_from_filename(&self, filename: &str) -> String {
        // Формат: "192_168_1_100_8080" -> "192.168.1.100:8080"
        let parts: Vec<&str> = filename.rsplitn(2, '_').collect();
        if parts.len() == 2 {
            let port = parts[0];
            let ip_part = parts[1].replace('_', ".");
            format!("{}:{}", ip_part, port)
        } else {
            filename.replace('_', ":")
        }
    }

    fn get_last_message_info(&self, file_path: &PathBuf) -> Option<(ChatMessage, usize)> {
        let file = File::open(file_path).ok()?;
        let reader = BufReader::new(file);

        let mut last_msg: Option<ChatMessage> = None;
        let mut unread_count = 0;

        for line in reader.lines().filter_map(|l| l.ok()) {
            if let Ok(msg) = serde_json::from_str::<ChatMessage>(&line) {
                // Считаем непрочитанными сообщения с delivery_status < 2
                if msg.delivery_status < 2 && !msg.is_mine {
                    unread_count += 1;
                }
                last_msg = Some(msg);
            }
        }

        last_msg.map(|m| (m, unread_count))
    }
}
