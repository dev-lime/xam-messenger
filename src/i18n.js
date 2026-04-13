/**
 * @file Интернационализация (ru/en)
 * Загружает переводы из JSON файлов с fallback на встроенные данные для тестов
 * @module i18n
 */

'use strict';

import { storage } from './storage.js';

const STORAGE_KEY = 'xam-language';

/** @type {Object<string, Object<string, string>>} */
let translations = {};

/** @type {boolean} */
let translationsLoaded = false;

/**
 * Загрузка переводов из JSON файлов
 * @returns {Promise<void>}
 */
export async function loadTranslations() {
    try {
        const fetchJSON = async (url) => {
            if (typeof fetch !== 'function') return null;
            const response = await fetch(url);
            if (!response || !response.ok) return null;
            return response.json();
        };

        const [ru, en] = await Promise.all([
            fetchJSON('locales/ru.json').catch(() => null),
            fetchJSON('locales/en.json').catch(() => null),
        ]);

        if (ru) translations.ru = ru;
        if (en) translations.en = en;

        // Fallback на встроенные данные если JSON не загрузились (тесты)
        if (!translations.ru) translations.ru = getFallbackTranslations('ru');
        if (!translations.en) translations.en = getFallbackTranslations('en');

        translationsLoaded = true;
    } catch (e) {
        console.warn('⚠️ Ошибка загрузки переводов, используем fallback:', e);
        translations.ru = getFallbackTranslations('ru');
        translations.en = getFallbackTranslations('en');
        translationsLoaded = true;
    }
}

/**
 * Обработка placeholder'ов в строке перевода
 * @param {string} str - Строка с {{placeholder}}
 * @param {Object} params - Параметры для замены
 * @returns {string}
 */
function processPlaceholders(str, params) {
    if (!params) return str;
    return str.replace(/\{\{(\w+)\}\}/g, (match, key) => {
        return params[key] !== undefined ? params[key] : match;
    });
}

let currentLang = 'ru';

/**
 * Получить перевод
 * @param {string} key - Ключ перевода
 * @param  {...any} args - Параметры для placeholder'ов или позиционные аргументы
 * @returns {string}
 */
export function t(key, ...args) {
    const dict = translations[currentLang] || translations.ru || {};
    const value = dict[key];
    if (value === undefined) {
        const fallback = (translations.ru || {})[key];
        if (fallback === undefined) return key;
        return resolveTranslationValue(fallback, args);
    }
    return resolveTranslationValue(value, args);
}

/**
 * Распознать значение перевода (строка или функция через placeholder)
 * @param {string} value - Значение перевода
 * @param {Array} args - Аргументы
 * @returns {string}
 */
function resolveTranslationValue(value, args) {
    if (typeof value !== 'string') return value;
    // Определяем placeholder'ы по именам в строке
    const placeholders = value.match(/\{\{(\w+)\}\}/g);
    if (placeholders && args.length > 0) {
        // Если аргументов больше 1 и есть именованные placeholder'ы,
        // используем первый аргумент как объект params
        if (args.length === 1 && typeof args[0] === 'object') {
            return processPlaceholders(value, args[0]);
        }
        // Fallback: подставляем аргументы по порядку (для обратной совместимости)
        const keys = placeholders.map(p => p.replace(/\{\{|\}\}/g, ''));
        const params = {};
        keys.forEach((k, i) => {
            if (args[i] !== undefined) params[k] = args[i];
        });
        return processPlaceholders(value, params);
    }
    return value;
}

/**
 * Получить текущий язык
 * @returns {string}
 */
export function getLanguage() {
    return currentLang;
}

/**
 * Установить язык
 * @param {string} lang
 */
export function setLanguage(lang) {
    if (translations[lang]) {
        currentLang = lang;
        storage.set(STORAGE_KEY, lang);
    }
}

/**
 * Загрузить язык из localStorage
 */
export function loadLanguage() {
    const saved = storage.get(STORAGE_KEY);
    if (saved && translations[saved]) {
        currentLang = saved;
    }
}

/**
 * Встроенные переводы (fallback для тестов)
 * @param {string} lang
 * @returns {Object}
 */
function getFallbackTranslations(lang) {
    const fallbacks = {
        ru: {
            appTitle: 'XAM Messenger', notConnected: 'Не подключен', offline: 'Не в сети',
            online: 'В сети', connecting: '🔌 Подключение...', connected: '✅ Подключено',
            searching: '🔍 Поиск серверов...', serversFound: '✅ Найдено серверов: {{count}}',
            noServers: '❌ Серверы не найдены', connectionError: '❌ Ошибка подключения',
            restoringSession: '🔄 Восстановление сессии...', reconnecting: '🔄 Переподключение...',
            loginTitle: 'Вход в XAM Messenger', nameLabel: 'Ваше имя', namePlaceholder: 'Введите имя',
            enterName: 'Введите имя для подключения к выбранному серверу',
            serverNotSelected: '📡 Сервер не выбран', enterNameError: 'Имя не может быть пустым',
            selectServerFirst: 'Сначала выберите сервер', login: 'Войти',
            changeServer: '🔧 Сменить сервер', profile: 'Профиль', settings: 'Настройки',
            changeServerMenu: 'Сменить сервер', logout: 'Выйти',
            profileSettings: 'Настройки профиля', avatarLabel: 'Аватар (эмодзи)',
            settingsHint: 'Настройки сохраняются в базе данных', cancel: 'Отмена', save: 'Сохранить',
            nameTooLong: 'Имя слишком длинное (макс. 50 символов)',
            notConnectedError: 'Вы не подключены к серверу',
            profileUpdated: '👤 Профиль обновлён: {{name}}, аватар: {{avatar}}',
            appSettings: 'Настройки', soundNotifications: 'Звук',
            desktopNotifications: 'Всплывающие уведомления', fontSize: 'Размер шрифта',
            showAvatars: 'Аватары', showTimestamps: 'Время', theme: 'Тема',
            themeLight: 'Светлая', themeDark: 'Тёмная', themeSystem: 'Системная',
            autoDownload: 'Автозагрузка', language: 'Язык', langRu: 'Русский', langEn: 'English',
            clearCache: 'Очистить кэш', exportData: 'Экспорт данных', resetSettings: 'Сбросить',
            done: 'Готово', selectChat: 'Выберите чат',
            selectChatHint: 'Выберите контакт из списка слева чтобы начать общение',
            noMessages: 'Нет сообщений', messagePlaceholder: 'Введите сообщение...',
            typeMessage: 'Введите сообщение...', fileTooBig: 'Файл "{{name}}" слишком большой (макс. 100MB)',
            noConnection: 'Нет подключения к серверу', sendingFiles: '📤 Отправка файлов...',
            notConnectedPeers: 'Не подключены', noUsers: 'Нет других пользователей',
            deleteChatConfirm: 'Удалить всю переписку с {{name}}?\n\nЭто действие нельзя отменить.',
            deletingChat: '🗑️ Удаление чата с {{name}} ({{id}})',
            chatDeleted: '✅ Чат с {{name}} удалён', deleteChatError: 'Не удалось удалить чат',
            loadMore: '⏳ Загрузить старые сообщения', loading: 'Загрузка...',
            loadOlder: 'Загрузить старые', selectServerTitle: 'Выбор сервера',
            foundServers: '📡 Найденные серверы', manualAddress: 'Или введите адрес вручную:',
            connect: 'Подключиться', close: 'Закрыть', refresh: 'Обновить',
            serverListEmpty: '📡 Серверы не найдены',
            serverListHint: 'Убедитесь, что сервер запущен и доступен в локальной сети',
            onlineText: 'в сети', offlineText: 'офлайн', newMessage: '{{name}}: {{text}}',
            sent: 'Отправлено', delivered: 'Доставлено', read: 'Прочитано',
            selectContactHint: 'Выберите контакт для начала общения',
            removeFile: 'Удалить файл', filePathNotSpecified: 'Путь к файлу не указан',
            fileOpenError: 'Ошибка: {{msg}}', fileDownloadError: 'Не удалось открыть файл: {{msg}}',
            sourceMdns: 'mDNS', sourceCache: 'кэш', sourceScan: 'сканирование',
            sourceManual: 'вручную', serverCheckRunning: 'Проверьте что сервер запущен',
            connectToServerAlert: 'Подключитесь к серверу',
            enterServerAddress: 'Введите адрес сервера',
            invalidUrlFormat: 'Неверный формат: {{msg}}', latencyMs: '{{ms}} мс',
            noResponse: '❌ Нет ответа', languageNameRu: 'Русский', languageNameEn: 'English',
            deleteChatAction: 'Удалить чат', deleteProfile: 'Удалить профиль',
            deleteProfileConfirm: 'Вы уверены, что хотите удалить свой профиль? Это действие нельзя отменить.',
            deleteProfileDesc: 'Это действие удалит ваш аккаунт с сервера.',
        },
        en: {
            appTitle: 'XAM Messenger', notConnected: 'Not connected', offline: 'Offline',
            online: 'Online', connecting: '🔌 Connecting...', connected: '✅ Connected',
            searching: '🔍 Searching servers...', serversFound: '✅ Servers found: {{count}}',
            noServers: '❌ No servers found', connectionError: '❌ Connection error',
            restoringSession: '🔄 Restoring session...', reconnecting: '🔄 Reconnecting...',
            loginTitle: 'Login to XAM Messenger', nameLabel: 'Your name',
            namePlaceholder: 'Enter your name',
            enterName: 'Enter your name to connect to the selected server',
            serverNotSelected: '📡 Server not selected', enterNameError: 'Name cannot be empty',
            selectServerFirst: 'Select a server first', login: 'Login',
            changeServer: '🔧 Change server', profile: 'Profile', settings: 'Settings',
            changeServerMenu: 'Change server', logout: 'Logout',
            profileSettings: 'Profile Settings', avatarLabel: 'Avatar (emoji)',
            settingsHint: 'Settings are saved in the database', cancel: 'Cancel', save: 'Save',
            nameTooLong: 'Name is too long (max 50 characters)',
            notConnectedError: 'You are not connected to the server',
            profileUpdated: '👤 Profile updated: {{name}}, avatar: {{avatar}}',
            appSettings: 'Settings', soundNotifications: 'Sound',
            desktopNotifications: 'Desktop notifications', fontSize: 'Font size',
            showAvatars: 'Avatars', showTimestamps: 'Timestamps', theme: 'Theme',
            themeLight: 'Light', themeDark: 'Dark', themeSystem: 'System',
            autoDownload: 'Auto-download', language: 'Language', langRu: 'Russian',
            langEn: 'English', clearCache: 'Clear cache', exportData: 'Export data',
            resetSettings: 'Reset', done: 'Done', selectChat: 'Select a chat',
            selectChatHint: 'Select a contact from the left sidebar to start chatting',
            noMessages: 'No messages', messagePlaceholder: 'Type a message...',
            typeMessage: 'Type a message...', fileTooBig: 'File "{{name}}" is too large (max 100MB)',
            noConnection: 'No connection to server', sendingFiles: '📤 Sending files...',
            notConnectedPeers: 'Not connected', noUsers: 'No other users',
            deleteChatConfirm: 'Delete all messages with {{name}}?\n\nThis action cannot be undone.',
            deletingChat: '🗑️ Deleting chat with {{name}} ({{id}})',
            chatDeleted: '✅ Chat with {{name}} deleted', deleteChatError: 'Failed to delete chat',
            loadMore: '⏳ Load older messages', loading: 'Loading...', loadOlder: 'Load older',
            selectServerTitle: 'Select Server', foundServers: '📡 Found servers',
            manualAddress: 'Or enter address manually:', connect: 'Connect', close: 'Close',
            refresh: 'Refresh', serverListEmpty: '📡 No servers found',
            serverListHint: 'Make sure the server is running and accessible on the local network',
            onlineText: 'online', offlineText: 'offline', newMessage: '{{name}}: {{text}}',
            sent: 'Sent', delivered: 'Delivered', read: 'Read',
            selectContactHint: 'Select a contact to start chatting',
            removeFile: 'Remove file', filePathNotSpecified: 'File path not specified',
            fileOpenError: 'Error: {{msg}}', fileDownloadError: 'Failed to open file: {{msg}}',
            sourceMdns: 'mDNS', sourceCache: 'cache', sourceScan: 'scan', sourceManual: 'manual',
            serverCheckRunning: 'Make sure the server is running',
            connectToServerAlert: 'Connect to the server first',
            enterServerAddress: 'Enter server address',
            invalidUrlFormat: 'Invalid format: {{msg}}', latencyMs: '{{ms}} ms',
            noResponse: '❌ No response', languageNameRu: 'Russian', languageNameEn: 'English',
            deleteChatAction: 'Delete chat', deleteProfile: 'Delete profile',
            deleteProfileConfirm: 'Are you sure you want to delete your profile? This action cannot be undone.',
            deleteProfileDesc: 'This will remove your account from the server.',
        },
    };
    return fallbacks[lang] || fallbacks.ru;
}
