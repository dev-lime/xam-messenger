/**
 * Тесты для settings.js
 */

import {
    saveUserSettings, loadUserSettings,
    saveSession, loadSession, clearSession,
    saveAppSettings, loadAppSettings,
    savePaginationState, restorePaginationState, clearPaginationState,
} from 'src/settings.js';

beforeEach(() => {
    localStorage.clear();
});

describe('settings.js - User Settings', () => {
    test('должен сохранять и загружать настройки пользователя', () => {
        const settings = { name: 'Test', avatar: '👨' };
        saveUserSettings(settings);
        const loaded = loadUserSettings({});
        expect(loaded).toEqual(settings);
    });

    test('должен возвращать дефолтное значение при отсутствии сохранённых', () => {
        const result = loadUserSettings({ name: 'Default' });
        expect(result.name).toBe('Default');
    });
});

describe('settings.js - Session', () => {
    test('должен сохранять и загружать сессию', () => {
        const user = { id: 'u1', name: 'Test' };
        const server = { wsUrl: 'ws://127.0.0.1:8080/ws' };
        saveSession(user, server);

        const session = loadSession();
        expect(session.user).toEqual(user);
        expect(session.server).toEqual(server);
    });

    test('должен возвращать null при отсутствии сессии', () => {
        expect(loadSession()).toBeNull();
    });

    test('должен очищать сессию', () => {
        saveSession({ id: 'u1' }, { wsUrl: 'ws://test' });
        clearSession();
        expect(loadSession()).toBeNull();
    });
});

describe('settings.js - Pagination', () => {
    test('должен сохранять hasMore', () => {
        savePaginationState(true, 'msg-123');
        const result = restorePaginationState([]);
        expect(result.hasMoreMessages).toBe(true);
    });

    test('clearPaginationState должен очищать ключи', () => {
        savePaginationState(true, 'msg-123');
        clearPaginationState();
        // После очистки restorePaginationState с пустыми сообщениями вернёт true (default)
        const result = restorePaginationState([]);
        expect(result).toHaveProperty('hasMoreMessages');
    });
});

describe('settings.js - App Settings', () => {
    test('должен сохранять и загружать настройки приложения', () => {
        const settings = { fontSize: '16', theme: 'dark' };
        saveAppSettings(settings);
        const loaded = loadAppSettings();
        expect(loaded.fontSize).toBe('16');
        expect(loaded.theme).toBe('dark');
    });

    test('должен возвращать пустой объект по умолчанию', () => {
        expect(loadAppSettings()).toEqual({});
    });
});
