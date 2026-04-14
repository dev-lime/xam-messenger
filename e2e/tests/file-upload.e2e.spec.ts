/**
 * E2E тесты: файлообмен
 */
import { test, expect } from '../fixtures/users.fixture';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

test.describe('Файлообмен', () => {
	test('отправка файла → скачивание → проверка содержимого', async ({ users }) => {
		const { userA, userB } = await users.createTwoUsers();

		await users.openChat(userA.page, userB.name);

		const tmpDir = os.tmpdir();
		const originalContent = `Уникальный контент ${Date.now()}`;
		const filePath = path.join(tmpDir, `test-file-${Date.now()}.txt`);

		try {
			fs.writeFileSync(filePath, originalContent);

			// Прикрепляем файл
			await userA.page.locator('#fileInput').setInputFiles(filePath);
			await expect(userA.page.locator('#attachedFiles .attached-file-name')).toBeVisible({ timeout: 5000 });

			// Отправляем
			await userA.page.click('#sendBtn');
			await userA.page.waitForSelector('.message.mine .file-item', { state: 'visible', timeout: 10000 });

			// B открывает чат и проверяет файл
			await users.openChat(userB.page, userA.name);
			const fileNameEl = userB.page.locator('.file-name').first();
			await expect(fileNameEl).toBeVisible({ timeout: 10000 });

			// Скачиваем
			const downloadBtn = userB.page.locator('.file-download-btn').first();
			const [download] = await Promise.all([
				userB.page.waitForEvent('download'),
				downloadBtn.click(),
			]);

			const downloadedPath = await download.path();
			expect(downloadedPath).toBeTruthy();
			const downloadedContent = fs.readFileSync(downloadedPath!, 'utf-8');
			expect(downloadedContent).toContain(originalContent);
		} finally {
			try { fs.unlinkSync(filePath); } catch { /* ignore */ }
		}
	});

	test.fixme('файл слишком большой → ошибка', async ({ users }) => {
		// BUG: проверка размера файла происходит на клиенте но сообщение об ошибке
		// может не отображаться корректно
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

	test('несколько файлов одновременно', async ({ users }) => {
		const { userA, userB } = await users.createTwoUsers();
		await users.openChat(userA.page, userB.name);

		const tmpDir = os.tmpdir();
		const files = [
			{ name: `file1-${Date.now()}.txt`, content: 'File 1 content' },
			{ name: `file2-${Date.now()}.txt`, content: 'File 2 content' },
		];
		const filePaths = files.map(f => {
			const p = path.join(tmpDir, f.name);
			fs.writeFileSync(p, f.content);
			return p;
		});

		try {
			// Прикрепляем несколько файлов
			await userA.page.locator('#fileInput').setInputFiles(filePaths);

			// Проверяем что оба файла появились в превью
			await expect(userA.page.locator('#attachedFiles .attached-file-name').first()).toBeVisible({ timeout: 5000 });
			const attachedCount = await userA.page.locator('#attachedFiles .attached-file-name').count();
			expect(attachedCount).toBe(2);

			// Отправляем
			await userA.page.click('#sendBtn');
			await userA.page.waitForSelector('.message.mine .file-item', { state: 'visible', timeout: 10000 });

			// B открывает чат и проверяет что оба файла получены
			await users.openChat(userB.page, userA.name);
			const fileNames = await userB.page.locator('.file-name').allTextContents();
			expect(fileNames.length).toBeGreaterThanOrEqual(2);
		} finally {
			filePaths.forEach(p => { try { fs.unlinkSync(p); } catch { /* ignore */ } });
		}
	});

	test('несколько файлов с текстовой подписью — нет дубликатов', async ({ users }) => {
		const { userA, userB } = await users.createTwoUsers();
		await users.openChat(userA.page, userB.name);

		const tmpDir = os.tmpdir();
		const captionText = `Подпись к файлам ${Date.now()}`;
		const filePaths = [
			path.join(tmpDir, `f1-${Date.now()}.txt`),
			path.join(tmpDir, `f2-${Date.now()}.txt`),
		];
		filePaths.forEach(p => fs.writeFileSync(p, 'content'));

		try {
			// Считаем сообщения ДО
			const mineBefore = await userA.page.locator('.message.mine').count();

			// Прикрепляем 2 файла + текст
			await userA.page.locator('#fileInput').setInputFiles(filePaths);
			await expect(userA.page.locator('#attachedFiles .attached-file-name').first()).toBeVisible({ timeout: 5000 });

			// Вводим текст и отправляем
			await userA.page.fill('#messageInput', captionText);
			await userA.page.click('#sendBtn');

			// Ждём появления сообщений у получателя
			await users.openChat(userB.page, userA.name);
			await userB.page.waitForSelector('.message-text', { state: 'visible', timeout: 10000 });

			// Текст появился ровно в 1 сообщении
			const textMessages = await userB.page.locator('.message-text', { hasText: captionText }).count();
			expect(textMessages).toBe(1);

			// Файлы появились (2 файла = 2 сообщения с файлами)
			const fileItems = await userB.page.locator('.file-item').count();
			expect(fileItems).toBeGreaterThanOrEqual(2);

			// У отправителя: 2 файла + 1 текст = не больше 3 новых
			const mineAfter = await userA.page.locator('.message.mine').count();
			expect(mineAfter - mineBefore).toBeLessThanOrEqual(3);
		} finally {
			filePaths.forEach(p => { try { fs.unlinkSync(p); } catch { /* ignore */ } });
		}
	});
});
