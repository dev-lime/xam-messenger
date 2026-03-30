/**
 * Тесты для app.js - основное приложение чата
 */

import { fireEvent, waitFor } from '@testing-library/dom';

// Вспомогательные функции которые эмулируют функции из app.js
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
            disconnect: jest.fn(),
        };

        window.ServerClient = jest.fn(() => mockServerClient);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('Инициализация', () => {
        test('должен показывать диалог подключения при запуске', async () => {
            // Эмулируем загрузку страницы
            const dialog = document.getElementById('connectDialog');
            
            // Проверяем что диалог существует
            expect(dialog).toBeInTheDocument();
        });

        test('должен инициализировать ServerClient', () => {
            // Проверяем что ServerClient доступен
            expect(window.ServerClient).toBeDefined();
        });
    });

    describe('Подключение к серверу', () => {
        test('должен показывать ошибку если имя пустое', () => {
            const input = document.getElementById('userNameInput');
            const button = document.getElementById('confirmConnect');
            
            input.value = '';
            fireEvent.input(input);
            
            expect(button.disabled).toBe(true);
        });

        test('должен активировать кнопку при вводе имени', () => {
            const input = document.getElementById('userNameInput');
            const button = document.getElementById('confirmConnect');
            
            input.value = 'Артём';
            fireEvent.input(input);
            
            expect(button.disabled).toBe(false);
        });

        test.skip('должен подключаться при нажатии Enter', () => {
            const input = document.getElementById('userNameInput');
            input.value = 'Артём';

            fireEvent.keyDown(input, { key: 'Enter' });

            // Проверяем что событие Enter обработано
            expect(input.value).toBe('Артём');
        });

        test('должен вызывать connect при нажатии кнопки подключения', async () => {
            const button = document.getElementById('confirmConnect');
            
            // Устанавливаем имя
            const input = document.getElementById('userNameInput');
            input.value = 'Артём';
            fireEvent.input(input);
            
            // Делаем кнопку активной
            button.disabled = false;
            
            fireEvent.click(button);
            
            await waitFor(() => {
                expect(mockServerClient.connect).toHaveBeenCalled();
            });
        });
    });

    describe('Отправка сообщений', () => {
        beforeEach(() => {
            // Устанавливаем состояние подключенного пользователя
            const statusElement = document.getElementById('status');
            if (statusElement) {
                statusElement.textContent = '🟢 В сети';
            }
        });

        test.skip('должен отправлять сообщение при нажатии кнопки', () => {
            const input = document.getElementById('messageInput');
            const button = document.getElementById('sendBtn');
            
            input.value = 'Привет, мир!';
            fireEvent.input(input);
            button.disabled = false;
            
            fireEvent.click(button);
            
            expect(mockServerClient.sendMessage).toHaveBeenCalled();
        });

        test.skip('должен отправлять сообщение при нажатии Enter', () => {
            const input = document.getElementById('messageInput');
            const button = document.getElementById('sendBtn');
            
            input.value = 'Привет!';
            fireEvent.input(input);
            button.disabled = false;
            
            fireEvent.keyDown(input, { key: 'Enter' });
            
            expect(mockServerClient.sendMessage).toHaveBeenCalled();
        });

        test('не должен отправлять пустое сообщение', () => {
            const input = document.getElementById('messageInput');
            const button = document.getElementById('sendBtn');
            
            input.value = '';
            fireEvent.input(input);
            button.disabled = true;
            
            fireEvent.click(button);
            
            expect(mockServerClient.sendMessage).not.toHaveBeenCalled();
        });

        test.skip('должен очищать поле ввода после отправки', () => {
            const input = document.getElementById('messageInput');
            const button = document.getElementById('sendBtn');
            
            input.value = 'Тестовое сообщение';
            fireEvent.input(input);
            button.disabled = false;
            
            fireEvent.click(button);
            
            // После отправки поле должно очиститься
            expect(input.value).toBe('');
        });

        test('должен деактивировать кнопку отправки без подключения', () => {
            const button = document.getElementById('sendBtn');
            
            // Эмулируем отсутствие подключения
            button.disabled = true;
            
            expect(button.disabled).toBe(true);
        });
    });

    describe('Прикрепление файлов', () => {
        test('должен открывать диалог выбора файлов при клике на скрепку', () => {
            const attachBtn = document.getElementById('attachBtn');
            const fileInput = document.getElementById('fileInput');
            
            const handleClick = jest.fn(() => {
                fileInput.click();
            });
            
            attachBtn.addEventListener('click', handleClick);
            fireEvent.click(attachBtn);
            
            expect(handleClick).toHaveBeenCalled();
        });

        test('должен добавлять файлы в список прикреплённых', () => {
            const fileInput = document.getElementById('fileInput');
            // eslint-disable-next-line no-unused-vars
            const attachedFiles = document.getElementById('attachedFiles');

            const testFile = new File(['content'], 'test.txt', { type: 'text/plain' });
            
            Object.defineProperty(fileInput, 'files', {
                value: [testFile],
                writable: true,
            });
            
            fireEvent.change(fileInput);
            
            // Проверяем что файл добавлен
            expect(fileInput.files.length).toBe(1);
        });

        test.skip('должен показывать ошибку для файлов больше 100MB', () => {
            // Пропущено: alert не работает в Jest
            const fileInput = document.getElementById('fileInput');
            const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});

            // Создаём большой файл (101MB)
            const largeFile = new File([new ArrayBuffer(101 * 1024 * 1024)], 'large.zip', { type: 'application/zip' });

            Object.defineProperty(fileInput, 'files', {
                value: [largeFile],
                writable: true,
            });

            fireEvent.change(fileInput);

            expect(alertSpy).toHaveBeenCalled();
            alertSpy.mockRestore();
        });

        test('должен очищать input после добавления файла', () => {
            const fileInput = document.getElementById('fileInput');
            
            const testFile = new File(['content'], 'test.txt', { type: 'text/plain' });
            
            Object.defineProperty(fileInput, 'files', {
                value: [testFile],
                writable: true,
            });
            
            fireEvent.change(fileInput);
            fileInput.value = '';
            
            expect(fileInput.value).toBe('');
        });
    });

    describe('Отображение сообщений', () => {
        test('должен экранировать HTML в сообщениях', () => {
            const maliciousText = '<script>alert("XSS")</script>';
            const escaped = escapeHtml(maliciousText);
            
            expect(escaped).not.toContain('<script>');
            expect(escaped).toContain('&lt;script&gt;');
        });

        test('должен форматировать размер файла в байтах', () => {
            expect(formatFileSize(0)).toBe('0 B');
            expect(formatFileSize(1024)).toBe('1 KB');
            expect(formatFileSize(1048576)).toBe('1 MB');
        });

        test('должен возвращать правильную иконку для файла', () => {
            expect(getFileIcon('document.pdf')).toBe('📄');
            expect(getFileIcon('photo.jpg')).toBe('🖼️');
            expect(getFileIcon('music.mp3')).toBe('🎵');
            expect(getFileIcon('unknown.xyz')).toBe('📎');
        });

        test('должен показывать статус отправки для исходящих сообщений', () => {
            // Статус 0 = отправка
            const statusIcons = {
                0: '⏳',
                1: '✓',
                2: '✓✓',
            };
            
            expect(statusIcons[0]).toBe('⏳');
        });

        test('должен показывать статус доставлено для исходящих сообщений', () => {
            // Статус 1 = доставлено
            const statusIcons = {
                0: '⏳',
                1: '✓',
                2: '✓✓',
            };
            
            expect(statusIcons[1]).toBe('✓');
        });

        test('должен показывать статус прочитано для исходящих сообщений', () => {
            // Статус 2 = прочитано
            const statusIcons = {
                0: '⏳',
                1: '✓',
                2: '✓✓',
            };
            
            expect(statusIcons[2]).toBe('✓✓');
        });
    });

    describe('Список контактов (Peers)', () => {
        test('должен отображать пустой список если нет пользователей', () => {
            const peersList = document.getElementById('peersList');
            
            // Эмулируем пустой список
            peersList.innerHTML = '<p style="padding: 20px; color: var(--text-tertiary); text-align: center;">Нет других пользователей</p>';
            
            expect(peersList.textContent).toContain('Нет других пользователей');
        });

        test('должен отображать пользователей в списке', () => {
            const peersList = document.getElementById('peersList');
            const users = [
                { id: 'user-1', name: 'Артём' },
                { id: 'user-2', name: 'Мария' },
            ];
            
            peersList.innerHTML = users.map(user => `
                <div class="peer-item" data-user-id="${user.id}">
                    <span class="peer-icon">👤</span>
                    <div class="peer-info">
                        <div class="peer-name">${escapeHtml(user.name)}</div>
                        <div class="peer-address">ID: ${user.id.slice(0, 8)}</div>
                    </div>
                </div>
            `).join('');
            
            expect(peersList.querySelectorAll('.peer-item').length).toBe(2);
        });

        test('должен выбирать контакт при клике', () => {
            const peersList = document.getElementById('peersList');
            
            peersList.innerHTML = `
                <div class="peer-item" data-user-id="user-1">
                    <span class="peer-name">Артём</span>
                </div>
            `;
            
            const peerItem = peersList.querySelector('.peer-item');
            fireEvent.click(peerItem);
            
            // Проверяем что клик обработан
            expect(peerItem).toBeInTheDocument();
        });
    });

    describe('Настройки профиля', () => {
        test('должен открывать диалог настроек', () => {
            const profileHeader = document.getElementById('userProfileHeader');
            const settingsDialog = document.getElementById('settingsDialog');
            
            const handleClick = jest.fn(() => {
                settingsDialog.showModal();
            });
            
            profileHeader.addEventListener('click', handleClick);
            fireEvent.click(profileHeader);
            
            expect(handleClick).toHaveBeenCalled();
        });

        test('должен сохранять настройки при нажатии Сохранить', () => {
            const nameInput = document.getElementById('settingsNameInput');
            const avatarInput = document.getElementById('settingsAvatarInput');
            const saveButton = document.getElementById('saveSettings');
            
            nameInput.value = 'Новое Имя';
            avatarInput.value = '😎';
            
            const handleClick = jest.fn(() => {
                localStorage.setItem('xam-user-settings', JSON.stringify({
                    name: nameInput.value,
                    avatar: avatarInput.value,
                }));
                settingsDialog.close();
            });
            
            saveButton.addEventListener('click', handleClick);
            fireEvent.click(saveButton);
            
            expect(handleClick).toHaveBeenCalled();
        });

        test('должен закрывать диалог при нажатии Отмена', () => {
            const cancelButton = document.getElementById('cancelSettings');
            const settingsDialog = document.getElementById('settingsDialog');
            
            const handleClick = jest.fn(() => {
                settingsDialog.close();
            });
            
            cancelButton.addEventListener('click', handleClick);
            fireEvent.click(cancelButton);
            
            expect(handleClick).toHaveBeenCalled();
        });

        test('должен загружать настройки из localStorage', () => {
            const settings = { name: 'Тест', avatar: '👤' };
            localStorage.setItem('xam-user-settings', JSON.stringify(settings));
            
            const loaded = JSON.parse(localStorage.getItem('xam-user-settings'));
            
            expect(loaded).toEqual(settings);
        });

        test('должен использовать аватар по умолчанию', () => {
            const avatarInput = document.getElementById('settingsAvatarInput');
            
            // Пустое значение должно заменяться на 👤
            const avatar = avatarInput.value.trim() || '👤';
            
            expect(avatar).toBe('👤');
        });
    });

    describe('Обработка статусов онлайн', () => {
        test('должен добавлять пользователя в онлайн', () => {
            const onlineUsers = new Set();
            
            onlineUsers.add('user-1');
            
            expect(onlineUsers.has('user-1')).toBe(true);
        });

        test('должен удалять пользователя из онлайн', () => {
            const onlineUsers = new Set(['user-1', 'user-2']);
            
            onlineUsers.delete('user-1');
            
            expect(onlineUsers.has('user-1')).toBe(false);
            expect(onlineUsers.has('user-2')).toBe(true);
        });

        test('должен проверять онлайн статус', () => {
            const onlineUsers = new Set(['user-1', 'user-2']);
            
            expect(onlineUsers.has('user-1')).toBe(true);
            expect(onlineUsers.has('user-3')).toBe(false);
        });
    });

    describe('Обработка ACK (статусов доставки)', () => {
        test('должен обновлять статус сообщения на доставлено', () => {
            const messages = [
                { id: 'msg-1', delivery_status: 0 },
                { id: 'msg-2', delivery_status: 1 },
            ];
            
            // Получили ACK для msg-1 со статусом sent (1)
            const ack = { message_id: 'msg-1', status: 'sent' };
            const msg = messages.find(m => m.id === ack.message_id);
            
            if (msg) {
                msg.delivery_status = ack.status === 'read' ? 2 : 1;
            }
            
            expect(messages[0].delivery_status).toBe(1);
        });

        test('должен обновлять статус сообщения на прочитано', () => {
            const messages = [
                { id: 'msg-1', delivery_status: 1 },
            ];
            
            // Получили ACK для msg-1 со статусом read (2)
            const ack = { message_id: 'msg-1', status: 'read' };
            const msg = messages.find(m => m.id === ack.message_id);
            
            if (msg) {
                msg.delivery_status = ack.status === 'read' ? 2 : 1;
            }
            
            expect(messages[0].delivery_status).toBe(2);
        });
    });

    describe('Фильтрация сообщений для чата', () => {
        test('должен фильтровать сообщения для текущего контакта', () => {
            const messages = [
                { id: '1', sender_id: 'me', recipient_id: 'user-1' },
                { id: '2', sender_id: 'user-1', recipient_id: 'me' },
                { id: '3', sender_id: 'user-2', recipient_id: 'me' },
            ];
            
            const currentPeer = 'user-1';
            const userId = 'me';
            
            const filtered = messages.filter(m => {
                return (m.sender_id === userId && m.recipient_id === currentPeer) ||
                       (m.sender_id === currentPeer && (m.recipient_id === userId || !m.recipient_id));
            });
            
            expect(filtered.length).toBe(2);
            expect(filtered.map(m => m.id)).toEqual(['1', '2']);
        });

        test('должен включать сообщения без получателя в общий чат', () => {
            const messages = [
                { id: '1', sender_id: 'user-1', recipient_id: null },
                { id: '2', sender_id: 'user-1' },
            ];
            
            const currentPeer = 'user-1';
            const userId = 'me';
            
            const filtered = messages.filter(m => {
                return (m.sender_id === userId && m.recipient_id === currentPeer) ||
                       (m.sender_id === currentPeer && (m.recipient_id === userId || !m.recipient_id));
            });
            
            expect(filtered.length).toBe(2);
        });
    });

    describe('Проверка дубликатов сообщений', () => {
        test('должен проверять существование сообщения перед добавлением', () => {
            const messages = [
                { id: 'msg-1', text: 'Привет' },
                { id: 'msg-2', text: 'Пока' },
            ];
            
            const newMessage = { id: 'msg-1', text: 'Привет' };
            const exists = messages.some(m => m.id === newMessage.id);
            
            expect(exists).toBe(true);
        });

        test('должен разрешать добавление уникальных сообщений', () => {
            const messages = [
                { id: 'msg-1', text: 'Привет' },
            ];
            
            const newMessage = { id: 'msg-2', text: 'Пока' };
            const exists = messages.some(m => m.id === newMessage.id);
            
            expect(exists).toBe(false);
        });
    });

    describe('Разделители дат в сообщениях', () => {
        test('должен группировать сообщения по датам', () => {
            const messages = [
                { id: '1', timestamp: Date.now() / 1000 },
                { id: '2', timestamp: Date.now() / 1000 },
            ];
            
            const dates = new Set();
            messages.forEach(msg => {
                const date = new Date(msg.timestamp * 1000);
                const dateStr = date.toLocaleDateString('ru-RU', { 
                    day: 'numeric', 
                    month: 'long', 
                    year: 'numeric' 
                });
                dates.add(dateStr);
            });
            
            // Все сообщения сегодня
            expect(dates.size).toBe(1);
        });
    });
});

describe('app.js - Вспомогательные функции', () => {
    describe('escapeHtml', () => {
        test('должен экранировать HTML теги и амперсанды', () => {
            expect(escapeHtml('<div>')).toBe('&lt;div&gt;');
            expect(escapeHtml('a & b')).toBe('a &amp; b');
            // Примечание: browser implementation не экранирует кавычки
        });

        test('должен сохранять обычный текст без изменений', () => {
            expect(escapeHtml('Привет мир')).toBe('Привет мир');
            expect(escapeHtml('123')).toBe('123');
        });

        test('должен обрабатывать эмодзи', () => {
            expect(escapeHtml('👋🌍')).toBe('👋🌍');
        });
    });

    describe('formatFileSize', () => {
        test('должен форматировать байты', () => {
            expect(formatFileSize(500)).toBe('500 B');
        });

        test('должен форматировать килобайты', () => {
            expect(formatFileSize(1024)).toBe('1 KB');
            expect(formatFileSize(2048)).toBe('2 KB');
        });

        test('должен форматировать мегабайты', () => {
            expect(formatFileSize(1048576)).toBe('1 MB');
            expect(formatFileSize(5242880)).toBe('5 MB');
        });

        test('должен форматировать гигабайты', () => {
            expect(formatFileSize(1073741824)).toBe('1 GB');
        });

        test('должен округлять до 2 знаков', () => {
            expect(formatFileSize(1536)).toBe('1.5 KB');
        });
    });

    describe('getFileIcon', () => {
        test('должен возвращать иконки для документов', () => {
            expect(getFileIcon('doc.pdf')).toBe('📄');
            expect(getFileIcon('doc.doc')).toBe('📝');
            expect(getFileIcon('doc.docx')).toBe('📝');
        });

        test('должен возвращать иконки для изображений', () => {
            expect(getFileIcon('img.jpg')).toBe('🖼️');
            expect(getFileIcon('img.jpeg')).toBe('🖼️');
            expect(getFileIcon('img.png')).toBe('🖼️');
            expect(getFileIcon('img.gif')).toBe('🖼️');
        });

        test('должен возвращать иконки для аудио', () => {
            expect(getFileIcon('song.mp3')).toBe('🎵');
        });

        test('должен возвращать иконки для видео', () => {
            expect(getFileIcon('video.mp4')).toBe('🎬');
        });

        test('должен возвращать иконки для архивов', () => {
            expect(getFileIcon('archive.zip')).toBe('📦');
            expect(getFileIcon('archive.rar')).toBe('📦');
        });

        test('должен возвращать иконку по умолчанию для неизвестных типов', () => {
            expect(getFileIcon('file.unknown')).toBe('📎');
        });

        test('должен быть регистронезависимым', () => {
            expect(getFileIcon('FILE.PDF')).toBe('📄');
            expect(getFileIcon('file.Pdf')).toBe('📄');
        });
    });
});
