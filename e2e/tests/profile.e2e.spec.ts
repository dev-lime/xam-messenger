/**
 * E2E тесты: профиль пользователя
 */
import { test, expect } from '../fixtures/users.fixture';

test.describe('Профиль пользователя', () => {
	test('смена аватара', async ({ users }) => {
		const { userA } = await users.createTwoUsers();

		const newAvatar = '🦊';

		// Открываем диалог профиля
		await userA.page.locator('#profileAvatarBtn').click();
		await userA.page.locator('#menuProfile').click();
		await expect(userA.page.locator('#settingsDialog')).toBeVisible({ timeout: 5000 });

		// Меняем аватар
		await userA.page.fill('#settingsAvatarInput', newAvatar);
		await userA.page.locator('#saveSettings').click();
		await expect(userA.page.locator('#settingsDialog')).not.toBeVisible({ timeout: 10000 });

		// Проверяем что аватар обновился в сайдбаре
		await expect(userA.page.locator('#userAvatar')).toContainText(newAvatar);
	});

	test.fixme('выход из аккаунта (logout)', async ({ users }) => {
		// BUG: logout функция ещё не полностью реализована
		const { userA } = await users.createTwoUsers();

		// Открываем меню и выходим
		await userA.page.locator('#profileAvatarBtn').click();
		await userA.page.locator('#menuLogout').click();

		// Должен открыться диалог подключения
		await expect(userA.page.locator('#connectDialog')).toBeVisible({ timeout: 10000 });
	});

	test.fixme('переподключение через клик по статусу', async ({ users }) => {
		// BUG: требует реализации логики переподключения
		const { userA } = await users.createTwoUsers();

		await userA.page.locator('#profileAvatarBtn').click();
		await userA.page.locator('#menuLogout').click();
		await expect(userA.page.locator('#connectDialog')).toBeVisible({ timeout: 10000 });

		await userA.page.locator('#connectDialog').evaluate((el: HTMLDialogElement) => el.close());
		await userA.page.locator('.connection-status').click();
		await expect(userA.page.locator('#connectDialog')).toBeVisible({ timeout: 5000 });
	});
});
