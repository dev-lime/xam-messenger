/**
 * @file Управление настройками пользователя, приложения и сессиями
 * @module Settings
 */

'use strict';

import { CONFIG } from './utils/helpers.js';
import { storage } from './storage.js';

/**
 * Сохранение настроек пользователя
 * @param {UserSettings} settings - Настройки пользователя
 */
export function saveUserSettings(settings) {
    storage.setJson(CONFIG.STORAGE_KEYS.USER_SETTINGS, settings);
}

/**
 * Загрузка настроек пользователя
 * @param {UserSettings} defaultSettings - Настройки по умолчанию
 * @returns {UserSettings}
 */
export function loadUserSettings(defaultSettings) {
    return storage.getJson(CONFIG.STORAGE_KEYS.USER_SETTINGS, defaultSettings);
}

/**
 * Сохранение состояния пагинации
 * @param {boolean} hasMore - Есть ли ещё сообщения
 * @param {string} [currentPeerBeforeId] - ID последнего загруженного сообщения
 */
export function savePaginationState(hasMore, currentPeerBeforeId) {
    storage.set(CONFIG.STORAGE_KEYS.HAS_MORE, hasMore.toString());
    if (currentPeerBeforeId) {
        storage.set(CONFIG.STORAGE_KEYS.LAST_MESSAGE_ID, currentPeerBeforeId);
    }
}

/**
 * Восстановление состояния пагинации
 * @param {ChatMessage[]} messages - Текущие сообщения
 * @returns {{hasMoreMessages: boolean}}
 */
export function restorePaginationState(messages) {
    const savedHasMore = storage.get(CONFIG.STORAGE_KEYS.HAS_MORE);

    if (savedHasMore !== null && messages.length === 0) {
        return {
            hasMoreMessages: savedHasMore === 'true',
        };
    }
    return { hasMoreMessages: true };
}

/**
 * Очистка состояния пагинации
 */
export function clearPaginationState() {
    storage.remove(CONFIG.STORAGE_KEYS.HAS_MORE);
    storage.remove(CONFIG.STORAGE_KEYS.LAST_MESSAGE_ID);
}

/**
 * Сохранение настроек приложения
 * @param {AppSettings} appSettings - Настройки приложения
 */
export function saveAppSettings(appSettings) {
    storage.setJson(CONFIG.STORAGE_KEYS.APP_SETTINGS, appSettings);
}

/**
 * Загрузка настроек приложения
 * @returns {AppSettings}
 */
export function loadAppSettings() {
    return storage.getJson(CONFIG.STORAGE_KEYS.APP_SETTINGS, {});
}

/**
 * Сохранение сессии
 * @param {User} user - Данные пользователя
 * @param {ServerInfo} server - Данные сервера
 */
export function saveSession(user, server) {
    storage.setJson(CONFIG.STORAGE_KEYS.SESSION_USER, user);
    storage.setJson(CONFIG.STORAGE_KEYS.SESSION_SERVER, server);
}

/**
 * Загрузка сессии
 * @returns {{user: User, server: ServerInfo}|null}
 */
export function loadSession() {
    const user = storage.getJson(CONFIG.STORAGE_KEYS.SESSION_USER, null);
    const server = storage.getJson(CONFIG.STORAGE_KEYS.SESSION_SERVER, null);

    if (user && server) {
        return { user, server };
    }
    return null;
}

/**
 * Очистка сессии
 */
export function clearSession() {
    storage.remove(CONFIG.STORAGE_KEYS.SESSION_USER);
    storage.remove(CONFIG.STORAGE_KEYS.SESSION_SERVER);
}
