import js from '@eslint/js';
import globals from 'globals';

export default [
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.browser,
                ...globals.node,
                ...globals.jest,
                'invokeTauri': 'readonly',
                '__TAURI__': 'readonly',
            },
        },
        rules: {
            'indent': ['error', 4],
            'linebreak-style': ['error', 'unix'],
            'quotes': ['error', 'single'],
            'semi': ['error', 'always'],
            'no-unused-vars': 'warn',
            'no-console': 'off',
            'no-undef': 'error',
        },
        ignores: [
            'node_modules/',
            'coverage/',
            'dist/',
            'src-tauri/',
            'server/target/',
        ],
    },
];
