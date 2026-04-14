/**
 * Тесты для chat/handlers.js — обработка ошибок от сервера (handleServerError)
 */

import { handleServerError } from 'src/chat/handlers.js';
import { state, setServerClient, elements } from 'src/state.js';
import { DELIVERY_STATUS } from 'src/utils/helpers.js';

class MockServerClient {
    constructor() { this.httpUrl = 'http://127.0.0.1:8080'; this.messageHandlers = []; }
    send() {}
    sendAck() {}
    getUsers() { return Promise.resolve([]); }
    on() {}
}

beforeEach(() => {
    state.messages = [];
    state.filteredMessages = [];
    state.currentPeer = 'user2';
    state.user = { id: 'user1', name: 'Test' };
    state.peers = [];
    setServerClient(new MockServerClient());

    elements.messages = document.createElement('div');
    elements.messagesContainer = document.createElement('div');
    elements.messagesContainer.appendChild(elements.messages);
    elements.loadMoreBtn = null;
    elements.loadMoreContainer = null;
});

describe('chat/handlers.js - handleServerError', () => {
    test('должен помечать локальное сообщение со статусом -1 при ошибке сервера', () => {
        // Добавляем локальное сообщение
        state.messages.push({
            id: 'local_1000_text',
            sender_id: 'user1', sender_name: 'Test',
            text: 'Too long message',
            timestamp: Date.now() / 1000,
            delivery_status: DELIVERY_STATUS.SENT,
            recipient_id: 'user2', files: [],
        });

        handleServerError({
            type: 'error',
            error: 'Message too long (max 10000 characters)',
            text: 'Too long message',
        });

        expect(state.messages[0].delivery_status).toBe(-1);
        expect(state.messages[0].send_error).toBe('Message too long (max 10000 characters)');
    });

    test('должен находить сообщение по совпадению текста', () => {
        state.messages.push({
            id: 'local_1000_text',
            sender_id: 'user1', sender_name: 'Test',
            text: 'Hello world',
            timestamp: Date.now() / 1000,
            delivery_status: DELIVERY_STATUS.SENT,
            recipient_id: 'user2', files: [],
        });
        state.messages.push({
            id: 'local_1001_text',
            sender_id: 'user1', sender_name: 'Test',
            text: 'Another message',
            timestamp: Date.now() / 1000,
            delivery_status: DELIVERY_STATUS.SENT,
            recipient_id: 'user2', files: [],
        });

        handleServerError({
            type: 'error',
            error: 'Rate limit exceeded',
            text: 'Another message',
        });

        // Должно быть помечено второе сообщение (по совпадению текста)
        expect(state.messages[1].delivery_status).toBe(-1);
        // Первое должно остаться нетронутым
        expect(state.messages[0].delivery_status).toBe(DELIVERY_STATUS.SENT);
    });

    test('должен помечать последнее локальное сообщение как fallback', () => {
        state.messages.push({
            id: 'local_1000_text',
            sender_id: 'user1', sender_name: 'Test',
            text: 'Msg 1',
            timestamp: Date.now() / 1000,
            delivery_status: DELIVERY_STATUS.SENT,
            recipient_id: 'user2', files: [],
        });
        state.messages.push({
            id: 'local_1001_text',
            sender_id: 'user1', sender_name: 'Test',
            text: 'Msg 2',
            timestamp: Date.now() / 1000,
            delivery_status: DELIVERY_STATUS.SENT,
            recipient_id: 'user2', files: [],
        });

        // Ошибка без совпадения текста — должен пометить последнее
        handleServerError({
            type: 'error',
            error: 'Some error',
            text: 'Nonexistent text',
        });

        expect(state.messages[1].delivery_status).toBe(-1);
        expect(state.messages[0].delivery_status).toBe(DELIVERY_STATUS.SENT);
    });

    test('должен обновлять filteredMessages', () => {
        const localMsg = {
            id: 'local_1000_text',
            sender_id: 'user1', sender_name: 'Test',
            text: 'Test message',
            timestamp: Date.now() / 1000,
            delivery_status: DELIVERY_STATUS.SENT,
            recipient_id: 'user2', files: [],
        };
        state.messages.push(localMsg);
        state.filteredMessages.push({ ...localMsg });

        handleServerError({
            type: 'error',
            error: 'Test error',
            text: 'Test message',
        });

        expect(state.filteredMessages[0].delivery_status).toBe(-1);
        expect(state.filteredMessages[0].send_error).toBe('Test error');
    });

    test('должен игнорировать уже подтверждённые сообщения', () => {
        // Сообщение уже получило ACK (DELIVERED)
        state.messages.push({
            id: 'real-uuid-123',
            sender_id: 'user1', sender_name: 'Test',
            text: 'Already delivered',
            timestamp: Date.now() / 1000,
            delivery_status: DELIVERY_STATUS.DELIVERED,
            recipient_id: 'user2', files: [],
        });

        handleServerError({
            type: 'error',
            error: 'Some error',
            text: 'Already delivered',
        });

        // Сообщение не должно быть изменено (не local_ и не SENT)
        expect(state.messages[0].delivery_status).toBe(DELIVERY_STATUS.DELIVERED);
    });

    test('должен использовать data.message как fallback для текста ошибки', () => {
        state.messages.push({
            id: 'local_1000_text',
            sender_id: 'user1', sender_name: 'Test',
            text: 'Some text',
            timestamp: Date.now() / 1000,
            delivery_status: DELIVERY_STATUS.SENT,
            recipient_id: 'user2', files: [],
        });

        handleServerError({
            type: 'error',
            message: 'Fallback error message',
        });

        expect(state.messages[0].send_error).toBe('Fallback error message');
    });

    test('должен использовать "Unknown error" если нет error и message', () => {
        state.messages.push({
            id: 'local_1000_text',
            sender_id: 'user1', sender_name: 'Test',
            text: 'Some text',
            timestamp: Date.now() / 1000,
            delivery_status: DELIVERY_STATUS.SENT,
            recipient_id: 'user2', files: [],
        });

        handleServerError({
            type: 'error',
        });

        expect(state.messages[0].send_error).toBe('Unknown error');
    });

    test('не должен падать при пустом state.messages', () => {
        expect(() => handleServerError({ type: 'error', error: 'test' })).not.toThrow();
    });
});
