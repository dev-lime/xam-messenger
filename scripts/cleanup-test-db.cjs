#!/usr/bin/env node

/**
 * Скрипт для очистки тестовой базы данных
 * 
 * Используется для удаления тестовых данных после интеграционных тестов
 * 
 * Использование:
 *   node scripts/cleanup-test-db.js
 * 
 * Или для конкретной ОС:
 *   node scripts/cleanup-test-db.js --os macos
 *   node scripts/cleanup-test-db.js --os windows
 *   node scripts/cleanup-test-db.js --os linux
 */

const fs = require('fs');
const path = require('path');

const DB_CONFIGS = {
    darwin: {
        name: 'macOS',
        dbPath: process.env.HOME ? path.join(process.env.HOME, 'Library', 'Application Support', 'xam-messenger', 'xam.db') : null,
        filesPath: process.env.HOME ? path.join(process.env.HOME, 'Library', 'Application Support', 'xam-messenger', 'files') : null,
    },
    win32: {
        name: 'Windows',
        dbPath: process.env.APPDATA ? path.join(process.env.APPDATA, 'xam-messenger', 'xam.db') : null,
        filesPath: process.env.APPDATA ? path.join(process.env.APPDATA, 'xam-messenger', 'files') : null,
    },
    linux: {
        name: 'Linux',
        dbPath: process.env.HOME ? path.join(process.env.HOME, '.config', 'xam-messenger', 'xam.db') : null,
        filesPath: process.env.HOME ? path.join(process.env.HOME, '.config', 'xam-messenger', 'files') : null,
    },
};

function cleanup(os) {
    const platform = os || process.platform;
    const config = DB_CONFIGS[platform];

    if (!config) {
        console.error(`❌ Неизвестная ОС: ${platform}`);
        process.exit(1);
    }

    console.log(`🧹 Очистка тестовых данных для ${config.name}...`);

    let deletedCount = 0;

    // Удаляем базу данных
    if (config.dbPath && fs.existsSync(config.dbPath)) {
        try {
            fs.unlinkSync(config.dbPath);
            console.log(`✅ Удалена БД: ${config.dbPath}`);
            deletedCount++;
        } catch (error) {
            console.error(`❌ Ошибка удаления БД: ${error.message}`);
        }
    } else if (!config.dbPath) {
        console.log(`ℹ️  Путь к БД не определён`);
    } else {
        console.log(`ℹ️  БД не найдена: ${config.dbPath}`);
    }

    // Удаляем папку с файлами
    if (config.filesPath && fs.existsSync(config.filesPath)) {
        try {
            fs.rmSync(config.filesPath, { recursive: true, force: true });
            console.log(`✅ Удалена папка с файлами: ${config.filesPath}`);
            deletedCount++;
        } catch (error) {
            console.error(`❌ Ошибка удаления папки: ${error.message}`);
        }
    } else {
        console.log(`ℹ️  Папка с файлами не найдена: ${config.filesPath}`);
    }
    
    if (deletedCount > 0) {
        console.log(`\n✅ Очистка завершена. Удалено объектов: ${deletedCount}`);
    } else {
        console.log('\nℹ️  Нечего удалять. Тестовые данные отсутствуют.');
    }
}

// Парсинг аргументов командной строки
const args = process.argv.slice(2);
const osArg = args.find(arg => arg.startsWith('--os='));
const osValue = osArg ? osArg.split('=')[1] : null;

cleanup(osValue);
