# XAM Messenger

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Tests](https://github.com/dev-lime/xam/actions/workflows/tests.yml/badge.svg)](https://github.com/dev-lime/xam/actions/workflows/tests.yml)
[![Release](https://img.shields.io/github/v/release/dev-lime/xam)](https://github.com/dev-lime/xam/releases)

Корпоративный мессенджер для локальной сети с поддержкой файлов и статусов доставки.

---

## 🔥 Особенности

- 🔒 **Только локальная сеть** — без интернета, полная приватность
- 🚀 **Быстрый старт** — авто-обнаружение сервера (mDNS)
- 📁 **Файлообмен** — отправка файлов до 100MB
- ✓✓ **Статусы** — отправлено / доставлено / прочитано
- 💾 **История** — SQLite для хранения сообщений
- 🖥️ **Универсальный клиент** — браузер + Tauri приложение

---

## 📚 Документация

| Документ | Описание |
|----------|----------|
| [📖 Руководство пользователя](docs/GUIDE.md) | Установка, настройка, использование |
| [🔌 API Документация](docs/API.md) | HTTP и WebSocket API |
| [🏗️ Архитектура](docs/ARCHITECTURE.md) | Архитектура, БД, mDNS, протоколы |
| [👨‍💻 Для разработчиков](docs/DEVELOPMENT.md) | Сборка, тестирование, вклад в проект |

---

## 🚀 Быстрый старт

### 1. Запуск сервера

```bash
cd server
cargo build --release
./target/release/xam-server
```

### 2. Запуск клиента

**Браузер:** откройте `src/index.html`

**Tauri приложение:**
```bash
cd src-tauri && cargo tauri dev
```

### 3. Подключение

Введите имя → нажмите **"Войти"** → сервер найдётся автоматически ✨

---

## 📦 Установка

Скачайте готовую сборку из [Releases](https://github.com/dev-lime/xam/releases):

| Платформа | Файл |
|-----------|------|
| **Windows** | `.msi`, `.exe` (portable) |
| **Linux** | `.deb`, `.rpm`, `.AppImage` |
| **macOS** | `.dmg` (Universal) |

---

## 🧪 Тесты

```bash
cd server && cargo test       # Сервер (21 тест ✅)
npm test                      # Клиент (198 тестов ✅)
npm run test:integration      # Интеграционные
```

---

## 🛠️ Стек

**Сервер:** Rust, Actix-web, SQLite, mDNS-SD
**Клиент:** Vanilla JS, WebSocket API
**Tauri:** tokio-tungstenite (нативный WebSocket)

---

## 📄 Лицензия

MIT — см. [LICENSE](LICENSE).
