/**
 * @file Интернационализация (ru/en)
 * @module i18n
 */

'use strict';

const STORAGE_KEY = 'xam-language';

const translations = {
    ru: {
        // Общие
        appTitle: 'XAM Messenger',
        notConnected: 'Не подключен',
        offline: 'Не в сети',
        online: 'В сети',
        connecting: '🔌 Подключение...',
        connected: '✅ Подключено',
        searching: '🔍 Поиск серверов...',
        serversFound: count => `✅ Найдено серверов: ${count}`,
        noServers: '❌ Серверы не найдены',
        connectionError: '❌ Ошибка подключения',
        restoringSession: '🔄 Восстановление сессии...',
        reconnecting: '🔄 Переподключение...',

        // Диалоги
        loginTitle: 'Вход в XAM Messenger',
        nameLabel: 'Ваше имя',
        namePlaceholder: 'Введите имя',
        enterName: 'Введите имя для подключения к выбранному серверу',
        serverNotSelected: '📡 Сервер не выбран',
        enterNameError: 'Имя не может быть пустым',
        selectServerFirst: 'Сначала выберите сервер',
        login: 'Войти',
        changeServer: '🔧 Сменить сервер',

        // Меню профиля
        profile: 'Профиль',
        settings: 'Настройки',
        changeServerMenu: 'Сменить сервер',
        logout: 'Выйти',

        // Настройки профиля
        profileSettings: 'Настройки профиля',
        avatarLabel: 'Аватар (эмодзи)',
        settingsHint: 'Настройки сохраняются в базе данных',
        cancel: 'Отмена',
        save: 'Сохранить',
        nameTooLong: 'Имя слишком длинное (макс. 50 символов)',
        notConnectedError: 'Вы не подключены к серверу',
        profileUpdated: (name, avatar) => `👤 Профиль обновлён: ${name}, аватар: ${avatar}`,

        // Настройки приложения
        appSettings: 'Настройки',
        soundNotifications: 'Звук',
        desktopNotifications: 'Всплывающие уведомления',
        fontSize: 'Размер шрифта',
        showAvatars: 'Аватары',
        showTimestamps: 'Время',
        theme: 'Тема',
        themeLight: 'Светлая',
        themeDark: 'Тёмная',
        themeSystem: 'Системная',
        autoDownload: 'Автозагрузка',
        language: 'Язык',
        langRu: 'Русский',
        langEn: 'English',
        clearCache: 'Очистить кэш',
        exportData: 'Экспорт данных',
        resetSettings: 'Сбросить',
        done: 'Готово',

        // Чат
        selectChat: 'Выберите чат',
        selectChatHint: 'Выберите контакт из списка слева чтобы начать общение',
        noMessages: 'Нет сообщений',
        messagePlaceholder: 'Введите сообщение...',
        typeMessage: 'Введите сообщение...',
        fileTooBig: name => `Файл "${name}" слишком большой (макс. 100MB)`,
        noConnection: 'Нет подключения к серверу',
        sendingFiles: '📤 Отправка файлов...',

        // Контакты
        notConnectedPeers: 'Не подключены',
        noUsers: 'Нет других пользователей',

        // Удаление чата
        deleteChatConfirm: name => `Удалить всю переписку с ${name}?\n\nЭто действие нельзя отменить.`,
        deletingChat: (name, id) => `🗑️ Удаление чата с ${name} (${id})`,
        chatDeleted: name => `✅ Чат с ${name} удалён`,
        deleteChatError: 'Не удалось удалить чат',

        // Пагинация
        loadMore: '⏳ Загрузить старые сообщения',
        loading: 'Загрузка...',
        loadOlder: 'Загрузить старые',

        // Выбор сервера
        selectServerTitle: 'Выбор сервера',
        foundServers: '📡 Найденные серверы',
        manualAddress: 'Или введите адрес вручную:',
        connect: 'Подключиться',
        close: 'Закрыть',
        refresh: 'Обновить',
        serverListEmpty: '📡 Серверы не найдены',
        serverListHint: 'Убедитесь, что сервер запущен и доступен в локальной сети',
        onlineText: 'в сети',
        offlineText: 'офлайн',

        // Уведомления
        newMessage: (name, text) => `${name}: ${text}`,

        // Статусы доставки
        sent: 'Отправлено',
        delivered: 'Доставлено',
        read: 'Прочитано',

        // Чат — пустое состояние
        selectContactHint: 'Выберите контакт для начала общения',

        // Файлы
        removeFile: 'Удалить файл',
        filePathNotSpecified: 'Путь к файлу не указан',
        fileOpenError: msg => `Ошибка: ${msg}`,
        fileDownloadError: msg => `Не удалось открыть файл: ${msg}`,

        // Серверы — источники
        sourceMdns: 'mDNS',
        sourceCache: 'кэш',
        sourceScan: 'сканирование',
        sourceManual: 'вручную',
        serverCheckRunning: 'Проверьте что сервер запущен',

        // Подключения
        connectToServerAlert: 'Подключитесь к серверу',
        enterServerAddress: 'Введите адрес сервера',
        invalidUrlFormat: msg => `Неверный формат: ${msg}`,

        // Пинг / задержка
        latencyMs: ms => `${ms} мс`,
        noResponse: '❌ Нет ответа',

        // Язык (toast)
        languageNameRu: 'Русский',
        languageNameEn: 'English',

        // Удаление чата (кнопка)
        deleteChatAction: 'Удалить чат',

        // Удаление профиля
        deleteProfile: 'Удалить профиль',
        deleteProfileConfirm: 'Вы уверены, что хотите удалить свой профиль? Это действие нельзя отменить.',
        deleteProfileDesc: 'Это действие удалит ваш аккаунт с сервера.',
    },
    en: {
        // Common
        appTitle: 'XAM Messenger',
        notConnected: 'Not connected',
        offline: 'Offline',
        online: 'Online',
        connecting: '🔌 Connecting...',
        connected: '✅ Connected',
        searching: '🔍 Searching servers...',
        serversFound: count => `✅ Servers found: ${count}`,
        noServers: '❌ No servers found',
        connectionError: '❌ Connection error',
        restoringSession: '🔄 Restoring session...',
        reconnecting: '🔄 Reconnecting...',

        // Dialogs
        loginTitle: 'Login to XAM Messenger',
        nameLabel: 'Your name',
        namePlaceholder: 'Enter your name',
        enterName: 'Enter your name to connect to the selected server',
        serverNotSelected: '📡 Server not selected',
        enterNameError: 'Name cannot be empty',
        selectServerFirst: 'Select a server first',
        login: 'Login',
        changeServer: '🔧 Change server',

        // Profile menu
        profile: 'Profile',
        settings: 'Settings',
        changeServerMenu: 'Change server',
        logout: 'Logout',

        // Profile settings
        profileSettings: 'Profile Settings',
        avatarLabel: 'Avatar (emoji)',
        settingsHint: 'Settings are saved in the database',
        cancel: 'Cancel',
        save: 'Save',
        nameTooLong: 'Name is too long (max 50 characters)',
        notConnectedError: 'You are not connected to the server',
        profileUpdated: (name, avatar) => `👤 Profile updated: ${name}, avatar: ${avatar}`,

        // App settings
        appSettings: 'Settings',
        soundNotifications: 'Sound',
        desktopNotifications: 'Desktop notifications',
        fontSize: 'Font size',
        showAvatars: 'Avatars',
        showTimestamps: 'Timestamps',
        theme: 'Theme',
        themeLight: 'Light',
        themeDark: 'Dark',
        themeSystem: 'System',
        autoDownload: 'Auto-download',
        language: 'Language',
        langRu: 'Russian',
        langEn: 'English',
        clearCache: 'Clear cache',
        exportData: 'Export data',
        resetSettings: 'Reset',
        done: 'Done',

        // Chat
        selectChat: 'Select a chat',
        selectChatHint: 'Select a contact from the left sidebar to start chatting',
        noMessages: 'No messages',
        messagePlaceholder: 'Type a message...',
        typeMessage: 'Type a message...',
        fileTooBig: name => `File "${name}" is too large (max 100MB)`,
        noConnection: 'No connection to server',
        sendingFiles: '📤 Sending files...',

        // Contacts
        notConnectedPeers: 'Not connected',
        noUsers: 'No other users',

        // Delete chat
        deleteChatConfirm: name => `Delete all messages with ${name}?\n\nThis action cannot be undone.`,
        deletingChat: (name, id) => `🗑️ Deleting chat with ${name} (${id})`,
        chatDeleted: name => `✅ Chat with ${name} deleted`,
        deleteChatError: 'Failed to delete chat',

        // Pagination
        loadMore: '⏳ Load older messages',
        loading: 'Loading...',
        loadOlder: 'Load older',

        // Server selection
        selectServerTitle: 'Select Server',
        foundServers: '📡 Found servers',
        manualAddress: 'Or enter address manually:',
        connect: 'Connect',
        close: 'Close',
        refresh: 'Refresh',
        serverListEmpty: '📡 No servers found',
        serverListHint: 'Make sure the server is running and accessible on the local network',
        onlineText: 'online',
        offlineText: 'offline',

        // Notifications
        newMessage: (name, text) => `${name}: ${text}`,

        // Delivery statuses
        sent: 'Sent',
        delivered: 'Delivered',
        read: 'Read',

        // Chat — empty state
        selectContactHint: 'Select a contact to start chatting',

        // Files
        removeFile: 'Remove file',
        filePathNotSpecified: 'File path not specified',
        fileOpenError: msg => `Error: ${msg}`,
        fileDownloadError: msg => `Failed to open file: ${msg}`,

        // Servers — sources
        sourceMdns: 'mDNS',
        sourceCache: 'cache',
        sourceScan: 'scan',
        sourceManual: 'manual',
        serverCheckRunning: 'Make sure the server is running',

        // Connection
        connectToServerAlert: 'Connect to the server first',
        enterServerAddress: 'Enter server address',
        invalidUrlFormat: msg => `Invalid format: ${msg}`,

        // Ping / latency
        latencyMs: ms => `${ms} ms`,
        noResponse: '❌ No response',

        // Language (toast)
        languageNameRu: 'Russian',
        languageNameEn: 'English',

        // Delete chat (button)
        deleteChatAction: 'Delete chat',

        // Delete profile
        deleteProfile: 'Delete profile',
        deleteProfileConfirm: 'Are you sure you want to delete your profile? This action cannot be undone.',
        deleteProfileDesc: 'This will remove your account from the server.',
    },
};

let currentLang = 'ru';

/**
 * Получить перевод
 * @param {string} key - Ключ перевода
 * @param  {...any} args - Аргументы для функций
 * @returns {string}
 */
export function t(key, ...args) {
    const dict = translations[currentLang] || translations.ru;
    const value = dict[key];
    if (value === undefined) {
        // Fallback на русский
        const fallback = translations.ru[key];
        if (typeof fallback === 'function') return fallback(...args);
        return fallback || key;
    }
    if (typeof value === 'function') return value(...args);
    return value;
}

/**
 * Получить текущий язык
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
        localStorage.setItem('xam-language', lang);
    }
}

/**
 * Загрузить язык из localStorage
 */
export function loadLanguage() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && translations[saved]) {
        currentLang = saved;
    }
}
