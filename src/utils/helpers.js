/**
 * @file Вспомогательные функции для XAM Messenger
 * @module Utils/Helpers
 */

'use strict';

// ============================================================================
// Utility функции
// ============================================================================

/**
 * Экранирование HTML для безопасного отображения
 * @param {string} text - Текст для экранирования
 * @returns {string} Экранированный текст
 */
export function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Экранирование строки для безопасного использования в JS-контексте
 * @param {string} text - Текст для экранирования
 * @returns {string} Экранированный текст
 */
export function escapeJsString(text) {
    return text
        .replace(/\\/g, '\\\\')
        .replace(/'/g, '\\x27')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Форматирование размера файла
 * @param {number} bytes - Размер в байтах
 * @returns {string} Отформатированный размер
 */
export function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Получение иконки файла по расширению
 * @param {string} filename - Имя файла
 * @returns {string} Эмодзи-иконка
 */
export function getFileIcon(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const icons = {
        pdf: '📄',
        doc: '📝', docx: '📝',
        xls: '📊', xlsx: '📊',
        ppt: '📊', pptx: '📊',
        txt: '📄',
        jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', bmp: '🖼️', svg: '🖼️',
        mp3: '🎵', wav: '🎵', ogg: '🎵',
        mp4: '🎬', avi: '🎬', mkv: '🎬', mov: '🎬',
        zip: '📦', rar: '📦', '7z': '📦', tar: '📦', gz: '📦',
        exe: '⚙️', msi: '⚙️', deb: '⚙️', rpm: '⚙️',
        js: '📜', ts: '📜', py: '📜', java: '📜', cpp: '📜', c: '📜', h: '📜',
        html: '🌐', css: '🎨', json: '📋', xml: '📋', yaml: '📋', yml: '📋',
        md: '📝', rtf: '📄',
    };
    return icons[ext] || '📎';
}

// ============================================================================
// Конфигурация приложения (загружается из JSON с fallback)
// ============================================================================

/** @type {Object|null} */
let loadedConfig = null;

/**
 * Загрузить конфигурацию из JSON файла
 * @returns {Promise<Object>}
 */
export async function loadClientConfig() {
    if (loadedConfig) return loadedConfig;
    try {
        if (typeof fetch === 'function') {
            const response = await fetch('config.client.json');
            if (response.ok) {
                loadedConfig = await response.json();
            }
        }
    } catch {
        // Fallback на встроенные значения
    }
    loadedConfig = loadedConfig || getDefaultConfig();
    return loadedConfig;
}

/**
 * Получить конфигурацию синхронно (использует уже загруженное или дефолтное)
 * @returns {Object}
 */
function getDefaultConfig() {
    return {
        maxFileSize: 100 * 1024 * 1024,
        localMessageTtl: 10,
        avatarDefault: '👤',
        defaultLanguage: 'ru',
        storageKeys: {
            userSettings: 'xam-user-settings',
            appSettings: 'xam-app-settings',
            lastMessageId: 'xam-last-message-id',
            hasMore: 'xam-has-more',
            sessionUser: 'xam-session-user',
            sessionServer: 'xam-session-server',
        },
        wsConfig: {
            reconnectDelay: 2000,
            maxReconnectAttempts: 10,
            connectionTimeout: 3000,
            mdnsTimeout: 3000,
            scanTimeout: 3000,
        },
        scanConfig: {
            port: 8080,
            ipStartMin: 1,
            ipStartMax: 10,
            ipEndMin: 100,
            ipEndMax: 110,
        },
        uiConfig: {
            messagePageSize: 50,
            searchDebounceMs: 150,
            peerAnimationDelayMs: 50,
        },
    };
}

/**
 * Конфигурация приложения (синхронная, использует дефолтные значения)
 * Загрузка из config.client.json происходит асинхронно через loadClientConfig()
 */
export const CONFIG = {
    MAX_FILE_SIZE: 100 * 1024 * 1024, // 100MB
    LOCAL_MESSAGE_TTL: 10, // секунд для поиска локального сообщения
    AVATAR_DEFAULT: '👤',
    STORAGE_KEYS: {
        USER_SETTINGS: 'xam-user-settings',
        APP_SETTINGS: 'xam-app-settings',
        LAST_MESSAGE_ID: 'xam-last-message-id',
        HAS_MORE: 'xam-has-more',
        SESSION_USER: 'xam-session-user',
        SESSION_SERVER: 'xam-session-server',
    },
};

/**
 * Статусы доставки сообщений
 */
export const DELIVERY_STATUS = {
    SENT: 0,        // сервер принял
    DELIVERED: 1,   // клиент получил
    READ: 2,        // клиент прочитал
};

/**
 * Иконки статусов доставки
 */
export const STATUS_ICONS = {
    SENT: '🕐',      // круглые часы
    DELIVERED: '✓', // одна галочка
    READ: '✓✓',     // две галочки
};
