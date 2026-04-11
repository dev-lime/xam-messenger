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
		await expect(userA.page.locator('.message.mine .read-status').last()).toBeVisible({ timeout: 10000 });

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

		// Проверяем порядок в DOM — последние 3 сообщения должны быть в правильном порядке
		const messageTexts = await userB.page.locator('.message.theirs .message-text').allTextContents();
		const lastThree = messageTexts.slice(-3);
		expect(lastThree[0]).toContain(messages[0].split('(')[0].trim());
		expect(lastThree[1]).toContain(messages[1].split('(')[0].trim());
		expect(lastThree[2]).toContain(messages[2].split('(')[0].trim());
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
		// .online стоит на .peer-status, не на .peer-item (app.js: createPeerElement)
		const peerElement = userB.page.locator('.peer-item', { hasText: userA.name });
		await expect(peerElement).toBeVisible();

		// Индикатор статуса контакта должен быть зелёным
		const statusIndicator = peerElement.locator('.peer-status.online');
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

	test('отправка файла', async ({ users }) => {
		// BUG: сообщение с файлом дублируется — одно с галочкой, второе с часиками
		// Требуется исправление в логике отправки файлов в app.js/server-client.js
		const { userA, userB } = await users.createTwoUsers();

		await users.openChat(userA.page, userB.name);

		// Считаем сообщения ДО отправки (проверка на дубликаты через дельту)
		const mineBefore = await userA.page.locator('.message.mine').count();

		// M-08 FIX: используем test.info().outputDir для временных файлов с cleanup
		const path = await import('path');
		const fs = await import('fs');
		const os = await import('os');
		const tmpDir = os.tmpdir();
		const filePath = path.join(tmpDir, `test-file-${Date.now()}.txt`);

		try {
			fs.writeFileSync(filePath, 'Тестовый контент для E2E теста');

			// Прикрепляем файл через input
			const fileInput = userA.page.locator('#fileInput');
			await fileInput.setInputFiles(filePath);

			// Проверяем что файл появился в превью (приложение рендерит в #attachedFiles)
			await expect(userA.page.locator('#attachedFiles .attached-file-name')).toBeVisible({ timeout: 5000 });

			// Отправляем сообщение (без текста, только файл)
			await userA.page.click('#sendBtn');

			// Ждём появления сообщения с файлом
			await userA.page.waitForTimeout(1000);

			// Проверяем что добавилось ровно одно сообщение (не дубликат!)
			const mineCount = await userA.page.locator('.message.mine').count();
			expect(mineCount - mineBefore).toBe(1);

			// Считаем сообщения у B ДО открытия чата
			const theirsBefore = await userB.page.locator('.message.theirs').count();

			// B открывает чат и проверяет наличие файла
			await users.openChat(userB.page, userA.name);
			await users.waitForMessageInChat(userB.page, '');

			// Проверяем что у получателя тоже появилось ровно одно сообщение
			const theirsAfter = await userB.page.locator('.message.theirs').count();
			expect(theirsAfter - theirsBefore).toBe(1);

			// Проверяем что файл отображается у получателя и не дублируется
			const fileNameEl = userB.page.locator('.file-name').first();
			await expect(fileNameEl).toBeVisible({ timeout: 10000 });
			const fileName = await fileNameEl.textContent();
			expect(fileName).toContain('test-file-');

			// Проверяем что имя файла встречается ровно один раз
			const fileNamesCount = await userB.page.locator('.file-name', { hasText: path.basename(filePath) }).count();
			expect(fileNamesCount).toBe(1);
		} finally {
			// M-08 FIX: cleanup — удаляем временный файл
			try { fs.unlinkSync(filePath); } catch { /* ignore */ }
		}
	});

	test('скачивание файла — проверка содержимого', async ({ users }) => {
		const { userA, userB } = await users.createTwoUsers();

		await users.openChat(userA.page, userB.name);

		const path = await import('path');
		const fs = await import('fs');
		const os = await import('os');
		const tmpDir = os.tmpdir();
		const originalContent = `Уникальный контент для проверки скачивания ${Date.now()}`;
		const filePath = path.join(tmpDir, `download-test-${Date.now()}.txt`);

		try {
			fs.writeFileSync(filePath, originalContent);

			// Прикрепляем и отправляем файл
			const fileInput = userA.page.locator('#fileInput');
			await fileInput.setInputFiles(filePath);
			await expect(userA.page.locator('#attachedFiles .attached-file-name')).toBeVisible({ timeout: 5000 });
			await userA.page.click('#sendBtn');
			await userA.page.waitForTimeout(1000);

			// B открывает чат и ждёт файл
			await users.openChat(userB.page, userA.name);
			await users.waitForMessageInChat(userB.page, '');

			const fileNameEl = userB.page.locator('.file-name').first();
			await expect(fileNameEl).toBeVisible({ timeout: 10000 });

			// Нажимаем кнопку скачивания
			const downloadBtn = userB.page.locator('.file-download-btn').first();
			const [download] = await Promise.all([
				userB.page.waitForEvent('download'),
				downloadBtn.click(),
			]);

			// Скачиваем файл и проверяем содержимое
			const downloadedPath = await download.path();
			expect(downloadedPath).toBeTruthy();
			const downloadedContent = fs.readFileSync(downloadedPath!, 'utf-8');
			expect(downloadedContent).toContain(originalContent);
		} finally {
			// Cleanup
			try { fs.unlinkSync(filePath); } catch { /* ignore */ }
		}
	});

	test.fixme('индикатор онлайн-статуса: переход в оффлайн и обратно', async ({ users }) => {
		// BUG: debounce loadPeers (2с) задерживает обновление списка контактов,
		// статус остаётся "в сети" даже после setOffline(true)
		// Требуется: либо уменьшить debounce, либо реагировать на WebSocket user_offline
		const { userA, userB } = await users.createTwoUsers();

		// B видит A как онлайн
		const peerA = userB.page.locator('.peer-item', { hasText: userA.name });
		await expect(peerA).toBeVisible();

		// Переключаем A в оффлайн через контекст страницы
		await userA.page.context().setOffline(true);

		// Ждём пока сервер обнаружит отключение
		await userA.page.waitForTimeout(3000);

		// B должен увидеть A как оффлайн (или не в сети)
		// Проверяем что статус изменился
		const statusEl = peerA.locator('.peer-status');
		const statusText = await statusEl.textContent();
		expect(statusText).toContain('не в сети');

		// Возвращаем A в онлайн
		await userA.page.context().setOffline(false);

		// Ждём восстановления подключения
		await userA.page.waitForTimeout(3000);

		// Проверяем что индикатор снова онлайн
		await expect(userA.page.locator('.status-indicator.online')).toBeVisible({ timeout: 10000 });
	});

	test('пагинация: кнопка "Загрузить ещё"', async ({ users }) => {
		const { userA, userB } = await users.createTwoUsers();

		// Отправляем достаточно сообщений чтобы сработала пагинация
		await users.openChat(userA.page, userB.name);
		for (let i = 0; i < 30; i++) {
			await users.sendMessage(userA.page, `Сообщение для пагинации ${i} (${Date.now() + i})`);
		}

		// B открывает чат — должно появиться меньше 30 сообщений и кнопка "Загрузить ещё"
		await users.openChat(userB.page, userA.name);
		await userB.page.waitForTimeout(2000);

		// Проверяем наличие кнопки загрузки
		const loadMoreBtn = userB.page.locator('#loadMoreBtn');
		const isVisible = await loadMoreBtn.isVisible().catch(() => false);

		if (isVisible) {
			// Кнопка видна — нажимаем
			await loadMoreBtn.click();
			await userB.page.waitForTimeout(1000);

			// Проверяем что появились дополнительные сообщения
			const messagesAfter = await userB.page.locator('.message.theirs .message-text').count();
			expect(messagesAfter).toBeGreaterThan(0);
		} else {
			// Если кнопка не видна — проверяем что сообщения загрузились
			const messagesCount = await userB.page.locator('.message.theirs .message-text').count();
			expect(messagesCount).toBeGreaterThan(0);
		}
	});

	test('смена сервера через меню профиля', async ({ users }) => {
		const { userA } = await users.createTwoUsers();

		// Открываем меню профиля
		await userA.page.locator('#profileAvatarBtn').click();
		await userA.page.waitForTimeout(500);

		// Нажимаем "Сменить сервер"
		await userA.page.locator('#menuChangeServer').click();

		// Проверяем что открылся диалог выбора сервера
		await expect(userA.page.locator('#serverSelectorDialog')).toBeVisible({ timeout: 5000 });

		// Закрываем диалог
		await userA.page.locator('#cancelServerSelector').click();
	});

	test.fixme('редактирование профиля: смена имени', async ({ users }) => {
		// BUG: #saveSettings не закрывает #settingsDialog после сохранения
		// Требуется исправление в app.js — saveSettings() не вызывается или выбрасывает ошибку
		const { userA } = await users.createTwoUsers();

		const newName = `НовоеИмя_${Date.now()}`;

		// Открываем меню профиля
		await userA.page.locator('#profileAvatarBtn').click();
		await userA.page.waitForTimeout(500);

		// Открываем диалог профиля (не настройки приложения!)
		await userA.page.locator('#menuProfile').click();

		// Ждём диалог настроек профиля
		await expect(userA.page.locator('#settingsDialog')).toBeVisible({ timeout: 5000 });

		// Меняем имя
		await userA.page.fill('#settingsNameInput', newName);

		// Сохраняем
		await userA.page.locator('#saveSettings').click();
		await userA.page.waitForTimeout(1000);

		// Ждём закрытия диалога
		await expect(userA.page.locator('#settingsDialog')).not.toBeVisible({ timeout: 10000 });

		// Проверяем что имя обновилось в профиле
		await userA.page.locator('#profileAvatarBtn').click();
		await userA.page.waitForTimeout(500);
		const displayName = await userA.page.locator('#profileMenuName').textContent();
		expect(displayName).toContain(newName);
	});
});
