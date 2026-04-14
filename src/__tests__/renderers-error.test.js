/**
 * Тесты для ui/renderers.js — обработка статуса ошибки (-1)
 */

import { loadTranslations, setLanguage } from 'src/i18n.js';
import {
    createMineMessageHtml,
    getStatusIcon,
    getStatusTitle,
} from 'src/ui/renderers.js';
import { DELIVERY_STATUS } from 'src/utils/helpers.js';

beforeAll(async () => {
    await loadTranslations();
    setLanguage('ru');
});

describe('ui/renderers.js - error status (delivery_status = -1)', () => {
    test('createMineMessageHtml должен добавлять класс message-error для статуса -1', () => {
        const msg = {
            id: 'local_err_1',
            text: 'Failed message',
            delivery_status: -1,
            send_error: 'Message too long',
            files: [],
        };
        const html = createMineMessageHtml(msg, '14:30');

        expect(html).toContain('message mine message-error');
        expect(html).toContain('❗');
    });

    test('createMineMessageHtml должен устанавливать title с текстом ошибки', () => {
        const msg = {
            id: 'local_err_2',
            text: 'Failed message 2',
            delivery_status: -1,
            send_error: 'Rate limit exceeded',
            files: [],
        };
        const html = createMineMessageHtml(msg, '14:30');

        expect(html).toContain('Rate limit exceeded');
    });

    test('createMineMessageHtml должен добавлять status-error к статус-элементу', () => {
        const msg = {
            id: 'local_err_3',
            text: 'Failed message 3',
            delivery_status: -1,
            send_error: 'Test error',
            files: [],
        };
        const html = createMineMessageHtml(msg, '14:30');

        expect(html).toContain('status-error');
    });

    test('createMineMessageHtml НЕ должен добавлять message-error для нормальных статусов', () => {
        const msgSent = { id: 'm1', text: 'Hi', delivery_status: 0, files: [] };
        const msgDelivered = { id: 'm2', text: 'Hi', delivery_status: 1, files: [] };
        const msgRead = { id: 'm3', text: 'Hi', delivery_status: 2, files: [] };

        expect(createMineMessageHtml(msgSent, '14:30')).not.toContain('message-error');
        expect(createMineMessageHtml(msgDelivered, '14:30')).not.toContain('message-error');
        expect(createMineMessageHtml(msgRead, '14:30')).not.toContain('message-error');
    });

    test('createMineMessageHtml должен экранировать текст ошибки в title', () => {
        const msg = {
            id: 'local_err_4',
            text: 'Failed',
            delivery_status: -1,
            send_error: 'Error: <script>alert("xss")</script>',
            files: [],
        };
        const html = createMineMessageHtml(msg, '14:30');

        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;script&gt;');
    });

    test('createMineMessageHtml должен использовать "Ошибка отправки" как fallback для send_error', () => {
        const msg = {
            id: 'local_err_5',
            text: 'Failed',
            delivery_status: -1,
            files: [],
        };
        const html = createMineMessageHtml(msg, '14:30');

        expect(html).toContain('Ошибка отправки');
    });

    test('getStatusIcon должен возвращать 🕐 для -1 (fallback)', () => {
        expect(getStatusIcon(-1)).toBe('🕐');
    });

    test('getStatusTitle должен возвращать "Отправлено" для -1 (fallback)', () => {
        expect(getStatusTitle(-1)).toBe('Отправлено');
    });
});
