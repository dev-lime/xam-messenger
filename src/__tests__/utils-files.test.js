/**
 * Тесты для utils/files.js — логика без DOM
 */

import { CONFIG } from 'src/utils/helpers.js';

describe('utils/files.js — CONFIG', () => {
    test('MAX_FILE_SIZE должен быть 100MB', () => {
        expect(CONFIG.MAX_FILE_SIZE).toBe(100 * 1024 * 1024);
    });

    test('должен правильно конвертировать размеры', () => {
        const kb = 1024;
        const mb = 1024 * kb;
        expect(CONFIG.MAX_FILE_SIZE).toBe(100 * mb);
    });
});
