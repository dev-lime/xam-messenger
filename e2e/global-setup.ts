/**
 * Global setup для E2E тестов
 * Запускает статический HTTP сервер для фронтенда.
 * Rust сервер предполагается уже запущенным (или запускается отдельно).
 */
import { spawn, ChildProcess, execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

const FRONTEND_PORT = process.env.XAM_FRONTEND_PORT || '3000';
const SRC_DIR = path.resolve(__dirname, '../src');

interface ServerContext {
	frontendProcess: ChildProcess | null;
}

async function waitForServer(url: string, timeout = 30000): Promise<boolean> {
	const start = Date.now();
	while (Date.now() - start < timeout) {
		try {
			const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
			if (res.ok || res.status === 200 || res.status === 404) return true;
		} catch {
			// Server not ready yet
		}
		await new Promise((r) => setTimeout(r, 500));
	}
	return false;
}

export default async function globalSetup(): Promise<ServerContext> {
	const context: ServerContext = {
		frontendProcess: null,
	};

	// Проверяем что сервер уже запущен
	const serverUrl = process.env.XAM_SERVER_URL || 'http://localhost:8080';
	try {
		const res = await fetch(`${serverUrl}/api/v1/users`, { signal: AbortSignal.timeout(3000) });
		if (!res.ok) {
			console.warn(`⚠️  Сервер ${serverUrl} не отвечает. Запустите сервер перед тестами.`);
		} else {
			console.log('✅ Сервер доступен');
		}
	} catch {
		console.warn(`⚠️  Сервер ${serverUrl} недоступен. Запустите сервер перед тестами.`);
	}

	// Запускаем static HTTP сервер для фронтенда
	console.log(`🌐 Запуск фронтенд-сервера на порту ${FRONTEND_PORT}...`);
	context.frontendProcess = spawn(
		'npx',
		['serve', 'src', '-l', FRONTEND_PORT, '-s', '--no-clipboard'],
		{
			cwd: path.resolve(__dirname, '..'),
			stdio: ['pipe', 'pipe', 'pipe'],
		}
	);

	const frontendReady = await waitForServer(`http://localhost:${FRONTEND_PORT}/index.html`);
	if (!frontendReady) {
		throw new Error(`Фронтенд-сервер не запустился на порту ${FRONTEND_PORT}`);
	}
	console.log('✅ Фронтенд готов');

	process.env.XAM_SERVER_URL = serverUrl;
	process.env.XAM_WS_URL = `${serverUrl.replace('http', 'ws')}/ws`;
	process.env.XAM_FRONTEND_URL = `http://localhost:${FRONTEND_PORT}`;

	return context;
}
