# Документация XAM Messenger

Добро пожаловать в документацию XAM Messenger — корпоративного мессенджера для локальной сети.

## 📚 Разделы документации

| Документ | Описание |
|----------|----------|
| [📖 Руководство пользователя](GUIDE.md) | Быстрый старт, установка, настройка, использование |
| [🔌 API Документация](API.md) | Полное описание HTTP и WebSocket API |
| [🏗️ Архитектура](ARCHITECTURE.md) | Архитектура, база данных, mDNS, протоколы |
| [👨‍💻 Для разработчиков](DEVELOPMENT.md) | Сборка, тестирование, вклад в проект |

## 🚀 Быстрый старт

### 1. Запуск сервера
```bash
cd server
./target/release/xam-server
```

### 2. Запуск клиента
```bash
# В браузере
open src/index.html

# Или Tauri приложение
cd src-tauri && cargo tauri dev
```

### 3. Подключение
1. Введите ваше имя
2. Нажмите **"Войти"**
3. Сервер найдётся автоматически ✨

## 📦 Ресурсы

- [GitHub Repository](https://github.com/dev-lime/xam)
- [Issues](https://github.com/dev-lime/xam/issues)
- [Releases](https://github.com/dev-lime/xam/releases)

## 📋 Содержание

### Для пользователей
- [Установка](GUIDE.md#установка)
- [Настройка](GUIDE.md#настройка)
- [Использование](GUIDE.md#использование)
- [Статусы сообщений](GUIDE.md#статусы-сообщений)
- [Отправка файлов](GUIDE.md#отправка-файлов)
- [Решение проблем](GUIDE.md#решение-проблем)

### Для разработчиков
- [Структура проекта](DEVELOPMENT.md#структура-проекта)
- [Сборка сервера](DEVELOPMENT.md#сборка-сервера)
- [Сборка клиента](DEVELOPMENT.md#сборка-клиента)
- [Тестирование](DEVELOPMENT.md#тестирование)
- [Вклад в проект](DEVELOPMENT.md#вклад-в-проект)

### API
- [HTTP API](API.md#http-api)
- [WebSocket API](API.md#websocket-api)
- [Коды ошибок](API.md#коды-ошибок)

### Архитектура
- [Обзор](ARCHITECTURE.md#обзор)
- [База данных](ARCHITECTURE.md#база-данных)
- [mDNS обнаружение](ARCHITECTURE.md#mdns-обнаружение)
- [Безопасность](ARCHITECTURE.md#безопасность)
