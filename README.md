# XAM Messenger

Корпоративный мессенджер для локальной сети с поддержкой файлов и статусов доставки.

## Особенности

- 🔒 **Только локальная сеть** — без интернета, полная приватность
- 🚀 **Быстрый старт** — сервер + клиент, авто-обнаружение
- 📁 **Файлообмен** — отправка файлов до 25MB
- ✓✓ **Статусы** — доставлено / прочитано
- 💾 **История** — SQLite для хранения сообщений
- 🖥️ **Кроссплатформенно** — macOS, Linux, Windows

## Быстрый старт

### 1. Запуск сервера

```bash
cd server
./start.sh
```

Или напрямую:
```bash
./server/target/release/xam-server
```

**Сервер слушает на `0.0.0.0:8080`**

### 2. Запуск клиента

**Вариант A: В браузере**
```bash
# Откройте файл в браузере
open src/index.html
```

**Вариант B: Tauri приложение**
```bash
cd src-tauri
cargo tauri dev
```

### 3. Подключение

1. Введите ваше имя
2. Нажмите **"Войти"**
3. Сервер найдётся автоматически ✨

## Архитектура

```
┌────────────────────────────────────────────┐
│  Сервер (порт 8080)                       │
│  ┌─────────────────────────────────────┐  │
│  │ WebSocket /ws                       │  │
│  │ • Сообщения в реальном времени     │  │
│  │ • Статусы доставки                 │  │
│  └─────────────────────────────────────┘  │
│  ┌─────────────────────────────────────┐  │
│  │ HTTP /api/*                         │  │
│  │ • /api/register  - регистрация     │  │
│  │ • /api/messages  - история         │  │
│  └─────────────────────────────────────┘  │
│  ┌─────────────────────────────────────┐  │
│  │ SQLite (~/.config/xam-messenger/)  │  │
│  └─────────────────────────────────────┘  │
└────────────────────────────────────────────┘
                    ▲
                    │ Авто-обнаружение
                    │
        ┌───────────┼───────────┐
        │           │           │
   ┌────▼────┐ ┌────▼────┐ ┌───▼────┐
   │ Windows │ │  macOS  │ │ Linux  │
   │ Tauri   │ │ Tauri   │ │ Tauri  │
   └─────────┘ └─────────┘ └────────┘
```

## API

### WebSocket (`ws://server:8080/ws`)

**Регистрация:**
```json
{"type": "register", "name": "Артем"}
```

**Ответ:**
```json
{"type": "registered", "user": {"id": "...", "name": "Артем"}}
```

**Отправка сообщения:**
```json
{"type": "message", "text": "Привет всем!"}
```

**Подтверждение прочтения:**
```json
{"type": "ack", "message_id": "uuid", "status": "read"}
```

**Запрос истории:**
```json
{"type": "get_messages", "limit": 100}
```

### HTTP

**POST /api/register**
```bash
curl -X POST http://localhost:8080/api/register \
  -H "Content-Type: application/json" \
  -d '{"name": "Артем"}'
```

**GET /api/messages**
```bash
curl "http://localhost:8080/api/messages?limit=50"
```

## Структура проекта

```
lan-messenger-tauri/
├── server/                 # Сервер (Rust)
│   ├── src/
│   │   └── main.rs        # Основной код сервера
│   ├── Cargo.toml         # Зависимости
│   ├── start.sh           # Скрипт запуска
│   └── target/release/    # Скомпилированный сервер
│
├── src/                    # Клиент (JavaScript/HTML/CSS)
│   ├── index.html         # Главная страница
│   ├── app-server.js      # Клиент для сервера
│   ├── server-client.js   # WebSocket клиент
│   ├── styles.css         # Стили
│   └── app.js             # P2P версия (резерв)
│
├── src-tauri/              # Tauri приложение
│   ├── src/
│   │   ├── main.rs        # Tauri бэкенд
│   │   ├── network.rs     # P2P сеть
│   │   └── state.rs       # Состояние
│   ├── Cargo.toml
│   └── tauri.conf.json
│
└── README.md
```

## Статусы сообщений

| Статус | Значение | Когда |
|--------|----------|-------|
| ⏳ | Отправлено | Ждём доставки |
| ✓ | Доставлено | Получатель получил |
| ✓✓ | Прочитано | Получатель открыл чат |

## База данных

**Расположение:** `~/.config/xam-messenger/xam.db`

**Таблицы:**
```sql
users (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE
)

messages (
    id TEXT PRIMARY KEY,
    sender_id TEXT,
    sender_name TEXT,
    text TEXT,
    timestamp INTEGER,
    delivery_status INTEGER DEFAULT 0
)
```

## Для разработчиков

### Сборка сервера

```bash
cd server
cargo build --release
./target/release/xam-server
```

### Сборка Tauri клиента

```bash
cd src-tauri
cargo tauri build
```

### Зависимости сервера

- `actix-web` — веб-фреймворк
- `actix-ws` — WebSocket
- `rusqlite` — SQLite
- `serde` — сериализация
- `uuid` — генерация ID
- `chrono` — время

### Логирование

```bash
# Отладочный режим
RUST_LOG=debug ./target/release/xam-server

# Только ошибки
RUST_LOG=error ./target/release/xam-server
```

## Troubleshooting

### Сервер не запускается

```bash
# Проверьте, не занят ли порт 8080
lsof -i :8080

# Если занят — убейте процесс
kill -9 <PID>
```

### Клиент не подключается

1. Убедитесь, что сервер запущен
2. Проверьте firewall (порт 8080)
3. Попробуйте localhost вместо IP

### Ошибки компиляции

```bash
# Очистите и пересоберите
cargo clean
cargo build --release
```

## Лицензия

MIT

---

**XAM Messenger** — простой и надёжный мессенджер для вашей локальной сети.
