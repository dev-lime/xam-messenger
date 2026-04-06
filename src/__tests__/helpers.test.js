/**
 * Тесты для helpers.js
 * Цель: 100% покрытие всех функций
 */

import {
    escapeHtml,
    escapeJsString,
    formatFileSize,
    getFileIcon,
    CONFIG,
    DELIVERY_STATUS,
    STATUS_ICONS,
} from '../utils/helpers.js';

// ============================================================================
// escapeHtml
// ============================================================================

describe('escapeHtml', () => {
    test('должен экранировать HTML теги', () => {
        expect(escapeHtml('<div>')).toBe('&lt;div&gt;');
        expect(escapeHtml('<p>')).toBe('&lt;p&gt;');
    });

    test('должен экранировать амперсанд', () => {
        expect(escapeHtml('a & b')).toBe('a &amp; b');
    });

    test('должен сохранять обычный текст', () => {
        expect(escapeHtml('Привет')).toBe('Привет');
        expect(escapeHtml('123')).toBe('123');
        expect(escapeHtml('hello world')).toBe('hello world');
    });

    test('должен сохранять эмодзи', () => {
        expect(escapeHtml('👋')).toBe('👋');
        expect(escapeHtml('👤📎🔍')).toBe('👤📎🔍');
    });

    test('должен экранировать скрипты (XSS защита)', () => {
        expect(escapeHtml('<script>alert("xss")</script>'))
            .toBe('&lt;script&gt;alert("xss")&lt;/script&gt;');
    });

    test('должен сохранять двойные кавычки (textContent не экранирует их)', () => {
        expect(escapeHtml('"hello"')).toBe('"hello"');
    });

    test('должен сохранять одинарные кавычки (НЕ экранирует)', () => {
        expect(escapeHtml('it\'s')).toBe('it\'s');
    });

    test('должен обрабатывать пустую строку', () => {
        expect(escapeHtml('')).toBe('');
    });

    test('должен обрабатывать пробелы и переводы строк', () => {
        expect(escapeHtml('  hello  ')).toBe('  hello  ');
        expect(escapeHtml('line1\nline2')).toBe('line1\nline2');
    });
});

// ============================================================================
// escapeJsString
// ============================================================================

describe('escapeJsString', () => {
    test('должен экранировать одинарные кавычки', () => {
        expect(escapeJsString('it\'s')).toBe('it\\x27s');
    });

    test('должен экранировать обратный слэш', () => {
        expect(escapeJsString('path\\file')).toBe('path\\\\file');
    });

    test('должен экранировать двойные кавычки', () => {
        expect(escapeJsString('"hello"')).toBe('&quot;hello&quot;');
    });

    test('должен экранировать < и >', () => {
        expect(escapeJsString('<div>')).toBe('&lt;div&gt;');
    });

    test('должен защищать от XSS через одинарные кавычки', () => {
        const malicious = '\'); alert(\'xss';
        const escaped = escapeJsString(malicious);
        // После экранирования одинарные кавычки заменены на \x27
        expect(escaped).not.toContain('\'');
        expect(escaped).toBe('\\x27); alert(\\x27xss');
    });

    test('должен обрабатывать пустую строку', () => {
        expect(escapeJsString('')).toBe('');
    });

    test('должен обрабатывать обычный текст без изменений', () => {
        expect(escapeJsString('hello')).toBe('hello');
        expect(escapeJsString('file_123')).toBe('file_123');
    });

    test('должен комбинировать все экранирования', () => {
        const input = '<script>alert(\'xss\')</script>';
        const expected = '&lt;script&gt;alert(\\x27xss\\x27)&lt;/script&gt;';
        expect(escapeJsString(input)).toBe(expected);
    });

    test('должен экранировать путь с одинарными кавычками', () => {
        expect(escapeJsString('file\'s/path')).toBe('file\\x27s/path');
    });

    test('должен обрабатывать backslash перед кавычкой', () => {
        expect(escapeJsString('\\\'')).toBe('\\\\\\x27');
    });
});

// ============================================================================
// formatFileSize
// ============================================================================

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

    test('должен округлять до 2 знаков', () => {
        expect(formatFileSize(1234567)).toBe('1.18 MB');
        expect(formatFileSize(1234)).toBe('1.21 KB');
    });

    test('должен обрабатывать очень большие числа', () => {
        expect(formatFileSize(100 * 1024 * 1024 * 1024)).toBe('100 GB');
    });
});

// ============================================================================
// getFileIcon
// ============================================================================

describe('getFileIcon', () => {
    test('PDF → 📄', () => {
        expect(getFileIcon('doc.pdf')).toBe('📄');
    });

    test('txt, rtf → 📄', () => {
        expect(getFileIcon('file.txt')).toBe('📄');
        expect(getFileIcon('doc.rtf')).toBe('📄');
    });

    test('doc, docx → 📝', () => {
        expect(getFileIcon('doc.doc')).toBe('📝');
        expect(getFileIcon('doc.docx')).toBe('📝');
    });

    test('xls, xlsx, ppt, pptx → 📊', () => {
        expect(getFileIcon('report.xls')).toBe('📊');
        expect(getFileIcon('report.xlsx')).toBe('📊');
        expect(getFileIcon('presentation.ppt')).toBe('📊');
        expect(getFileIcon('presentation.pptx')).toBe('📊');
    });

    test('изображения → 🖼️', () => {
        ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg'].forEach(ext => {
            expect(getFileIcon(`img.${ext}`)).toBe('🖼️');
        });
    });

    test('аудио → 🎵', () => {
        ['mp3', 'wav', 'ogg'].forEach(ext => {
            expect(getFileIcon(`song.${ext}`)).toBe('🎵');
        });
    });

    test('видео → 🎬', () => {
        ['mp4', 'avi', 'mkv', 'mov'].forEach(ext => {
            expect(getFileIcon(`video.${ext}`)).toBe('🎬');
        });
    });

    test('архивы → 📦', () => {
        ['zip', 'rar', '7z', 'tar', 'gz'].forEach(ext => {
            expect(getFileIcon(`file.${ext}`)).toBe('📦');
        });
    });

    test('исполняемые → ⚙️', () => {
        ['exe', 'msi', 'deb', 'rpm'].forEach(ext => {
            expect(getFileIcon(`app.${ext}`)).toBe('⚙️');
        });
    });

    test('файлы кода → 📜', () => {
        ['js', 'ts', 'py', 'java', 'cpp', 'c', 'h'].forEach(ext => {
            expect(getFileIcon(`script.${ext}`)).toBe('📜');
        });
    });

    test('веб → 🌐/🎨/📋', () => {
        expect(getFileIcon('index.html')).toBe('🌐');
        expect(getFileIcon('styles.css')).toBe('🎨');
        expect(getFileIcon('data.json')).toBe('📋');
        expect(getFileIcon('config.xml')).toBe('📋');
        expect(getFileIcon('config.yaml')).toBe('📋');
        expect(getFileIcon('config.yml')).toBe('📋');
    });

    test('markdown → 📝', () => {
        expect(getFileIcon('README.md')).toBe('📝');
    });

    test('неизвестное расширение → 📎', () => {
        expect(getFileIcon('file.xyz')).toBe('📎');
        expect(getFileIcon('file.unknown')).toBe('📎');
    });

    test('регистронезависимость', () => {
        expect(getFileIcon('FILE.PDF')).toBe('📄');
        expect(getFileIcon('FILE.Pdf')).toBe('📄');
        expect(getFileIcon('FILE.pDf')).toBe('📄');
    });

    test('файлы без расширения → 📎', () => {
        expect(getFileIcon('README')).toBe('📎');
        expect(getFileIcon('Makefile')).toBe('📎');
    });

    test('файлы с несколькими точками → последнее расширение', () => {
        expect(getFileIcon('file.tar.gz')).toBe('📦');
    });

    test('должен бросать ошибку при null/undefined', () => {
        expect(() => getFileIcon(null)).toThrow();
        expect(() => getFileIcon(undefined)).toThrow();
    });
});

// ============================================================================
// CONFIG
// ============================================================================

describe('CONFIG', () => {
    test('MAX_FILE_SIZE должен быть 100MB', () => {
        expect(CONFIG.MAX_FILE_SIZE).toBe(100 * 1024 * 1024);
    });

    test('LOCAL_MESSAGE_TTL должен быть 10 секунд', () => {
        expect(CONFIG.LOCAL_MESSAGE_TTL).toBe(10);
    });

    test('AVATAR_DEFAULT должен быть 👤', () => {
        expect(CONFIG.AVATAR_DEFAULT).toBe('👤');
    });

    test('STORAGE_KEYS должен содержать все ключи', () => {
        expect(CONFIG.STORAGE_KEYS.USER_SETTINGS).toBe('xam-user-settings');
        expect(CONFIG.STORAGE_KEYS.LAST_MESSAGE_ID).toBe('xam-last-message-id');
        expect(CONFIG.STORAGE_KEYS.HAS_MORE).toBe('xam-has-more');
    });
});

// ============================================================================
// DELIVERY_STATUS
// ============================================================================

describe('DELIVERY_STATUS', () => {
    test('SENT должен быть 0', () => {
        expect(DELIVERY_STATUS.SENT).toBe(0);
    });

    test('DELIVERED должен быть 1', () => {
        expect(DELIVERY_STATUS.DELIVERED).toBe(1);
    });

    test('READ должен быть 2', () => {
        expect(DELIVERY_STATUS.READ).toBe(2);
    });
});

// ============================================================================
// STATUS_ICONS
// ============================================================================

describe('STATUS_ICONS', () => {
    test('SENT должен быть 🕐', () => {
        expect(STATUS_ICONS.SENT).toBe('🕐');
    });

    test('DELIVERED должен быть ✓', () => {
        expect(STATUS_ICONS.DELIVERED).toBe('✓');
    });

    test('READ должен быть ✓✓', () => {
        expect(STATUS_ICONS.READ).toBe('✓✓');
    });
});
