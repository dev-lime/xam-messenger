/**
 * Тесты для chat/handlers.js — логика без DOM
 */

import { handleNewMessage, handleAck, handleChatDeleted } from 'src/chat/handlers.js';
import { state, setServerClient, elements } from 'src/state.js';

class MockServerClient {
    constructor() { this.httpUrl = 'http://127.0.0.1:8080'; this.messageHandlers = []; }
    send() {}
    sendAck() {}
    getUsers() { return Promise.resolve([{ id: 'user3', name: 'New' }]); }
    on() {}
}

beforeEach(() => {
    state.messages = [];
    state.filteredMessages = [];
    state.currentPeer = 'user2';
    state.user = { id: 'user1', name: 'Test' };
    state.peers = [{ id: 'user2', name: 'Peer' }];
    setServerClient(new MockServerClient());

    // Мокаем элементы для renderMessages
    elements.messages = document.createElement('div');
    elements.messagesContainer = document.createElement('div');
    elements.messagesContainer.appendChild(elements.messages);
    elements.loadMoreBtn = null;
    elements.loadMoreContainer = null;
});

describe('chat/handlers.js - handleNewMessage', () => {
    test('должен добавлять входящее сообщение', () => {
        handleNewMessage({
            id: 'msg-1', sender_id: 'user2', sender_name: 'Peer',
            text: 'Привет!', timestamp: Date.now() / 1000, delivery_status: 1,
            recipient_id: 'user1', files: [],
        });

        expect(state.messages.length).toBe(1);
        expect(state.messages[0].text).toBe('Привет!');
    });

    test('не должен добавлять дубликат', () => {
        const msg = {
            id: 'msg-1', sender_id: 'user2', sender_name: 'Peer',
            text: 'Привет!', timestamp: Date.now() / 1000, delivery_status: 1,
            recipient_id: 'user1', files: [],
        };

        handleNewMessage(msg);
        handleNewMessage(msg);

        expect(state.messages.length).toBe(1);
    });

    test('должен фильтровать сообщения для текущего чата', () => {
        handleNewMessage({
            id: 'msg-1', sender_id: 'user2', sender_name: 'Peer',
            text: 'Привет!', timestamp: Date.now() / 1000, delivery_status: 1,
            recipient_id: 'user1', files: [],
        });

        expect(state.filteredMessages.length).toBe(1);
    });
});

describe('chat/handlers.js - handleAck', () => {
    test('должен обновлять статус доставки', () => {
        state.messages.push({
            id: 'msg-1', sender_id: 'user1', sender_name: 'Test',
            text: 'Hi', timestamp: Date.now() / 1000, delivery_status: 0,
            recipient_id: 'user2', files: [],
        });

        handleAck({ message_id: 'msg-1', status: 'read', sender_id: 'user2' });

        expect(state.messages[0].delivery_status).toBe(2);
    });
});

describe('chat/handlers.js - handleChatDeleted', () => {
    test('должен удалять сообщения чата', () => {
        state.messages = [
            { id: 'm1', sender_id: 'user1', recipient_id: 'user2', text: 'Hi', timestamp: 1000, delivery_status: 1, sender_name: 'Test', files: [] },
            { id: 'm2', sender_id: 'user2', recipient_id: 'user1', text: 'Hello', timestamp: 1001, delivery_status: 1, sender_name: 'Peer', files: [] },
            { id: 'm3', sender_id: 'user1', recipient_id: 'user3', text: 'Other', timestamp: 1002, delivery_status: 1, sender_name: 'Test', files: [] },
        ];

        handleChatDeleted({ peer_id: 'user2' });

        expect(state.messages.length).toBe(1);
        expect(state.messages[0].id).toBe('m3');
    });
});
