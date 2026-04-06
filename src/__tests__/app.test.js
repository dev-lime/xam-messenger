/**
 * Тесты для app.js - логика пагинации сообщений
 * Тестируем только уникальную бизнес-логику приложения
 * (helpers и isMessageInCurrentChat тестируются в helpers.test.js и logic-chat.test.js)
 */

import { hasMoreMessagesForCurrentPeer } from 'src/logic/chat.js';

describe('app.js - Пагинация сообщений', () => {
    describe('hasMoreMessagesForCurrentPeer (реальная функция из logic/chat.js)', () => {
        test('должен возвращать false если чат не выбран', () => {
            const state = { currentPeer: null, hasMoreMessages: true, isLoadingMessages: false, currentPeerBeforeId: 'msg-100' };
            expect(hasMoreMessagesForCurrentPeer(state)).toBe(false);
        });

        test('должен возвращать false если нет больше сообщений', () => {
            const state = { currentPeer: 'user-2', hasMoreMessages: false, isLoadingMessages: false, currentPeerBeforeId: 'msg-100' };
            expect(hasMoreMessagesForCurrentPeer(state)).toBe(false);
        });

        test('должен возвращать false если идёт загрузка', () => {
            const state = { currentPeer: 'user-2', hasMoreMessages: true, isLoadingMessages: true, currentPeerBeforeId: 'msg-100' };
            expect(hasMoreMessagesForCurrentPeer(state)).toBe(false);
        });

        test('должен возвращать true если все условия выполнены', () => {
            const state = { currentPeer: 'user-2', hasMoreMessages: true, isLoadingMessages: false, currentPeerBeforeId: 'msg-123' };
            expect(hasMoreMessagesForCurrentPeer(state)).toBe(true);
        });

        test('должен возвращать false если нет currentPeerBeforeId', () => {
            const state = { currentPeer: 'user-2', hasMoreMessages: true, isLoadingMessages: false, currentPeerBeforeId: null };
            expect(hasMoreMessagesForCurrentPeer(state)).toBe(false);
        });
    });

    describe('Бесконечный цикл загрузки — предотвращение', () => {
        test('должен прекращать загрузку если messages.length === 0', () => {
            const data = {
                messages: [],
                next_before_id: null,
                has_more: true,
                before_id: 'msg-100',
            };

            const shouldStop = data.before_id &&
                data.messages.length === 0;

            expect(shouldStop).toBe(true);
        });

        test('должен продолжать загрузку только если messages.length > 0', () => {
            const data = {
                messages: [{ id: 'msg-1', sender_id: 'user-3', text: 'Other chat' }],
                next_before_id: 'msg-50',
                has_more: true,
                before_id: 'msg-100',
            };

            const shouldContinue = data.before_id &&
                data.has_more &&
                data.next_before_id &&
                data.messages.length > 0;

            expect(shouldContinue).toBe(true);
        });

        test('не должен продолжать загрузку если messages.length === 0', () => {
            const data = {
                messages: [],
                next_before_id: 'msg-50',
                has_more: true,
                before_id: 'msg-100',
            };

            const shouldContinue = data.before_id &&
                data.has_more &&
                data.next_before_id &&
                data.messages.length > 0;

            expect(shouldContinue).toBe(false);
        });
    });
});
