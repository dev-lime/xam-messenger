/**
 * Фикстуры для управления пользователями
 * Регистрация через UI + утилиты для E2E сценариев
 */
import { test as base, Page, BrowserContext } from '@playwright/test';

const SERVER_URL = process.env.XAM_SERVER_URL || 'http://localhost:8080';

export interface TestUser {
	id: string;
	name: string;
	page: Page;
	context: BrowserContext;
}

export interface UsersFixture {
	/** Создать пользователя через UI (выбор сервера + ввод имени + подключение) */
	createUser(name: string): Promise<TestUser>;

	/** Создать двух пользователей, готовых к обмену */
	createTwoUsers(names?: { a: string; b: string }): Promise<{ userA: TestUser; userB: TestUser }>;

	/** Ожидание: контакт появился в списке */
	waitForPeerInList(page: Page, peerName: string): Promise<void>;

	/** Ожидание: сообщение появилось в чате */
	waitForMessageInChat(page: Page, text: string): Promise<void>;

	/** Отправить сообщение через UI */
	sendMessage(page: Page, text: string): Promise<void>;

	/** Открыть чат с контактом */
	openChat(page: Page, peerName: string): Promise<void>;

	/** Получить ID пользователя по имени (через HTTP API) */
	findUserIdByName(name: string): Promise<string | null>;

	/** Получить статус-иконку последнего своего сообщения */
	getLastMineMessageStatus(page: Page): Promise<string>;

	/** Ожидание: статус сообщения изменился на указанный */
	waitForMessageStatus(page: Page, statusText: string, timeout?: number): Promise<void>;
}

/** Получить ID пользователя по имени через HTTP API */
async function findUserIdByName(name: string): Promise<string | null> {
	const response = await fetch(`${SERVER_URL}/api/v1/users`);
	const result = await response.json();
	if (result.success) {
		const user = result.data.find((u: { name: string }) => u.name === name);
		return user?.id || null;
	}
	return null;
}

export const test = base.extend<{ users: UsersFixture }>({
	users: async ({ browser }, use) => {
		// Логируем конфигурация для отладки
		const SERVER_URL = process.env.XAM_SERVER_URL || 'http://localhost:8080';
		const WS_URL = process.env.XAM_WS_URL || 'ws://localhost:8080/ws';
		const FRONTEND_URL = process.env.XAM_FRONTEND_URL || 'http://localhost:3000';
		
		console.log(`🔧 E2E конфигурация:
   Сервер: ${SERVER_URL}
   WebSocket: ${WS_URL}
   Фронтенд: ${FRONTEND_URL}`);

		const fixture: UsersFixture = {
			createUser: async (name: string) => {
				const context = await browser.newContext();
				const page = await context.newPage();

				console.log(`👤 Создание пользователя: ${name}`);

				// E2E FIX: кэшируем сервер чтобы пропустить сканирование сети
				const serverUrlObj = new URL(SERVER_URL);
				const serverHostname = serverUrlObj.hostname;
				const serverPort = parseInt(serverUrlObj.port) || 8080;
				await context.addInitScript((serverData) => {
					const cachedServers = [{
						ip: serverData.hostname,
						port: serverData.port,
						lastSeen: Date.now(),
						source: 'mdns'
					}];
					localStorage.setItem('xam_server_cache', JSON.stringify(cachedServers));
				}, { hostname: serverHostname, port: serverPort });

				// Логируем навигацию
				page.on('console', (msg) => {
					console.log(`[PAGE ${name}] ${msg.type()}: ${msg.text().substring(0, 200)}`);
				});
				page.on('pageerror', (err) => {
					console.error(`[PAGE ${name}] Error: ${err.message}`);
				});

				// Открываем приложение
				const FRONTEND_URL = process.env.XAM_FRONTEND_URL || 'http://localhost:3000';
				console.log(`🌐 Навигация на ${FRONTEND_URL}`);
				await page.goto('/');
				await page.waitForLoadState('networkidle');

				// 1. Ждём диалог выбора сервера
				await page.waitForSelector('#serverSelectorDialog[open]', { state: 'visible', timeout: 15000 });

				// E2E: сервер уже в кэше (из addInitScript) — выбираем его автоматически
				// Проверяем есть ли серверы в списке
				const serverOptionsCount = await page.locator('#serverSelector option').count();
				if (serverOptionsCount > 1) {
					// Выбираем первый найденный сервер (не "Ввести вручную")
					await page.selectOption('#serverSelector', { index: 1 });
					await page.click('#confirmServerSelect');
					console.log(`🔌 Выбран сервер из кэша`);
				} else {
					// Вводим адрес сервера вручную
					const serverUrlObj = new URL(SERVER_URL);
					const serverHostname = serverUrlObj.hostname;
					const serverPort = serverUrlObj.port || '8080';
					const serverAddress = `${serverHostname}:${serverPort}`;
					console.log(`🔌 Вводим адрес сервера: ${serverAddress}`);
					await page.fill('#manualServerInput', serverAddress);
					await page.click('#confirmManualServer');
				}

				// 3. Ждём диалог подключения (ввод имени)
				await page.waitForSelector('#userNameInput', { state: 'visible', timeout: 15000 });

				// 4. Вводим имя и подключаемся
				await page.fill('#userNameInput', name);

				// Перехватываем ошибки со страницы
				const errors: string[] = [];
				page.on('pageerror', (err) => {
					// Сохраняем только настоящие ошибки, не логи
					if (err.message && !err.message.includes('Стек вызова')) {
						errors.push(err.message);
					}
				});
				page.on('console', (msg) => {
					const text = msg.text();
					// Игнорируем логи с "Error" в стеке вызова
					if (msg.type() === 'error' && !text.includes('Стек вызова')) {
						errors.push(text);
					}
				});

				await page.click('#confirmConnect');
				console.log(`🔘 Нажата кнопка подключения для ${name}`);

				// Ждём закрытия диалога подключения (увеличенный таймаут т.к. регистрация + загрузка peers)
				try {
					await page.waitForFunction(() => {
						const dialog = document.getElementById('connectDialog');
						return dialog && !dialog.hasAttribute('open');
					}, null, { timeout: 30000 });
				} catch (e) {
					// Делаем скриншот для отладки
					await page.screenshot({ path: '/tmp/e2e-debug-dialog.png' });
					console.error(`❌ Диалог не закрылся через 30с. Ошибки: ${errors.join('; ') || 'нет ошибок'}`);
					throw new Error(
						`Диалог не закрылся. Ошибки: ${errors.join('; ') || 'нет ошибок'}`
					);
				}

				// Ждём появления зелёного индикатора
				await page.waitForTimeout(1000);
				await page.waitForSelector('.status-indicator.online', {
					state: 'visible',
					timeout: 15000,
				});

				// 6. Ждём загрузки списка контактов
				await page.waitForTimeout(1500);

				const userId = await fixture.findUserIdByName(name);
				if (!userId) {
					throw new Error(`Не удалось найти ID пользователя "${name}"`);
				}

				return { id: userId, name, page, context };
			},

			createTwoUsers: async (names) => {
				const suffix = Date.now();
				const nameA = names?.a || `Alice_${suffix}`;
				const nameB = names?.b || `Bob_${suffix}`;

				const userA = await fixture.createUser(nameA);
				const userB = await fixture.createUser(nameB);

				// Ждём пока каждый увидит другого в списке
				await fixture.waitForPeerInList(userA.page, nameB);
				await fixture.waitForPeerInList(userB.page, nameA);

				return { userA, userB };
			},

			waitForPeerInList: async (page: Page, peerName: string) => {
				// Увеличенный таймаут т.к. peers загружаются через WebSocket
				await page.waitForFunction(
					(peerName) => {
						const peers = document.querySelectorAll('.peer-name');
						return Array.from(peers).some((el) => el.textContent?.includes(peerName));
					},
					peerName,
					{ timeout: 20000 }
				);
			},

			waitForMessageInChat: async (page: Page, text: string) => {
				await page.waitForFunction(
					(msgText) => {
						const messages = document.querySelectorAll('.message-text');
						return Array.from(messages).some((el) => el.textContent?.includes(msgText));
					},
					text,
					{ timeout: 10000 }
				);
			},

			sendMessage: async (page: Page, text: string) => {
				await page.fill('#messageInput', text);
				await page.click('#sendBtn');
				// Ждём появления сообщения в чате (локальное)
				await page.waitForFunction(
					(msgText) => {
						const messages = document.querySelectorAll('.message-text');
						return Array.from(messages).some((el) => el.textContent?.includes(msgText));
					},
					text,
					{ timeout: 5000 }
				);
			},

			openChat: async (page: Page, peerName: string) => {
				const peerItem = page.locator('.peer-item').filter({ hasText: peerName }).first();
				await peerItem.click();
				// Ждём загрузки чата
				await page.waitForTimeout(500);
			},

			findUserIdByName,

			getLastMineMessageStatus: async (page: Page) => {
				const mineMessages = page.locator('.message.mine .message-status');
				const count = await mineMessages.count();
				if (count === 0) return '';
				const last = mineMessages.nth(count - 1);
				return (await last.textContent()) || '';
			},

			waitForMessageStatus: async (page: Page, statusText: string, timeout = 10000) => {
				await page.waitForFunction(
					(status) => {
						const statuses = document.querySelectorAll('.message.mine .message-status');
						if (statuses.length === 0) return false;
						const last = statuses[statuses.length - 1];
						return last.textContent?.includes(status);
					},
					statusText,
					{ timeout }
				);
			},
		};

		await use(fixture);
	},
});

export { expect } from '@playwright/test';
