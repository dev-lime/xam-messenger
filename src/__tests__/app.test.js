/**
 * Тесты для app.js - основное приложение чата
 * Тестируем вспомогательные функции и UI взаимодействия
 */

// Вспомогательные функции (те же что в app.js)
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

describe('app.js - Вспомогательные функции', () => {
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

        test('должен экранировать скрипты (XSS защита)', () => {
            expect(escapeHtml('<script>alert("xss")</script>'))
                .toBe('&lt;script&gt;alert("xss")&lt;/script&gt;');
        });

        test('должен сохранять кавычки (textContent не экранирует их)', () => {
            // textContent экранирует только <, >, &
            expect(escapeHtml('"quotes"')).toBe('"quotes"');
            expect(escapeHtml('\'single\'')).toBe('\'single\'');
        });
    });

    describe('formatFileSize', () => {
        test('должен форматировать 0 байт', () => {
            expect(formatFileSize(0)).toBe('0 B');
        });

        test('должен форматировать байты', () => {
            expect(formatFileSize(1)).toBe('1 B');
            expect(formatFileSize(500)).toBe('500 B');
            expect(formatFileSize(1023)).toBe('1023 B');
        });

        test('должен форматировать КБ', () => {
            expect(formatFileSize(1024)).toBe('1 KB');
            expect(formatFileSize(1536)).toBe('1.5 KB');
            expect(formatFileSize(2048)).toBe('2 KB');
        });

        test('должен форматировать МБ', () => {
            expect(formatFileSize(1048576)).toBe('1 MB');
            expect(formatFileSize(1572864)).toBe('1.5 MB');
            expect(formatFileSize(2097152)).toBe('2 MB');
        });

        test('должен форматировать ГБ', () => {
            expect(formatFileSize(1073741824)).toBe('1 GB');
            expect(formatFileSize(1610612736)).toBe('1.5 GB');
        });

        test('должен округлять до 2 знаков после запятой', () => {
            expect(formatFileSize(1234567)).toBe('1.18 MB');
            expect(formatFileSize(1234)).toBe('1.21 KB');
        });
    });

    describe('getFileIcon', () => {
        test('должен возвращать иконки для PDF', () => {
            expect(getFileIcon('doc.pdf')).toBe('📄');
        });

        test('должен возвращать иконки для текстовых файлов', () => {
            expect(getFileIcon('file.txt')).toBe('📄');
        });

        test('должен возвращать иконки для офисных файлов', () => {
            expect(getFileIcon('doc.doc')).toBe('📝');
            expect(getFileIcon('doc.docx')).toBe('📝');
            expect(getFileIcon('report.xls')).toBe('📊');
            expect(getFileIcon('report.xlsx')).toBe('📊');
            expect(getFileIcon('presentation.ppt')).toBe('📊');
            expect(getFileIcon('presentation.pptx')).toBe('📊');
        });

        test('должен возвращать иконки для изображений', () => {
            expect(getFileIcon('img.jpg')).toBe('🖼️');
            expect(getFileIcon('img.jpeg')).toBe('🖼️');
            expect(getFileIcon('img.png')).toBe('🖼️');
            expect(getFileIcon('img.gif')).toBe('🖼️');
            expect(getFileIcon('img.bmp')).toBe('🖼️');
            expect(getFileIcon('img.svg')).toBe('🖼️');
        });

        test('должен возвращать иконки для аудио', () => {
            expect(getFileIcon('song.mp3')).toBe('🎵');
            expect(getFileIcon('song.wav')).toBe('🎵');
            expect(getFileIcon('song.ogg')).toBe('🎵');
        });

        test('должен возвращать иконки для видео', () => {
            expect(getFileIcon('video.mp4')).toBe('🎬');
            expect(getFileIcon('video.avi')).toBe('🎬');
            expect(getFileIcon('video.mkv')).toBe('🎬');
            expect(getFileIcon('video.mov')).toBe('🎬');
        });

        test('должен возвращать иконки для архивов', () => {
            expect(getFileIcon('file.zip')).toBe('📦');
            expect(getFileIcon('file.rar')).toBe('📦');
            expect(getFileIcon('file.7z')).toBe('📦');
            expect(getFileIcon('file.tar')).toBe('📦');
            expect(getFileIcon('file.gz')).toBe('📦');
        });

        test('должен возвращать иконки для исполняемых файлов', () => {
            expect(getFileIcon('app.exe')).toBe('⚙️');
            expect(getFileIcon('installer.msi')).toBe('⚙️');
            expect(getFileIcon('package.deb')).toBe('⚙️');
            expect(getFileIcon('package.rpm')).toBe('⚙️');
        });

        test('должен возвращать иконки для файлов кода', () => {
            expect(getFileIcon('script.js')).toBe('📜');
            expect(getFileIcon('code.ts')).toBe('📜');
            expect(getFileIcon('app.py')).toBe('📜');
            expect(getFileIcon('Main.java')).toBe('📜');
            expect(getFileIcon('main.cpp')).toBe('📜');
            expect(getFileIcon('main.c')).toBe('📜');
            expect(getFileIcon('header.h')).toBe('📜');
        });

        test('должен возвращать иконки для веб файлов', () => {
            expect(getFileIcon('index.html')).toBe('🌐');
            expect(getFileIcon('styles.css')).toBe('🎨');
            expect(getFileIcon('data.json')).toBe('📋');
            expect(getFileIcon('config.xml')).toBe('📋');
            expect(getFileIcon('config.yaml')).toBe('📋');
            expect(getFileIcon('config.yml')).toBe('📋');
        });

        test('должен возвращать иконки для markdown', () => {
            expect(getFileIcon('README.md')).toBe('📝');
            expect(getFileIcon('doc.rtf')).toBe('📄');
        });

        test('должен возвращать иконку по умолчанию для неизвестных расширений', () => {
            expect(getFileIcon('file.xyz')).toBe('📎');
            expect(getFileIcon('file.unknown')).toBe('📎');
            expect(getFileIcon('file.abc123')).toBe('📎');
        });

        test('должен быть регистронезависимым', () => {
            expect(getFileIcon('FILE.PDF')).toBe('📄');
            expect(getFileIcon('FILE.Pdf')).toBe('📄');
            expect(getFileIcon('FILE.pDf')).toBe('📄');
            expect(getFileIcon('FILE.PDF')).toBe(getFileIcon('file.pdf'));
        });

        test('должен обрабатывать файлы без расширения', () => {
            expect(getFileIcon('README')).toBe('📎');
            expect(getFileIcon('Makefile')).toBe('📎');
        });

        test('должен обрабатывать файлы с несколькими точками', () => {
            expect(getFileIcon('file.tar.gz')).toBe('📦');
            expect(getFileIcon('backup.sql.txt')).toBe('📄');
        });

        test('должен обрабатывать null и undefined входные значения', () => {
            expect(() => getFileIcon(null)).toThrow();
            expect(() => getFileIcon(undefined)).toThrow();
        });

        test('должен обрабатывать числа как строки', () => {
            // Функция ожидает строку, числа будут обработаны как строки
            expect(getFileIcon('123.mp3')).toBe('🎵');
        });
    });
});

describe('app.js - Пагинация сообщений', () => {
    // Мок для state
    let mockState = {};
    
    // Функция проверки возможности загрузки (копия из app.js)
    const hasMoreMessagesForCurrentPeer = () => {
        if (!mockState.currentPeer) return false;
        if (!mockState.hasMoreMessages) return false;
        if (mockState.isLoadingMessages) return false;
        
        if (mockState.lastMessageId) return true;
        
        if (mockState.filteredMessages && mockState.filteredMessages.length > 0) {
            const hasOwnMessages = mockState.filteredMessages.some(m => m.sender_id === mockState.user?.id);
            const hasReceivedMessages = mockState.filteredMessages.some(m => m.sender_id === mockState.currentPeer);
            
            if (hasReceivedMessages) return true;
            if (hasOwnMessages) {
                const hasPeerMessagesInAll = mockState.messages.some(m => m.sender_id === mockState.currentPeer);
                return hasPeerMessagesInAll;
            }
        }
        
        return false;
    };
    
    // Функция обновления кнопки (упрощённая копия)
    const updateLoadMoreButton = () => {
        return hasMoreMessagesForCurrentPeer();
    };

    beforeEach(() => {
        mockState = {
            currentPeer: null,
            hasMoreMessages: true,
            isLoadingMessages: false,
            lastMessageId: null,
            user: { id: 'user-1' },
            messages: [],
            filteredMessages: [],
        };
    });

    describe('hasMoreMessagesForCurrentPeer', () => {
        test('должен возвращать false если чат не выбран', () => {
            mockState.currentPeer = null;
            mockState.hasMoreMessages = true;
            mockState.lastMessageId = 'msg-100';
            expect(hasMoreMessagesForCurrentPeer()).toBe(false);
        });

        test('должен возвращать false если нет больше сообщений', () => {
            mockState.currentPeer = 'user-2';
            mockState.hasMoreMessages = false;
            mockState.lastMessageId = 'msg-100';
            expect(hasMoreMessagesForCurrentPeer()).toBe(false);
        });

        test('должен возвращать false если идёт загрузка', () => {
            mockState.currentPeer = 'user-2';
            mockState.hasMoreMessages = true;
            mockState.isLoadingMessages = true;
            mockState.lastMessageId = 'msg-100';
            expect(hasMoreMessagesForCurrentPeer()).toBe(false);
        });

        test('должен возвращать true если есть lastMessageId и hasMoreMessages', () => {
            mockState.currentPeer = 'user-2';
            mockState.hasMoreMessages = true;
            mockState.lastMessageId = 'msg-123';
            expect(hasMoreMessagesForCurrentPeer()).toBe(true);
        });

        test('должен возвращать false если нет lastMessageId', () => {
            mockState.currentPeer = 'user-2';
            mockState.hasMoreMessages = true;
            mockState.lastMessageId = null;
            expect(hasMoreMessagesForCurrentPeer()).toBe(false);
        });

        test('должен возвращать false если filteredMessages пуст', () => {
            mockState.currentPeer = 'user-2';
            mockState.hasMoreMessages = true;
            mockState.lastMessageId = null;
            mockState.filteredMessages = [];
            expect(hasMoreMessagesForCurrentPeer()).toBe(false);
        });
    });

    describe('handleMessages - обработка первой загрузки', () => {
        test('должен установить lastMessageId в next_before_id если он есть', () => {
            const data = {
                messages: [
                    { id: 'msg-1', sender_id: 'user-1', text: 'Hi' },
                    { id: 'msg-2', sender_id: 'user-2', text: 'Hello' },
                ],
                next_before_id: 'msg-0',
                has_more: true,
            };
            
            mockState.messages = data.messages;
            mockState.lastMessageId = data.next_before_id;
            
            expect(mockState.lastMessageId).toBe('msg-0');
        });

        test('должен установить lastMessageId в первое сообщение если next_before_id нет', () => {
            const data = {
                messages: [
                    { id: 'msg-1', sender_id: 'user-1', text: 'Hi' },
                    { id: 'msg-2', sender_id: 'user-2', text: 'Hello' },
                ],
                next_before_id: null,
                has_more: false,
            };
            
            mockState.messages = data.messages;
            // Эмулируем логику handleMessages
            if (data.next_before_id) {
                mockState.lastMessageId = data.next_before_id;
            } else if (data.messages.length > 0) {
                mockState.lastMessageId = data.messages[0].id;
            }
            
            expect(mockState.lastMessageId).toBe('msg-1');
        });

        test('должен установить lastMessageId в null если сообщений нет', () => {
            const data = {
                messages: [],
                next_before_id: null,
                has_more: false,
            };
            
            mockState.messages = data.messages;
            if (data.next_before_id) {
                mockState.lastMessageId = data.next_before_id;
            } else if (data.messages.length > 0) {
                mockState.lastMessageId = data.messages[0].id;
            } else {
                mockState.lastMessageId = null;
            }
            
            expect(mockState.lastMessageId).toBe(null);
        });
    });

    describe('loadMoreMessages - определение beforeId', () => {
        test('должен использовать state.lastMessageId если он есть', () => {
            mockState.currentPeer = 'user-2';
            mockState.lastMessageId = 'msg-100';
            mockState.filteredMessages = [
                { id: 'msg-1', sender_id: 'user-2', text: 'Hi' },
            ];
            
            let beforeId = mockState.lastMessageId;
            if (!beforeId && mockState.filteredMessages && mockState.filteredMessages.length > 0) {
                beforeId = mockState.filteredMessages[0].id;
            }
            
            expect(beforeId).toBe('msg-100');
        });

        test('должен использовать первое сообщение из filteredMessages если lastMessageId нет', () => {
            mockState.currentPeer = 'user-2';
            mockState.lastMessageId = null;
            mockState.filteredMessages = [
                { id: 'msg-50', sender_id: 'user-2', text: 'Old message' },
                { id: 'msg-100', sender_id: 'user-1', text: 'New message' },
            ];
            
            let beforeId = mockState.lastMessageId;
            if (!beforeId && mockState.filteredMessages && mockState.filteredMessages.length > 0) {
                beforeId = mockState.filteredMessages[0].id;
            }
            
            expect(beforeId).toBe('msg-50');
        });
    });

    describe('updateLoadMoreButton', () => {
        test('должен показывать кнопку только если выбран чат и есть сообщения для загрузки', () => {
            mockState.currentPeer = 'user-2';
            mockState.hasMoreMessages = true;
            mockState.lastMessageId = 'msg-100';
            
            expect(updateLoadMoreButton()).toBe(true);
        });

        test('должен скрывать кнопку если чат не выбран', () => {
            mockState.currentPeer = null;
            mockState.hasMoreMessages = true;
            mockState.lastMessageId = 'msg-100';
            
            expect(updateLoadMoreButton()).toBe(false);
        });

        test('должен скрывать кнопку если нет больше сообщений', () => {
            mockState.currentPeer = 'user-2';
            mockState.hasMoreMessages = false;
            mockState.lastMessageId = null;
            
            expect(updateLoadMoreButton()).toBe(false);
        });

        test('должен скрывать кнопку если идёт загрузка', () => {
            mockState.currentPeer = 'user-2';
            mockState.hasMoreMessages = true;
            mockState.isLoadingMessages = true;
            mockState.lastMessageId = 'msg-100';
            
            expect(updateLoadMoreButton()).toBe(false);
        });
    });

    describe('Бесконечный цикл загрузки', () => {
        test('должен прекращать загрузку если messages.length === 0', () => {
            // Эмуляция ситуации когда сервер вернул пустой массив
            // но hasMore = true (ошибка или особенность)
            const data = {
                messages: [],
                next_before_id: null,
                has_more: true,
                before_id: 'msg-100',
            };
            
            mockState.currentPeer = 'user-2';
            mockState.filteredMessages = [];
            mockState.hasMoreMessages = data.has_more;
            
            // Проверяем условие прекращения
            const shouldStop = data.before_id && 
                mockState.filteredMessages.length === 0 && 
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
            
            mockState.currentPeer = 'user-2';
            mockState.filteredMessages = [];
            
            // Проверяем условие продолжения
            const shouldContinue = data.before_id && 
                mockState.filteredMessages.length === 0 && 
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
            
            mockState.currentPeer = 'user-2';
            mockState.filteredMessages = [];
            
            // Проверяем условие продолжения - должно быть false
            const shouldContinue = data.before_id && 
                mockState.filteredMessages.length === 0 && 
                data.has_more && 
                data.next_before_id && 
                data.messages.length > 0;
            
            expect(shouldContinue).toBe(false);
        });
    });
});

describe('app.js - isMessageInCurrentChat', () => {
    const mockState = {
        user: { id: 'user-1' },
        currentPeer: 'user-2',
    };
    
    const isMessageInCurrentChat = (msg) => {
        // Сообщения без recipient_id считаются общими — показываем во всех чатах
        if (!msg.recipient_id) {
            return true;
        }
        
        // Сообщения с получателем показываем только в соответствующем чате
        return (
            (msg.sender_id === mockState.user.id && msg.recipient_id === mockState.currentPeer) ||
            (msg.sender_id === mockState.currentPeer && msg.recipient_id === mockState.user.id)
        );
    };

    describe('Сообщения без recipient_id (общие)', () => {
        test('должен показывать сообщения от текущего пира без recipient_id', () => {
            const msg = { sender_id: 'user-2', recipient_id: null, text: 'Hello' };
            expect(isMessageInCurrentChat(msg)).toBe(true);
        });

        test('должен показывать наши сообщения без recipient_id', () => {
            const msg = { sender_id: 'user-1', recipient_id: null, text: 'Hi' };
            expect(isMessageInCurrentChat(msg)).toBe(true);
        });

        test('должен показывать сообщения от других пользователей без recipient_id', () => {
            const msg = { sender_id: 'user-3', recipient_id: null, text: 'Other' };
            expect(isMessageInCurrentChat(msg)).toBe(true);
        });
    });

    describe('Сообщения с recipient_id', () => {
        test('должен показывать наши сообщения текущему пиру', () => {
            const msg = { sender_id: 'user-1', recipient_id: 'user-2', text: 'Hi' };
            expect(isMessageInCurrentChat(msg)).toBe(true);
        });

        test('должен показывать сообщения от текущего пира нам', () => {
            const msg = { sender_id: 'user-2', recipient_id: 'user-1', text: 'Hello' };
            expect(isMessageInCurrentChat(msg)).toBe(true);
        });

        test('не должен показывать сообщения другому получателю', () => {
            const msg = { sender_id: 'user-2', recipient_id: 'user-3', text: 'Other' };
            expect(isMessageInCurrentChat(msg)).toBe(false);
        });

        test('не должен показывать наши сообщения другому получателю', () => {
            const msg = { sender_id: 'user-1', recipient_id: 'user-3', text: 'Other' };
            expect(isMessageInCurrentChat(msg)).toBe(false);
        });
    });
});
