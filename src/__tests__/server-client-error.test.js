/**
 * Тесты для ServerClient — обработка типа 'error' от сервера
 */

import { ServerClient } from '../server-client.js';

describe('ServerClient — обработка error от сервера', () => {
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

    describe('handleMessage — type: error', () => {
        test('должен уведомлять обработчиков при получении error', () => {
            const handler = jest.fn();
            client.on('error', handler);

            const errorData = {
                type: 'error',
                error: 'Message too long (max 10000 characters)',
                text: 'x'.repeat(10001),
            };

            client.handleMessage(errorData);

            expect(handler).toHaveBeenCalledWith(errorData);
        });

        test('должен передавать все поля ошибки обработчику', () => {
            const handler = jest.fn();
            client.on('error', handler);

            client.handleMessage({
                type: 'error',
                error: 'Rate limit exceeded',
                message_id: 'some-id',
                recipient_id: 'user-123',
            });

            expect(handler).toHaveBeenCalledWith(expect.objectContaining({
                type: 'error',
                error: 'Rate limit exceeded',
                message_id: 'some-id',
                recipient_id: 'user-123',
            }));
        });

        test('должен обрабатывать error с полем message вместо error', () => {
            const handler = jest.fn();
            client.on('error', handler);

            client.handleMessage({
                type: 'error',
                message: 'Alternative error format',
            });

            expect(handler).toHaveBeenCalledWith({
                type: 'error',
                message: 'Alternative error format',
            });
        });

        test('должен логировать ошибку в console.error', () => {
            const spy = jest.spyOn(console, 'error').mockImplementation();
            const handler = jest.fn();
            client.on('error', handler);

            client.handleMessage({
                type: 'error',
                error: 'Test error',
            });

            expect(spy).toHaveBeenCalledWith(
                '❌ Ошибка от сервера:',
                'Test error',
                expect.objectContaining({ type: 'error', error: 'Test error' })
            );

            spy.mockRestore();
        });
    });
});
