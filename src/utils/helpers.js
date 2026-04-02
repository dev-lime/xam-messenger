/**
 * @file Вспомогательные функции для XAM Messenger
 * @module Utils/Helpers
 */

'use strict';

/**
 * Экранирование HTML для безопасного отображения
 * @param {string} text - Текст для экранирования
 * @returns {string} Экранированный текст
 */
export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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

/**
 * Конфигурация приложения
 */
export const CONFIG = {
    MAX_FILE_SIZE: 100 * 1024 * 1024, // 100MB
    LOCAL_MESSAGE_TTL: 10, // секунд для поиска локального сообщения
    AVATAR_DEFAULT: '👤',
    STORAGE_KEYS: {
        USER_SETTINGS: 'xam-user-settings',
        LAST_MESSAGE_ID: 'xam-last-message-id',
        HAS_MORE: 'xam-has-more',
    },
};

/**
 * Статусы доставки сообщений
 */
export const DELIVERY_STATUS = {
    SENDING: 0,
    SENT: 1,
    READ: 2,
};

/**
 * Иконки статусов доставки
 */
export const STATUS_ICONS = {
    SENDING: '⏳',
    SENT: '✓',
    READ: '✓✓',
    PENDING: '🕐',
};
