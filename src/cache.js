/**
 * @file Кэширование серверов в localStorage
 * @module Cache
 */

'use strict';

import { storage } from './storage.js';

const CACHE_CONFIG = {
    KEY: 'xam_server_cache',
    TTL: 24 * 60 * 60 * 1000, // 24 часа
};

/**
 * Сохранить сервер в кэш
 * @param {string} ip - IP адрес
 * @param {number} port - Порт
 * @param {string} source - Источник (mdns/cache/scan/manual)
 */
export function cacheServer(ip, port, source) {
    try {
        const cache = storage.getJson(CACHE_CONFIG.KEY, []);
        const timestamp = Date.now();
        const filtered = cache.filter(s => s.ip !== ip);
        filtered.push({ ip, port, lastSeen: timestamp, source });
        storage.setJson(CACHE_CONFIG.KEY, filtered);

        // Если в Tauri, вызываем нативную команду
        const isTauri = !!(window.__TAURI__?.core?.invoke || window.__TAURI__?.invoke);
        if (isTauri) {
            invokeTauri('cache_server', { ip, port, source }).catch(console.warn);
        }
    } catch (e) {
        console.warn('⚠️ Не удалось сохранить сервер в кэш:', e);
    }
}

/**
 * Получить кэшированные серверы
 * @returns {Array<{ip: string, port: number, lastSeen: number, source: string}>}
 */
export function getCachedServers() {
    try {
        const cache = storage.getJson(CACHE_CONFIG.KEY, []);
        const now = Date.now();
        return cache.filter(server => (now - server.lastSeen) < CACHE_CONFIG.TTL);
    } catch (e) {
        console.warn('⚠️ Не удалось прочитать кэш серверов:', e);
        return [];
    }
}

/**
 * Вызов Tauri команды (совместимость с v1 и v2)
 */
async function invokeTauri(cmd, args = {}) {
    if (window.__TAURI__?.core?.invoke) return window.__TAURI__.core.invoke(cmd, args);
    if (window.__TAURI__?.invoke) return window.__TAURI__.invoke(cmd, args);
    throw new Error('Tauri API недоступен');
}

export { CACHE_CONFIG };
