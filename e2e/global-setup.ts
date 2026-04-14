/**
 * Global setup для E2E тестов
 * Запускает Rust сервер и статический HTTP сервер для фронтенда.
 */
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as fs from 'fs';
import * as os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

	// Очищаем БД сервера перед каждым прогоном (защита от загрязнения состояния)
	const homeDir = os.homedir();
	// Кроссплатформенный путь к БД
	const dataDir = process.platform === 'darwin'
		? path.join(homeDir, 'Library', 'Application Support', 'xam-messenger')
		: process.platform === 'win32'
			? path.join(process.env.APPDATA || '', 'xam-messenger')
			: path.join(homeDir, '.config', 'xam-messenger');
	const dbPath = path.join(dataDir, 'xam.db');
	const filesDir = path.join(dataDir, 'files');
	try {
		if (fs.existsSync(dbPath)) {
			fs.unlinkSync(dbPath);
			console.log('🧹 Очищена серверная БД');
		}
		// Также чистим WAL и SHM файлы
		for (const ext of ['-wal', '-shm']) {
			const walPath = dbPath + ext;
			if (fs.existsSync(walPath)) {
				fs.unlinkSync(walPath);
				console.log(`🧹 Очищена ${ext} файл`);
			}
		}
		if (fs.existsSync(filesDir)) {
			fs.rmSync(filesDir, { recursive: true, force: true });
		}
	} catch {
		// Игнорируем ошибки если файлы не найдены
	}

	// Буфер для хранения вывода сервера (чтобы извлечь IP)
	let serverOutput = '';

	// Запускаем Rust сервер
	console.log(`🚀 Запуск Rust сервера на порту ${SERVER_PORT}...`);

	// Предварительная компиляция (ускорение запуска)
	console.log('🔨 Компиляция сервера...');
	const buildResult = await new Promise<number>((resolve) => {
		const build = spawn('cargo', ['build', '--manifest-path', path.join(SERVER_DIR, 'Cargo.toml')], {
			cwd: SERVER_DIR,
			stdio: 'inherit',
		});
		build.on('close', (code) => resolve(code ?? 1));
	});
	if (buildResult !== 0) {
		throw new Error('Не удалось скомпилировать сервер');
	}

	context.serverProcess = spawn(
		'cargo',
		['run', '--manifest-path', path.join(SERVER_DIR, 'Cargo.toml'), '--quiet'],
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
