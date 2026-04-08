import { defineConfig, devices } from '@playwright/test';

const SERVER_PORT = process.env.XAM_SERVER_PORT || '8080';
const FRONTEND_PORT = process.env.XAM_FRONTEND_PORT || '3000';

export default defineConfig({
	testDir: './e2e/tests',
	fullyParallel: false, // Сервер общий, тесты последовательные
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: 1, // Один воркер — общий сервер
	timeout: 120000, // Увеличиваем таймаут теста до 2 минут
	reporter: [
		['html', { outputFolder: 'e2e-report', open: 'never' }],
		['list'],
	],
	globalSetup: './e2e/global-setup.ts',
	globalTeardown: './e2e/global-teardown.ts',
	use: {
		baseURL: `http://localhost:${FRONTEND_PORT}`,
		trace: 'on-first-retry',
		screenshot: 'only-on-failure',
		video: 'retain-on-failure',
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] },
		},
	],
});
