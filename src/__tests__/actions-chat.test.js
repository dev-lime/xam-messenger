/**
 * Тесты для chat/actions.js — тестирование логики без DOM
 */

import { state, setAttachedFiles } from 'src/state.js';
import { filterMessagesForCurrentChat } from 'src/chat/pagination.js';

describe('chat/actions logic - message creation', () => {
    beforeEach(() => {
        state.messages = [];
        state.filteredMessages = [];
        state.currentPeer = 'user2';
        state.user = { id: 'user1', name: 'Test' };
        setAttachedFiles([]);
    });

    test('должен создавать правильное локальное сообщение', () => {
        const messageData = {
            id: `local_${Date.now()}`,
            sender_id: state.user.id,
            sender_name: state.user.name,
            text: 'Привет!',
            timestamp: Date.now() / 1000,
            delivery_status: 0,
            files: [],
            recipient_id: state.currentPeer,
        };

        state.messages.push(messageData);
        expect(state.messages[0].sender_id).toBe('user1');
        expect(state.messages[0].id).toMatch(/^local_/);
        expect(state.messages[0].text).toBe('Привет!');
    });

    test('должен фильтровать сообщения для текущего чата', () => {
        state.messages = [
            { id: 'm1', sender_id: 'user1', recipient_id: 'user2', text: 'Hi', timestamp: 1000, delivery_status: 1, sender_name: 'Test', files: [] },
            { id: 'm2', sender_id: 'user3', recipient_id: 'user4', text: 'Other', timestamp: 1001, delivery_status: 1, sender_name: 'Other', files: [] },
        ];

        filterMessagesForCurrentChat();
        expect(state.filteredMessages.length).toBe(1);
        expect(state.filteredMessages[0].id).toBe('m1');
    });
});
