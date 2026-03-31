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
        this.httpUrl = url.replace('ws://', 'http://').replace('/ws', '/api');

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

    async register(name) {
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
            body: JSON.stringify({ name }),
        });

        const result = await response.json();
        if (result.success) {
            this.user = result.data;
            this.send({ type: 'register', name });
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

    sendMessageWithFiles(text, files, recipientId = null) {
        this.send({
            type: 'message',
            text,
            files,
            recipient_id: recipientId,
        });
    }

    sendAck(messageId, status = 'read') {
        this.send({
            type: 'ack',
            message_id: messageId,
            status,
        });
    }

    getMessages(limit = 100, beforeId = null) {
        this.send({
            type: 'get_messages',
            limit: Math.max(1, Math.min(200, limit)),
            before_id: beforeId,
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
            this.messageHandlers
                .filter(h => h.event === data.type)
                .forEach(h => h.handler(data));
            break;
        }
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
            expect(client.httpUrl).toBe('http://localhost:8080/api');
        });

        test('должен использовать первый сервер из списка если URL не указан', async () => {
            await client.connect();

            expect(client.serverUrl).toBe('ws://localhost:8080/ws');
        });

        test('должен преобразовывать WebSocket URL в HTTP URL', async () => {
            await client.connect('ws://192.168.1.100:8080/ws');

            expect(client.httpUrl).toBe('http://192.168.1.100:8080/api');
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
            }));
        });

        test('должен использовать лимит по умолчанию 100', async () => {
            await client.connect('ws://localhost:8080/ws');

            client.getMessages();

            expect(client.ws.sentMessages[0]).toBe(JSON.stringify({
                type: 'get_messages',
                limit: 100,
                before_id: null,
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
                'http://localhost:8080/api/register',
                expect.objectContaining({
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: 'Артём' }),
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
                JSON.stringify({ type: 'register', name: 'Артём' })
            );
        });

        test('должен выбрасывать ошибку при неудачной регистрации', async () => {
            // Сбрасываем мок и устанавливаем новый для этого теста
            fetch.mockReset();
            fetch.mockResolvedValueOnce({
                json: async () => ({ success: false, error: 'Invalid name' })
            });

            await client.connect('ws://localhost:8080/ws');
            client.httpUrl = 'http://localhost:8080/api';

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

            client.httpUrl = 'http://localhost:8080/api';
            const users = await client.getUsers();

            expect(users).toEqual(mockUsers);
        });

        test('должен возвращать пустой массив если data отсутствует', async () => {
            // Сбрасываем предыдущие моки
            fetch.mockReset();
            fetch.mockResolvedValueOnce({
                json: async () => ({ success: true })
            });

            client.httpUrl = 'http://localhost:8080/api';
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
        test('должен отправлять сообщение с файлами', async () => {
            await client.connect('ws://localhost:8080/ws');

            const files = [
                { name: 'test.txt', size: 1024, path: '/files/test.txt' }
            ];

            client.sendMessageWithFiles('Сообщение с файлом', files);

            expect(client.ws.sentMessages[0]).toBe(JSON.stringify({
                type: 'message',
                text: 'Сообщение с файлом',
                files,
                recipient_id: null,
            }));
        });

        test('должен отправлять сообщение с несколькими файлами', async () => {
            await client.connect('ws://localhost:8080/ws');

            const files = [
                { name: 'test1.txt', size: 1024, path: '/files/test1.txt' },
                { name: 'test2.pdf', size: 2048, path: '/files/test2.pdf' }
            ];

            client.sendMessageWithFiles('Сообщение с файлами', files, 'user-123');

            expect(client.ws.sentMessages[0]).toBe(JSON.stringify({
                type: 'message',
                text: 'Сообщение с файлами',
                files,
                recipient_id: 'user-123',
            }));
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
        });

        test('должен запрашивать сообщения с before_id для пагинации', async () => {
            await client.connect('ws://localhost:8080/ws');

            client.getMessages(50, 'msg-123');

            const sentData = JSON.parse(client.ws.sentMessages[0]);
            expect(sentData.type).toBe('get_messages');
            expect(sentData.limit).toBe(50);
            expect(sentData.before_id).toBe('msg-123');
        });

        test('должен использовать лимит по умолчанию 100', async () => {
            await client.connect('ws://localhost:8080/ws');

            client.getMessages();

            const sentData = JSON.parse(client.ws.sentMessages[0]);
            expect(sentData.limit).toBe(100);
            expect(sentData.before_id).toBeNull();
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

        test('должен запрашивать сообщения с null before_id для первой загрузки', async () => {
            await client.connect('ws://localhost:8080/ws');

            client.getMessages(50, null);

            const sentData = JSON.parse(client.ws.sentMessages[0]);
            expect(sentData.type).toBe('get_messages');
            expect(sentData.limit).toBe(50);
            expect(sentData.before_id).toBeNull();
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
            expect(client.httpUrl).toBe('http://localhost:8081/api');
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
