# XAM Messenger

Корпоративный мессенджер для локальной сети с поддержкой файлов и статусов доставки.

**Версия:** 1.0.0  
**Минимальные версии:** Rust 1.75+, Node.js 18+, Tauri 2.0+

## Особенности

- 🔒 **Только локальная сеть** — без интернета, полная приватность
- 🚀 **Быстрый старт** — сервер + клиент, авто-обнаружение
- 📁 **Файлообмен** — отправка файлов до 100MB
- ✓✓ **Статусы** — доставлено / прочитано
- 💾 **История** — SQLite для хранения сообщений
- 🖥️ **Универсальный клиент** — работает в браузере и Tauri

## Быстрый старт

### 1. Запуск сервера

```bash
cd server
./target/release/xam-server
```

**Сервер слушает на `0.0.0.0:8080`**

### 2. Запуск клиента

**Вариант A: В браузере**
```bash
# Откройте файл в браузере
open src/index.html
```

**Вариант B: Tauri приложение (десктоп)**
```bash
# Режим разработки
cd src-tauri
cargo tauri dev

# Или собранный релиз
./src-tauri/target/release/xam-messenger
```

### 3. Подключение

1. Введите ваше имя
2. Нажмите **"Войти"**
3. Сервер найдётся автоматически ✨

## Архитектура

```
┌─────────────────────────────────────┐
│  Сервер (порт 8080)                 │
│  ┌───────────────────────────────┐  │
│  │ WebSocket /ws                 │  │
│  │ • Сообщения в реальном времени│  │
│  │ • Статусы доставки            │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │ HTTP /api/*                   │  │
│  │ • /api/register - регистрация │  │
│  │ • /api/users  - пользователи  │  │
│  │ • /api/messages - история     │  │
│  │ • /api/files    - файлы       │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │ SQLite                        │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
              ▲
              │ WebSocket + HTTP
              │
    ┌─────────┼─────────┐
    │         │         │
┌───▼───┐ ┌───▼───┐ ┌───▼───┐
│Браузер│ │Браузер│ │ Tauri │
│ User1 │ │ User2 │ │  App  │
└───────┘ └───────┘ └───────┘
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
{"type": "message", "text": "Привет!", "recipient_id": "..."}
```

**Подтверждение прочтения:**
```json
{"type": "ack", "message_id": "uuid", "status": "read"}
```

**Запрос истории:**
```json
{"type": "get_messages", "limit": 50, "before_id": null}
```

**Запрос старых сообщений (пагинация):**
```json
{"type": "get_messages", "limit": 50, "before_id": "c6cb1fec-..."}
```

### HTTP

**POST /api/register**
```bash
curl -X POST http://localhost:8080/api/register \
  -H "Content-Type: application/json" \
  -d '{"name": "Артем"}'
```

**GET /api/users**
```bash
curl http://localhost:8080/api/users
```

**GET /api/messages**
```bash
curl "http://localhost:8080/api/messages?limit=50"
```

**POST /api/files**
```bash
curl -X POST http://localhost:8080/api/files \
  -F "file=@document.pdf"
```

## Структура проекта

```
lan-messenger-tauri/
├── server/                 # Сервер (Rust + Actix)
│   ├── src/
│   │   └── main.rs        # Основной код сервера
│   ├── Cargo.toml         # Зависимости
│   └── target/release/    # Скомпилированный сервер
│
├── src/                    # Клиент (JavaScript/HTML/CSS)
│   ├── index.html         # Главная страница
│   ├── app.js             # Клиентское приложение
│   ├── server-client.js   # WebSocket клиент
│   └── styles.css         # Стили
│
├── src-tauri/              # Tauri приложение (десктоп)
│   ├── src/
│   │   └── main.rs        # Tauri бэкенд (окно)
│   ├── Cargo.toml         # Зависимости
│   └── tauri.conf.json    # Конфигурация Tauri
│
├── .github/
│   └── workflows/         # CI/CD конфигурация
├── DISCOVERY.md           # Протокол обнаружения сервера
└── README.md
```

## Статусы сообщений

| Статус | Значение | Когда |
|--------|----------|-------|
| ⏳ | Отправка | Ждём доставки |
| 🕐 | Отправлено | Сервер принял |
| ✓ | Доставлено | Получатель получил |
| ✓✓ | Прочитано | Получатель открыл чат |

## База данных

**Расположение:**
- **Linux:** `~/.config/xam-messenger/xam.db`
- **macOS:** `~/Library/Application Support/xam-messenger/xam.db`

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
    delivery_status INTEGER DEFAULT 0,
    recipient_id TEXT,
    files TEXT DEFAULT '[]'
)

files (
    id TEXT PRIMARY KEY,
    name TEXT,
    path TEXT,
    size INTEGER,
    sender_id TEXT,
    recipient_id TEXT,
    timestamp INTEGER
)
```

## Тестирование

### Запуск всех тестов

```bash
# Тесты сервера (Rust)
cd server
cargo test

# Тесты клиента (JavaScript)
cd ..
npm install
npm test
```

### Покрытие тестами

| Компонент | Тестов | Статус |
|-----------|--------|--------|
| Сервер (Rust) | 35 | ✅ |
| Клиент (JS) | 82 | ⚠️ 61 passed, 20 skipped |

### CI/CD

GitHub Actions автоматически запускает тесты при push в `main`/`master` и при создании Pull Request.

## Для разработчиков

### Сборка сервера

```bash
cd server
cargo build --release
./target/release/xam-server
```

### Сборка клиента (Tauri)

```bash
cd src-tauri
cargo tauri dev    # Режим разработки
cargo tauri build  # Релизная сборка
```

### Автоматическая сборка (CI/CD)

Проект использует GitHub Actions для автоматической сборки под все платформы:

**Запуск сборки:**
```bash
# Создайте тег версии
git tag v1.0.0
git push origin v1.0.0
```

Или через GitHub UI: Actions → "Build All Platforms" → "Run workflow"

**Артефакты:**
- **Windows**: `.msi` (установщик), `.exe` (портативный), сервер `.exe`
- **Linux**: `.deb`, `.rpm`, `.AppImage`, сервер
- **macOS**: `.dmg` (универсальный Intel+ARM), сервер

### Зависимости сервера

- `actix-web` — веб-фреймворк
- `actix-ws` — WebSocket
- `actix-multipart` — загрузка файлов
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
3. Откройте консоль браузера (F12) для просмотра ошибок

### Ошибки компиляции

```bash
# Очистите и пересоберите
cd server
cargo clean
cargo build --release
```

### Ошибки тестов клиента

```bash
# Переустановите зависимости
rm -rf node_modules package-lock.json
npm install

# Запустите тесты заново
npm test
```

### Файлы не загружаются

- Проверьте права на запись в папку файлов:
  - **Linux:** `~/.local/share/xam-messenger/files/`
  - **macOS:** `~/Library/Application Support/xam-messenger/files/`
- Максимальный размер файла: 100MB

## Безопасность

**Важно:** Мессенджер предназначен для использования в доверенной локальной сети (LAN).

- ✅ XSS защита через экранирование пользовательских данных
- ✅ SQL injection защита через параметризованные запросы
- ✅ CORS настроен для localhost и LAN
- ⚠️ Нет шифрования трафика (WebSocket без TLS)
- ⚠️ Нет аутентификации (любой в LAN может подключиться)

## Лицензия

MIT

---

**XAM Messenger** — простой и надёжный мессенджер для вашей локальной сети.
