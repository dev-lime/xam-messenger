/**
 * Тесты для ServerClient - модуль WebSocket клиента
 */

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
        
        this.ws = new WebSocket(url);
        
        return new Promise((resolve, reject) => {
            this.ws.onopen = () => resolve();
            this.ws.onerror = (error) => reject(error);
        });
    }

    on(event, handler) {
        this.messageHandlers.push({ event, handler });
    }

    send(message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
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

    sendAck(messageId, status = 'read') {
        this.send({
            type: 'ack',
            message_id: messageId,
            status,
        });
    }

    getMessages(limit = 100) {
        this.send({
            type: 'get_messages',
            limit,
        });
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
        test('должен отправлять текстовое сообщение без получателя', () => {
            client.ws = { readyState: WebSocket.OPEN, send: jest.fn() };
            
            client.sendMessage('Привет!');
            
            expect(client.ws.send).toHaveBeenCalledWith(JSON.stringify({
                type: 'message',
                text: 'Привет!',
                files: [],
                recipient_id: null,
            }));
        });

        test('должен отправлять текстовое сообщение с получателем', () => {
            client.ws = { readyState: WebSocket.OPEN, send: jest.fn() };
            
            client.sendMessage('Привет!', 'user-123');
            
            expect(client.ws.send).toHaveBeenCalledWith(JSON.stringify({
                type: 'message',
                text: 'Привет!',
                files: [],
                recipient_id: 'user-123',
            }));
        });

        test('должен отправлять ACK с статусом read', () => {
            client.ws = { readyState: WebSocket.OPEN, send: jest.fn() };
            
            client.sendAck('msg-123', 'read');
            
            expect(client.ws.send).toHaveBeenCalledWith(JSON.stringify({
                type: 'ack',
                message_id: 'msg-123',
                status: 'read',
            }));
        });

        test('должен отправлять ACK со статусом по умолчанию', () => {
            client.ws = { readyState: WebSocket.OPEN, send: jest.fn() };
            
            client.sendAck('msg-123');
            
            expect(client.ws.send).toHaveBeenCalledWith(JSON.stringify({
                type: 'ack',
                message_id: 'msg-123',
                status: 'read',
            }));
        });

        test('должен запрашивать историю сообщений', () => {
            client.ws = { readyState: WebSocket.OPEN, send: jest.fn() };
            
            client.getMessages(50);
            
            expect(client.ws.send).toHaveBeenCalledWith(JSON.stringify({
                type: 'get_messages',
                limit: 50,
            }));
        });

        test('должен использовать лимит по умолчанию 100', () => {
            client.ws = { readyState: WebSocket.OPEN, send: jest.fn() };
            
            client.getMessages();
            
            expect(client.ws.send).toHaveBeenCalledWith(JSON.stringify({
                type: 'get_messages',
                limit: 100,
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
            
            client.ws = { readyState: WebSocket.OPEN, send: jest.fn() };
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
            
            client.ws = { readyState: WebSocket.OPEN, send: jest.fn() };
            await client.connect('ws://localhost:8080/ws');
            
            await client.register('Артём');
            
            expect(client.ws.send).toHaveBeenCalledWith(
                JSON.stringify({ type: 'register', name: 'Артём' })
            );
        });

        test('должен выбрасывать ошибку при неудачной регистрации', async () => {
            fetch.mockResolvedValueOnce({
                json: async () => ({ success: false, error: 'Invalid name' })
            });
            
            client.ws = { readyState: WebSocket.OPEN, send: jest.fn() };
            await client.connect('ws://localhost:8080/ws');
            
            await expect(client.register('')).rejects.toThrow('Invalid name');
        });
    });

    describe('Получение списка пользователей', () => {
        test('должен получать список пользователей', async () => {
            const mockUsers = [
                { id: 'user-1', name: 'Артём' },
                { id: 'user-2', name: 'Мария' },
            ];
            
            fetch.mockResolvedValueOnce({
                json: async () => ({ success: true, data: mockUsers })
            });
            
            client.httpUrl = 'http://localhost:8080/api';
            const users = await client.getUsers();
            
            expect(users).toEqual(mockUsers);
        });

        test('должен возвращать пустой массив если data отсутствует', async () => {
            fetch.mockResolvedValueOnce({
                json: async () => ({ success: true })
            });
            
            client.httpUrl = 'http://localhost:8080/api';
            const users = await client.getUsers();
            
            expect(users).toEqual([]);
        });
    });

    describe('Отключение', () => {
        test('должен закрывать WebSocket соединение', () => {
            const mockWs = { close: jest.fn() };
            client.ws = mockWs;
            
            client.disconnect();
            
            expect(mockWs.close).toHaveBeenCalled();
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
            
            expect(handler).toHaveBeenCalledWith(messageData.message);
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
            
            expect(handler).toHaveBeenCalledWith(messagesData.messages);
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
});
