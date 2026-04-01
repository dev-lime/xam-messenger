# Архитектура XAM Messenger

**Версия:** 1.0.0

---

## Содержание

- [Обзор](#обзор)
- [Компоненты](#компоненты)
- [База данных](#база-данных)
- [mDNS обнаружение](#mdns-обнаружение)
- [Протоколы](#протоколы)
- [Безопасность](#безопасность)

---

## Обзор

XAM Messenger использует клиент-серверную архитектуру:

```
┌─────────────────────────────────────┐
│  Сервер (порт 8080)                 │
│  ┌───────────────────────────────┐  │
│  │ WebSocket /ws                 │  │
│  │ • Сообщения в реальном времени│  │
│  │ • Статусы доставки            │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │ HTTP API /api/v1/*            │  │
│  │ • /api/v1/register            │  │
│  │ • /api/v1/users               │  │
│  │ • /api/v1/messages            │  │
│  │ • /api/v1/files               │  │
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

---

## Компоненты

### Сервер (Rust)

**Технологии:**
- Actix-web 4 — веб-фреймворк
- Actix-ws 0.3 — WebSocket
- Rusqlite 0.31 — SQLite
- Tokio 1 — async runtime
- mDNS-SD 0.13 — обнаружение сервисов

**Модули:**
```
server/src/
├── main.rs        # Точка входа, настройка сервера
├── config.rs      # Конфигурация (.env, переменные окружения)
├── handlers.rs    # HTTP обработчики
├── websocket.rs   # WebSocket обработчик
├── db.rs          # Работа с базой данных
├── models.rs      # Модели данных
└── error.rs       # Типы ошибок
```

### Клиент (JavaScript)

**Технологии:**
- Vanilla JavaScript (без фреймворков)
- WebSocket API
- Fetch API

**Модули:**
```
src/
├── index.html         # Главная страница
├── app.js             # Основная логика приложения
├── server-client.js   # WebSocket/HTTP клиент
└── styles.css         # Стили
```

### Tauri приложение

**Технологии:**
- Tauri 2 — десктопный фреймворк
- Rust — бэкенд для mDNS

**Функции:**
- Нативное mDNS обнаружение
- Доступ к файловой системе
- Системные уведомления

---

## База данных

**Движок:** SQLite 3  
**Режим:** WAL (Write-Ahead Logging)

### Расположение

| ОС | Путь |
|----|------|
| **Linux** | `~/.config/xam-messenger/xam.db` |
| **macOS** | `~/Library/Application Support/xam-messenger/xam.db` |
| **Windows** | `%APPDATA%\xam-messenger\xam.db` |

### Схема БД

#### users

```sql
CREATE TABLE users (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    avatar TEXT DEFAULT '👤'
);
```

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | TEXT | UUID пользователя |
| `name` | TEXT | Уникальное имя |
| `avatar` | TEXT | Эмодзи-аватар |

---

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

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | TEXT | UUID сообщения |
| `sender_id` | TEXT | ID отправителя |
| `sender_name` | TEXT | Имя отправителя |
| `text` | TEXT | Текст сообщения |
| `timestamp` | INTEGER | Unix timestamp (секунды) |
| `delivery_status` | INTEGER | 0=отправка, 1=отправлено, 2=прочитано |
| `recipient_id` | TEXT | ID получателя (null для всех) |
| `files` | TEXT | JSON массив файлов |

---

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

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | TEXT | UUID файла |
| `name` | TEXT | Имя файла |
| `path` | TEXT | Путь к файлу |
| `size` | INTEGER | Размер в байтах |
| `sender_id` | TEXT | ID отправителя |
| `recipient_id` | TEXT | ID получателя |
| `timestamp` | INTEGER | Unix timestamp |

---

### PRAGMA настройки

```sql
PRAGMA journal_mode = WAL;      -- WAL режим
PRAGMA cache_size = -5000;      -- Кэш 5MB
PRAGMA foreign_keys = ON;       -- Внешние ключи
```

---

## mDNS обнаружение

### Протокол

**Сервис:** `_xam-messenger._tcp.local`  
**Порт:** 8080  
**TXT записи:**
- `version=1.0.0`
- `protocol=ws`

### Приоритет обнаружения

1. **mDNS (Bonjour)** — автоматическое обнаружение
2. **Кэш** — ранее подключённые серверы (TTL 24 часа)
3. **IP-сканирование** — перебор подсетей
4. **Ручной ввод** — указание адреса вручную

### Сканируемые подсети

| Подсеть | Диапазоны |
|---------|-----------|
| `192.168.1.x` | 1-10, 100-110 |
| `192.168.0.x` | 1-10, 100-110 |
| `192.168.88.x` | 1-10, 100-110 |
| `192.168.2.x` | 1-10, 100-110 |
| `192.168.10.x` | 1-10, 100-110 |
| `10.0.0.x` | 1-10, 100-110 |
| `10.0.1.x` | 1-10, 100-110 |
| `10.0.2.x` | 1-10, 100-110 |
| `172.16.0.x` | 1-10, 100-110 |
| `172.16.1.x` | 1-10, 100-110 |

### Проверка mDNS

**macOS:**
```bash
# Поиск сервисов
dns-sd -B _xam-messenger._tcp

# Или через Bonjour Browser
open /System/Applications/Utilities/Network\ Utility.app
```

**Linux (требуется avahi):**
```bash
avahi-browse _xam-messenger._tcp -r
```

---

## Протоколы

### WebSocket

**URL:** `ws://<server>:8080/ws`

**Формат сообщений:** JSON

**Типы сообщений:**
- `register` — регистрация
- `message` — отправка сообщения
- `ack` — подтверждение прочтения
- `get_messages` — запрос истории
- `update_profile` — обновление профиля

**Ответы сервера:**
- `registered` — успешная регистрация
- `message` — новое сообщение
- `ack` — подтверждение
- `messages` — история сообщений
- `user_online` / `user_updated` — статусы пользователей

### HTTP API

**Базовый URL:** `http://<server>:8080/api/v1`

**Эндпоинты:**
- `POST /api/v1/register` — регистрация
- `GET /api/v1/users` — список пользователей
- `GET /api/v1/messages` — история сообщений
- `GET /api/v1/online` — пользователи онлайн
- `POST /api/v1/files` — загрузка файла
- `GET /api/v1/files/download` — скачивание файла

---

## Безопасность

### Текущая реализация

| Аспект | Реализация |
|--------|------------|
| **CSP** | Включён (tauri.conf.json) |
| **CORS** | Разрешены все origin (настраивается) |
| **Валидация** | Проверка входных данных |
| **Rate Limiting** | Настраивается через `RATE_LIMIT` |

### Рекомендации для продакшена

1. **Ограничить CORS:**
   ```env
   CORS_ORIGINS=https://example.com,https://app.example.com
   ```

2. **Включить rate limiting:**
   ```env
   RATE_LIMIT=50
   ```

3. **Использовать HTTPS/WSS** (через reverse proxy):
   ```
   nginx → https://example.com → http://localhost:8080
   ```

4. **Настроить firewall:**
   - Разрешить только локальную сеть
   - Заблокировать внешний доступ

### Ограничения

- ⚠️ Нет аутентификации (только имя пользователя)
- ⚠️ Нет шифрования сообщений (только LAN)
- ⚠️ Нет защиты от спама

**Проект предназначен для использования в доверенной локальной сети.**

---

## Масштабирование

### Текущие ограничения

| Параметр | Значение |
|----------|----------|
| Макс. пользователей | ~1000 (ограничено SQLite) |
| Макс. сообщений в истории | Неограниченно (пагинация) |
| Макс. размер файла | 100MB (настраивается) |
| Макс. подключений WebSocket | Зависит от системы |

### Рекомендации для больших развёртываний

1. **Разделение БД:** Использовать PostgreSQL вместо SQLite
2. **Кэширование:** Redis для онлайн-статусов
3. **Горизонтальное масштабирование:** Несколько серверов с балансировкой
4. **Шардирование:** Разделение по комнатам/каналам

---

## Поддержка

- [GitHub Repository](https://github.com/dev-lime/xam)
- [Issues](https://github.com/dev-lime/xam/issues)
- [API Документация](API.md)
