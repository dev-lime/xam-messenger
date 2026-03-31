# XAM Messenger

Корпоративный мессенджер для локальной сети с поддержкой файлов и статусов доставки.

**Версия:** 1.0.0  
**Минимальные версии:** Rust 1.75+, Node.js 18+, Tauri 2.0+

## 📋 Особенности

- 🔒 **Только локальная сеть** — без интернета, полная приватность
- 🚀 **Быстрый старт** — сервер + клиент, авто-обнаружение
- 📁 **Файлообмен** — отправка файлов до 100MB
- ✓✓ **Статусы** — доставлено / прочитано
- 💾 **История** — SQLite для хранения сообщений
- 🖥️ **Универсальный клиент** — работает в браузере и Tauri

## 🚀 Быстрый старт

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

## 🏗️ Архитектура

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

## 📡 API Документация

### HTTP API

Все HTTP эндпоинты возвращают JSON в формате:
```json
{
  "success": true,
  "data": { ... },
  "error": "..."  // только при ошибке
}
```

#### POST /api/register

Регистрация нового пользователя.

**Request:**
```http
POST /api/register HTTP/1.1
Content-Type: application/json

{
  "name": "Артём"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Артём",
    "avatar": "👤"
  }
}
```

**Response (400 Bad Request):**
```json
{
  "success": false,
  "error": "Empty name"
}
```

---

#### GET /api/users

Получение списка всех зарегистрированных пользователей.

**Request:**
```http
GET /api/users HTTP/1.1
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "Артём",
      "avatar": "👤"
    },
    {
      "id": "660e8400-e29b-41d4-a716-446655440001",
      "name": "Мария",
      "avatar": "👩"
    }
  ]
}
```

---

#### GET /api/messages

Получение истории сообщений с пагинацией.

**Query Parameters:**
| Параметр | Тип | По умолчанию | Описание |
|----------|-----|--------------|----------|
| `limit` | integer | 50 | Количество сообщений (макс. 200) |
| `before_id` | string | null | ID сообщения для пагинации |

**Request:**
```http
GET /api/messages?limit=50&before_id=c6cb1fec-... HTTP/1.1
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": "msg-001",
      "sender_id": "550e8400-e29b-41d4-a716-446655440000",
      "sender_name": "Артём",
      "text": "Привет!",
      "timestamp": 1699000000,
      "delivery_status": 1,
      "recipient_id": null,
      "files": []
    }
  ],
  "before_id": "c6cb1fec-...",
  "next_before_id": "msg-001",
  "has_more": true
}
```

**Поля сообщения:**
| Поле | Тип | Описание |
|------|-----|----------|
| `id` | string | Уникальный ID сообщения (UUID) |
| `sender_id` | string | ID отправителя |
| `sender_name` | string | Имя отправителя |
| `text` | string | Текст сообщения |
| `timestamp` | integer | Unix timestamp (секунды) |
| `delivery_status` | integer | 0=отправка, 1=отправлено, 2=прочитано |
| `recipient_id` | string\|null | ID получателя (null для всех) |
| `files` | array | Массив файлов |

---

#### GET /api/online

Получение списка пользователей онлайн.

**Request:**
```http
GET /api/online HTTP/1.1
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": [
    "550e8400-e29b-41d4-a716-446655440000",
    "660e8400-e29b-41d4-a716-446655440001"
  ]
}
```

---

#### POST /api/files

Загрузка файла на сервер.

**Request (multipart/form-data):**
```http
POST /api/files HTTP/1.1
Content-Type: multipart/form-data; boundary=----WebKitFormBoundary

------WebKitFormBoundary
Content-Disposition: form-data; name="file"; filename="document.pdf"
Content-Type: application/pdf

<binary data>
------WebKitFormBoundary--
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "file-uuid",
    "name": "document.pdf",
    "size": 102400,
    "path": "/path/to/files/file-uuid_document.pdf"
  }
}
```

**Response (400 Bad Request):**
```json
{
  "success": false,
  "error": "No file uploaded"
}
```

**Лимиты:**
- Максимальный размер файла: 100MB
- Поддерживаемые типы: любые

---

#### GET /api/files/download

Скачивание файла.

**Query Parameters:**
| Параметр | Тип | Обязательный | Описание |
|----------|-----|--------------|----------|
| `path` | string | да | Путь к файлу |

**Request:**
```http
GET /api/files/download?path=%2Fpath%2Fto%2Ffile.pdf HTTP/1.1
```

**Response (200 OK):**
```http
HTTP/1.1 200 OK
Content-Type: application/octet-stream
Content-Disposition: attachment; filename="file.pdf"

<binary data>
```

**Response (404 Not Found):**
```json
{
  "success": false,
  "error": "File not found"
}
```

---

### WebSocket API

**URL подключения:** `ws://<server>:8080/ws`

Все сообщения передаются в формате JSON.

#### Клиент → Сервер

##### Регистрация

```json
{
  "type": "register",
  "name": "Артём",
  "text": "👤"
}
```

**Поля:**
| Поле | Тип | Обязательное | Описание |
|------|-----|--------------|----------|
| `type` | string | да | Всегда `"register"` |
| `name` | string | да | Имя пользователя |
| `text` | string | нет | Аватар (эмодзи), по умолчанию "👤" |

---

##### Отправка сообщения

```json
{
  "type": "message",
  "text": "Привет!",
  "recipient_id": "550e8400-e29b-41d4-a716-446655440000",
  "files": [
    {
      "name": "doc.pdf",
      "size": 1024,
      "path": "/path/to/doc.pdf"
    }
  ]
}
```

**Поля:**
| Поле | Тип | Обязательное | Описание |
|------|-----|--------------|----------|
| `type` | string | да | Всегда `"message"` |
| `text` | string | нет | Текст сообщения |
| `recipient_id` | string | нет | ID получателя (null для всех) |
| `files` | array | нет | Массив файлов |

---

##### Подтверждение прочтения (ACK)

```json
{
  "type": "ack",
  "message_id": "msg-uuid",
  "status": "read"
}
```

**Поля:**
| Поле | Тип | Обязательное | Описание |
|------|-----|--------------|----------|
| `type` | string | да | Всегда `"ack"` |
| `message_id` | string | да | ID сообщения |
| `status` | string | да | `"read"` или `"delivered"` |

---

##### Запрос истории сообщений

```json
{
  "type": "get_messages",
  "limit": 50,
  "before_id": "c6cb1fec-..."
}
```

**Поля:**
| Поле | Тип | Обязательное | Описание |
|------|-----|--------------|----------|
| `type` | string | да | Всегда `"get_messages"` |
| `limit` | integer | нет | Количество (по умолчанию 50, макс. 200) |
| `before_id` | string | нет | ID для пагинации |

---

##### Обновление профиля

```json
{
  "type": "update_profile",
  "text": "😎"
}
```

**Поля:**
| Поле | Тип | Обязательное | Описание |
|------|-----|--------------|----------|
| `type` | string | да | Всегда `"update_profile"` |
| `text` | string | да | Новый аватар |

---

#### Сервер → Клиент

##### Регистрация успешна

```json
{
  "type": "registered",
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Артём",
    "avatar": "👤"
  }
}
```

---

##### Новое сообщение

```json
{
  "type": "message",
  "message": {
    "id": "msg-uuid",
    "sender_id": "550e8400-e29b-41d4-a716-446655440000",
    "sender_name": "Артём",
    "text": "Привет!",
    "timestamp": 1699000000,
    "delivery_status": 1,
    "recipient_id": null,
    "files": []
  }
}
```

---

##### Подтверждение (ACK)

```json
{
  "type": "ack",
  "message_id": "msg-uuid",
  "status": "read",
  "sender_id": "660e8400-e29b-41d4-a716-446655440001"
}
```

---

##### История сообщений

```json
{
  "type": "messages",
  "messages": [...],
  "before_id": "c6cb1fec-...",
  "next_before_id": "msg-001",
  "limit": 50,
  "has_more": true
}
```

---

##### Пользователь онлайн/офлайн

```json
{
  "type": "user_online",
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "online": true
}
```

---

##### Профиль обновлён

```json
{
  "type": "user_updated",
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "avatar": "😎"
}
```

---

## 🔍 Обнаружение сервера в локальной сети

Клиент автоматически ищет сервер в локальной сети.

### Сканируемые диапазоны

Для каждой подсети проверяются адреса:
- `1-10` (обычно роутеры и серверы)
- `100-110` (обычно рабочие станции)

### Подсети:
- `192.168.1.x`
- `192.168.0.x`
- `192.168.88.x`
- `10.0.0.x`
- `10.0.1.x`

### Если сервер не найден

1. **Убедитесь что сервер запущен:**
   ```bash
   ./server/target/release/xam-server
   ```

2. **Проверьте firewall** (порт 8080 должен быть открыт)

   **Windows:** Откройте порт 8080 в брандмауэре (от имени администратора):
   ```powershell
   New-NetFirewallRule -DisplayName "XAM Messenger Server" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow
   ```

   **macOS:** Системные настройки → Защита и безопасность → Фаервол → Добавьте `xam-server`

   **Linux:**
   ```bash
   sudo ufw allow 8080/tcp
   ```

3. **Узнайте IP сервера:**
   ```bash
   # macOS
   ipconfig getifaddr en0

   # Linux
   hostname -I | awk '{print $1}'

   # Windows
   ipconfig | findstr IPv4
   ```

### mDNS (будущая реализация)

В будущем планируется добавить mDNS/Bonjour для автоматического обнаружения:
- Сервер регистрируется как `_xam-messenger._tcp.local`
- Клиент находит сервис через системный Bonjour/mDNS

---

## 📊 Статусы сообщений

| Статус | Значение | Когда |
|--------|----------|-------|
| ⏳ | Отправка | Ждём доставки |
| 🕐 | Отправлено | Сервер принял |
| ✓ | Доставлено | Получатель получил |
| ✓✓ | Прочитано | Получатель открыл чат |

---

## 🗄️ База данных

**Расположение:**
- **Linux:** `~/.config/xam-messenger/xam.db`
- **macOS:** `~/Library/Application Support/xam-messenger/xam.db`
- **Windows:** `%APPDATA%\xam-messenger\xam.db`

**Режим:** WAL (Write-Ahead Logging)

WAL mode включён по умолчанию при инициализации базы данных. Это обеспечивает:
- ✅ Читатели не блокируют писателей
- ✅ Писатели не блокируют читателей
- ✅ Лучшую производительность при конкурентной записи
- ✅ Автоматический checkpoint (сохранение)

**Дополнительные PRAGMA настройки:**
- `cache_size = -5000` — кэш 5MB для лучшей производительности
- `foreign_keys = ON` — поддержка внешних ключей (на будущее)

### Таблицы

#### users
```sql
CREATE TABLE users (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    avatar TEXT DEFAULT '👤'
);
```

#### messages
```sql
CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    sender_id TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    text TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    delivery_status INTEGER DEFAULT 0,
    recipient_id TEXT,
    files TEXT DEFAULT '[]'
);
```

#### files
```sql
CREATE TABLE files (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    size INTEGER NOT NULL,
    sender_id TEXT,
    recipient_id TEXT,
    timestamp INTEGER NOT NULL
);
```

---

## 🧪 Тестирование

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

### Интеграционные тесты

Интеграционные тесты требуют запущенного сервера:

```bash
# 1. Запустите сервер в отдельном терминале
cd server
./target/release/xam-server

# 2. В другом терминале запустите интеграционные тесты
cd ..
npm run test:integration
```

**Опции:**
```bash
# Тесты своего сервера
TEST_SERVER_URL=http://192.168.1.100:8080 npm run test:integration

# Все тесты сразу
npm run test:all
```

**Зависимости для интеграционных тестов:**
```bash
npm install --save-dev ws
```

### Покрытие тестами

- **Сервер (Rust):** 44 теста
- **Клиент (JavaScript):** 69 тестов
- **Покрытие:** ~80% бизнес-логики

---

## 🛠️ Для разработчиков

### Структура проекта

```
lan-messenger-tauri/
├── server/                 # Сервер (Rust + Actix)
│   ├── src/
│   │   └── main.rs        # Основной код сервера (~2100 строк)
│   ├── Cargo.toml         # Зависимости
│   └── target/release/    # Скомпилированный сервер
│
├── src/                    # Клиент (JavaScript/HTML/CSS)
│   ├── __tests__/         # Тесты
│   │   ├── app.test.js
│   │   ├── server-client.test.js
│   │   ├── integration.test.js
│   │   └── setup.js
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
│       ├── build-all.yml
│       ├── build-linux.yml
│       ├── build-macos.yml
│       ├── build-windows.yml
│       └── tests.yml
└── README.md
```

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

| Зависимость | Версия | Назначение |
|-------------|--------|------------|
| `actix-web` | 4 | Веб-фреймворк |
| `actix-ws` | 0.3 | WebSocket |
| `actix-cors` | 0.7 | CORS middleware |
| `actix-multipart` | 0.7 | Загрузка файлов |
| `tokio` | 1 | Async runtime |
| `serde` | 1 | Сериализация |
| `serde_json` | 1 | JSON |
| `rusqlite` | 0.31 | SQLite |
| `uuid` | 1 | Генерация ID |
| `chrono` | 0.4 | Время |
| `env_logger` | 0.11 | Логирование |

### Зависимости клиента

| Зависимость | Версия | Назначение |
|-------------|--------|------------|
| `jest` | 29.7 | Тестирование |
| `@testing-library/dom` | 9.3 | UI тесты |
| `eslint` | 8.57 | Линтинг |

### Логирование

```bash
# Отладочный режим
RUST_LOG=debug ./target/release/xam-server

# Только ошибки
RUST_LOG=error ./target/release/xam-server

# Полное логирование
RUST_LOG=trace ./target/release/xam-server
```

**Пример вывода:**
```
[2024-01-01T12:00:00Z INFO  xam_server] 🚀 XAM Server на 0.0.0.0:8080
[2024-01-01T12:00:01Z INFO  xam_server] ✅ Артём: 550e8400-e29b-41d4-a716-446655440000
[2024-01-01T12:00:02Z INFO  xam_server] 📩 Получено сообщение: text=Привет!, files=0
[2024-01-01T12:00:03Z INFO  xam_server] 📨 ACK read для msg-uuid от user-uuid
```
