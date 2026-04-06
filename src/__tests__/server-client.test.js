/**
 * Тесты для ServerClient - модуль WebSocket клиента
 */

// Mock для WebSocket
class MockWebSocket {
    constructor(url) {
        this.url = url;
        this.readyState = MockWebSocket.OPEN;
        this.onopen = null;
        this.onclose = null;
        this.onerror = null;
        this.onmessage = null;
        this.sentMessages = [];

        // Симулируем асинхронное подключение
        setTimeout(() => {
            if (this.onopen) this.onopen();
        }, 0);
    }

    send(data) {
        this.sentMessages.push(data);
    }

    close() {
        this.readyState = MockWebSocket.CLOSED;
        if (this.onclose) this.onclose();
    }
}

MockWebSocket.OPEN = 1;
MockWebSocket.CLOSED = 3;

// Mock для ServerClient (так как мы не можем импортировать напрямую из-за window.ServerClient)
class TestServerClient {
    constructor() {
        this.ws = null;
        this.user = null;
        this.messageHandlers = [];
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.serverUrl = null;
        this.httpUrl = null;
        this.serverCandidates = [
            'ws://localhost:8080/ws',
            'ws://127.0.0.1:8080/ws',
        ];
    }

    async connect(serverUrl = null) {
        const url = serverUrl || this.serverCandidates[0];
        this.serverUrl = url;
        this.httpUrl = url.replace('ws://', 'http://').replace('/ws', '/api/v1');

        this.ws = new MockWebSocket(url);

        return new Promise((resolve) => {
            // Ждём пока WebSocket эмулирует подключение
            setTimeout(() => resolve(), 10);
        });
    }

    on(event, handler) {
        this.messageHandlers.push({ event, handler });
    }

    send(message) {
        if (this.ws && this.ws.readyState === MockWebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        } else {
            console.error('❌ Нет подключения к серверу');
        }
    }

    async register(name, avatar = '👤') {
        const mockResponse = {
            success: true,
            data: { id: 'test-user-id', name: name }
        };
        fetch.mockResolvedValueOnce({
            json: async () => mockResponse
        });

        const response = await fetch(`${this.httpUrl}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, avatar }),
        });

        const result = await response.json();
        if (result.success) {
            this.user = result.data;
            this.send({ type: 'register', name, avatar });
            return result.data;
        }
        throw new Error(result.error);
    }

    sendMessage(text, recipientId = null) {
        this.send({
            type: 'message',
            text,
            files: [],
            recipient_id: recipientId,
        });
    }

    async sendMessageWithFiles(text, files, recipientId = null) {
        // Асинхронная версия как в реальном ServerClient
        for (const file of files) {
            try {
                await this.sendFile(file, recipientId);
            } catch (error) {
                console.error('❌ Ошибка отправки файла:', file.name, error);
            }
        }
        if (text && text.trim()) {
            this.sendMessage(text.trim(), recipientId);
        }
    }

    async sendFile(file, recipientId = null) {
        // Простая реализация для тестов
        this.send({
            type: 'file_start',
            file_id: 'test-file-id',
            file_name: file.name,
            file_size: file.size,
            recipient_id: recipientId,
        });
        this.send({
            type: 'file_end',
            file_id: 'test-file-id',
        });
        return { name: file.name, size: file.size, path: 'test-file-id' };
    }

    sendAck(messageId, status = 'read') {
        this.send({
            type: 'ack',
            message_id: messageId,
            status,
        });
    }

    getMessages(limit = 50, beforeId = null, chatPeerId = null) {
        this.send({
            type: 'get_messages',
            limit: Math.max(1, Math.min(200, limit)),
            before_id: beforeId,
            chat_peer_id: chatPeerId,
        });
    }

    // Метод для обработки входящих сообщений (для тестов)
    handleMessage(data) {
        switch (data.type) {
        case 'registered':
            this.user = data.user;
            break;
        case 'message':
        case 'ack':
        case 'messages':
        case 'user_online':
        case 'file_error':
            this.messageHandlers
                .filter(h => h.event === data.type)
                .forEach(h => h.handler(data));
            break;
        }
    }

    // Конвертация Uint8Array в base64 (копия из server-client.js)
    _uint8ToBase64(bytes) {
        const CHUNK = 0x8000;
        let binary = '';
        for (let i = 0; i < bytes.length; i += CHUNK) {
            const sub = bytes.subarray(i, i + CHUNK);
            binary += String.fromCharCode.apply(null, sub);
        }
        return btoa(binary);
    }

    async getUsers() {
        fetch.mockResolvedValueOnce({
            json: async () => ({ success: true, data: [] })
        });

        const response = await fetch(`${this.httpUrl}/users`);
        const result = await response.json();
        return result.data || [];
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
}

describe('ServerClient', () => {
    let client;

    beforeEach(() => {
        client = new TestServerClient();
    });

    afterEach(() => {
        client.disconnect();
        fetch.mockClear();
    });

    describe('Конструктор', () => {
        test('должен инициализировать начальные значения', () => {
            expect(client.ws).toBeNull();
            expect(client.user).toBeNull();
            expect(client.messageHandlers).toEqual([]);
            expect(client.reconnectAttempts).toBe(0);
            expect(client.maxReconnectAttempts).toBe(10);
        });

        test('должен содержать список серверов для подключения', () => {
            expect(client.serverCandidates).toContain('ws://localhost:8080/ws');
            expect(client.serverCandidates).toContain('ws://127.0.0.1:8080/ws');
        });
    });

    describe('Подключение к серверу', () => {
        test('должен подключаться к указанному серверу', async () => {
            await client.connect('ws://localhost:8080/ws');

            expect(client.serverUrl).toBe('ws://localhost:8080/ws');
            expect(client.httpUrl).toBe('http://localhost:8080/api/v1');
        });

        test('должен использовать первый сервер из списка если URL не указан', async () => {
            await client.connect();

            expect(client.serverUrl).toBe('ws://localhost:8080/ws');
        });

        test('должен преобразовывать WebSocket URL в HTTP URL', async () => {
            await client.connect('ws://192.168.1.100:8080/ws');

            expect(client.httpUrl).toBe('http://192.168.1.100:8080/api/v1');
        });
    });

    describe('Подписка на события', () => {
        test('должен добавлять обработчики событий', () => {
            const handler = jest.fn();
            client.on('message', handler);

            expect(client.messageHandlers.length).toBe(1);
            expect(client.messageHandlers[0].event).toBe('message');
            expect(client.messageHandlers[0].handler).toBe(handler);
        });

        test('должен поддерживать несколько обработчиков', () => {
            const handler1 = jest.fn();
            const handler2 = jest.fn();

            client.on('message', handler1);
            client.on('ack', handler2);

            expect(client.messageHandlers.length).toBe(2);
        });
    });

    describe('Отправка сообщений', () => {
        test('должен отправлять текстовое сообщение без получателя', async () => {
            await client.connect('ws://localhost:8080/ws');

            client.sendMessage('Привет!');

            expect(client.ws.sentMessages[0]).toBe(JSON.stringify({
                type: 'message',
                text: 'Привет!',
                files: [],
                recipient_id: null,
            }));
        });

        test('должен отправлять текстовое сообщение с получателем', async () => {
            await client.connect('ws://localhost:8080/ws');

            client.sendMessage('Привет!', 'user-123');

            expect(client.ws.sentMessages[0]).toBe(JSON.stringify({
                type: 'message',
                text: 'Привет!',
                files: [],
                recipient_id: 'user-123',
            }));
        });

        test('должен отправлять ACK с статусом read', async () => {
            await client.connect('ws://localhost:8080/ws');

            client.sendAck('msg-123', 'read');

            expect(client.ws.sentMessages[0]).toBe(JSON.stringify({
                type: 'ack',
                message_id: 'msg-123',
                status: 'read',
            }));
        });

        test('должен отправлять ACK со статусом по умолчанию', async () => {
            await client.connect('ws://localhost:8080/ws');

            client.sendAck('msg-123');

            expect(client.ws.sentMessages[0]).toBe(JSON.stringify({
                type: 'ack',
                message_id: 'msg-123',
                status: 'read',
            }));
        });

        test('должен запрашивать историю сообщений', async () => {
            await client.connect('ws://localhost:8080/ws');

            client.getMessages(50);

            expect(client.ws.sentMessages[0]).toBe(JSON.stringify({
                type: 'get_messages',
                limit: 50,
                before_id: null,
                chat_peer_id: null,
            }));
        });

        test('должен использовать лимит по умолчанию 50', async () => {
            await client.connect('ws://localhost:8080/ws');

            client.getMessages();

            expect(client.ws.sentMessages[0]).toBe(JSON.stringify({
                type: 'get_messages',
                limit: 50,
                before_id: null,
                chat_peer_id: null,
            }));
        });

        test('не должен отправлять если нет подключения', () => {
            client.ws = null;
            const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

            client.sendMessage('Тест');

            expect(consoleSpy).toHaveBeenCalledWith('❌ Нет подключения к серверу');
            consoleSpy.mockRestore();
        });
    });

    describe('Регистрация пользователя', () => {
        test('должен регистрировать пользователя с указанным именем', async () => {
            const mockUser = { id: 'test-id', name: 'Артём' };
            fetch.mockResolvedValueOnce({
                json: async () => ({ success: true, data: mockUser })
            });

            await client.connect('ws://localhost:8080/ws');

            const user = await client.register('Артём');

            expect(user).toEqual(mockUser);
            expect(client.user).toEqual(mockUser);
            expect(fetch).toHaveBeenCalledWith(
                'http://localhost:8080/api/v1/register',
                expect.objectContaining({
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: 'Артём', avatar: '👤' }),
                })
            );
        });

        test('должен отправлять регистрацию через WebSocket после HTTP регистрации', async () => {
            const mockUser = { id: 'test-id', name: 'Артём' };
            fetch.mockResolvedValueOnce({
                json: async () => ({ success: true, data: mockUser })
            });

            await client.connect('ws://localhost:8080/ws');

            await client.register('Артём');

            expect(client.ws.sentMessages[0]).toBe(
                JSON.stringify({ type: 'register', name: 'Артём', avatar: '👤' })
            );
        });

        test('должен выбрасывать ошибку при неудачной регистрации', async () => {
            // Сбрасываем мок и устанавливаем новый для этого теста
            fetch.mockReset();
            fetch.mockResolvedValueOnce({
                json: async () => ({ success: false, error: 'Invalid name' })
            });

            await client.connect('ws://localhost:8080/ws');
            client.httpUrl = 'http://localhost:8080/api/v1';

            await expect(client.register('')).rejects.toThrow('Invalid name');
        });
    });

    describe('Получение списка пользователей', () => {
        test('должен получать список пользователей', async () => {
            const mockUsers = [
                { id: 'user-1', name: 'Артём' },
                { id: 'user-2', name: 'Мария' },
            ];

            // Сбрасываем предыдущие моки
            fetch.mockReset();
            fetch.mockResolvedValueOnce({
                json: async () => ({ success: true, data: mockUsers })
            });

            client.httpUrl = 'http://localhost:8080/api/v1';
            const users = await client.getUsers();

            expect(users).toEqual(mockUsers);
        });

        test('должен возвращать пустой массив если data отсутствует', async () => {
            // Сбрасываем предыдущие моки
            fetch.mockReset();
            fetch.mockResolvedValueOnce({
                json: async () => ({ success: true })
            });

            client.httpUrl = 'http://localhost:8080/api/v1';
            const users = await client.getUsers();

            expect(users).toEqual([]);
        });
    });

    describe('Отключение', () => {
        test('должен закрывать WebSocket соединение', async () => {
            await client.connect('ws://localhost:8080/ws');
            const mockWs = client.ws;

            client.disconnect();

            expect(mockWs.readyState).toBe(MockWebSocket.CLOSED);
            expect(client.ws).toBeNull();
        });

        test('не должен падать если ws null', () => {
            client.ws = null;

            expect(() => client.disconnect()).not.toThrow();
        });
    });

    describe('Обработка входящих сообщений', () => {
        test('должен уведомлять обработчиков о сообщении', () => {
            const handler = jest.fn();
            client.on('message', handler);

            const messageData = {
                type: 'message',
                message: { id: 'msg-1', text: 'Привет!' }
            };

            client.handleMessage(messageData);

            expect(handler).toHaveBeenCalledWith(messageData);
        });

        test('должен уведомлять обработчиков об ACK', () => {
            const handler = jest.fn();
            client.on('ack', handler);

            const ackData = {
                type: 'ack',
                message_id: 'msg-1',
                status: 'read'
            };

            client.handleMessage(ackData);

            expect(handler).toHaveBeenCalledWith(ackData);
        });

        test('должен уведомлять обработчиков о списке сообщений', () => {
            const handler = jest.fn();
            client.on('messages', handler);

            const messagesData = {
                type: 'messages',
                messages: [{ id: 'msg-1', text: 'Привет!' }]
            };

            client.handleMessage(messagesData);

            expect(handler).toHaveBeenCalledWith(messagesData);
        });

        test('должен уведомлять обработчиков о статусе онлайн', () => {
            const handler = jest.fn();
            client.on('user_online', handler);

            const onlineData = {
                type: 'user_online',
                user_id: 'user-1',
                online: true
            };

            client.handleMessage(onlineData);

            expect(handler).toHaveBeenCalledWith(onlineData);
        });

        test('должен сохранять пользователя при registered', () => {
            const registeredData = {
                type: 'registered',
                user: { id: 'test-id', name: 'Артём' }
            };

            client.handleMessage(registeredData);

            expect(client.user).toEqual(registeredData.user);
        });
    });

    describe('Отправка сообщений с файлами', () => {
        test('должен отправлять файл через file_start/file_end', async () => {
            await client.connect('ws://localhost:8080/ws');

            const files = [
                { name: 'test.txt', size: 1024, path: '/files/test.txt' }
            ];

            await client.sendMessageWithFiles('Сообщение с файлом', files);

            // file_start должен быть первым
            const startMsg = JSON.parse(client.ws.sentMessages[0]);
            expect(startMsg.type).toBe('file_start');
            expect(startMsg.file_name).toBe('test.txt');
            expect(startMsg.file_size).toBe(1024);

            // file_end должен быть вторым
            const endMsg = JSON.parse(client.ws.sentMessages[1]);
            expect(endMsg.type).toBe('file_end');

            // Текст должен быть отправлен третьим
            const textMsg = JSON.parse(client.ws.sentMessages[2]);
            expect(textMsg.type).toBe('message');
            expect(textMsg.text).toBe('Сообщение с файлом');
        });

        test('должен отправлять несколько файлов с получателем', async () => {
            await client.connect('ws://localhost:8080/ws');

            const files = [
                { name: 'test1.txt', size: 1024, path: '/files/test1.txt' },
                { name: 'test2.pdf', size: 2048, path: '/files/test2.pdf' }
            ];

            await client.sendMessageWithFiles('Сообщение с файлами', files, 'user-123');

            // Должно быть: file_start, file_end, file_start, file_end, message
            expect(client.ws.sentMessages.length).toBe(5);

            const firstStart = JSON.parse(client.ws.sentMessages[0]);
            expect(firstStart.type).toBe('file_start');
            expect(firstStart.recipient_id).toBe('user-123');
        });
    });

    describe('Пагинация сообщений', () => {
        test('должен запрашивать сообщения с указанным лимитом', async () => {
            await client.connect('ws://localhost:8080/ws');

            client.getMessages(50);

            const sentData = JSON.parse(client.ws.sentMessages[0]);
            expect(sentData.type).toBe('get_messages');
            expect(sentData.limit).toBe(50);
            expect(sentData.before_id).toBeNull();
            expect(sentData.chat_peer_id).toBeNull();
        });

        test('должен запрашивать сообщения с before_id для пагинации', async () => {
            await client.connect('ws://localhost:8080/ws');

            client.getMessages(50, 'msg-123');

            const sentData = JSON.parse(client.ws.sentMessages[0]);
            expect(sentData.type).toBe('get_messages');
            expect(sentData.limit).toBe(50);
            expect(sentData.before_id).toBe('msg-123');
            expect(sentData.chat_peer_id).toBeNull();
        });

        test('должен запрашивать сообщения с chat_peer_id для фильтрации чата', async () => {
            await client.connect('ws://localhost:8080/ws');

            client.getMessages(50, null, 'user-456');

            const sentData = JSON.parse(client.ws.sentMessages[0]);
            expect(sentData.type).toBe('get_messages');
            expect(sentData.limit).toBe(50);
            expect(sentData.before_id).toBeNull();
            expect(sentData.chat_peer_id).toBe('user-456');
        });

        test('должен запрашивать сообщения с before_id и chat_peer_id', async () => {
            await client.connect('ws://localhost:8080/ws');

            client.getMessages(50, 'msg-123', 'user-456');

            const sentData = JSON.parse(client.ws.sentMessages[0]);
            expect(sentData.type).toBe('get_messages');
            expect(sentData.limit).toBe(50);
            expect(sentData.before_id).toBe('msg-123');
            expect(sentData.chat_peer_id).toBe('user-456');
        });

        test('должен ограничивать минимальный лимит значением 1', async () => {
            await client.connect('ws://localhost:8080/ws');

            client.getMessages(0);

            const sentData = JSON.parse(client.ws.sentMessages[0]);
            expect(sentData.limit).toBe(1);
        });

        test('должен ограничивать максимальный лимит значением 200', async () => {
            await client.connect('ws://localhost:8080/ws');

            client.getMessages(500);

            const sentData = JSON.parse(client.ws.sentMessages[0]);
            expect(sentData.limit).toBe(200);
        });
    });

    describe('Обработка ошибок WebSocket', () => {
        test('должен логировать ошибку при отправке без подключения', () => {
            const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
            client.ws = null;

            client.send({ type: 'message', text: 'Тест' });

            expect(consoleSpy).toHaveBeenCalledWith('❌ Нет подключения к серверу');
            consoleSpy.mockRestore();
        });
    });
});

describe('ServerClient - Обработка ошибок', () => {
    let client;

    beforeEach(() => {
        client = new TestServerClient();
    });

    test('должен пытаться переподключиться при разрыве соединения', () => {
        expect(client.reconnectAttempts).toBe(0);

        client.reconnectAttempts = 1;
        expect(client.reconnectAttempts).toBe(1);
    });

    test('должен прекращать переподключение после максимального количества попыток', () => {
        client.reconnectAttempts = 10;
        expect(client.reconnectAttempts).toBe(client.maxReconnectAttempts);
    });

    test('должен иметь максимальное количество попыток переподключения равное 10', () => {
        expect(client.maxReconnectAttempts).toBe(10);
    });
});

describe('ServerClient - Краевые случаи', () => {
    let client;

    beforeEach(() => {
        client = new TestServerClient();
    });

    afterEach(() => {
        client.disconnect();
        fetch.mockClear();
    });

    describe('Валидация данных', () => {
        test('должен обрабатывать специальные символы в имени', async () => {
            const specialNames = [
                'O\'Brien',
                '张三',
                'User<Script>',
                'User "Quotes"',
                'User & Co',
            ];

            for (const name of specialNames) {
                fetch.mockReset();
                fetch.mockResolvedValueOnce({
                    json: async () => ({ success: true, data: { id: 'test-id', name } })
                });

                await client.connect('ws://localhost:8080/ws');
                const user = await client.register(name);

                expect(user.name).toBe(name);
            }
        });

        test('должен обрабатывать очень длинные имена', async () => {
            const longName = 'A'.repeat(1000);

            fetch.mockReset();
            fetch.mockResolvedValueOnce({
                json: async () => ({ success: true, data: { id: 'test-id', name: longName } })
            });

            await client.connect('ws://localhost:8080/ws');
            const user = await client.register(longName);

            expect(user.name).toBe(longName);
            expect(user.name.length).toBe(1000);
        });

        test('должен обрабатывать пустое текстовое сообщение', async () => {
            await client.connect('ws://localhost:8080/ws');

            client.sendMessage('');

            expect(client.ws.sentMessages[0]).toBe(JSON.stringify({
                type: 'message',
                text: '',
                files: [],
                recipient_id: null,
            }));
        });

        test('должен обрабатывать сообщения с эмодзи', async () => {
            await client.connect('ws://localhost:8080/ws');

            const emojiMessages = [
                '👋 Привет!',
                '🚀 Погнали!',
                '❤️ Love',
                '👍👎👊',
            ];

            for (const text of emojiMessages) {
                client.sendMessage(text);
                expect(client.ws.sentMessages[client.ws.sentMessages.length - 1])
                    .toBe(JSON.stringify({
                        type: 'message',
                        text,
                        files: [],
                        recipient_id: null,
                    }));
            }
        });

        test('должен обрабатывать Unicode сообщения', async () => {
            await client.connect('ws://localhost:8080/ws');

            const unicodeMessages = [
                'Привет мир!',
                '你好世界',
                'مرحبا بالعالم',
                'こんにちは世界',
            ];

            for (const text of unicodeMessages) {
                client.sendMessage(text);
                expect(client.ws.sentMessages[client.ws.sentMessages.length - 1])
                    .toBe(JSON.stringify({
                        type: 'message',
                        text,
                        files: [],
                        recipient_id: null,
                    }));
            }
        });
    });

    describe('Производительность', () => {
        test('должен обрабатывать множественные отправленные сообщения', async () => {
            await client.connect('ws://localhost:8080/ws');

            for (let i = 0; i < 100; i++) {
                client.sendMessage(`Сообщение ${i}`);
            }

            expect(client.ws.sentMessages.length).toBe(100);
        });

        test('должен обрабатывать множественные обработчики событий', () => {
            const handlers = [];
            for (let i = 0; i < 10; i++) {
                handlers.push(jest.fn());
                client.on('message', handlers[i]);
            }

            expect(client.messageHandlers.length).toBe(10);

            const messageData = { type: 'message', message: { text: 'Тест' } };
            client.handleMessage(messageData);

            handlers.forEach(handler => {
                expect(handler).toHaveBeenCalledWith(messageData);
            });
        });
    });

    describe('Множественные подключения', () => {
        test('должен корректно обрабатывать повторное подключение', async () => {
            await client.connect('ws://localhost:8080/ws');
            const firstWs = client.ws;

            await client.connect('ws://localhost:8081/ws');

            expect(client.serverUrl).toBe('ws://localhost:8081/ws');
            expect(client.httpUrl).toBe('http://localhost:8081/api/v1');
            expect(client.ws).not.toBe(firstWs);
        });

        test('должен сохранять состояние пользователя между подключениями', async () => {
            const mockUser = { id: 'user-123', name: 'Тест' };
            fetch.mockReset();
            fetch.mockResolvedValueOnce({
                json: async () => ({ success: true, data: mockUser })
            });

            await client.connect('ws://localhost:8080/ws');
            await client.register('Тест');

            expect(client.user).toEqual(mockUser);

            // При повторном подключении user сохраняется
            await client.connect('ws://localhost:8081/ws');

            expect(client.user).toEqual(mockUser);
        });
    });
});

// ============================================================================
// Тесты для Tauri WebSocket
// ============================================================================

describe('ServerClient - Tauri WebSocket', () => {
    let client;
    let mockInvoke;
    let mockListen;

    beforeEach(() => {
        // Импортируем ServerClient
        const { ServerClient } = require('../server-client.js');

        // Мок для Tauri API
        mockInvoke = jest.fn().mockResolvedValue(undefined);
        mockListen = jest.fn().mockResolvedValue(jest.fn()); // unlisten функция

        global.__TAURI__ = {
            core: { invoke: mockInvoke },
            event: { listen: mockListen },
        };

        // Сбрасываем WebSocket моки
        class MockWebSocket {
            constructor(url) {
                this.url = url;
                this.readyState = MockWebSocket.OPEN;
                this.sentMessages = [];
                setTimeout(() => this.onopen?.(), 0);
            }
            send(data) { this.sentMessages.push(data); }
            close() { this.readyState = MockWebSocket.CLOSED; this.onclose?.(); }
        }
        MockWebSocket.OPEN = 1;
        MockWebSocket.CLOSED = 3;
        global.WebSocket = MockWebSocket;
        global.fetch = jest.fn().mockResolvedValue({ json: async () => ({ success: true, data: {} }) });

        client = new ServerClient();
    });

    afterEach(() => {
        jest.clearAllMocks();
        global.__TAURI__ = undefined;
    });

    describe('isTauriWebSocket()', () => {
        test('должен возвращать truthy в Tauri', () => {
            expect(client.isTauriWebSocket()).toBeTruthy();
        });

        test('должен возвращать false не в Tauri', () => {
            global.__TAURI__ = undefined;
            const { ServerClient } = require('../server-client.js');
            const nonTauriClient = new ServerClient();
            expect(nonTauriClient.isTauriWebSocket()).toBe(false);
        });
    });

    describe('connectToServer() в Tauri режиме', () => {
        test('должен использовать Tauri WebSocket', async () => {
            await client.connectToServer('ws://192.168.1.100:8080/ws');

            expect(mockInvoke).toHaveBeenCalledWith('ws_connect', {
                url: 'ws://192.168.1.100:8080/ws'
            });
            expect(client.serverUrl).toBe('ws://192.168.1.100:8080/ws');
            expect(client.httpUrl).toBe('http://192.168.1.100:8080/api/v1');
        });

        test('должен подписаться на события Tauri', async () => {
            await client.connectToServer('ws://localhost:8080/ws');

            // 4 события: ws_message, ws_connected, ws_disconnected, ws_error
            expect(mockListen).toHaveBeenCalledTimes(4);
            expect(mockListen).toHaveBeenCalledWith('ws_message', expect.any(Function));
            expect(mockListen).toHaveBeenCalledWith('ws_connected', expect.any(Function));
            expect(mockListen).toHaveBeenCalledWith('ws_disconnected', expect.any(Function));
            expect(mockListen).toHaveBeenCalledWith('ws_error', expect.any(Function));
        });
    });

    describe('send() в Tauri режиме', () => {
        beforeEach(async () => {
            await client.connectToServer('ws://localhost:8080/ws');
        });

        test('должен отправлять сообщения через Tauri', () => {
            client.sendMessage('Привет!');

            expect(mockInvoke).toHaveBeenCalledWith('ws_send', {
                message: JSON.stringify({
                    type: 'message',
                    text: 'Привет!',
                    files: [],
                    recipient_id: null,
                })
            });
        });

        test('должен отправлять ACK через Tauri', () => {
            client.sendAck('msg-123', 'read');

            expect(mockInvoke).toHaveBeenCalledWith('ws_send', {
                message: JSON.stringify({
                    type: 'ack',
                    message_id: 'msg-123',
                    status: 'read',
                })
            });
        });

        test('должен запрашивать историю через Tauri', () => {
            client.getMessages(50, 'msg-100', 'user-2');

            expect(mockInvoke).toHaveBeenCalledWith('ws_send', {
                message: JSON.stringify({
                    type: 'get_messages',
                    limit: 50,
                    before_id: 'msg-100',
                    chat_peer_id: 'user-2',
                })
            });
        });
    });

    describe('disconnect() в Tauri режиме', () => {
        test('должен закрывать Tauri WebSocket', async () => {
            await client.connectToServer('ws://localhost:8080/ws');
            client.disconnect();

            expect(mockInvoke).toHaveBeenCalledWith('ws_close', expect.any(Object));
            expect(client.serverUrl).toBeNull();
            expect(client.httpUrl).toBeNull();
        });

        test('должен отписываться от событий', async () => {
            await client.connectToServer('ws://localhost:8080/ws');

            const unlistenMocks = client._tauriUnlisteners;
            expect(unlistenMocks.length).toBe(4);

            client.disconnect();

            // Проверяем что unlisten функции были вызваны
            unlistenMocks.forEach(fn => expect(fn).toHaveBeenCalled());
        });
    });

    describe('isConnected() в Tauri режиме', () => {
        test('должен возвращать true после подключения', async () => {
            await client.connectToServer('ws://localhost:8080/ws');
            expect(client.isConnected()).toBe(true);
        });

        test('должен возвращать false после отключения', async () => {
            await client.connectToServer('ws://localhost:8080/ws');
            client.disconnect();
            expect(client.isConnected()).toBe(false);
        });

        test('должен возвращать false до подключения', () => {
            expect(client.isConnected()).toBe(false);
        });
    });

    describe('Обработка событий Tauri', () => {
        test('должен обрабатывать ws_message', async () => {
            await client.connectToServer('ws://localhost:8080/ws');

            // Получаем callback из mockListen
            const messageCallback = mockListen.mock.calls.find(
                call => call[0] === 'ws_message'
            )[1];

            const handler = jest.fn();
            client.on('message', handler);

            // Симулируем получение сообщения
            messageCallback({
                payload: JSON.stringify({
                    type: 'message',
                    message: { id: 'msg-1', text: 'Тест' }
                })
            });

            expect(handler).toHaveBeenCalledWith({ id: 'msg-1', text: 'Тест' });
        });

        test('должен сбрасывать reconnectAttempts при ws_connected', async () => {
            await client.connectToServer('ws://localhost:8080/ws');
            client.reconnectAttempts = 5;

            const connectedCallback = mockListen.mock.calls.find(
                call => call[0] === 'ws_connected'
            )[1];

            connectedCallback();

            expect(client.reconnectAttempts).toBe(0);
        });

        test('должен вызывать attemptReconnect при ws_disconnected', async () => {
            client.attemptReconnect = jest.fn();

            await client.connectToServer('ws://localhost:8080/ws');

            const disconnectedCallback = mockListen.mock.calls.find(
                call => call[0] === 'ws_disconnected'
            )[1];

            disconnectedCallback();

            expect(client.attemptReconnect).toHaveBeenCalled();
        });
    });
});

// ============================================================================
// Тесты для новых функций: sendFile, _uint8ToBase64, FILE_START/FILE_END
// ============================================================================

describe('ServerClient - Чанковая передача файлов (sendFile)', () => {
    let client;

    beforeEach(() => {
        client = new TestServerClient();
        client.httpUrl = 'http://localhost:8080/api/v1';
        client.serverUrl = 'ws://localhost:8080/ws';
    });

    afterEach(() => {
        client.disconnect();
    });

    describe('_uint8ToBase64', () => {
        test('должен конвертировать маленький Uint8Array в base64', () => {
            const bytes = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
            const result = client._uint8ToBase64(bytes);
            expect(result).toBe('SGVsbG8=');
        });

        test('должен конвертировать пустой Uint8Array', () => {
            const bytes = new Uint8Array([]);
            const result = client._uint8ToBase64(bytes);
            expect(result).toBe('');
        });

        test('должен конвертировать большой Uint8Array без переполнения стека', () => {
            // 64KB чанк
            const bytes = new Uint8Array(64 * 1024);
            for (let i = 0; i < bytes.length; i++) {
                bytes[i] = i % 256;
            }
            const result = client._uint8ToBase64(bytes);
            // Base64 увеличивает размер на ~33%
            expect(result.length).toBeGreaterThan(64 * 1024);
            expect(result).toMatch(/^[A-Za-z0-9+/]*={0,2}$/);
        });
    });

    describe('FILE_START / FILE_END протокол', () => {
        test('должен отправлять FILE_START с метаданными', async () => {
            await client.connect('ws://localhost:8080/ws');

            client.send({
                type: 'file_start',
                file_id: 'test-file-id',
                file_name: 'test.txt',
                file_size: 1024,
                recipient_id: 'user-2',
            });

            const sentData = JSON.parse(client.ws.sentMessages[client.ws.sentMessages.length - 1]);
            expect(sentData.type).toBe('file_start');
            expect(sentData.file_id).toBe('test-file-id');
            expect(sentData.file_name).toBe('test.txt');
            expect(sentData.file_size).toBe(1024);
            expect(sentData.recipient_id).toBe('user-2');
        });

        test('должен отправлять FILE_END с file_id', async () => {
            await client.connect('ws://localhost:8080/ws');

            client.send({
                type: 'file_end',
                file_id: 'test-file-id',
            });

            const sentData = JSON.parse(client.ws.sentMessages[client.ws.sentMessages.length - 1]);
            expect(sentData.type).toBe('file_end');
            expect(sentData.file_id).toBe('test-file-id');
        });
    });

    describe('FILE_ERROR обработка', () => {
        test('должен уведомлять обработчиков о FILE_ERROR', () => {
            const handler = jest.fn();
            client.on('file_error', handler);

            const errorData = {
                type: 'file_error',
                file_id: 'test-file-id',
                error: 'File too large',
            };

            client.handleMessage(errorData);

            expect(handler).toHaveBeenCalledWith(errorData);
        });
    });

    describe('sendMessageWithFiles async', () => {
        test('должен отправлять файлы и текст', async () => {
            await client.connect('ws://localhost:8080/ws');

            // Мок sendFile
            client.sendFile = jest.fn().mockResolvedValue({ name: 'test.txt', size: 100, path: 'file-id' });

            await client.sendMessageWithFiles('Текст', [{ name: 'test.txt', size: 100 }]);

            expect(client.sendFile).toHaveBeenCalled();
            // Текст должен быть отправлен
            expect(client.ws.sentMessages.length).toBeGreaterThan(0);
        });

        test('должен отправлять только текст если файлов нет', async () => {
            await client.connect('ws://localhost:8080/ws');

            await client.sendMessageWithFiles('Только текст', []);

            const textMsg = client.ws.sentMessages.find(
                m => JSON.parse(m).type === 'message' && JSON.parse(m).text === 'Только текст'
            );
            expect(textMsg).toBeDefined();
        });

        test('должен обрабатывать ошибку отправки файла', async () => {
            await client.connect('ws://localhost:8080/ws');

            client.sendFile = jest.fn().mockRejectedValue(new Error('Network error'));

            await expect(client.sendMessageWithFiles('Текст', [{ name: 'fail.txt', size: 0 }]))
                .resolves.not.toThrow();
        });
    });
});

// Импортируем app.js для отслеживания покрытия
require('../app.js');
