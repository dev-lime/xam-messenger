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
});
