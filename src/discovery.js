/**
 * @file Обнаружение серверов (mDNS, cache, scan)
 * @module Discovery
 */

'use strict';

import { cacheServer, getCachedServers, CACHE_CONFIG } from './cache.js';

export { cacheServer, getCachedServers, CACHE_CONFIG };

const WS_CONFIG = {
    RECONNECT_DELAY: 2000, MAX_RECONNECT_ATTEMPTS: 10,
    CONNECTION_TIMEOUT: 3000, MDNS_TIMEOUT: 3000, SCAN_TIMEOUT: 3000,
};

const SUBNETS = [
    '192.168.1.', '192.168.0.', '192.168.88.', '192.168.2.', '192.168.3.',
    '192.168.10.', '192.168.31.', '10.0.0.', '10.0.1.', '10.0.2.', '10.0.3.',
    '172.16.0.', '172.16.1.',
];

const SCAN_CONFIG = { PORT: 8080, IP_START_MIN: 1, IP_START_MAX: 10, IP_END_MIN: 100, IP_END_MAX: 110 };

export { WS_CONFIG, SUBNETS, SCAN_CONFIG };

export function generateLocalNetworkServers() {
    const servers = [];
    SUBNETS.forEach((subnet) => {
        if (subnet.startsWith('127.')) return;
        for (let i = SCAN_CONFIG.IP_START_MIN; i <= SCAN_CONFIG.IP_START_MAX; i++) {
            servers.push(`ws://${subnet}${i}:${SCAN_CONFIG.PORT}/ws`);
        }
        for (let i = SCAN_CONFIG.IP_END_MIN; i <= SCAN_CONFIG.IP_END_MAX; i++) {
            servers.push(`ws://${subnet}${i}:${SCAN_CONFIG.PORT}/ws`);
        }
    });
    return servers;
}

export function wsToHttpUrl(wsUrl) {
    return wsUrl.replace('ws://', 'http://').replace(/\/ws$/, '/api/v1');
}

export function extractIpFromWsUrl(wsUrl) {
    const match = wsUrl.match(/ws:\/\/([^:]+):(\d+)/);
    return match ? match[1] : '';
}

export async function pingServer(httpUrl, timeout = 3000) {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        try {
            const response = await fetch(`${httpUrl}/users`, { method: 'GET', signal: controller.signal });
            if (!response.ok || response.status !== 200) return false;
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) return false;
            try {
                const data = await response.json();
                return data && typeof data === 'object' && 'success' in data && 'data' in data;
            } catch { return false; }
        } finally { clearTimeout(timer); }
    } catch { return false; }
}

export async function discoverViaMdns() {
    if (!window.__TAURI__?.core?.invoke) return [];
    try {
        const servers = await (window.__TAURI__.core.invoke || window.__TAURI__.invoke)('search_mdns_servers');
        const normalized = servers.map(s => ({
            ip: s.ip, port: s.port, hostname: s.hostname,
            wsUrl: s.ws_url, httpUrl: s.http_url, source: s.source, txtRecords: s.txt_records,
        }));
        normalized.forEach(s => cacheServer(s.ip, s.port, 'mdns'));
        return normalized;
    } catch { return []; }
}

export function discoverViaCache() {
    return getCachedServers().map(s => ({
        ip: s.ip, port: s.port, wsUrl: `ws://${s.ip}:${s.port}/ws`,
        httpUrl: `http://${s.ip}:${s.port}/api/v1`, source: s.source,
    }));
}

export async function discoverViaScan() {
    const candidates = generateLocalNetworkServers();
    const found = [];
    const CONCURRENCY = 20;
    const SCAN_TIMEOUT = 500;
    for (let i = 0; i < candidates.length; i += CONCURRENCY) {
        const batch = candidates.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(
            batch.map(async (url) => {
                const httpUrl = wsToHttpUrl(url);
                return { url, httpUrl, isAlive: await pingServer(httpUrl, SCAN_TIMEOUT) };
            })
        );
        for (const result of results) {
            if (result.status === 'fulfilled' && result.value.isAlive) {
                const { url, httpUrl } = result.value;
                found.push({ ip: extractIpFromWsUrl(url), port: SCAN_CONFIG.PORT, wsUrl: url, httpUrl, source: 'scan' });
            }
        }
        if (i + CONCURRENCY < candidates.length) await new Promise(r => setTimeout(r, 50));
    }
    return found;
}

export async function discoverAllServers() {
    const discoveredServers = [];
    const mdnsServers = await discoverViaMdns();
    discoveredServers.push(...mdnsServers);
    if (mdnsServers.length === 0) discoveredServers.push(...discoverViaCache());
    if (discoveredServers.length === 0) discoveredServers.push(...await discoverViaScan());
    const priority = { mdns: 0, cache: 1, scan: 2, manual: 3 };
    discoveredServers.sort((a, b) => priority[a.source] - priority[b.source]);
    return discoveredServers;
}
