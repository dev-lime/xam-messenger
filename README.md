# XAM Messenger

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Tests](https://github.com/dev-lime/xam/actions/workflows/tests.yml/badge.svg)](https://github.com/dev-lime/xam/actions/workflows/tests.yml)
[![Release](https://img.shields.io/github/v/release/dev-lime/xam)](https://github.com/dev-lime/xam/releases)

Корпоративный мессенджер для локальной сети с поддержкой файлов и статусов доставки.

**Версия:** 1.0.0  
**Минимальные версии:** Rust 1.75+, Node.js 18+, Tauri 2.0+

---

## 🔥 Особенности

- 🔒 **Только локальная сеть** — без интернета, полная приватность
- 🚀 **Быстрый старт** — авто-обнаружение сервера (mDNS)
- 📁 **Файлообмен** — отправка файлов до 100MB
- ✓✓ **Статусы** — доставлено / прочитано
- 💾 **История** — SQLite для хранения сообщений
- 🖥️ **Универсальный клиент** — браузер + Tauri приложение

---

## 📚 Документация

Полная документация доступна в разделе [docs/](docs/):

| Документ | Описание |
|----------|----------|
| [📖 Руководство пользователя](docs/GUIDE.md) | Установка, настройка, использование |
| [🔌 API Документация](docs/API.md) | Полное описание HTTP и WebSocket API |
| [🏗️ Архитектура](docs/ARCHITECTURE.md) | Архитектура, база данных, mDNS |
| [👨‍💻 Для разработчиков](docs/DEVELOPMENT.md) | Сборка, тестирование, вклад в проект |

---

## 🚀 Быстрый старт

### 1. Запуск сервера

```bash
cd server
./target/release/xam-server
```

### 2. Запуск клиента

**В браузере:**
```bash
open src/index.html
```

**Tauri приложение (десктоп):**
```bash
cd src-tauri
cargo tauri dev
```

### 3. Подключение

1. Введите ваше имя
2. Нажмите **"Войти"**
3. Сервер найдётся автоматически ✨

---

## 📦 Установка

Скачайте готовую сборку для вашей платформы из [Releases](https://github.com/dev-lime/xam/releases):

| Платформа | Файл |
|-----------|------|
| **Windows** | `.msi` (установщик), `.exe` (portable) |
| **Linux** | `.deb`, `.rpm`, `.AppImage` |
| **macOS** | `.dmg` (Intel + Apple Silicon) |

---

## 🏗️ Архитектура

```
┌─────────────────────────────────────┐
│  Сервер (порт 8080)                 │
│  ┌───────────────────────────────┐  │
│  │ WebSocket /ws                 │  │
│  │ HTTP API /api/v1/*            │  │
│  │ SQLite                        │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
              ▲
              │ WebSocket + HTTP
    ┌─────────┼─────────┐
    │         │         │
┌───▼───┐ ┌───▼───┐ ┌───▼───┐
│Браузер│ │Браузер│ │ Tauri │
└───────┘ └───────┘ └───────┘
```

---

## 🧪 Тестирование

```bash
# Тесты сервера (Rust)
cd server && cargo test

# Тесты клиента (JavaScript)
npm test

# Интеграционные тесты (требуется сервер)
npm run test:integration

# Все тесты
npm run test:all
```

**Покрытие:** ~80% бизнес-логики

---

## 🛠️ Технологии

### Сервер (Rust)
- Actix-web 4, Actix-ws 0.3
- Rusqlite 0.31 (SQLite WAL)
- mDNS-SD 0.13 (авто-обнаружение)
- Tokio 1 (async runtime)

### Клиент (JavaScript)
- Vanilla JS (без фреймворков)
- WebSocket API, Fetch API
- Jest + Testing Library (тесты)

### Tauri
- Tauri 2.0
- Rust бэкенд для mDNS

---

## 📋 Конфигурация

Сервер поддерживает переменные окружения:

| Переменная | По умолчанию | Описание |
|------------|--------------|----------|
| `XAM_HOST` | `0.0.0.0` | Хост для прослушивания |
| `XAM_PORT` | `8080` | Порт |
| `XAM_DB_PATH` | `~/.config/xam-messenger/xam.db` | Путь к БД |
| `MAX_FILE_SIZE` | `104857600` | Макс. размер файла (100MB) |
| `RUST_LOG` | `info` | Уровень логирования |

**Пример:**
```bash
XAM_PORT=9000 RUST_LOG=debug ./target/release/xam-server
```

См. [server/.env.example](server/.env.example) для полного списка.

---

## 🤝 Вклад в проект

```bash
# Форкните репозиторий
git clone https://github.com/dev-lime/xam.git

# Установите зависимости
npm install

# Настройте pre-commit хуки
npx simple-git-hooks

# Запустите сервер
cd server && cargo build --release && ./target/release/xam-server
```

Подробнее в [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

---

## 📄 Лицензия

MIT License — см. файл [LICENSE](LICENSE).

---

## 🔗 Ссылки

- [GitHub Repository](https://github.com/dev-lime/xam)
- [Issues](https://github.com/dev-lime/xam/issues)
- [Releases](https://github.com/dev-lime/xam/releases)
- [Документация](docs/)
