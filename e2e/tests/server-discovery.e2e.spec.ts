/**
 * E2E тесты: обнаружение и подключение к серверу
 */
import { test, expect } from '@playwright/test';

const FRONTEND_URL = process.env.XAM_FRONTEND_URL || 'http://localhost:3000';
const SERVER_PORT = process.env.XAM_SERVER_PORT || '8080';

test.describe('Обнаружение сервера', () => {
	test('ручной ввод адреса сервера', async ({ browser }) => {
		const context = await browser.newContext();
		const page = await context.newPage();

		// Открываем приложение без кэша
		await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });

		// Ждём диалог выбора сервера
		await expect(page.locator('#serverSelectorDialog')).toBeVisible({ timeout: 15000 });

		// Вводим адрес сервера вручную
		await page.fill('#manualServerInput', `localhost:${SERVER_PORT}`);
		await page.locator('#confirmManualServer').click();

		// Должен открыться диалог подключения (ввод имени)
		await expect(page.locator('#connectDialog')).toBeVisible({ timeout: 5000 });

		// Проверяем что адрес сервера отобразился
		await expect(page.locator('#selectedServerInfo')).toContainText('localhost');

		await context.close();
	});

	test.fixme('кэширование сервера → автоподключение', async ({ browser }) => {
		const context = await browser.newContext();

		// Предзаполняем кэш
		await context.addInitScript(() => {
			const cached = [{
				ip: 'localhost',
				port: parseInt(process.env.XAM_SERVER_PORT || '8080'),
				lastSeen: Date.now(),
				source: 'mdns'
			}];
			localStorage.setItem('xam_server_cache', JSON.stringify(cached));
		});

		const page = await context.newPage();
		await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });

		// Должен открыться диалог выбора сервера с сервером из кэша
		await expect(page.locator('#serverSelectorDialog')).toBeVisible({ timeout: 15000 });

		// Проверяем что сервер из кэша отображается
		const serverList = page.locator('#serverList');
		await expect(serverList).toBeVisible({ timeout: 5000 });

		// Сервер должен отобразиться после сканирования
		await page.waitForTimeout(3000);
		const serverItems = await page.locator('.server-item').count();
		expect(serverItems).toBeGreaterThanOrEqual(1);

		await context.close();
	});

	test('неверный адрес → сообщение об ошибке', async ({ browser }) => {
		const context = await browser.newContext();
		const page = await context.newPage();
		await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });

		await expect(page.locator('#serverSelectorDialog')).toBeVisible({ timeout: 15000 });

		// Вводим заведомо неверный адрес
		await page.fill('#manualServerInput', '192.168.255.255:9999');
		await page.locator('#confirmManualServer').click();

		// Должен открыться диалог подключения, но подключение должно завершиться ошибкой
		await expect(page.locator('#connectDialog')).toBeVisible({ timeout: 5000 });

		// Вводим имя и пытаемся подключиться
		await page.fill('#userNameInput', 'TestUser');
		await page.locator('#confirmConnect').click();

		// Ждём сообщения об ошибке (таймаут подключения)
		await expect(page.locator('#serverStatus')).toContainText('Ошибка', { timeout: 15000 });

		await context.close();
	});
});
