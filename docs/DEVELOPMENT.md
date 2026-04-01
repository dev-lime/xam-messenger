# Разработка XAM Messenger

**Версия:** 1.0.0

---

## Содержание

- [Требования](#требования)
- [Структура проекта](#структура-проекта)
- [Сборка сервера](#сборка-сервера)
- [Сборка клиента](#сборка-клиента)
- [Тестирование](#тестирование)
- [Вклад в проект](#вклад-в-проект)

---

## Требования

### Минимальные версии

| Компонент | Версия |
|-----------|--------|
| **Rust** | 1.75+ |
| **Node.js** | 18+ |
| **Tauri** | 2.0+ |

### Зависимости

**Для сервера (Rust):**
- libsqlite3-dev
- pkg-config

**Для Tauri (Linux):**
```bash
sudo apt-get install \
    libwebkit2gtk-4.1-dev \
    build-essential \
    libssl-dev \
    libgtk-3-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev \
    libjavascriptcoregtk-4.1-dev \
    libsoup-3.0-dev
```

**Для Tauri (macOS):**
- Xcode Command Line Tools

**Для Tauri (Windows):**
- Visual Studio C++ Build Tools

---

## Структура проекта

```
lan-messenger-tauri/
├── server/                 # Сервер (Rust + Actix)
│   ├── src/
│   │   ├── main.rs        # Основной код сервера
│   │   ├── config.rs      # Конфигурация (.env)
│   │   ├── handlers.rs    # HTTP обработчики
│   │   ├── websocket.rs   # WebSocket обработчик
│   │   ├── db.rs          # Работа с БД
│   │   ├── models.rs      # Модели данных
│   │   └── error.rs       # Типы ошибок
│   ├── Cargo.toml         # Зависимости
│   ├── .env.example       # Пример конфигурации
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
│   │   └── main.rs        # Tauri бэкенд (mDNS)
│   ├── capabilities/
│   │   └── default.json   # Разрешения Tauri
│   ├── icons/             # Иконки приложения
│   ├── Cargo.toml         # Зависимости
│   └── tauri.conf.json    # Конфигурация Tauri
│
├── docs/                   # Документация
│   ├── README.md          # Оглавление
│   ├── API.md             # API документация
│   ├── GUIDE.md           # Руководство пользователя
│   ├── ARCHITECTURE.md    # Архитектура
│   └── DEVELOPMENT.md     # Этот файл
│
├── .github/workflows/     # CI/CD конфигурация
│   ├── tests.yml          # Тесты и линтинг
│   ├── build-all.yml      # Сборка всех платформ
│   ├── build-linux.yml    # Сборка Linux
│   ├── build-windows.yml  # Сборка Windows
│   └── build-macos.yml    # Сборка macOS
│
├── scripts/
│   ├── dev-server.js      # Dev сервер для разработки
│   └── cleanup-test-db.js # Очистка тестовой БД
│
├── LICENSE                # MIT License
├── package.json           # Node.js зависимости
└── README.md              # Краткое описание
```

---

## Сборка сервера

### Debug сборка

```bash
cd server
cargo build
```

### Release сборка

```bash
cd server
cargo build --release
```

Скомпилированный сервер: `server/target/release/xam-server`

### Запуск

```bash
# С настройками по умолчанию
./target/release/xam-server

# С переменными окружения
XAM_PORT=9000 RUST_LOG=debug ./target/release/xam-server

# С .env файлом
cp .env.example .env
# Отредактируйте .env
./target/release/xam-server
```

### Логирование

```bash
# Отладочный режим
RUST_LOG=debug ./target/release/xam-server

# Только ошибки
RUST_LOG=error ./target/release/xam-server

# Полное логирование
RUST_LOG=trace ./target/release/xam-server
```

---

## Сборка клиента

### Режим разработки (Tauri)

```bash
cd src-tauri
cargo tauri dev
```

### Release сборка (Tauri)

```bash
cd src-tauri
cargo tauri build
```

Скомпилированное приложение: `src-tauri/target/release/bundle/`

### Веб-клиент

Просто откройте `src/index.html` в браузере.

---

## Тестирование

### Тесты сервера (Rust)

```bash
cd server
cargo test
```

Тесты используют in-memory SQLite базу данных.

### Тесты клиента (JavaScript)

```bash
# Запустить все тесты
npm test

# Тесты в режиме watching
npm run test:watch

# Покрытие тестами
npm run test:coverage

# Очистка тестовой БД
npm run cleanup:test-db
```

### Интеграционные тесты

Требуют запущенного сервера:

```bash
# 1. Запустите сервер в отдельном терминале
cd server
./target/release/xam-server

# 2. В другом терминале запустите тесты
npm run test:integration
```

**С переменными окружения:**
```bash
TEST_SERVER_URL=http://192.168.1.100:8080 npm run test:integration
TEST_WS_URL=ws://192.168.1.100:8080/ws npm run test:integration
```

### Все тесты

```bash
npm run test:all
```

### Покрытие тестами

| Тип тестов | Количество | Покрытие |
|------------|------------|----------|
| Сервер (Rust) | 10+ тестов | ~85% |
| Клиент (JS) | 102 теста | ~80% |
| Интеграционные | 40+ тестов | E2E |

---

## Вклад в проект

### Ветвление

- `main` — основная ветка, стабильные релизы
- `develop` — разработка (если используется)
- `feature/*` — новые функции
- `bugfix/*` — исправления ошибок
- `release/*` — подготовка релиза

### Коммиты

Проект использует [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

**Типы:**
- `feat` — новая функция
- `fix` — исправление ошибки
- `docs` — документация
- `style` — форматирование
- `refactor` — рефакторинг
- `test` — тесты
- `chore` — обслуживание

**Примеры:**
```
feat(server): добавить rate limiting
fix(client): исправление утечки памяти в WebSocket
docs: обновить API документацию
refactor(db): оптимизация запросов к БД
```

### Pre-commit хуки

Проект использует `simple-git-hooks` для автоматической проверки перед коммитом:

```bash
# Установка хуков
npm install
npx simple-git-hooks

# Хуки запускают:
# - npm run lint (ESLint)
# - npm test (Jest тесты)
```

### CI/CD

**GitHub Actions автоматически:**

1. **При push/PR:**
   - Тесты сервера (Rust)
   - Тесты клиента (JavaScript)
   - Интеграционные тесты
   - Линтинг (ESLint, clippy, fmt)

2. **При создании тега (v*):**
   - Сборка под все платформы
   - Создание GitHub Release

### Создание релиза

```bash
# 1. Увеличьте версию в:
#    - server/Cargo.toml
#    - src-tauri/Cargo.toml
#    - package.json

# 2. Закоммитьте изменения
git add -A
git commit -m "chore: release v1.0.0"

# 3. Создайте тег
git tag v1.0.0
git push origin v1.0.0

# 4. CI/CD автоматически создаст релиз
```

---

## Отладка

### Сервер

```bash
# Запуск с отладочным логом
RUST_LOG=debug ./target/release/xam-server

# Логирование только модуля
RUST_LOG=xam_server=debug,actix_web=info ./target/release/xam-server
```

### Клиент

Откройте DevTools в браузере (F12) для просмотра консоли.

### Tauri

```bash
# Запуск с DevTools
cargo tauri dev

# В приложении: Ctrl+Shift+I (Cmd+Opt+I на macOS)
```

---

## Полезные команды

```bash
# Проверка форматирования Rust
cargo fmt --check

# Автоматическое форматирование
cargo fmt

# Проверка кода (clippy)
cargo clippy -- -D warnings

# Проверка клиента (ESLint)
npm run lint

# Авто-исправление ESLint
npm run lint:fix

# Очистка артефактов
cargo clean
rm -rf node_modules
```

---

## Поддержка

- [Документация](README.md)
- [API Документация](../docs/API.md)
- [Руководство пользователя](../docs/GUIDE.md)
- [Архитектура](../docs/ARCHITECTURE.md)
- [Issues](https://github.com/dev-lime/xam/issues)
