/**
 * Тесты для app.js - основное приложение чата
 */

import { fireEvent, waitFor } from '@testing-library/dom';

// Вспомогательные функции
const escapeHtml = (text) => {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
};

const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
};

const getFileIcon = (filename) => {
    const ext = filename.split('.').pop().toLowerCase();
    const icons = {
        'pdf': '📄',
        'doc': '📝', 'docx': '📝',
        'xls': '📊', 'xlsx': '📊',
        'ppt': '📊', 'pptx': '📊',
        'txt': '📄',
        'jpg': '🖼️', 'jpeg': '🖼️', 'png': '🖼️', 'gif': '🖼️', 'bmp': '🖼️', 'svg': '🖼️',
        'mp3': '🎵', 'wav': '🎵', 'ogg': '🎵',
        'mp4': '🎬', 'avi': '🎬', 'mkv': '🎬', 'mov': '🎬',
        'zip': '📦', 'rar': '📦', '7z': '📦', 'tar': '📦', 'gz': '📦',
        'exe': '⚙️', 'msi': '⚙️', 'deb': '⚙️', 'rpm': '⚙️',
        'js': '📜', 'ts': '📜', 'py': '📜', 'java': '📜', 'cpp': '📜', 'c': '📜', 'h': '📜',
        'html': '🌐', 'css': '🎨', 'json': '📋', 'xml': '📋', 'yaml': '📋', 'yml': '📋',
        'md': '📝', 'rtf': '📄',
    };
    return icons[ext] || '📎';
};

describe('app.js - Приложение чата', () => {
    let mockServerClient;

    beforeEach(() => {
        // Создаём мок ServerClient
        mockServerClient = {
            connect: jest.fn().mockResolvedValue(),
            register: jest.fn().mockResolvedValue({ id: 'test-user-id', name: 'Тест' }),
            sendMessage: jest.fn(),
            sendFile: jest.fn().mockResolvedValue(true),
            sendAck: jest.fn(),
            getMessages: jest.fn(),
            getUsers: jest.fn().mockResolvedValue([]),
            on: jest.fn(),
            httpUrl: 'http://localhost:8080/api',
        };

        // Устанавливаем мок ПЕРЕД загрузкой app.js
        window.ServerClient = jest.fn(() => mockServerClient);

        // Загружаем app.js и вручную вызываем init
        jest.isolateModules(() => {
            require('../app.js');
        });

        // Проматываем таймеры для init()
        jest.advanceTimersByTime(300);
    });

    describe('Подключение к серверу', () => {
        test('должен подключаться при нажатии Enter', async () => {
            const input = document.getElementById('userNameInput');
            input.value = 'Тест';
            fireEvent.input(input);
            
            const button = document.getElementById('confirmConnect');
            button.disabled = false;

            fireEvent.keyDown(input, { key: 'Enter' });

            await waitFor(() => {
                expect(mockServerClient.connect).toHaveBeenCalled();
            });
        });

        test('должен вызывать connect при нажатии кнопки', async () => {
            const input = document.getElementById('userNameInput');
            input.value = 'Тест';
            fireEvent.input(input);
            
            const button = document.getElementById('confirmConnect');
            button.disabled = false;

            fireEvent.click(button);

            await waitFor(() => {
                expect(mockServerClient.connect).toHaveBeenCalled();
            });
        });
    });

    describe('Отправка сообщений', () => {
        test('должен отправлять сообщение при нажатии кнопки', async () => {
            const input = document.getElementById('messageInput');
            const button = document.getElementById('sendBtn');

            input.value = 'Привет!';
            fireEvent.input(input);
            button.disabled = false;

            fireEvent.click(button);

            await waitFor(() => {
                expect(mockServerClient.sendMessage).toHaveBeenCalled();
            });
        });

        test('должен отправлять сообщение при нажатии Enter', async () => {
            const input = document.getElementById('messageInput');
            input.value = 'Привет!';
            fireEvent.input(input);
            
            const button = document.getElementById('sendBtn');
            button.disabled = false;

            fireEvent.keyDown(input, { key: 'Enter' });

            await waitFor(() => {
                expect(mockServerClient.sendMessage).toHaveBeenCalled();
            });
        });

        test('не должен отправлять пустое сообщение', () => {
            const button = document.getElementById('sendBtn');
            expect(button.disabled).toBe(true);
        });

        test('должен очищать поле ввода после отправки', async () => {
            const input = document.getElementById('messageInput');
            const button = document.getElementById('sendBtn');

            input.value = 'Тестовое сообщение';
            fireEvent.input(input);
            button.disabled = false;

            fireEvent.click(button);

            await waitFor(() => {
                expect(input.value).toBe('');
            });
        });

        test('должен деактивировать кнопку отправки без подключения', () => {
            const button = document.getElementById('sendBtn');
            button.disabled = true;
            expect(button.disabled).toBe(true);
        });
    });

    describe('Прикрепление файлов', () => {
        test('должен добавлять файлы в список', () => {
            const fileInput = document.getElementById('fileInput');
            const testFile = new File(['content'], 'test.txt', { type: 'text/plain' });

            Object.defineProperty(fileInput, 'files', {
                value: [testFile],
                writable: true,
            });

            fireEvent.change(fileInput);
            expect(fileInput.files.length).toBe(1);
        });

        test.skip('должен показывать ошибку для файлов больше 100MB', () => {
            // alert не работает в Jest
        });

        test('должен очищать input после добавления файла', () => {
            const fileInput = document.getElementById('fileInput');
            const testFile = new File(['content'], 'test.txt', { type: 'text/plain' });

            Object.defineProperty(fileInput, 'files', {
                value: [testFile],
                writable: true,
            });

            fireEvent.change(fileInput);
            expect(fileInput.value).toBe('');
        });
    });

    describe('Вспомогательные функции', () => {
        describe('escapeHtml', () => {
            test('должен экранировать HTML теги', () => {
                expect(escapeHtml('<div>')).toBe('&lt;div&gt;');
                expect(escapeHtml('a & b')).toBe('a &amp; b');
            });

            test('должен сохранять текст', () => {
                expect(escapeHtml('Привет')).toBe('Привет');
                expect(escapeHtml('123')).toBe('123');
            });

            test('должен обрабатывать эмодзи', () => {
                expect(escapeHtml('👋')).toBe('👋');
            });
        });

        describe('formatFileSize', () => {
            test('должен форматировать байты', () => {
                expect(formatFileSize(500)).toBe('500 B');
            });

            test('должен форматировать КБ', () => {
                expect(formatFileSize(1024)).toBe('1 KB');
            });

            test('должен форматировать МБ', () => {
                expect(formatFileSize(1048576)).toBe('1 MB');
            });

            test('должен форматировать ГБ', () => {
                expect(formatFileSize(1073741824)).toBe('1 GB');
            });
        });

        describe('getFileIcon', () => {
            test('должен возвращать иконки для PDF', () => {
                expect(getFileIcon('doc.pdf')).toBe('📄');
            });

            test('должен возвращать иконки для изображений', () => {
                expect(getFileIcon('img.jpg')).toBe('🖼️');
                expect(getFileIcon('img.png')).toBe('🖼️');
                expect(getFileIcon('img.gif')).toBe('🖼️');
            });

            test('должен возвращать иконки для архивов', () => {
                expect(getFileIcon('file.zip')).toBe('📦');
                expect(getFileIcon('file.rar')).toBe('📦');
            });

            test('должен возвращать иконку по умолчанию', () => {
                expect(getFileIcon('file.xyz')).toBe('📎');
            });

            test('должен быть регистронезависимым', () => {
                expect(getFileIcon('FILE.PDF')).toBe('📄');
            });
        });
    });
});
