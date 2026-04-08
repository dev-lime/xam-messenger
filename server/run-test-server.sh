#!/bin/bash
# Wrapper для запуска сервера с переменными окружения для тестов
# Читает .env и экспортирует переменные перед запуском бинарника

cd "$(dirname "$0")"

if [ -f ".env" ]; then
    set -a
    source .env
    set +a
fi

exec ./target/release/xam-server "$@"
