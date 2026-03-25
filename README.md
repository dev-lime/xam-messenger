# Xam Messenger — Tauri + Rust

LAN-мессенджер на Tauri v2 + Rust с красивым веб-интерфейсом.

## 🚀 Возможности

- ✅ Обмен сообщениями в локальной сети
- ✅ История переписок (JSONL)
- ✅ Статусы прочтения (✓ / ✓✓)
- ✅ Список последних контактов
- ✅ Копирование сообщений
- ✅ Кроссплатформенность (Windows, Linux, macOS)

## 📦 Установка

### 1. Установите Rust

```bash
# macOS/Linux
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Windows - скачайте с https://rustup.rs/
```

### 2. Установите зависимости

**macOS:**
```bash
xcode-select --install
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt update
sudo apt install -y libwebkit2gtk-4.0-dev build-essential libssl-dev \
  libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
```

**Linux (Fedora):**
```bash
sudo dnf install webkit2gtk3-devel openssl-devel \
  gtk3-devel libappindicator-gtk3-devel librsvg2-devel
```

**Windows:**
- Установите [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
- Выберите "C++ build tools"

### 3. Установите Tauri CLI (опционально)

```bash
cargo install tauri-cli
```

### 4. Сборка проекта

```bash
cd lan-messenger-tauri/src-tauri

# Режим разработки
cargo tauri dev

# Сборка релиза
cargo tauri build
```

## 📁 Структура проекта

```
lan-messenger-tauri/
├── src/                    # Frontend (HTML/CSS/JS)
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── src-tauri/              # Backend (Rust)
│   ├── src/
│   │   ├── main.rs        # Tauri commands
│   │   ├── types.rs       # Общие типы
│   │   ├── network.rs     # Сетевая логика
│   │   ├── history.rs     # История (JSONL)
│   │   └── state.rs       # Состояние приложения
│   ├── Cargo.toml
│   └── tauri.conf.json
└── README.md
```

## 🎮 Использование

### Запуск на одном ПК (тест)

1. **Первый экземпляр:**
   - Порт: `8080`
   - Имя: `Кот1`
   - IP собеседника: `127.0.0.1:8081`

2. **Второй экземпляр:**
   - Порт: `8081`
   - Имя: `Кот2`
   - IP собеседника: `127.0.0.1:8080`

### Запуск на разных компьютерах

1. **Компьютер 1:**
   - Узнайте IP: `ipconfig` (Windows) или `ip addr` (Linux)
   - Порт: `8080`
   - IP собеседника: (оставьте пустым)

2. **Компьютер 2:**
   - Порт: `8081`
   - IP собеседника: `192.168.1.100:8080`

## 📬 Хранение данных

История сохраняется в:
- **Windows:** `%APPDATA%\xam-messenger\history\`
- **Linux:** `~/.config/xam-messenger/history/`
- **macOS:** `~/Library/Application Support/xam-messenger/history/`

Формат: JSONL (один JSON-объект на строку)

## 🔧 Сборка под разные платформы

### Windows
```bash
cargo tauri build --target x86_64-pc-windows-msvc
```

### Linux
```bash
cargo tauri build --target x86_64-unknown-linux-gnu
```

### macOS
```bash
cargo tauri build --target x86_64-apple-darwin
cargo tauri build --target aarch64-apple-darwin  # Apple Silicon
```

## 📊 Размер бинарника

После оптимизации (в режиме release):
- **Windows:** ~8-12 MB
- **Linux:** ~10-15 MB (зависит от системных библиотек)
- **macOS:** ~10-14 MB

## 🛠 Разработка

### Горячая перезагрузка
```bash
cargo tauri dev
```

### Логирование
```bash
# В режиме разработки логи выводятся в консоль
# В релизе используйте logger
```

## 📝 Протокол обмена

```
Сообщение: MSG|ID|Sender|Port|Text
Подтверждение: ACK|id1,id2,id3
Ответ на ACK: ACK_OK
```

## 🔐 Безопасность

- Нет шифрования (учебный проект для LAN)
- Доверенная локальная сеть
- Нет аутентификации

## 📄 Лицензия

MIT
