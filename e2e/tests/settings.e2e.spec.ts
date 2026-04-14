/**
 * E2E тесты: настройки приложения
 */
import { test, expect } from '../fixtures/users.fixture';

test.describe('Настройки приложения', () => {
	test('смена языка ru → en', async ({ users }) => {
		const { userA } = await users.createTwoUsers();

		// Открываем настройки приложения
		await userA.page.locator('#profileAvatarBtn').click();
		await userA.page.locator('#menuSettings').click();
		await expect(userA.page.locator('#appSettingsDialog')).toBeVisible({ timeout: 5000 });

		// Проверяем что текущий язык — русский
		await expect(userA.page.locator('#saveAppSettings')).toContainText('Готово');

		// Меняем язык на English
		await userA.page.locator('#settingLanguage').selectOption('en');

		// Сохраняем
		await userA.page.locator('#saveAppSettings').click();
		await expect(userA.page.locator('#appSettingsDialog')).not.toBeVisible({ timeout: 5000 });

		// Открываем снова и проверяем что язык сохранился
		await userA.page.locator('#profileAvatarBtn').click();
		await userA.page.locator('#menuSettings').click();
		await expect(userA.page.locator('#settingLanguage')).toHaveValue('en');

		// Возвращаем русский
		await userA.page.locator('#settingLanguage').selectOption('ru');
		await userA.page.locator('#saveAppSettings').click();
	});

	test('смена темы light → dark', async ({ users }) => {
		const { userA } = await users.createTwoUsers();

		// Проверяем что нет dark-theme по умолчанию
		await expect(userA.page.locator('html')).not.toHaveClass(/dark-theme/);

		// Открываем настройки
		await userA.page.locator('#profileAvatarBtn').click();
		await userA.page.locator('#menuSettings').click();
		await expect(userA.page.locator('#appSettingsDialog')).toBeVisible({ timeout: 5000 });

		// Меняем тему
		await userA.page.selectOption('#settingTheme', 'dark');
		await userA.page.locator('#saveAppSettings').click();
		await expect(userA.page.locator('#appSettingsDialog')).not.toBeVisible({ timeout: 5000 });

		// Проверяем что класс dark-theme применён
		await expect(userA.page.locator('html')).toHaveClass(/dark-theme/);
	});

	test('изменение размера шрифта', async ({ users }) => {
		const { userA } = await users.createTwoUsers();

		// Открываем настройки
		await userA.page.locator('#profileAvatarBtn').click();
		await userA.page.locator('#menuSettings').click();
		await expect(userA.page.locator('#appSettingsDialog')).toBeVisible({ timeout: 5000 });

		// Меняем размер шрифта
		const fontSizeSlider = userA.page.locator('#settingFontSize');
		await fontSizeSlider.fill('18');

		// Проверяем что значение обновилось
		await expect(userA.page.locator('#fontSizeValue')).toContainText('18px');

		// Сохраняем
		await userA.page.locator('#saveAppSettings').click();
		await expect(userA.page.locator('#appSettingsDialog')).not.toBeVisible({ timeout: 5000 });

		// Проверяем что шрифт применён к body
		const bodyFontSize = await userA.page.evaluate(() =>
			window.getComputedStyle(document.body).fontSize
		);
		expect(bodyFontSize).toBe('18px');
	});
});
