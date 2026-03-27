# XAM Messenger Server

Сервер для корпоративного мессенджера локальной сети.

## Быстрый старт

### 1. Запуск сервера

```bash
cd server
./target/release/xam-server
```

Или сборка из исходников:
```bash
cargo build --release
./target/release/xam-server
```

### 2. Запуск клиента

Просто откройте `src/index.html` в браузере или через Tauri.

**Никаких настроек!** Клиент автоматически найдёт сервер.

## Как это работает

```
┌──────────────────────────────────────────┐
│  Сервер (порт 8080)                     │
│  • WebSocket - сообщения в реальном     │
│  • HTTP - регистрация, история          │
│  • SQLite - база данных                 │
└──────────────────────────────────────────┘
         ▲
         │ Авто-обнаружение
         │
    ┌────┴────┐
    │ Клиент  │  ← Вводите только имя
    └─────────┘
```

## API

### Регистрация
```
POST /api/register
Body: {"name": "Имя"}
Response: {"success": true, "data": {"id": "...", "name": "Имя"}}
```

### WebSocket
```
ws://server-ip:8080/ws
```

Сообщения (JSON):
```json
// Регистрация
{"type": "register", "name": "Артем"}

// Отправка сообщения
{"type": "message", "text": "Привет"}

// Подтверждение прочтения
{"type": "ack", "message_id": "...", "status": "read"}

// Запрос истории
{"type": "get_messages", "limit": 100}
```

### История
```
GET /api/messages?limit=100
```

## База данных

Расположение: `~/.config/xam-messenger/xam.db`

Таблицы:
- `users` - пользователи
- `messages` - сообщения

## Для разработчиков

### Сборка
```bash
cargo build --release
```

### Запуск с логом
```bash
RUST_LOG=debug ./target/release/xam-server
```

### Зависимости
- Actix-web - веб-фреймворк
- Actix-ws - WebSocket
- Rusqlite - SQLite
- Serde - сериализация
