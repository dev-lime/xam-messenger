/**
 * Global setup для E2E тестов
 * Запускает Rust сервер и статический HTTP сервер для фронтенда.
 */
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';

const SERVER_PORT = process.env.XAM_SERVER_PORT || '8080';
const FRONTEND_PORT = process.env.XAM_FRONTEND_PORT || '3000';
const SERVER_DIR = path.resolve(__dirname, '../server');

interface ServerContext {
	serverProcess: ChildProcess | null;
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

/**
 * Извлекает локальный IP из вывода сервера
 * Сервер логирует: └─ http://172.19.203.221:8080
 */
function extractServerIp(output: string): string | null {
	// Ищем паттерн http://<ip>:<port>
	const match = output.match(/└─ http:\/\/([^:]+):/);
	return match ? match[1] : null;
}

export default async function globalSetup(): Promise<ServerContext> {
	const context: ServerContext = {
		serverProcess: null,
		frontendProcess: null,
	};

	// Буфер для хранения вывода сервера (чтобы извлечь IP)
	let serverOutput = '';

	// Запускаем Rust сервер
	console.log(`🚀 Запуск Rust сервера на порту ${SERVER_PORT}...`);
	context.serverProcess = spawn(
		'cargo',
		['run', '--manifest-path', path.join(SERVER_DIR, 'Cargo.toml')],
		{
			cwd: SERVER_DIR,
			env: { ...process.env, XAM_PORT: SERVER_PORT, XAM_SKIP_RATE_LIMIT: '1' },
			stdio: ['pipe', 'pipe', 'pipe'],
		}
	);

	// Логируем вывод сервера для отладки
	context.serverProcess.stdout?.on('data', (data) => {
		const text = data.toString().trim();
		if (text) {
			console.log(`[SERVER] ${text}`);
			serverOutput += text;
		}
	});
	context.serverProcess.stderr?.on('data', (data) => {
		const text = data.toString().trim();
		if (text) {
			console.error(`[SERVER ERROR] ${text}`);
			serverOutput += text;
		}
	});

	// Ждём пока сервер запустится
	// Сначала пробуем через localhost (для проверки готовности)
	const localhostUrl = `http://localhost:${SERVER_PORT}`;
	const serverReady = await waitForServer(`${localhostUrl}/api/v1/users`);
	if (!serverReady) {
		throw new Error(`Rust сервер не запустился на порту ${SERVER_PORT}`);
	}
	console.log('✅ Rust сервер готов');

	// Для Playwright Chromium используем localhost — это работает надёжнее
	const useIp = 'localhost';
	const serverUrl = `http://${useIp}:${SERVER_PORT}`;
	const wsUrl = `ws://${useIp}:${SERVER_PORT}/ws`;

	console.log(`📡 IP сервера: ${useIp}`);
	console.log(`🔗 HTTP: ${serverUrl}, WS: ${wsUrl}`);

	// Запускаем static HTTP сервер для фронтенда
	console.log(`🌐 Запуск фронтенд-сервера на порту ${FRONTEND_PORT} из директории src/...`);
	context.frontendProcess = spawn(
		'npx',
		['serve', 'src', '-l', FRONTEND_PORT, '-s', '--no-clipboard'],  // -s = single page app
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

	// Устанавливаем переменные окружения для тестов
	// Используем реальный IP сервера вместо localhost
	process.env.XAM_SERVER_URL = serverUrl;
	process.env.XAM_WS_URL = wsUrl;
	process.env.XAM_FRONTEND_URL = `http://localhost:${FRONTEND_PORT}`;

	return context;
}
