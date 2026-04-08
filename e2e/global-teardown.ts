/**
 * Global teardown для E2E тестов
 */
import { ChildProcess } from 'child_process';

interface ServerContext {
	frontendProcess: ChildProcess | null;
}

export default async function globalTeardown(context: ServerContext): Promise<void> {
	console.log('🛑 Остановка фронтенд-сервера...');

	if (context.frontendProcess) {
		context.frontendProcess.kill('SIGTERM');
		await new Promise<void>((resolve) => {
			context.frontendProcess!.on('exit', () => resolve());
			setTimeout(resolve, 3000);
		});
		console.log('✅ Фронтенд остановлен');
	}
}
