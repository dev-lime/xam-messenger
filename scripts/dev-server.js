#!/usr/bin/env node

/**
 * Простой HTTP сервер для разработки
 * Запускается автоматически при cargo tauri dev
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 1420;
const SRC_DIR = path.join(__dirname, '..', 'src');

const mimeTypes = {
	'.html': 'text/html',
	'.js': 'text/javascript',
	'.css': 'text/css',
	'.json': 'application/json',
	'.png': 'image/png',
	'.jpg': 'image/jpg',
	'.gif': 'image/gif',
	'.svg': 'image/svg+xml',
	'.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
	console.log(`HTTP ${req.method} ${req.url}`);

	// Убираем query параметры
	let urlPath = req.url.split('?')[0];

	// Корень -> index.html
	if (urlPath === '/') {
		urlPath = '/index.html';
	}

	const filePath = path.join(SRC_DIR, urlPath);
	const ext = path.extname(filePath);
	const contentType = mimeTypes[ext] || 'application/octet-stream';

	fs.readFile(filePath, (err, content) => {
		if (err) {
			if (err.code === 'ENOENT') {
				console.log(`  ↳ 404 - Файл не найден: ${filePath}`);
				res.writeHead(404, { 'Content-Type': 'text/plain' });
				res.end('404 - File Not Found');
			} else {
				console.log(`  ↳ 500 - Ошибка: ${err.code}`);
				res.writeHead(500);
				res.end(`Server Error: ${err.code}`);
			}
		} else {
			console.log(`  ↳ 200 - ${contentType}`);
			res.writeHead(200, { 'Content-Type': contentType });
			res.end(content);
		}
	});
});

server.listen(PORT, 'localhost', () => {
	console.log(`\n🚀 Dev server запущен на http://localhost:${PORT}`);
	console.log(`📁 Раздаёт файлы из: ${SRC_DIR}\n`);
});
