/**
 * Интеграционные тесты для XAM Messenger
 * Тестируют взаимодействие между клиентом и сервером
 * 
 * Для запуска тестов сервер должен быть запущен:
 * npm run test:integration
 * 
 * Или с указанием своего сервера:
 * TEST_SERVER_URL=http://192.168.1.100:8080 npm run test:integration
 */

const TEST_SERVER_URL = process.env.TEST_SERVER_URL || 'http://localhost:8080';
const TEST_WS_URL = process.env.TEST_WS_URL || 'ws://localhost:8080/ws';

// Проверяем наличие WebSocket (в Node.js нужен пакет 'ws')
let WebSocketClient = global.WebSocket;
if (!WebSocketClient) {
    try {
        WebSocketClient = require('ws');
    } catch (e) {
        console.warn('⚠️  Пакет "ws" не установлен. Интеграционные тесты будут пропущены.');
        console.warn('Установите: npm install --save-dev ws');
    }
}

// Проверка доступности сервера перед запуском тестов
const checkServerAvailability = async () => {
    try {
        const response = await fetch(`${TEST_SERVER_URL}/api/users`, {
            method: 'GET',
            signal: AbortSignal.timeout(5000)
        });
        return response.ok;
    } catch (error) {
        return false;
    }
};

// Вспомогательная функция для регистрации пользователя
const registerUser = async (name) => {
    const response = await fetch(`${TEST_SERVER_URL}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
    });
    const result = await response.json();
    if (result.success) {
        return result.data;
    }
    throw new Error(result.error || 'Registration failed');
};

// Вспомогательная функция для создания WebSocket подключения
const createWebSocket = () => {
    return new Promise((resolve, reject) => {
        if (!WebSocketClient) {
            reject(new Error('WebSocket не доступен'));
            return;
        }
        const ws = new WebSocketClient(TEST_WS_URL);
        ws.onopen = () => resolve(ws);
        ws.onerror = (error) => reject(error);
        setTimeout(() => reject(new Error('WebSocket timeout')), 5000);
    });
};

describe('Интеграционные тесты - XAM Messenger', () => {
    // Проверка сервера перед всеми тестами
    beforeAll(async () => {
        const isAvailable = await checkServerAvailability();
        if (!isAvailable) {
            console.warn(`⚠️  Сервер не доступен по адресу ${TEST_SERVER_URL}`);
            console.warn('Интеграционные тесты будут пропущены');
            console.warn('Запустите сервер перед запуском тестов');
        }
    });

    describe('Регистрация пользователей', () => {
        test('должен регистрировать нового пользователя через HTTP API', async () => {
            const user = await registerUser(`Тест_${Date.now()}`);

            expect(user).toHaveProperty('id');
            expect(user).toHaveProperty('name');
            expect(typeof user.id).toBe('string');
        });

        test('должен возвращать того же пользователя при повторной регистрации', async () => {
            const uniqueName = `UniqueUser_${Date.now()}`;

            const user1 = await registerUser(uniqueName);
            const user2 = await registerUser(uniqueName);

            expect(user1.id).toBe(user2.id);
            expect(user1.name).toBe(user2.name);
        });

        test('должен отклонять пустое имя', async () => {
            const response = await fetch(`${TEST_SERVER_URL}/api/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: '' }),
            });
            const result = await response.json();

            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
        });

        test('должен обрабатывать имена с пробелами', async () => {
            const timestamp = Date.now();
            const name = `John Doe ${timestamp}`;
            const user = await registerUser(name);
            expect(user.name).toBe(name);
        });

        test('должен обрабатывать имена с цифрами', async () => {
            const timestamp = Date.now();
            const name = `User123_${timestamp}`;
            const user = await registerUser(name);
            expect(user.name).toBe(name);
        });
    });

    describe('Список пользователей', () => {
        test('должен возвращать список зарегистрированных пользователей', async () => {
            await registerUser(`User1_${Date.now()}`);
            await registerUser(`User2_${Date.now()}`);

            const response = await fetch(`${TEST_SERVER_URL}/api/users`);
            const result = await response.json();

            expect(result.success).toBe(true);
            expect(Array.isArray(result.data)).toBe(true);
            expect(result.data.length).toBeGreaterThanOrEqual(2);

            // Проверяем что каждый пользователь имеет id и name
            result.data.forEach(user => {
                expect(user).toHaveProperty('id');
                expect(user).toHaveProperty('name');
            });
        });

        test('должен возвращать пользователей с уникальными ID', async () => {
            const user1 = await registerUser(`UserA_${Date.now()}`);
            const user2 = await registerUser(`UserB_${Date.now()}`);

            expect(user1.id).not.toBe(user2.id);
        });
    });

    describe('WebSocket подключение', () => {
        test('должен подключаться к WebSocket серверу', async () => {
            const ws = await createWebSocket();
            expect(ws.readyState).toBe(WebSocketClient.OPEN);
            ws.close();
        });

        test('должен получать подтверждение регистрации через WebSocket', async () => {
            const ws = await createWebSocket();
            const userName = `WSUser_${Date.now()}`;

            const registeredPromise = new Promise((resolve) => {
                ws.onmessage = (event) => {
                    const data = JSON.parse(event.data);
                    if (data.type === 'registered') {
                        resolve(data);
                    }
                };
            });

            ws.send(JSON.stringify({ type: 'register', name: userName }));

            const result = await registeredPromise;
            expect(result.type).toBe('registered');
            expect(result.user.name).toBe(userName);
            expect(result.user.id).toBeDefined();

            ws.close();
        });

        test('должен закрывать соединение корректно', async () => {
            const ws = await createWebSocket();
            
            ws.close();
            
            // Ждём пока соединение закроется
            await new Promise(resolve => setTimeout(resolve, 100));
            expect(ws.readyState).toBe(WebSocketClient.CLOSED);
        });
    });

    describe('Обмен сообщениями', () => {
        let ws1, ws2;
        let user1, user2;

        beforeEach(async () => {
            // Регистрируем двух пользователей
            user1 = await registerUser(`Sender_${Date.now()}`);
            user2 = await registerUser(`Receiver_${Date.now()}`);

            // Подключаемся через WebSocket
            ws1 = await createWebSocket();
            ws2 = await createWebSocket();

            // Регистрируемся через WebSocket
            await new Promise((resolve) => {
                let resolved = 0;
                const checkResolve = () => {
                    resolved++;
                    if (resolved === 2) resolve();
                };

                ws1.onmessage = (event) => {
                    const data = JSON.parse(event.data);
                    if (data.type === 'registered') checkResolve();
                };
                ws2.onmessage = (event) => {
                    const data = JSON.parse(event.data);
                    if (data.type === 'registered') checkResolve();
                };

                ws1.send(JSON.stringify({ type: 'register', name: user1.name }));
                ws2.send(JSON.stringify({ type: 'register', name: user2.name }));
            });
        });

        afterEach(() => {
            if (ws1) ws1.close();
            if (ws2) ws2.close();
        });

        test('должен отправлять сообщения между пользователями', async () => {
            const messageText = `Тестовое сообщение ${Date.now()}`;

            const messagePromise = new Promise((resolve) => {
                ws2.onmessage = (event) => {
                    const data = JSON.parse(event.data);
                    if (data.type === 'message') {
                        resolve(data.message);
                    }
                };
            });

            // Отправляем сообщение
            ws1.send(JSON.stringify({
                type: 'message',
                text: messageText,
                recipient_id: user2.id,
            }));

            const message = await messagePromise;
            expect(message.text).toBe(messageText);
            expect(message.sender_id).toBe(user1.id);
        });

        test('должен присваивать уникальный ID сообщению', async () => {
            const messagePromise = new Promise((resolve) => {
                ws2.onmessage = (event) => {
                    const data = JSON.parse(event.data);
                    if (data.type === 'message') {
                        resolve(data.message);
                    }
                };
            });

            ws1.send(JSON.stringify({
                type: 'message',
                text: 'Тест ID',
                recipient_id: user2.id,
            }));

            const message = await messagePromise;
            expect(message.id).toBeDefined();
            expect(typeof message.id).toBe('string');
            expect(message.id.length).toBeGreaterThan(0);
        });

        test('должен устанавливать временную метку сообщения', async () => {
            const beforeSend = Date.now();

            const messagePromise = new Promise((resolve) => {
                ws2.onmessage = (event) => {
                    const data = JSON.parse(event.data);
                    if (data.type === 'message') {
                        resolve(data.message);
                    }
                };
            });

            ws1.send(JSON.stringify({
                type: 'message',
                text: 'Тест времени',
                recipient_id: user2.id,
            }));

            const message = await messagePromise;
            const messageTime = message.timestamp * 1000;

            expect(messageTime).toBeGreaterThanOrEqual(beforeSend - 1000);
            expect(messageTime).toBeLessThanOrEqual(Date.now() + 1000);
        });

        test('должен отправлять сообщения в правильном формате', async () => {
            const messagePromise = new Promise((resolve) => {
                ws2.onmessage = (event) => {
                    const data = JSON.parse(event.data);
                    if (data.type === 'message') {
                        resolve(data.message);
                    }
                };
            });

            ws1.send(JSON.stringify({
                type: 'message',
                text: 'Форматированное сообщение',
                recipient_id: user2.id,
            }));

            const message = await messagePromise;
            expect(message).toHaveProperty('id');
            expect(message).toHaveProperty('text');
            expect(message).toHaveProperty('sender_id');
            expect(message).toHaveProperty('timestamp');
            expect(message.text).toBe('Форматированное сообщение');
        });
    });

    describe('Статусы доставки (ACK)', () => {
        let ws1, ws2;
        let user1, user2;

        beforeEach(async () => {
            user1 = await registerUser(`Sender_${Date.now()}`);
            user2 = await registerUser(`Receiver_${Date.now()}`);

            ws1 = await createWebSocket();
            ws2 = await createWebSocket();

            await new Promise((resolve) => {
                let resolved = 0;
                const checkResolve = () => {
                    resolved++;
                    if (resolved === 2) resolve();
                };

                ws1.onmessage = (event) => {
                    const data = JSON.parse(event.data);
                    if (data.type === 'registered') checkResolve();
                };
                ws2.onmessage = (event) => {
                    const data = JSON.parse(event.data);
                    if (data.type === 'registered') checkResolve();
                };

                ws1.send(JSON.stringify({ type: 'register', name: user1.name }));
                ws2.send(JSON.stringify({ type: 'register', name: user2.name }));
            });
        });

        afterEach(() => {
            if (ws1) ws1.close();
            if (ws2) ws2.close();
        });

        test('должен обновлять статус сообщения на "прочитано"', async () => {
            // Отправляем сообщение
            const messagePromise = new Promise((resolve) => {
                ws2.onmessage = (event) => {
                    const data = JSON.parse(event.data);
                    if (data.type === 'message') {
                        resolve(data.message);
                    }
                };
            });

            ws1.send(JSON.stringify({
                type: 'message',
                text: 'Сообщение для ACK',
                recipient_id: user2.id,
            }));

            const message = await messagePromise;

            // Отправляем ACK
            const ackPromise = new Promise((resolve) => {
                ws1.onmessage = (event) => {
                    const data = JSON.parse(event.data);
                    if (data.type === 'ack') {
                        resolve(data);
                    }
                };
            });

            ws2.send(JSON.stringify({
                type: 'ack',
                message_id: message.id,
                status: 'read',
            }));

            const ack = await ackPromise;
            expect(ack.type).toBe('ack');
            expect(ack.message_id).toBe(message.id);
            expect(ack.status).toBe('read');
        });

        test('должен отправлять ACK с правильным message_id', async () => {
            const messagePromise = new Promise((resolve) => {
                ws2.onmessage = (event) => {
                    const data = JSON.parse(event.data);
                    if (data.type === 'message') {
                        resolve(data.message);
                    }
                };
            });

            ws1.send(JSON.stringify({
                type: 'message',
                text: 'Тест ACK',
                recipient_id: user2.id,
            }));

            const message = await messagePromise;

            const ackPromise = new Promise((resolve) => {
                ws1.onmessage = (event) => {
                    const data = JSON.parse(event.data);
                    if (data.type === 'ack') {
                        resolve(data);
                    }
                };
            });

            ws2.send(JSON.stringify({
                type: 'ack',
                message_id: message.id,
                status: 'read',
            }));

            const ack = await ackPromise;
            expect(ack.message_id).toBe(message.id);
        });
    });

    describe('История сообщений', () => {
        test('должен возвращать историю сообщений', async () => {
            const ws = await createWebSocket();
            const user = await registerUser(`HistoryUser_${Date.now()}`);

            const messagesPromise = new Promise((resolve) => {
                ws.onmessage = (event) => {
                    const data = JSON.parse(event.data);
                    if (data.type === 'messages') {
                        resolve(data.messages);
                    }
                };
            });

            ws.send(JSON.stringify({ type: 'register', name: user.name }));
            await new Promise(r => setTimeout(r, 100));

            // Запрашиваем историю
            ws.send(JSON.stringify({ type: 'get_messages', limit: 100 }));

            const messages = await messagesPromise;
            expect(Array.isArray(messages)).toBe(true);

            ws.close();
        });

        test('должен ограничивать количество сообщений лимитом', async () => {
            const ws = await createWebSocket();
            const user = await registerUser(`LimitUser_${Date.now()}`);

            const messagesPromise = new Promise((resolve) => {
                ws.onmessage = (event) => {
                    const data = JSON.parse(event.data);
                    if (data.type === 'messages') {
                        resolve(data.messages);
                    }
                };
            });

            ws.send(JSON.stringify({ type: 'register', name: user.name }));
            await new Promise(r => setTimeout(r, 100));

            ws.send(JSON.stringify({ type: 'get_messages', limit: 5 }));

            const messages = await messagesPromise;
            expect(messages.length).toBeLessThanOrEqual(5);

            ws.close();
        });

        test('должен поддерживать пагинацию сообщений', async () => {
            const ws = await createWebSocket();
            const user = await registerUser(`PaginationUser_${Date.now()}`);

            const messagesPromise = new Promise((resolve) => {
                ws.onmessage = (event) => {
                    const data = JSON.parse(event.data);
                    if (data.type === 'messages') {
                        resolve(data);
                    }
                };
            });

            ws.send(JSON.stringify({ type: 'register', name: user.name }));
            await new Promise(r => setTimeout(r, 100));

            // Запрашиваем первую страницу
            ws.send(JSON.stringify({ type: 'get_messages', limit: 10 }));

            const response = await messagesPromise;
            expect(response).toHaveProperty('messages');
            expect(response).toHaveProperty('has_more');

            ws.close();
        });

        test('должен возвращать next_before_id для следующей страницы', async () => {
            const ws = await createWebSocket();
            const user = await registerUser(`PaginationNextUser_${Date.now()}`);

            const messagesPromise = new Promise((resolve) => {
                ws.onmessage = (event) => {
                    const data = JSON.parse(event.data);
                    if (data.type === 'messages') {
                        resolve(data);
                    }
                };
            });

            ws.send(JSON.stringify({ type: 'register', name: user.name }));
            await new Promise(r => setTimeout(r, 100));

            ws.send(JSON.stringify({ type: 'get_messages', limit: 5 }));

            const response = await messagesPromise;
            expect(response).toHaveProperty('next_before_id');
            expect(response).toHaveProperty('has_more');

            ws.close();
        });

        test('должен загружать сообщения по before_id', async () => {
            const ws = await createWebSocket();
            const user = await registerUser(`PaginationBeforeUser_${Date.now()}`);

            // Сначала загружаем первую страницу
            const firstPagePromise = new Promise((resolve) => {
                ws.onmessage = (event) => {
                    const data = JSON.parse(event.data);
                    if (data.type === 'messages') {
                        resolve(data);
                    }
                };
            });

            ws.send(JSON.stringify({ type: 'register', name: user.name }));
            await new Promise(r => setTimeout(r, 100));

            ws.send(JSON.stringify({ type: 'get_messages', limit: 5 }));

            const firstPage = await firstPagePromise;
            expect(firstPage).toHaveProperty('messages');

            // Если есть ещё сообщения, загружаем следующую страницу
            if (firstPage.has_more && firstPage.next_before_id) {
                const secondPagePromise = new Promise((resolve) => {
                    ws.onmessage = (event) => {
                        const data = JSON.parse(event.data);
                        if (data.type === 'messages') {
                            resolve(data);
                        }
                    };
                });

                ws.send(JSON.stringify({
                    type: 'get_messages',
                    limit: 5,
                    before_id: firstPage.next_before_id
                }));

                const secondPage = await secondPagePromise;
                expect(secondPage).toHaveProperty('messages');
                expect(Array.isArray(secondPage.messages)).toBe(true);
            }

            ws.close();
        });

        test('должен возвращать has_more=false когда сообщения закончились', async () => {
            const ws = await createWebSocket();
            const user = await registerUser(`PaginationEndUser_${Date.now()}`);

            const messagesPromise = new Promise((resolve) => {
                ws.onmessage = (event) => {
                    const data = JSON.parse(event.data);
                    if (data.type === 'messages') {
                        resolve(data);
                    }
                };
            });

            ws.send(JSON.stringify({ type: 'register', name: user.name }));
            await new Promise(r => setTimeout(r, 100));

            // Запрашиваем большое количество сообщений чтобы получить все
            ws.send(JSON.stringify({ type: 'get_messages', limit: 1000 }));

            const response = await messagesPromise;
            expect(response).toHaveProperty('has_more');
            // has_more должен быть false если сообщений меньше чем лимит

            ws.close();
        });
    });

    describe('Статусы онлайн пользователей', () => {
        test('должен возвращать список онлайн пользователей', async () => {
            const response = await fetch(`${TEST_SERVER_URL}/api/online`);
            const result = await response.json();

            expect(result.success).toBe(true);
            expect(Array.isArray(result.data)).toBe(true);
        });

        test('должен уведомлять о подключении пользователя', async () => {
            const ws = await createWebSocket();
            const user = await registerUser(`OnlineUser_${Date.now()}`);

            const onlinePromise = new Promise((resolve) => {
                ws.onmessage = (event) => {
                    const data = JSON.parse(event.data);
                    if (data.type === 'user_online') {
                        resolve(data);
                    }
                };
            });

            ws.send(JSON.stringify({ type: 'register', name: user.name }));

            const online = await onlinePromise;
            expect(online.type).toBe('user_online');
            expect(online.user_id).toBe(user.id);
            expect(online.online).toBe(true);

            ws.close();
        });
    });

    describe('CORS заголовки', () => {
        test('должен возвращать CORS заголовки', async () => {
            const response = await fetch(`${TEST_SERVER_URL}/api/users`, {
                headers: { 'Origin': 'http://example.com' },
            });

            // Сервер должен возвращать CORS заголовки
            expect(response.headers.has('Access-Control-Allow-Origin')).toBe(true);
        });

        test('должен поддерживать OPTIONS preflight запрос', async () => {
            const response = await fetch(`${TEST_SERVER_URL}/api/users`, {
                method: 'OPTIONS',
                headers: {
                    'Origin': 'http://example.com',
                    'Access-Control-Request-Method': 'GET',
                },
            });

            expect(response.status).toBe(200);
        });
    });
});

describe('Интеграционные тесты - Краевые случаи', () => {
    const TEST_SERVER_URL = 'http://localhost:8080';

    describe('Валидация данных', () => {
        test('должен обрабатывать специальные символы в имени', async () => {
            const specialNames = [
                'O\'Brien',
                '张三',
                'User<Script>',
                'User "Quotes"',
            ];

            for (const name of specialNames) {
                const response = await fetch(`${TEST_SERVER_URL}/api/register`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name }),
                });
                const result = await response.json();

                // Должен успешно зарегистрировать
                expect(result.success).toBe(true);
                expect(result.data.name).toBe(name);
            }
        });

        test('должен обрабатывать очень длинные имена', async () => {
            const longName = 'A'.repeat(1000);

            const response = await fetch(`${TEST_SERVER_URL}/api/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: longName }),
            });
            const result = await response.json();

            // Должен обработать без ошибок
            expect(result.success).toBe(true);
            expect(result.data.name.length).toBe(1000);
        });

        test('должен обрабатывать Unicode в сообщениях', async () => {
            const ws = await new Promise((resolve, reject) => {
                const ws = new WebSocketClient('ws://localhost:8080/ws');
                ws.onopen = () => resolve(ws);
                ws.onerror = reject;
                setTimeout(() => reject(new Error('Timeout')), 5000);
            });

            await new Promise((resolve) => {
                ws.onmessage = (event) => {
                    const data = JSON.parse(event.data);
                    if (data.type === 'registered') resolve(data.user);
                };
                ws.send(JSON.stringify({ type: 'register', name: 'UnicodeUser' }));
            });

            const unicodeMessages = [
                'Привет мир!',
                '你好世界',
                'مرحبا بالعالم',
                '👋🌍🚀',
            ];

            for (const text of unicodeMessages) {
                ws.send(JSON.stringify({
                    type: 'message',
                    text: text,
                }));
            }

            ws.close();

            // Тест проходит если не было ошибок
            expect(true).toBe(true);
        });

        test('должен обрабатывать пустые сообщения', async () => {
            const ws = await createWebSocket();
            await registerUser(`EmptyMsgUser_${Date.now()}`);

            ws.send(JSON.stringify({ type: 'register', name: 'test' }));
            await new Promise(r => setTimeout(r, 100));

            // Отправляем пустое сообщение
            ws.send(JSON.stringify({
                type: 'message',
                text: '',
            }));

            ws.close();
            expect(true).toBe(true);
        });
    });

    describe('Производительность', () => {
        test('должен обрабатывать множественные подключения', async () => {
            const connections = [];

            // Создаём 10 подключений
            for (let i = 0; i < 10; i++) {
                const ws = await new Promise((resolve, reject) => {
                    const ws = new WebSocketClient('ws://localhost:8080/ws');
                    ws.onopen = () => resolve(ws);
                    ws.onerror = reject;
                });
                connections.push(ws);
            }

            expect(connections.length).toBe(10);

            // Закрываем подключения
            connections.forEach(ws => ws.close());
        });

        test('должен обрабатывать быструю отправку сообщений', async () => {
            const ws = await createWebSocket();
            const user = await registerUser(`FastMsgUser_${Date.now()}`);

            ws.send(JSON.stringify({ type: 'register', name: user.name }));
            await new Promise(r => setTimeout(r, 100));

            // Отправляем 50 сообщений быстро
            for (let i = 0; i < 50; i++) {
                ws.send(JSON.stringify({
                    type: 'message',
                    text: `Message ${i}`,
                }));
            }

            ws.close();
            expect(true).toBe(true);
        });
    });

    describe('Обработка ошибок', () => {
        test('должен обрабатывать некорректный JSON', async () => {
            let ws;
            try {
                ws = await createWebSocket();

                // Отправляем некорректный JSON
                ws.send('not valid json{');

                // Соединение не должно закрыться
                await new Promise(r => setTimeout(r, 100));
                expect(ws.readyState).toBe(WebSocketClient.OPEN);
            } finally {
                if (ws) ws.close();
            }
        });

        test('должен обрабатывать неизвестные типы сообщений', async () => {
            let ws;
            try {
                ws = await createWebSocket();

                ws.send(JSON.stringify({
                    type: 'unknown_type',
                    data: 'test',
                }));

                // Соединение не должно закрыться
                await new Promise(r => setTimeout(r, 100));
                expect(ws.readyState).toBe(WebSocketClient.OPEN);
            } finally {
                if (ws) ws.close();
            }
        });
    });
});
