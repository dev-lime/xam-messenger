/**
 * Фикстуры для тестового сервера
 * Предоставляют утилиты для HTTP API взаимодействия с сервером
 */
import { test as base } from '@playwright/test';

const SERVER_URL = process.env.XAM_SERVER_URL || 'http://localhost:8080';
const WS_URL = process.env.XAM_WS_URL || 'ws://localhost:8080/ws';

export interface ServerFixture {
	/** Базовый URL сервера (HTTP) */
	serverUrl: string;
	/** WebSocket URL */
	wsUrl: string;

	/** Регистрация пользователя через HTTP API */
	registerUser(name: string): Promise<{ id: string; name: string }>;

	/** Получить список всех пользователей */
	getUsers(): Promise<Array<{ id: string; name: string; avatar: string }>>;

	/** Получить список онлайн пользователей */
	getOnlineUsers(): Promise<string[]>;

	/** Получить сообщения */
	getMessages(limit?: number): Promise<any[]>;
}

async function registerUser(name: string): Promise<{ id: string; name: string }> {
	const response = await fetch(`${SERVER_URL}/api/v1/register`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ name }),
	});
	const result = await response.json();
	if (result.success) {
		return result.data;
	}
	throw new Error(result.error || 'Registration failed');
}

async function getUsers(): Promise<Array<{ id: string; name: string; avatar: string }>> {
	const response = await fetch(`${SERVER_URL}/api/v1/users`);
	const result = await response.json();
	if (result.success) {
		return result.data;
	}
	throw new Error('Failed to get users');
}

async function getOnlineUsers(): Promise<string[]> {
	const response = await fetch(`${SERVER_URL}/api/v1/online`);
	const result = await response.json();
	if (result.success) {
		return result.data;
	}
	throw new Error('Failed to get online users');
}

export const test = base.extend<{ server: ServerFixture }>({
	server: async ({}, use) => {
		const fixture: ServerFixture = {
			serverUrl: SERVER_URL,
			wsUrl: WS_URL,
			registerUser,
			getUsers,
			getOnlineUsers,
			getMessages: async (limit = 50) => {
				const response = await fetch(`${SERVER_URL}/api/v1/messages?limit=${limit}`);
				const result = await response.json();
				if (result.success) {
					return result.data;
				}
				throw new Error('Failed to get messages');
			},
		};
		await use(fixture);
	},
});

export { expect } from '@playwright/test';
