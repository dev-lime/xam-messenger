/**
 * Утилиты для E2E тестирования
 */
import { Page } from '@playwright/test';

/**
 * Подождать пока элемент появится
 */
export async function waitForElement(page: Page, selector: string, timeout = 10000): Promise<void> {
	await page.waitForSelector(selector, { state: 'visible', timeout });
}

/**
 * Подождать пока текст появится внутри элементов
 */
export async function waitForText(page: Page, text: string, selector = 'body', timeout = 10000): Promise<void> {
	await page.waitForFunction(
		({ text, selector: sel }) => {
			const elements = document.querySelectorAll(sel);
			return Array.from(elements).some((el) => el.textContent?.includes(text));
		},
		{ text, selector: selector },
		{ timeout }
	);
}

/**
 * Получить текст элемента
 */
export async function getElementText(page: Page, selector: string): Promise<string> {
	const el = await page.locator(selector).first();
	return (await el.textContent()) || '';
}

/**
 * Подождать определённое количество элементов
 */
export async function waitForElementsCount(
	page: Page,
	selector: string,
	count: number,
	timeout = 10000
): Promise<void> {
	await page.waitForFunction(
		({ selector: sel, expectedCount }) => {
			return document.querySelectorAll(sel).length === expectedCount;
		},
		{ selector, expectedCount: count },
		{ timeout }
	);
}

/**
 * Проверить что индикатор подключения онлайн
 */
export function isOnline(page: Page): Promise<boolean> {
	return page.evaluate(() => {
		const indicator = document.querySelector('.status-indicator');
		return indicator?.classList.contains('online') || false;
	});
}
