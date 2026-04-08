/**
 * Global teardown для E2E тестов
 * Останавливает Rust сервер и фронтенд сервер.
 */
import { ChildProcess } from 'child_process';

interface ServerContext {
	serverProcess: ChildProcess | null;
	frontendProcess: ChildProcess | null;
}

async function killProcess(proc: ChildProcess | null, name: string): Promise<void> {
	if (!proc) return;

	console.log(`🛑 Остановка ${name}...`);
	proc.kill('SIGTERM');

	await new Promise<void>((resolve) => {
		proc!.on('exit', () => {
			console.log(`✅ ${name} остановлен`);
			resolve();
		});
		// Таймаут 5 секунд, затем SIGKILL
		setTimeout(() => {
			if (!proc.killed) {
				console.warn(`⚠️ ${name} не остановился, отправляем SIGKILL`);
				proc.kill('SIGKILL');
			}
			resolve();
		}, 5000);
	});
}

export default async function globalTeardown(context: ServerContext): Promise<void> {
	// Останавливаем в обратном порядке запуска
	await killProcess(context.frontendProcess, 'фронтенд-сервер');
	await killProcess(context.serverProcess, 'Rust сервер');
}
