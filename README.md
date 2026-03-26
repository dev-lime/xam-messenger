# 💬 Xam Messenger

LAN-мессенджер на Tauri + Rust для общения в локальной сети.

## 🚀 Возможности

- Обмен сообщениями в LAN
- История переписок (JSONL)
- Статусы: ⏳ Отправлено → ✓ Доставлено → ✓✓ Прочитано
- Список последних контактов
- Копирование сообщений по клику

## 📦 Быстрый старт

### Установка Rust
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### Зависимости

**Ubuntu/Debian:**
```bash
sudo apt install libwebkit2gtk-4.0-dev build-essential libssl-dev libgtk-3-dev
```

**macOS:**
```bash
xcode-select --install
```

**Windows:** [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)

### Запуск
```bash
cd lan-messenger-tauri/src-tauri
cargo tauri dev
```

### Сборка
```bash
cargo tauri build
```

### Сборка для Linux (из macOS/Windows)
```bash
# Через Docker
./build-linux.sh

# Или вручную на Linux машине:
sudo apt install libwebkit2gtk-4.0-dev build-essential libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
cargo tauri build
```

**Результат:**
- `.deb` пакет для Debian/Ubuntu
- `.AppImage` для остальных дистрибутивов

## 🎮 Использование

### На одном ПК (тест)
| Экземпляр | Порт | IP собеседника |
|-----------|------|----------------|
| 1 | 8080 | 127.0.0.1:8081 |
| 2 | 8081 | 127.0.0.1:8080 |

### На разных ПК
| Компьютер | Порт | IP собеседника |
|-----------|------|----------------|
| 1 | 8080 | (пусто) |
| 2 | 8081 | 192.168.1.100:8080 |

## 📁 Хранение данных

```
macOS: ~/Library/Application Support/xam-messenger/history/
Linux: ~/.config/xam-messenger/history/
Windows: %APPDATA%\xam-messenger\history\
```

Формат: JSONL (один JSON на строку)

## ⌨️ Горячие клавиши

| Клавиша | Действие |
|---------|----------|
| Enter | Отправить |
| Ctrl+Enter | Новая строка |
| Клик на сообщение | Копировать |
| Клик на профиль | Настройки |

## 📊 Статусы сообщений

| Статус | Значение |
|--------|----------|
| ⏳ | Отправлено |
| ✓ | Доставлено собеседнику |
| ✓✓ | Прочитано собеседником |

## 🔧 Сборка

```bash
# Windows
cargo tauri build

# Linux
cargo tauri build

# macOS (Intel + Apple Silicon)
cargo tauri build --target universal-apple-darwin
```

Размер: ~10-15 MB

---

**Учебный проект для LAN. Без шифрования.**
