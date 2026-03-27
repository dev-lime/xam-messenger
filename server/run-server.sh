#!/bin/bash
# Запуск сервера XAM Messenger

echo "🚀 Запуск XAM Server..."
cd "$(dirname "$0")"

# Проверяем, собран ли сервер
if [ ! -f "./target/release/xam-server" ]; then
    echo "📦 Первая сборка (это займёт время)..."
    cargo build --release
fi

# Запускаем сервер
echo "📡 Сервер будет доступен на http://0.0.0.0:8080"
echo "💾 База данных: ~/.config/xam-messenger/xam-messenger.db"
echo ""
echo "📋 Команды:"
echo "  - Регистрация: POST /api/register {\"name\": \"Имя\"}"
echo "  - WebSocket: ws://localhost:8080/ws"
echo "  - Пользователи: GET /api/users"
echo "  - Сообщения: GET /api/messages?limit=100"
echo ""
echo "Нажмите Ctrl+C для остановки"
echo ""

./target/release/xam-server
