/**
 * @file Хранение данных в localStorage
 * @module Storage
 */

'use strict';

import { CONFIG } from './utils/helpers.js';

/**
 * Сохранение настроек пользователя
 */
export function saveUserSettings(settings) {
	localStorage.setItem(CONFIG.STORAGE_KEYS.USER_SETTINGS, JSON.stringify(settings));
}

/**
 * Загрузка настроек пользователя
 */
export function loadUserSettings(defaultSettings) {
	const saved = localStorage.getItem(CONFIG.STORAGE_KEYS.USER_SETTINGS);
	if (saved) {
		try {
			return JSON.parse(saved);
		} catch {
			console.warn('Failed to load user settings');
		}
	}
	return defaultSettings;
}

/**
 * Сохранение состояния пагинации
 */
export function savePaginationState(hasMore, currentPeerBeforeId) {
	localStorage.setItem(CONFIG.STORAGE_KEYS.HAS_MORE, hasMore.toString());
	if (currentPeerBeforeId) {
		localStorage.setItem(CONFIG.STORAGE_KEYS.LAST_MESSAGE_ID, currentPeerBeforeId);
	}
}

/**
 * Восстановление состояния пагинации
 */
export function restorePaginationState(messages) {
	const savedLastId = localStorage.getItem(CONFIG.STORAGE_KEYS.LAST_MESSAGE_ID);
	const savedHasMore = localStorage.getItem(CONFIG.STORAGE_KEYS.HAS_MORE);

	if (savedHasMore !== null && messages.length === 0) {
		return {
			hasMoreMessages: savedHasMore === 'true',
			// lastMessageId не восстанавливаем принудительно
		};
	}
	return { hasMoreMessages: true };
}

/**
 * Очистка состояния пагинации
 */
export function clearPaginationState() {
	state.hasMoreMessages = true;
	state.currentPeerBeforeId = null;
}

/**
 * Сохранение сессии
 */
export function saveSession(user, server) {
	localStorage.setItem(CONFIG.STORAGE_KEYS.SESSION_USER, JSON.stringify(user));
	localStorage.setItem(CONFIG.STORAGE_KEYS.SESSION_SERVER, JSON.stringify(server));
}

/**
 * Загрузка сессии
 */
export function loadSession() {
	const savedUser = localStorage.getItem(CONFIG.STORAGE_KEYS.SESSION_USER);
	const savedServer = localStorage.getItem(CONFIG.STORAGE_KEYS.SESSION_SERVER);

	if (savedUser && savedServer) {
		try {
			return {
				user: JSON.parse(savedUser),
				server: JSON.parse(savedServer),
			};
		} catch {
			console.warn('⚠️ Не удалось восстановить сессию');
		}
	}
	return null;
}

/**
 * Очистка сессии
 */
export function clearSession() {
	localStorage.removeItem(CONFIG.STORAGE_KEYS.SESSION_USER);
	localStorage.removeItem(CONFIG.STORAGE_KEYS.SESSION_SERVER);
}
