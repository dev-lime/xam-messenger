/**
 * @file Базовая абстракция для работы с localStorage
 * @module Storage
 */

'use strict';

/**
 * Единый интерфейс для работы с localStorage
 */
export const storage = {
    /**
     * Получить значение по ключу (строка)
     * @param {string} key - Ключ
     * @param {string} [defaultValue=''] - Значение по умолчанию
     * @returns {string}
     */
    get(key, defaultValue = '') {
        try {
            const value = localStorage.getItem(key);
            return value !== null ? value : defaultValue;
        } catch (e) {
            console.warn(`⚠️ Ошибка чтения localStorage [${key}]:`, e);
            return defaultValue;
        }
    },

    /**
     * Сохранить строковое значение
     * @param {string} key - Ключ
     * @param {string} value - Значение
     */
    set(key, value) {
        try {
            localStorage.setItem(key, value);
        } catch (e) {
            console.warn(`⚠️ Ошибка записи в localStorage [${key}]:`, e);
        }
    },

    /**
     * Получить JSON-значение
     * @template T
     * @param {string} key - Ключ
     * @param {T} defaultValue - Значение по умолчанию
     * @returns {T}
     */
    getJson(key, defaultValue = null) {
        try {
            const value = localStorage.getItem(key);
            if (value === null) return defaultValue;
            return JSON.parse(value);
        } catch (e) {
            console.warn(`⚠️ Ошибка парсинга JSON из localStorage [${key}]:`, e);
            return defaultValue;
        }
    },

    /**
     * Сохранить JSON-значение
     * @param {string} key - Ключ
     * @param {*} value - Значение (сериализуется в JSON)
     */
    setJson(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (e) {
            console.warn(`⚠️ Ошибка записи JSON в localStorage [${key}]:`, e);
        }
    },

    /**
     * Удалить значение по ключу
     * @param {string} key - Ключ
     */
    remove(key) {
        try {
            localStorage.removeItem(key);
        } catch (e) {
            console.warn(`⚠️ Ошибка удаления из localStorage [${key}]:`, e);
        }
    },

    /**
     * Очистить все значения (осторожно!)
     */
    clear() {
        try {
            localStorage.clear();
        } catch (e) {
            console.warn('⚠️ Ошибка очистки localStorage:', e);
        }
    },
};
