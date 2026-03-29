/**
 * Конфигурация Jest для интеграционных тестов
 */
module.exports = {
    testEnvironment: 'node',
    testMatch: [
        '**/__tests__/integration.test.js'
    ],
    testTimeout: 30000,
    verbose: true,
};
