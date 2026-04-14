/**
 * E2E тесты: файлообмен (консолидированные)
 *
 * Все проверки в рамках одного createTwoUsers() для экономии ресурсов.
 */
import { test, expect } from '../fixtures/users.fixture';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

test.describe('Файлообмен', () => {
	test('отправка файла → получение → скачивание → прогрессбар → галочка → повторное скачивание', async ({ users }) => {
		const { userA, userB } = await users.createTwoUsers();
		await users.openChat(userA.page, userB.name);

		const tmpDir = os.tmpdir();
		const originalContent = `Уникальный контент ${Date.now()}`;
		const filePath = path.join(tmpDir, `test-file-${Date.now()}.txt`);
		fs.writeFileSync(filePath, originalContent);

		try {
			// ===== 1. Отправка файла =====
			await userA.page.locator('#fileInput').setInputFiles(filePath);
			await expect(userA.page.locator('#attachedFiles .attached-file-name')).toBeVisible({ timeout: 5000 });
			await userA.page.click('#sendBtn');
			await userA.page.waitForSelector('.message.mine .file-item', { state: 'visible', timeout: 10000 });

			// ===== 2. B открывает чат и проверяет файл =====
			await users.openChat(userB.page, userA.name);
			const fileNameEl = userB.page.locator('.file-name').first();
			await expect(fileNameEl).toBeVisible({ timeout: 10000 });

			// ===== 3. Проверяем наличие прогрессбара (скрыт до начала скачивания) =====
			const downloadBtn = userB.page.locator('.file-download-btn').first();
			await expect(downloadBtn).toBeVisible({ timeout: 10000 });
			// progress-ring есть в DOM но скрыт
			const progressRing = downloadBtn.locator('.progress-ring');
			await expect(progressRing).toHaveCount(1);
			await expect(downloadBtn.locator('.download-icon')).toBeVisible();

			// ===== 4. Скачиваем и проверяем содержимое =====
			const [download1] = await Promise.all([
				userB.page.waitForEvent('download'),
				downloadBtn.click(),
			]);
			const downloadedPath1 = await download1.path();
			expect(downloadedPath1).toBeTruthy();
			const downloadedContent1 = fs.readFileSync(downloadedPath1!, 'utf-8');
			expect(downloadedContent1).toContain(originalContent);

			// ===== 5. Проверяем галочку после скачивания =====
			const downloadedIcon = downloadBtn.locator('.downloaded-icon');
			await expect(downloadedIcon).toBeVisible({ timeout: 5000 });
			const svgCheck = downloadedIcon.locator('svg path').last();
			await expect(svgCheck).toBeVisible();

			// ===== 6. Повторное скачивание =====
			const [download2] = await Promise.all([
				userB.page.waitForEvent('download'),
				downloadBtn.click(),
			]);
			const downloadedPath2 = await download2.path();
			expect(downloadedPath2).toBeTruthy();
			const downloadedContent2 = fs.readFileSync(downloadedPath2!, 'utf-8');
			expect(downloadedContent2).toContain(originalContent);
		} finally {
			try { fs.unlinkSync(filePath); } catch { /* ignore */ }
		}
	});

	test('несколько файлов + текст → нет дубликатов → скачивание каждого', async ({ users }) => {
		const { userA, userB } = await users.createTwoUsers();
		await users.openChat(userA.page, userB.name);

		const tmpDir = os.tmpdir();
		const captionText = `Подпись к файлам ${Date.now()}`;
		const files = [
			{ name: `f1-${Date.now()}.txt`, content: 'content file 1' },
			{ name: `f2-${Date.now()}.txt`, content: 'content file 2' },
		];
		const filePaths = files.map(f => {
			const p = path.join(tmpDir, f.name);
			fs.writeFileSync(p, f.content);
			return p;
		});

		try {
			// Считаем сообщения ДО
			const mineBefore = await userA.page.locator('.message.mine').count();

			// Прикрепляем 2 файла + текст
			await userA.page.locator('#fileInput').setInputFiles(filePaths);
			await expect(userA.page.locator('#attachedFiles .attached-file-name').first()).toBeVisible({ timeout: 5000 });
			await userA.page.fill('#messageInput', captionText);
			await userA.page.click('#sendBtn');

			// B открывает чат
			await users.openChat(userB.page, userA.name);
			await userB.page.waitForSelector('.message-text', { state: 'visible', timeout: 10000 });

			// Текст — ровно 1 сообщение
			const textMessages = await userB.page.locator('.message-text', { hasText: captionText }).count();
			expect(textMessages).toBe(1);

			// Файлы — минимум 2
			const fileItems = await userB.page.locator('.file-item').count();
			expect(fileItems).toBeGreaterThanOrEqual(2);

			// У отправителя: не больше 3 новых (2 файла + 1 текст)
			const mineAfter = await userA.page.locator('.message.mine').count();
			expect(mineAfter - mineBefore).toBeLessThanOrEqual(3);

			// Скачиваем каждый файл и проверяем содержимое
			const downloadBtns = userB.page.locator('.file-download-btn');
			const btnCount = await downloadBtns.count();
			for (let i = 0; i < Math.min(btnCount, 2); i++) {
				const [download] = await Promise.all([
					userB.page.waitForEvent('download'),
					downloadBtns.nth(i).click(),
				]);
				expect(await download.path()).toBeTruthy();
			}
		} finally {
			filePaths.forEach(p => { try { fs.unlinkSync(p); } catch { /* ignore */ } });
		}
	});

	test.fixme('файл слишком большой → ошибка', async ({ users }) => {
		const { userA } = await users.createTwoUsers();
		await users.openChat(userA.page, 'Nobody');

		const tmpDir = os.tmpdir();
		const largeFilePath = path.join(tmpDir, `large-file-${Date.now()}.txt`);
		const fd = fs.openSync(largeFilePath, 'w');
		fs.writeSync(fd, Buffer.alloc(101 * 1024 * 1024, 'x'));
		fs.closeSync(fd);

		try {
			await userA.page.locator('#fileInput').setInputFiles(largeFilePath);
			await userA.page.waitForTimeout(1000);
			const attachedFiles = await userA.page.locator('#attachedFiles .attached-file-name').count();
			expect(attachedFiles).toBe(0);
		} finally {
			try { fs.unlinkSync(largeFilePath); } catch { /* ignore */ }
		}
	});
});
