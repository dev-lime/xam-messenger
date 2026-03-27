#!/bin/bash
# Запуск сервера XAM Messenger

echo "🚀 XAM Messenger Server"
echo "======================"
echo ""

cd "$(dirname "$0")"

# Проверяем, собран ли сервер
if [ ! -f "./target/release/xam-server" ]; then
    echo "📦 Сборка сервера..."
    cargo build --release
fi

echo "📡 Запуск на порту 8080..."
echo "💾 База данных: ~/.config/xam-messenger/xam.db"
echo ""
echo "✅ Сервер готов!"
echo "   Клиент автоматически найдёт сервер."
echo ""
echo "Нажмите Ctrl+C для остановки"
echo ""

./target/release/xam-server
