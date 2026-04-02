/**
 * Тесты для модуля ui/renderers.js
 * Тестируем функции рендеринга
 */

import {
    createFilesHtml,
    getStatusIcon,
    getStatusTitle,
    formatMessageTime,
    createMineMessageHtml,
    createTheirsMessageHtml,
    createPeerElementHtml,
    createEmptyChatHtml,
    createAttachedFilesHtml,
} from 'src/ui/renderers.js';
import { DELIVERY_STATUS } from 'src/utils/helpers.js';

describe('ui/renderers.js - createFilesHtml', () => {
    test('должен возвращать пустую строку для пустого массива', () => {
        expect(createFilesHtml([])).toBe('');
        expect(createFilesHtml(null)).toBe('');
        expect(createFilesHtml(undefined)).toBe('');
    });

    test('должен создавать HTML для одного файла', () => {
        const files = [{ name: 'doc.pdf', size: 1024, path: 'path-123' }];
        const html = createFilesHtml(files);

        expect(html).toContain('attached-file-item');
        expect(html).toContain('doc.pdf');
        expect(html).toContain('📄');
        expect(html).toContain('1 KB');
    });

    test('должен создавать HTML для нескольких файлов', () => {
        const files = [
            { name: 'doc.pdf', size: 1024, path: 'path-1' },
            { name: 'image.png', size: 2048, path: 'path-2' },
        ];
        const html = createFilesHtml(files);

        expect(html.split('attached-file-item').length - 1).toBe(2);
        expect(html).toContain('doc.pdf');
        expect(html).toContain('image.png');
        expect(html).toContain('📄');
        expect(html).toContain('🖼️');
    });

    test('должен экранировать HTML в имени файла', () => {
        const files = [{ name: '<script>alert("xss")</script>.pdf', size: 100, path: 'path' }];
        const html = createFilesHtml(files);

        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;script&gt;');
    });
});

describe('ui/renderers.js - getStatusIcon', () => {
    test('должен возвращать иконку для статуса 0 (SENT)', () => {
        expect(getStatusIcon(0)).toBe('🕐');
    });

    test('должен возвращать иконку для статуса 1 (DELIVERED)', () => {
        expect(getStatusIcon(1)).toBe('✓');
    });

    test('должен возвращать иконку для статуса 2 (READ)', () => {
        expect(getStatusIcon(2)).toBe('✓✓');
    });

    test('должен возвращать иконку по умолчанию для неизвестного статуса', () => {
        expect(getStatusIcon(99)).toBe('🕐');
        expect(getStatusIcon(-1)).toBe('🕐');
    });
});

describe('ui/renderers.js - getStatusTitle', () => {
    test('должен возвращать описание для статуса 0 (SENT)', () => {
        expect(getStatusTitle(0)).toBe('Отправлено');
    });

    test('должен возвращать описание для статуса 1 (DELIVERED)', () => {
        expect(getStatusTitle(1)).toBe('Доставлено');
    });

    test('должен возвращать описание для статуса 2 (READ)', () => {
        expect(getStatusTitle(2)).toBe('Прочитано');
    });

    test('должен возвращать "Отправлено" для неизвестного статуса', () => {
        expect(getStatusTitle(99)).toBe('Отправлено');
    });
});

describe('ui/renderers.js - formatMessageTime', () => {
    test('должен форматировать время в формате HH:MM', () => {
        // Timestamp для 2024-01-01 14:30:00 UTC
        const timestamp = 1704117000;
        expect(formatMessageTime(timestamp)).toMatch(/^\d{2}:\d{2}$/);
    });

    test('должен добавлять ведущий ноль для часов и минут', () => {
        // Timestamp для 2024-01-01 01:05:00 UTC
        const timestamp = 1704071100;
        const result = formatMessageTime(timestamp);
        expect(result).toMatch(/^\d{2}:\d{2}$/);
    });
});

describe('ui/renderers.js - createMineMessageHtml', () => {
    const msg = {
        id: 'msg-1',
        text: 'Привет!',
        delivery_status: DELIVERY_STATUS.DELIVERED,
        files: [],
    };

    test('должен создавать HTML для сообщения с текстом', () => {
        const html = createMineMessageHtml(msg, '14:30');

        expect(html).toContain('message mine');
        expect(html).toContain('data-message-id="msg-1"');
        expect(html).toContain('Привет!');
        expect(html).toContain('14:30');
        expect(html).toContain('✓'); // DELIVERED status
    });

    test('должен создавать HTML для сообщения с файлами', () => {
        const msgWithFiles = {
            ...msg,
            files: [{ name: 'file.txt', size: 100, path: 'path' }],
        };
        const html = createMineMessageHtml(msgWithFiles, '14:30');

        expect(html).toContain('message-files');
        expect(html).toContain('file.txt');
    });

    test('должен создавать HTML для сообщения без текста но с файлами', () => {
        const msgWithFilesOnly = {
            ...msg,
            text: '',
            files: [{ name: 'file.txt', size: 100, path: 'path' }],
        };
        const html = createMineMessageHtml(msgWithFilesOnly, '14:30');

        expect(html).toContain('message-files');
        expect(html).not.toContain('message-text');
    });

    test('должен экранировать HTML в тексте сообщения', () => {
        const msgWithHtml = {
            ...msg,
            text: '<script>alert("xss")</script>',
        };
        const html = createMineMessageHtml(msgWithHtml, '14:30');

        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;script&gt;');
    });

    test('должен показывать статус READ для сообщения со статусом 2', () => {
        const msgRead = { ...msg, delivery_status: 2 };
        const html = createMineMessageHtml(msgRead, '14:30');

        expect(html).toContain('✓✓');
        expect(html).toContain('Прочитано');
    });
});

describe('ui/renderers.js - createTheirsMessageHtml', () => {
    const msg = {
        id: 'msg-1',
        sender_name: 'Артём',
        text: 'Привет!',
        files: [],
    };

    test('должен создавать HTML для сообщения от другого пользователя', () => {
        const html = createTheirsMessageHtml(msg, '14:30');

        expect(html).toContain('message theirs');
        expect(html).toContain('data-message-id="msg-1"');
        expect(html).toContain('Артём');
        expect(html).toContain('Привет!');
        expect(html).toContain('14:30');
    });

    test('должен создавать HTML для сообщения с файлами', () => {
        const msgWithFiles = {
            ...msg,
            files: [{ name: 'file.txt', size: 100, path: 'path' }],
        };
        const html = createTheirsMessageHtml(msgWithFiles, '14:30');

        expect(html).toContain('message-files');
        expect(html).toContain('file.txt');
    });

    test('должен экранировать HTML в имени отправителя и тексте', () => {
        const msgWithHtml = {
            ...msg,
            sender_name: '<b>Боб</b>',
            text: '<script>alert("xss")</script>',
        };
        const html = createTheirsMessageHtml(msgWithHtml, '14:30');

        expect(html).not.toContain('<b>');
        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;b&gt;Боб&lt;/b&gt;');
        expect(html).toContain('&lt;script&gt;');
    });
});

describe('ui/renderers.js - createPeerElementHtml', () => {
    const peer = {
        id: 'user-1',
        name: 'Артём',
        avatar: '👨',
    };

    test('должен создавать HTML для контакта онлайн', () => {
        const html = createPeerElementHtml(peer, 'Привет!', '14:30', true);

        expect(html).toContain('peer-item online');
        expect(html).toContain('data-user-id="user-1"');
        expect(html).toContain('Артём');
        expect(html).toContain('👨');
        expect(html).toContain('Привет!');
        expect(html).toContain('14:30');
        expect(html).toContain('peer-status-indicator online');
    });

    test('должен создавать HTML для контакта офлайн', () => {
        const html = createPeerElementHtml(peer, 'Привет!', '14:30', false);

        expect(html).toContain('peer-item offline');
        expect(html).toContain('peer-status-indicator offline');
    });

    test('должен создавать HTML без последнего сообщения', () => {
        const html = createPeerElementHtml(peer, '', '', false);

        // HTML содержит peer-last-message но без текста и времени
        expect(html).toContain('peer-last-message');
        expect(html).not.toContain('peer-time');
    });

    test('должен создавать HTML с аватаром по умолчанию', () => {
        const peerWithoutAvatar = { id: 'user-1', name: 'Тест' };
        const html = createPeerElementHtml(peerWithoutAvatar);

        expect(html).toContain('👤');
    });

    test('должен экранировать HTML в имени контакта', () => {
        const peerWithHtml = { id: 'user-1', name: '<script>alert("xss")</script>', avatar: '👤' };
        const html = createPeerElementHtml(peerWithHtml);

        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;script&gt;');
    });
});

describe('ui/renderers.js - createEmptyChatHtml', () => {
    test('должен создавать HTML для пустого чата', () => {
        const html = createEmptyChatHtml();

        expect(html).toContain('empty-chat');
        expect(html).toContain('empty-chat-icon');
        expect(html).toContain('empty-chat-text');
        expect(html).toContain('Выберите контакт');
    });
});

describe('ui/renderers.js - createAttachedFilesHtml', () => {
    test('должен возвращать пустую строку для пустого массива', () => {
        expect(createAttachedFilesHtml([])).toBe('');
        expect(createAttachedFilesHtml(null)).toBe('');
    });

    test('должен создавать HTML для прикрепленных файлов', () => {
        const files = [
            { name: 'file1.txt', size: 100 },
            { name: 'file2.pdf', size: 200 },
        ];
        const html = createAttachedFilesHtml(files);

        expect(html.split('attached-file-preview').length - 1).toBe(2);
        expect(html).toContain('file1.txt');
        expect(html).toContain('file2.pdf');
        expect(html).toContain('data-index="0"');
        expect(html).toContain('data-index="1"');
        expect(html).toContain('remove-file-btn');
    });

    test('должен создавать HTML с иконками файлов', () => {
        const files = [{ name: 'doc.pdf', size: 100 }];
        const html = createAttachedFilesHtml(files);

        expect(html).toContain('📄');
    });
});
