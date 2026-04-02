/**
 * Тесты для модуля logic/chat.js
 * Тестируем чистые функции бизнес-логики
 */

import {
    isMessageInCurrentChat,
    filterMessagesForChat,
    hasMoreMessagesForCurrentPeer,
    findLocalMessageIndex,
    isDuplicateMessage,
    isLocalMessage,
    createLocalMessage,
    updateMessageWithReal,
    getDeliveryStatusForNewMessage,
} from 'src/logic/chat.js';

describe('logic/chat.js - isMessageInCurrentChat', () => {
    const user = { id: 'user-1' };
    const currentPeer = 'user-2';

    test('должен показывать сообщения от текущего пира без recipient_id', () => {
        const msg = { sender_id: 'user-2', recipient_id: null, text: 'Hello' };
        expect(isMessageInCurrentChat(msg, currentPeer, user)).toBe(true);
    });

    test('не должен показывать наши сообщения без recipient_id в чате с другим пользователем', () => {
        const msg = { sender_id: 'user-1', recipient_id: null, text: 'Hi' };
        expect(isMessageInCurrentChat(msg, currentPeer, user)).toBe(false);
    });

    test('не должен показывать сообщения от других пользователей без recipient_id', () => {
        const msg = { sender_id: 'user-3', recipient_id: null, text: 'Other' };
        expect(isMessageInCurrentChat(msg, currentPeer, user)).toBe(false);
    });

    test('должен показывать наши сообщения текущему пиру', () => {
        const msg = { sender_id: 'user-1', recipient_id: 'user-2', text: 'Hi' };
        expect(isMessageInCurrentChat(msg, currentPeer, user)).toBe(true);
    });

    test('должен показывать сообщения от текущего пира нам', () => {
        const msg = { sender_id: 'user-2', recipient_id: 'user-1', text: 'Hello' };
        expect(isMessageInCurrentChat(msg, currentPeer, user)).toBe(true);
    });

    test('не должен показывать сообщения другому получателю', () => {
        const msg = { sender_id: 'user-2', recipient_id: 'user-3', text: 'Other' };
        expect(isMessageInCurrentChat(msg, currentPeer, user)).toBe(false);
    });

    test('не должен показывать наши сообщения другому получателю', () => {
        const msg = { sender_id: 'user-1', recipient_id: 'user-3', text: 'Other' };
        expect(isMessageInCurrentChat(msg, currentPeer, user)).toBe(false);
    });
});

describe('logic/chat.js - filterMessagesForChat', () => {
    const user = { id: 'user-1' };
    const currentPeer = 'user-2';

    const messages = [
        { id: '1', sender_id: 'user-2', recipient_id: null, text: 'General from peer' },
        { id: '2', sender_id: 'user-1', recipient_id: null, text: 'General from me' },
        { id: '3', sender_id: 'user-1', recipient_id: 'user-2', text: 'Direct to peer' },
        { id: '4', sender_id: 'user-2', recipient_id: 'user-1', text: 'Direct to me' },
        { id: '5', sender_id: 'user-3', recipient_id: 'user-4', text: 'Other chat' },
    ];

    test('должен фильтровать сообщения для текущего чата', () => {
        const filtered = filterMessagesForChat(messages, currentPeer, user);
		
        // Должны вернуться: 1 (general от peer), 3 (direct to peer), 4 (direct to me)
        expect(filtered).toHaveLength(3);
        expect(filtered.map(m => m.id)).toEqual(['1', '3', '4']);
    });

    test('должен возвращать пустой массив если нет currentPeer', () => {
        const filtered = filterMessagesForChat(messages, null, user);
        expect(filtered).toHaveLength(0);
    });

    test('должен возвращать пустой массив если messages пуст', () => {
        const filtered = filterMessagesForChat([], currentPeer, user);
        expect(filtered).toHaveLength(0);
    });
});

describe('logic/chat.js - hasMoreMessagesForCurrentPeer', () => {
    const baseState = {
        currentPeer: 'user-2',
        hasMoreMessages: true,
        isLoadingMessages: false,
        currentPeerBeforeId: 'msg-100',
    };

    test('должен возвращать true если все условия выполнены', () => {
        expect(hasMoreMessagesForCurrentPeer(baseState)).toBe(true);
    });

    test('должен возвращать false если нет currentPeer', () => {
        const state = { ...baseState, currentPeer: null };
        expect(hasMoreMessagesForCurrentPeer(state)).toBe(false);
    });

    test('должен возвращать false если нет больше сообщений', () => {
        const state = { ...baseState, hasMoreMessages: false };
        expect(hasMoreMessagesForCurrentPeer(state)).toBe(false);
    });

    test('должен возвращать false если идёт загрузка', () => {
        const state = { ...baseState, isLoadingMessages: true };
        expect(hasMoreMessagesForCurrentPeer(state)).toBe(false);
    });

    test('должен возвращать false если нет currentPeerBeforeId', () => {
        const state = { ...baseState, currentPeerBeforeId: null };
        expect(hasMoreMessagesForCurrentPeer(state)).toBe(false);
    });
});

describe('logic/chat.js - findLocalMessageIndex', () => {
    const userId = 'user-1';
    const ttl = 10;

    test('должен находить локальное сообщение по тексту и времени', () => {
        const messages = [
            { id: 'local_123', sender_id: 'user-1', text: 'Привет', timestamp: 1000 },
            { id: 'real-1', sender_id: 'user-2', text: 'Привет', timestamp: 1001 },
        ];
        const msg = { text: 'Привет', timestamp: 1005 };

        const index = findLocalMessageIndex(messages, msg, userId, ttl);
        expect(index).toBe(0);
    });

    test('должен возвращать -1 если локальное сообщение не найдено', () => {
        const messages = [
            { id: 'real-1', sender_id: 'user-2', text: 'Привет', timestamp: 1001 },
        ];
        const msg = { text: 'Привет', timestamp: 1005 };

        const index = findLocalMessageIndex(messages, msg, userId, ttl);
        expect(index).toBe(-1);
    });

    test('должен возвращать -1 если сообщение не от текущего пользователя', () => {
        const messages = [
            { id: 'local_123', sender_id: 'user-2', text: 'Привет', timestamp: 1000 },
        ];
        const msg = { text: 'Привет', timestamp: 1005 };

        const index = findLocalMessageIndex(messages, msg, userId, ttl);
        expect(index).toBe(-1);
    });

    test('должен возвращать -1 если текст не совпадает', () => {
        const messages = [
            { id: 'local_123', sender_id: 'user-1', text: 'Привет', timestamp: 1000 },
        ];
        const msg = { text: 'Пока', timestamp: 1005 };

        const index = findLocalMessageIndex(messages, msg, userId, ttl);
        expect(index).toBe(-1);
    });

    test('должен возвращать -1 если время отличается больше чем на ttl', () => {
        const messages = [
            { id: 'local_123', sender_id: 'user-1', text: 'Привет', timestamp: 1000 },
        ];
        const msg = { text: 'Привет', timestamp: 1020 }; // Разница 20 секунд > ttl 10

        const index = findLocalMessageIndex(messages, msg, userId, ttl);
        expect(index).toBe(-1);
    });
});

describe('logic/chat.js - isDuplicateMessage', () => {
    test('должен возвращать true если дубликат найден', () => {
        const messages = [{ id: 'msg-1' }, { id: 'msg-2' }];
        const msg = { id: 'msg-1' };

        expect(isDuplicateMessage(messages, msg)).toBe(true);
    });

    test('должен возвращать false если дубликат не найден', () => {
        const messages = [{ id: 'msg-1' }, { id: 'msg-2' }];
        const msg = { id: 'msg-3' };

        expect(isDuplicateMessage(messages, msg)).toBe(false);
    });

    test('должен возвращать false для пустого массива', () => {
        const messages = [];
        const msg = { id: 'msg-1' };

        expect(isDuplicateMessage(messages, msg)).toBe(false);
    });
});

describe('logic/chat.js - isLocalMessage', () => {
    test('должен возвращать true для локального сообщения', () => {
        const msg = { id: 'local_123' };
        expect(isLocalMessage(msg)).toBe(true);
    });

    test('должен возвращать false для реального сообщения', () => {
        const msg = { id: 'real-uuid-123' };
        expect(isLocalMessage(msg)).toBe(false);
    });

    test('должен бросать ошибку для сообщения без id', () => {
        const msg = {};
        expect(() => isLocalMessage(msg)).toThrow();
    });
});

describe('logic/chat.js - createLocalMessage', () => {
    const userId = 'user-1';
    const userName = 'Тест';

    test('должен создавать локальное сообщение с правильными полями', () => {
        const msg = createLocalMessage('Привет!', userId, userName);

        expect(msg.id).toMatch(/^local_\d+_[a-z0-9]+$/);
        expect(msg.sender_id).toBe(userId);
        expect(msg.sender_name).toBe(userName);
        expect(msg.text).toBe('Привет!');
        expect(msg.delivery_status).toBe(0); // SENDING
        expect(msg.recipient_id).toBeNull();
        expect(msg.files).toEqual([]);
    });

    test('должен создавать локальное сообщение с файлами', () => {
        const files = [{ name: 'file.txt', size: 100, path: 'path' }];
        const msg = createLocalMessage('Привет!', userId, userName, files);

        expect(msg.files).toEqual(files);
    });

    test('должен создавать локальное сообщение с получателем', () => {
        const recipientId = 'user-2';
        const msg = createLocalMessage('Привет!', userId, userName, [], recipientId);

        expect(msg.recipient_id).toBe(recipientId);
    });

    test('должен генерировать уникальный id для каждого сообщения', () => {
        const msg1 = createLocalMessage('Тест 1', userId, userName);
        const msg2 = createLocalMessage('Тест 2', userId, userName);

        expect(msg1.id).not.toBe(msg2.id);
    });
});

describe('logic/chat.js - updateMessageWithReal', () => {
    test('должен объединять локальное и реальное сообщение', () => {
        const localMsg = {
            id: 'local_123',
            delivery_status: 0, // SENDING
            text: 'Привет',
        };
        const realMsg = {
            id: 'real-uuid',
            delivery_status: 1, // SENT
            text: 'Привет',
            sender_id: 'user-1',
        };

        const result = updateMessageWithReal(localMsg, realMsg);

        expect(result.id).toBe('real-uuid');
        expect(result.delivery_status).toBe(0); // Сохранён статус локального
        expect(result.text).toBe('Привет');
        expect(result.sender_id).toBe('user-1');
    });
});

describe('logic/chat.js - getDeliveryStatusForNewMessage', () => {
    test('должен возвращать READ для нашего сообщения в открытом чате', () => {
        const status = getDeliveryStatusForNewMessage(true, 'user-2', 'user-2');
        expect(status).toBe(2); // READ
    });

    test('должен возвращать SENT для нашего сообщения без чата', () => {
        const status = getDeliveryStatusForNewMessage(true, null, null);
        expect(status).toBe(1); // SENT
    });

    test('должен возвращать READ для сообщения от текущего пира', () => {
        const status = getDeliveryStatusForNewMessage(false, 'user-2', 'user-2');
        expect(status).toBe(2); // READ
    });

    test('должен возвращать SENT для сообщения от другого пользователя', () => {
        const status = getDeliveryStatusForNewMessage(false, 'user-2', 'user-3');
        expect(status).toBe(1); // SENT
    });
});
