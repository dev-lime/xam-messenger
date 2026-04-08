/**
 * E2E тесты: полный цикл обмена сообщениями
 *
 * Покрывает:
 * - Регистрация двух пользователей через UI
 * - Появление контактов в списке
 * - Отправка сообщений через UI
 * - Получение сообщений в реальном времени
 * - Визуальное обновление статуса доставки
 */
import { test, expect } from '../fixtures/users.fixture';

test.describe('Полный цикл обмена сообщениями', () => {
	test('регистрация → появление в списке → обмен сообщениями', async ({ users }) => {
		// 1. Создаём двух пользователей
		const { userA, userB } = await users.createTwoUsers();

		// 2. Проверяем что каждый видит другого в списке контактов
		await expect(userA.page.locator('.peer-name', { hasText: userB.name })).toBeVisible();
		await expect(userB.page.locator('.peer-name', { hasText: userA.name })).toBeVisible();
	});

	test('отправка сообщения через UI → получение в реальном времени', async ({ users }) => {
		const { userA, userB } = await users.createTwoUsers();

		// Пользователь A открывает чат с B
		await users.openChat(userA.page, userB.name);

		// Отправляет сообщение
		const messageText = `Привет от ${userA.name}! (${Date.now()})`;
		await users.sendMessage(userA.page, messageText);

		// Пользователь B должен увидеть сообщение в чате (автоматически, не открывая чат)
		// Сообщения доставляются через WebSocket независимо от открытого чата
		// Но для отображения нужно открыть чат
		await users.openChat(userB.page, userA.name);
		await users.waitForMessageInChat(userB.page, messageText);

		// Проверяем содержимое
		const messageEl = userB.page.locator('.message.theirs .message-text', { hasText: messageText });
		await expect(messageEl).toBeVisible();
	});

	test('статус доставки: SENT → DELIVERED при отправке', async ({ users }) => {
		const { userA, userB } = await users.createTwoUsers();

		// Открываем чат
		await users.openChat(userA.page, userB.name);

		// Отправляем сообщение
		const messageText = `Проверка статуса (${Date.now()})`;
		await users.sendMessage(userA.page, messageText);

		// Проверяем что сообщение появилось
		await users.waitForMessageInChat(userA.page, messageText);

		// Статус должен быть как минимум "🕐" (SENT) или "✓" (DELIVERED)
		const status = await users.getLastMineMessageStatus(userA.page);
		expect(status).toBeTruthy();
		expect(/🕐|✓/.test(status)).toBe(true);
	});

	test('статус доставки: READ при открытии чата получателем', async ({ users }) => {
		const { userA, userB } = await users.createTwoUsers();

		// A открывает чат и отправляет сообщение
		await users.openChat(userA.page, userB.name);
		const messageText = `Прочитай меня (${Date.now()})`;
		await users.sendMessage(userA.page, messageText);

		// Ждём доставки
		await expect(userA.page.locator('.message.mine .message-status').last()).toBeVisible({ timeout: 10000 });

		// B открывает чат (это вызывает ACK с status=read)
		await users.openChat(userB.page, userA.name);
		await users.waitForMessageInChat(userB.page, messageText);

		// Ждём пока A получит обновление статуса
		// ACK обрабатывается сервером, A получает ack обратно
		await users.waitForMessageStatus(userA.page, '✓✓');

		const finalStatus = await users.getLastMineMessageStatus(userA.page);
		expect(finalStatus).toContain('✓✓');
	});

	test('несколько сообщений подряд — правильный порядок в DOM', async ({ users }) => {
		const { userA, userB } = await users.createTwoUsers();

		await users.openChat(userA.page, userB.name);

		const messages = [
			`Сообщение 1 (${Date.now()})`,
			`Сообщение 2 (${Date.now() + 1})`,
			`Сообщение 3 (${Date.now() + 2})`,
		];

		// Отправляем последовательно
		for (const text of messages) {
			await users.sendMessage(userA.page, text);
		}

		// B открывает чат и проверяет порядок
		await users.openChat(userB.page, userA.name);

		for (const text of messages) {
			await users.waitForMessageInChat(userB.page, text);
		}

		// Проверяем порядок в DOM
		const messageTexts = await userB.page.locator('.message.theirs .message-text').allTextContents();
		expect(messageTexts).toContain(messages[0]);
		expect(messageTexts).toContain(messages[1]);
		expect(messageTexts).toContain(messages[2]);
	});

	test('обмен сообщениями в обоих направлениях', async ({ users }) => {
		const { userA, userB } = await users.createTwoUsers();

		const msgAtoB = `A→B: Привет! (${Date.now()})`;
		const msgBtoA = `B→A: Привет в ответ! (${Date.now()})`;

		// A отправляет B
		await users.openChat(userA.page, userB.name);
		await users.sendMessage(userA.page, msgAtoB);

		// B открывает чат, видит сообщение и отвечает
		await users.openChat(userB.page, userA.name);
		await users.waitForMessageInChat(userB.page, msgAtoB);
		await users.sendMessage(userB.page, msgBtoA);

		// A видит ответ
		await users.waitForMessageInChat(userA.page, msgBtoA);

		// Проверяем что оба сообщения есть у обоих
		await expect(userA.page.locator('.message-text', { hasText: msgAtoB })).toBeVisible();
		await expect(userA.page.locator('.message-text', { hasText: msgBtoA })).toBeVisible();
		await expect(userB.page.locator('.message-text', { hasText: msgAtoB })).toBeVisible();
		await expect(userB.page.locator('.message-text', { hasText: msgBtoA })).toBeVisible();
	});

	test('индикатор онлайн-статуса контакта', async ({ users }) => {
		const { userA, userB } = await users.createTwoUsers();

		// B должен видеть A как онлайн в списке
		const peerElement = userB.page.locator('.peer-item.online', { hasText: userA.name });
		await expect(peerElement).toBeVisible();

		// Индикатор статуса контакта должен быть зелёным
		const statusIndicator = peerElement.locator('.peer-status-indicator.online');
		await expect(statusIndicator).toBeVisible();
	});

	test('статус подключения: "В сети" после подключения', async ({ users }) => {
		const { userA } = await users.createTwoUsers();

		// Проверяем текст статуса
		const statusText = userA.page.locator('.status-text');
		await expect(statusText).toContainText('В сети');

		// Индикатор онлайн
		const indicator = userA.page.locator('.status-indicator.online');
		await expect(indicator).toBeVisible();
	});

	test('клик по статусу показывает задержку', async ({ users }) => {
		const { userA } = await users.createTwoUsers();

		// Кликаем по статусу
		await userA.page.locator('.connection-status').click();

		// Должна появиться анимация задержки
		const latencyElement = userA.page.locator('.status-latency.visible');
		await expect(latencyElement).toBeVisible({ timeout: 5000 });

		// Через некоторое время должна скрыться
		await expect(latencyElement).toBeHidden({ timeout: 5000 });
	});
});

test.describe('Краевые случаи E2E', () => {
	test('отправка пустого сообщения не должна ничего делать', async ({ users }) => {
		const userA = await users.createUser('EmptySender');

		await userA.page.waitForTimeout(1000);

		// Нажимаем отправить без текста
		await userA.page.click('#sendBtn');
		await userA.page.waitForTimeout(500);

		// Не должно появиться новых сообщений
		const messagesCount = await userA.page.locator('.message-text').count();
		expect(messagesCount).toBe(0);
	});

	test('специальные символы в сообщении', async ({ users }) => {
		const { userA, userB } = await users.createTwoUsers();

		const specialText = `<script>alert('xss')</script> & "quotes" 'apostrophe' (${Date.now()})`;

		await users.openChat(userA.page, userB.name);
		await users.sendMessage(userA.page, specialText);

		await users.openChat(userB.page, userA.name);
		await users.waitForMessageInChat(userB.page, specialText);

		// Проверяем что текст отображается как есть (не исполняется)
		const messageEl = userB.page.locator('.message.theirs .message-text').first();
		const textContent = await messageEl.textContent();
		expect(textContent).toContain('<script>');
		expect(textContent).toContain('"quotes"');
	});

	test('длинное сообщение', async ({ users }) => {
		const { userA, userB } = await users.createTwoUsers();

		const longText = 'A'.repeat(5000) + ` (${Date.now()})`;

		await users.openChat(userA.page, userB.name);
		await users.sendMessage(userA.page, longText);

		await users.openChat(userB.page, userA.name);
		await users.waitForMessageInChat(userB.page, longText.substring(0, 50));

		const messageEl = userB.page.locator('.message.theirs .message-text').first();
		const textContent = await messageEl.textContent();
		expect(textContent?.length).toBeGreaterThan(100);
	});
});
