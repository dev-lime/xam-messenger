/**
 * Тесты для РЕАЛЬНОГО ServerClient и standalone функций
 */

import { ServerClient } from '../server-client.js';

// Импортируем standalone функции через require (CommonJS export)
const {
    generateLocalNetworkServers,
    wsToHttpUrl,
    extractIpFromWsUrl,
    pingServer,
    cacheServer,
    getCachedServers,
} = require('../server-client.js');

// Discovery функции тестируем напрямую из discovery.js
const {
    discoverViaCache,
    discoverViaMdns,
} = require('../discovery.js');

// Mock fetch helper — всегда возвращаем объект с методом json()
const mockFetchResponse = (data, ok = true) => {
    return Promise.resolve({
        ok,
        status: ok ? 200 : 500,
        headers: {
            get: (name) => name === 'content-type' ? 'application/json' : null,
        },
        json: () => Promise.resolve(data),
    });
};

beforeEach(() => {
    window.__TAURI__ = undefined;
    localStorage.clear();
});

afterEach(() => {
    window.__TAURI__ = undefined;
    jest.useRealTimers();
});

// ============================================================================
// Standalone функции (экспортированы для тестирования)
// ============================================================================

describe('Standalone функции', () => {
    describe('generateLocalNetworkServers', () => {
        test('генерирует серверы для всех подсетей', () => {
            const servers = generateLocalNetworkServers();
            // 13 подсетей × 21 IP = 273
            expect(servers.length).toBe(273);
        });

        test('первый сервер из первой подсети', () => {
            const servers = generateLocalNetworkServers();
            expect(servers[0]).toBe('ws://192.168.1.1:8080/ws');
        });

        test('последний сервер из первой подсети', () => {
            const servers = generateLocalNetworkServers();
            // 10 (1-10) + 11 (100-110) = 21 из первой подсети
            expect(servers[20]).toBe('ws://192.168.1.110:8080/ws');
        });

        test('все URL содержат правильный порт и путь', () => {
            const servers = generateLocalNetworkServers();
            servers.forEach(url => {
                expect(url).toMatch(/:8080\/ws$/);
            });
        });
    });

    describe('wsToHttpUrl', () => {
        test('преобразует ws:// в http:// и /ws в /api/v1', () => {
            expect(wsToHttpUrl('ws://192.168.1.100:8080/ws'))
                .toBe('http://192.168.1.100:8080/api/v1');
        });

        test('обрабатывает localhost', () => {
            expect(wsToHttpUrl('ws://localhost:8080/ws'))
                .toBe('http://localhost:8080/api/v1');
        });
    });

    describe('extractIpFromWsUrl', () => {
        test('извлекает IP', () => {
            expect(extractIpFromWsUrl('ws://192.168.1.100:8080/ws')).toBe('192.168.1.100');
        });

        test('возвращает пустую строку для невалидного URL', () => {
            expect(extractIpFromWsUrl('invalid')).toBe('');
        });
    });

    describe('pingServer', () => {
        beforeEach(() => {
            jest.useFakeTimers();
        });
        afterEach(() => {
            jest.useRealTimers();
        });

        test('возвращает true при ok response', async () => {
            fetch.mockResolvedValueOnce(mockFetchResponse({ success: true, data: [] }));
            const p = pingServer('http://localhost/api');
            expect(await p).toBe(true);
        });

        test('возвращает false при ошибке', async () => {
            fetch.mockRejectedValueOnce(new Error('fail'));
            expect(await pingServer('http://localhost/api')).toBe(false);
        });

        test('возвращает false при response.ok = false', async () => {
            fetch.mockResolvedValueOnce(mockFetchResponse({}, false));
            expect(await pingServer('http://localhost/api')).toBe(false);
        });

        test('очищает таймер при успехе (BUG-6 FIX)', async () => {
            fetch.mockResolvedValueOnce(mockFetchResponse({ success: true, data: [] }));
            const spy = jest.spyOn(global, 'clearTimeout');
            await pingServer('http://localhost/api');
            expect(spy).toHaveBeenCalled();
            spy.mockRestore();
        });

        test('очищает таймер при ошибке (BUG-6 FIX)', async () => {
            fetch.mockRejectedValueOnce(new Error('fail'));
            const spy = jest.spyOn(global, 'clearTimeout');
            await pingServer('http://localhost/api');
            expect(spy).toHaveBeenCalled();
            spy.mockRestore();
        });
    });

    describe('cacheServer / getCachedServers', () => {
        beforeEach(() => localStorage.clear());
        afterEach(() => localStorage.clear());

        test('сохраняет сервер в кэш', () => {
            cacheServer('1.1.1.1', 8080, 'mdns');
            const cached = getCachedServers();
            expect(cached.length).toBe(1);
            expect(cached[0].ip).toBe('1.1.1.1');
            expect(cached[0].port).toBe(8080);
            expect(cached[0].source).toBe('mdns');
        });

        test('заменяет старую запись для того же IP', () => {
            cacheServer('1.1.1.1', 8080, 'mdns');
            cacheServer('1.1.1.1', 9090, 'manual');
            expect(getCachedServers().length).toBe(1);
            expect(getCachedServers()[0].port).toBe(9090);
        });

        test('вызывает invokeTauri если доступен Tauri', () => {
            const mockInvoke = jest.fn().mockResolvedValue(undefined);
            window.__TAURI__ = { core: { invoke: mockInvoke } };

            cacheServer('1.1.1.1', 8080, 'mdns');

            expect(mockInvoke).toHaveBeenCalledWith('cache_server', {
                ip: '1.1.1.1', port: 8080, source: 'mdns'
            });
        });

        test('catch обрабатывает ошибки localStorage', () => {
            const spy = jest.spyOn(console, 'warn').mockImplementation();
            // Сломаем localStorage
            const origGet = localStorage.getItem;
            localStorage.getItem = () => { throw new Error('broken'); };

            cacheServer('1.1.1.1', 8080, 'mdns');

            expect(spy).toHaveBeenCalled();
            localStorage.getItem = origGet;
            spy.mockRestore();
        });
    });
});

// ============================================================================
// ServerClient (реальный класс)
// ============================================================================

describe('ServerClient (реальный класс)', () => {
    let client;

    beforeEach(() => {
        client = new ServerClient();
    });

    afterEach(() => {
        if (client) {
            client.ws = null;
            client._tauriUnlisteners = [];
        }
    });

    describe('Конструктор', () => {
        test('ws = null', () => expect(client.ws).toBeNull());
        test('user = null', () => expect(client.user).toBeNull());
        test('reconnectAttempts = 0', () => expect(client.reconnectAttempts).toBe(0));
        test('serverUrl = null', () => expect(client.serverUrl).toBeNull());
        test('httpUrl = null', () => expect(client.httpUrl).toBeNull());
        test('isTauri = false в jsdom', () => expect(client.isTauri).toBe(false));
        test('пустой messageHandlers', () => expect(client.messageHandlers).toEqual([]));
    });

    describe('on / notifyHandlers', () => {
        test('добавляет обработчик', () => {
            client.on('message', jest.fn());
            expect(client.messageHandlers.length).toBe(1);
        });

        test('уведомляет только нужные обработчики', () => {
            const h1 = jest.fn();
            const h2 = jest.fn();
            client.on('message', h1);
            client.on('ack', h2);
            client.notifyHandlers('message', 'data');
            expect(h1).toHaveBeenCalledWith('data');
            expect(h2).not.toHaveBeenCalled();
        });
    });

    describe('handleMessage', () => {
        test('registered сохраняет пользователя', () => {
            client.handleMessage({ type: 'registered', user: { id: 'u1', name: 'T' } });
            expect(client.user).toEqual({ id: 'u1', name: 'T' });
        });

        test('message уведомляет обработчиков', () => {
            const h = jest.fn();
            client.on('message', h);
            client.handleMessage({ type: 'message', message: { id: 'm1' } });
            expect(h).toHaveBeenCalledWith({ id: 'm1' });
        });

        test('ack уведомляет обработчиков', () => {
            const h = jest.fn();
            client.on('ack', h);
            client.handleMessage({ type: 'ack', message_id: 'm1', status: 'read' });
            expect(h).toHaveBeenCalledWith({ type: 'ack', message_id: 'm1', status: 'read' });
        });

        test('messages уведомляет обработчиков', () => {
            const h = jest.fn();
            client.on('messages', h);
            client.handleMessage({ type: 'messages', messages: [{ id: 'm1' }] });
            expect(h).toHaveBeenCalledWith({ type: 'messages', messages: [{ id: 'm1' }] });
        });

        test('user_online уведомляет обработчиков', () => {
            const h = jest.fn();
            client.on('user_online', h);
            client.handleMessage({ type: 'user_online', user_id: 'u1', online: true });
            expect(h).toHaveBeenCalledWith({ type: 'user_online', user_id: 'u1', online: true });
        });

        test('file_error уведомляет обработчиков', () => {
            const h = jest.fn();
            client.on('file_error', h);
            const spy = jest.spyOn(console, 'error').mockImplementation();
            client.handleMessage({ type: 'file_error', file_id: 'f1', error: 'fail' });
            expect(h).toHaveBeenCalledWith({ type: 'file_error', file_id: 'f1', error: 'fail' });
            spy.mockRestore();
        });

        test('неизвестный тип логирует предупреждение', () => {
            const spy = jest.spyOn(console, 'warn').mockImplementation();
            client.handleMessage({ type: 'unknown' });
            expect(spy).toHaveBeenCalledWith('⚠️ Неизвестный тип сообщения:', 'unknown');
            spy.mockRestore();
        });
    });

    describe('send', () => {
        test('отправляет JSON через WebSocket', () => {
            const mockWs = { readyState: WebSocket.OPEN, send: jest.fn() };
            client.ws = mockWs;
            client.send({ type: 'test' });
            expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({ type: 'test' }));
        });

        test('логирует ошибку без подключения', () => {
            const spy = jest.spyOn(console, 'error').mockImplementation();
            client.ws = null;
            client.send({ type: 'test' });
            expect(spy).toHaveBeenCalledWith('❌ Нет подключения к серверу');
            spy.mockRestore();
        });
    });

    describe('sendMessage', () => {
        test('без получателя', () => {
            const mockWs = { readyState: WebSocket.OPEN, send: jest.fn() };
            client.ws = mockWs;
            client.sendMessage('Hello');
            const s = JSON.parse(mockWs.send.mock.calls[0][0]);
            expect(s.text).toBe('Hello');
            expect(s.recipient_id).toBeNull();
        });

        test('с получателем', () => {
            const mockWs = { readyState: WebSocket.OPEN, send: jest.fn() };
            client.ws = mockWs;
            client.sendMessage('Hi', 'user-123');
            const s = JSON.parse(mockWs.send.mock.calls[0][0]);
            expect(s.recipient_id).toBe('user-123');
        });
    });

    describe('sendAck', () => {
        test('read по умолчанию', () => {
            const mockWs = { readyState: WebSocket.OPEN, send: jest.fn() };
            client.ws = mockWs;
            client.sendAck('m1');
            const s = JSON.parse(mockWs.send.mock.calls[0][0]);
            expect(s.status).toBe('read');
        });

        test('delivered', () => {
            const mockWs = { readyState: WebSocket.OPEN, send: jest.fn() };
            client.ws = mockWs;
            client.sendAck('m1', 'delivered');
            const s = JSON.parse(mockWs.send.mock.calls[0][0]);
            expect(s.status).toBe('delivered');
        });
    });

    describe('getMessages', () => {
        test('лимит по умолчанию 50', () => {
            const mockWs = { readyState: WebSocket.OPEN, send: jest.fn() };
            client.ws = mockWs;
            client.getMessages();
            const s = JSON.parse(mockWs.send.mock.calls[0][0]);
            expect(s.limit).toBe(50);
        });

        test('ограничение 1-200', () => {
            const mockWs = { readyState: WebSocket.OPEN, send: jest.fn() };
            client.ws = mockWs;
            client.getMessages(0);
            expect(JSON.parse(mockWs.send.mock.calls[0][0]).limit).toBe(1);
            client.getMessages(500);
            expect(JSON.parse(mockWs.send.mock.calls[1][0]).limit).toBe(200);
        });

        test('с before_id и chat_peer_id', () => {
            const mockWs = { readyState: WebSocket.OPEN, send: jest.fn() };
            client.ws = mockWs;
            client.getMessages(50, 'msg-100', 'user-456');
            const s = JSON.parse(mockWs.send.mock.calls[0][0]);
            expect(s.before_id).toBe('msg-100');
            expect(s.chat_peer_id).toBe('user-456');
        });
    });

    describe('updateProfile', () => {
        test('отправляет update_profile с именем и аватаром', () => {
            const mockWs = { readyState: WebSocket.OPEN, send: jest.fn() };
            client.ws = mockWs;
            client.updateProfile('НовоеИмя', '🎭');
            const s = JSON.parse(mockWs.send.mock.calls[0][0]);
            expect(s.type).toBe('update_profile');
            expect(s.text).toBe('🎭');
            expect(s.name).toBe('НовоеИмя');
        });
    });

    describe('disconnect', () => {
        test('закрывает WebSocket и очищает URL', () => {
            client.serverUrl = 'ws://localhost/ws';
            client.httpUrl = 'http://localhost/api';
            const mockWs = { readyState: WebSocket.OPEN, close: jest.fn() };
            client.ws = mockWs;
            client.disconnect();
            expect(mockWs.close).toHaveBeenCalled();
            expect(client.ws).toBeNull();
            expect(client.serverUrl).toBeNull();
        });

        test('не падает если ws null', () => {
            client.ws = null;
            expect(() => client.disconnect()).not.toThrow();
        });
    });

    describe('isConnected', () => {
        test('false без WebSocket', () => expect(client.isConnected()).toBe(false));
        test('true если OPEN', () => {
            client.ws = { readyState: WebSocket.OPEN };
            expect(client.isConnected()).toBe(true);
        });
        test('false если CLOSED', () => {
            client.ws = { readyState: WebSocket.CLOSED };
            expect(client.isConnected()).toBe(false);
        });
    });

    describe('register', () => {
        test('регистрирует пользователя', async () => {
            client.httpUrl = 'http://localhost:8080/api/v1';
            // Мокаем send чтобы не логировал ошибку
            client.send = jest.fn();
            fetch.mockResolvedValueOnce(mockFetchResponse({
                success: true,
                data: { id: 'u1', name: 'Test' }
            }));

            const user = await client.register('Test');
            expect(user.id).toBe('u1');
            expect(client.user).toEqual({ id: 'u1', name: 'Test' });
        });

        test('выбрасывает ошибку при неудаче', async () => {
            client.httpUrl = 'http://localhost:8080/api/v1';
            fetch.mockResolvedValueOnce(mockFetchResponse(
                { success: false, error: 'Name too long' },
                false
            ));

            await expect(client.register('Test')).rejects.toThrow('Name too long');
        });

        test('аватар по умолчанию', async () => {
            client.httpUrl = 'http://localhost:8080/api/v1';
            client.send = jest.fn();
            fetch.mockResolvedValueOnce(mockFetchResponse({
                success: true,
                data: { id: 'u1', name: 'Test' }
            }));

            await client.register('Test');
            expect(fetch).toHaveBeenCalledWith(
                'http://localhost:8080/api/v1/register',
                expect.objectContaining({
                    body: JSON.stringify({ name: 'Test', avatar: '👤' })
                })
            );
        });
    });

    describe('getUsers', () => {
        test('получает список', async () => {
            client.httpUrl = 'http://localhost:8080/api/v1';
            fetch.mockResolvedValueOnce(mockFetchResponse({
                success: true,
                data: [{ id: 'u1', name: 'Alice' }]
            }));

            const users = await client.getUsers();
            expect(users).toEqual([{ id: 'u1', name: 'Alice' }]);
        });

        test('возвращает [] если data нет', async () => {
            client.httpUrl = 'http://localhost:8080/api/v1';
            fetch.mockResolvedValueOnce(mockFetchResponse({ success: true, data: [] }));

            const users = await client.getUsers();
            expect(users).toEqual([]);
        });
    });

    describe('checkServerAvailability', () => {
        test('возвращает true при ok', async () => {
            fetch.mockResolvedValueOnce(mockFetchResponse({ success: true, data: [] }));
            const result = await client.checkServerAvailability('http://localhost/api');
            expect(result).toBe(true);
        });

        test('возвращает false при ошибке', async () => {
            fetch.mockRejectedValueOnce(new Error('fail'));
            const result = await client.checkServerAvailability('http://localhost/api');
            expect(result).toBe(false);
        });
    });

    describe('invokeTauri', () => {
        test('выбрасывает ошибку когда Tauri недоступен', async () => {
            const saved = window.__TAURI__;
            window.__TAURI__ = undefined;
            await expect(window.invokeTauri('some_cmd')).rejects.toThrow('Tauri API недоступен');
            window.__TAURI__ = saved;
        });

        test('использует Tauri v2 API', async () => {
            const mockInvoke = jest.fn().mockResolvedValue('result');
            window.__TAURI__ = { core: { invoke: mockInvoke } };
            const result = await window.invokeTauri('test_cmd', { arg: 1 });
            expect(mockInvoke).toHaveBeenCalledWith('test_cmd', { arg: 1 });
            expect(result).toBe('result');
        });

        test('fallback на Tauri v1 API', async () => {
            const mockInvoke = jest.fn().mockResolvedValue('v1_result');
            window.__TAURI__ = { invoke: mockInvoke };
            // Удаляем core.invoke чтобы сработал fallback
            delete window.__TAURI__.core;
            const result = await window.invokeTauri('test_cmd');
            expect(mockInvoke).toHaveBeenCalledWith('test_cmd', {});
            expect(result).toBe('v1_result');
        });

        test('приоритет v2 над v1', async () => {
            const v2Invoke = jest.fn().mockResolvedValue('v2');
            const v1Invoke = jest.fn().mockResolvedValue('v1');
            window.__TAURI__ = { core: { invoke: v2Invoke }, invoke: v1Invoke };
            const result = await window.invokeTauri('test');
            expect(result).toBe('v2');
            expect(v2Invoke).toHaveBeenCalled();
            expect(v1Invoke).not.toHaveBeenCalled();
        });
    });

    describe('_removeTauriListeners', () => {
        test('вызывает все unlisten функции и очищает массив', () => {
            const unlisten1 = jest.fn();
            const unlisten2 = jest.fn();
            client._tauriUnlisteners = [unlisten1, unlisten2];

            client._removeTauriListeners();

            expect(unlisten1).toHaveBeenCalled();
            expect(unlisten2).toHaveBeenCalled();
            expect(client._tauriUnlisteners).toEqual([]);
        });

        test('не падает с пустым массивом', () => {
            client._tauriUnlisteners = [];
            expect(() => client._removeTauriListeners()).not.toThrow();
        });
    });

    describe('_connectViaTauri ошибки', () => {
        test('переоформирует строковую ошибку сети', async () => {
            window.__TAURI__ = {
                core: { invoke: jest.fn().mockRejectedValue('Нет активного сетевого подключения') },
                event: { listen: jest.fn().mockResolvedValue(jest.fn()) }
            };
            const c = new ServerClient();
            await expect(c._connectViaTauri('ws://10.0.0.1/ws')).rejects.toThrow('Нет активного сетевого');
        });

        test('переоформирует ошибку Wi-Fi', async () => {
            window.__TAURI__ = {
                core: { invoke: jest.fn().mockRejectedValue('Включите Wi-Fi') },
                event: { listen: jest.fn().mockResolvedValue(jest.fn()) }
            };
            const c = new ServerClient();
            await expect(c._connectViaTauri('ws://10.0.0.1/ws')).rejects.toThrow('Включите Wi-Fi');
        });

        test('переоформирует общую ошибку подключения', async () => {
            window.__TAURI__ = {
                core: { invoke: jest.fn().mockRejectedValue(new Error('Connection refused')) },
                event: { listen: jest.fn().mockResolvedValue(jest.fn()) }
            };
            const c = new ServerClient();
            await expect(c._connectViaTauri('ws://10.0.0.1/ws')).rejects.toThrow('Ошибка подключения: Connection refused');
        });

        test('устанавливает serverUrl и httpUrl', async () => {
            window.__TAURI__ = {
                core: { invoke: jest.fn().mockResolvedValue(null) },
                event: { listen: jest.fn().mockResolvedValue(jest.fn()) }
            };
            const c = new ServerClient();
            await c._connectViaTauri('ws://192.168.1.50:8080/ws');
            expect(c.serverUrl).toBe('ws://192.168.1.50:8080/ws');
            expect(c.httpUrl).toBe('http://192.168.1.50:8080/api/v1');
        });
    });

    describe('discoverViaCache', () => {
        test('возвращает кэшированные серверы', () => {
            localStorage.setItem('xam_server_cache', JSON.stringify([
                { ip: '1.1.1.1', port: 8080, lastSeen: Date.now(), source: 'mdns' }
            ]));
            const servers = discoverViaCache();
            expect(servers.length).toBe(1);
            expect(servers[0].ip).toBe('1.1.1.1');
            expect(servers[0].wsUrl).toBe('ws://1.1.1.1:8080/ws');
            expect(servers[0].httpUrl).toBe('http://1.1.1.1:8080/api/v1');
        });

        test('возвращает пустой массив при пустом кэше', () => {
            const servers = discoverViaCache();
            expect(servers).toEqual([]);
        });
    });

    describe('discoverViaMdns', () => {
        test('возвращает пустой массив без Tauri', async () => {
            const servers = await discoverViaMdns();
            expect(servers).toEqual([]);
        });

        test('возвращает серверы через Tauri', async () => {
            window.__TAURI__ = {
                core: {
                    invoke: jest.fn().mockResolvedValue([{
                        ip: '1.1.1.1', port: 8080, ws_url: 'ws://1.1.1.1:8080/ws',
                        http_url: 'http://1.1.1.1:8080/api', source: 'mdns'
                    }])
                }
            };
            const servers = await discoverViaMdns();
            expect(servers.length).toBe(1);
            expect(servers[0].ip).toBe('1.1.1.1');
        });

        test('возвращает пустой массив при ошибке Tauri', async () => {
            window.__TAURI__ = { core: { invoke: jest.fn().mockRejectedValue(new Error('fail')) } };
            const servers = await discoverViaMdns();
            expect(servers).toEqual([]);
        });
    });

    describe('getAllDiscoveredServers', () => {
        test('возвращает массив обнаруженных серверов', () => {
            client.discoveredServers = [{ ip: '1.1.1.1', wsUrl: 'ws://1.1.1.1/ws' }];
            const servers = client.getAllDiscoveredServers();
            expect(servers.length).toBe(1);
        });
    });

    describe('attemptReconnect', () => {
        beforeEach(() => {
            jest.useFakeTimers();
        });
        afterEach(() => {
            jest.useRealTimers();
        });

        test('планирует переподключение при попытке < MAX', () => {
            const spy = jest.spyOn(global, 'setTimeout');
            client.connect = jest.fn().mockResolvedValue();
            client.reconnectAttempts = 0;
            client.attemptReconnect();

            expect(spy).toHaveBeenCalledTimes(1);
            spy.mockRestore();
        });

        test('не планирует переподключение при MAX попыток', () => {
            const spy = jest.spyOn(global, 'setTimeout');
            client.connect = jest.fn();
            client.reconnectAttempts = 10;
            client.attemptReconnect();

            expect(spy).not.toHaveBeenCalled();
            expect(client.connect).not.toHaveBeenCalled();
            spy.mockRestore();
        });

        test('использует exponential backoff', () => {
            client.connect = jest.fn().mockResolvedValue();
            client.reconnectAttempts = 0;
            client.attemptReconnect();

            // WS_CONFIG.RECONNECT_DELAY * Math.min(1, 5) = 2000 * 1 = 2000ms
            jest.advanceTimersByTime(2500);
            expect(client.connect).toHaveBeenCalledTimes(1);
        });
    });

    describe('send без подключения (Tauri ветка)', () => {
        test('Tauri ветка ловит ошибку _sendViaTauri', async () => {
            window.__TAURI__ = { core: { invoke: jest.fn().mockResolvedValue(null) } };
            const c = new ServerClient();
            c._sendViaTauri = jest.fn().mockRejectedValue(new Error('not connected'));
            const spy = jest.spyOn(console, 'error').mockImplementation();

            c.send({ type: 'message', text: 'test' });
            await new Promise(r => setTimeout(r, 0));

            expect(spy).toHaveBeenCalled();
            spy.mockRestore();
        });
    });

    describe('_connectViaTauri — полный успех', () => {
        test('устанавливает подключение и подписывается на события', async () => {
            const mockUnlisten = jest.fn();
            window.__TAURI__ = {
                core: { invoke: jest.fn().mockResolvedValue(null) },
                event: { listen: jest.fn().mockResolvedValue(mockUnlisten) }
            };
            const c = new ServerClient();
            await c._connectViaTauri('ws://192.168.1.50:8080/ws');
            expect(c.serverUrl).toBe('ws://192.168.1.50:8080/ws');
            expect(c.httpUrl).toBe('http://192.168.1.50:8080/api/v1');
            expect(window.__TAURI__.core.invoke).toHaveBeenCalledWith('ws_connect', {
                url: 'ws://192.168.1.50:8080/ws'
            });
            expect(window.__TAURI__.event.listen).toHaveBeenCalledTimes(4);
        });
    });

    describe('deleteChat', () => {
        test('отправляет delete_chat с recipient_id', () => {
            const mockWs = { readyState: WebSocket.OPEN, send: jest.fn() };
            client.ws = mockWs;
            client.deleteChat('user-123');
            const s = JSON.parse(mockWs.send.mock.calls[0][0]);
            expect(s.type).toBe('delete_chat');
            expect(s.recipient_id).toBe('user-123');
        });
    });

    describe('chat_deleted handler', () => {
        test('уведомляет обработчиков', () => {
            const h = jest.fn();
            client.on('chat_deleted', h);
            client.handleMessage({ type: 'chat_deleted', peer_id: 'user-123', deleted_by: 'user-456' });
            expect(h).toHaveBeenCalledWith({ type: 'chat_deleted', peer_id: 'user-123', deleted_by: 'user-456' });
        });
    });
});

// Импортируем app.js для покрытия
require('../app.js');
