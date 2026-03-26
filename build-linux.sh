#!/bin/bash
# Сборка Xam Messenger для Linux через Docker

set -e

echo "🐋 Сборка Xam Messenger для Linux..."

# Переходим в директорию проекта
cd "$(dirname "$0")"

# Собираем Docker образ
echo "📦 Создание Docker образа..."
docker build -f Dockerfile.linux -t xam-messenger-linux .

# Запускаем контейнер для сборки
echo "🔨 Сборка приложения..."
docker run --rm -v "$(pwd)/src-tauri/target:/app/src-tauri/target" xam-messenger-linux

# Копируем результат
echo "📥 Копирование результатов..."
mkdir -p ./linux-build
docker run --rm -v "$(pwd)/linux-build:/output" xam-messenger-linux cp -r /app/src-tauri/target/release/bundle/* /output/

echo "✅ Сборка завершена!"
echo "📁 Файлы в: ./linux-build/"
echo ""
echo "Для установки:"
echo "  Debian/Ubuntu: sudo dpkg -i linux-build/deb/xam-messenger_*.deb"
echo "  Или: linux-build/appimage/xam-messenger_*.AppImage"
