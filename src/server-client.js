/**
 * @file Модуль для работы с сервером (WebSocket + HTTP)
 * @module ServerClient
 */

// ============================================================================
// Константы
// ============================================================================

const WS_CONFIG = {
	RECONNECT_DELAY: 2000,
	MAX_RECONNECT_ATTEMPTS: 10,
	CONNECTION_TIMEOUT: 3000,
	MDNS_TIMEOUT: 3000,
	SCAN_TIMEOUT: 2000,
};

const SERVER_CANDIDATES = [
	'ws://localhost:8080/ws',
	'ws://127.0.0.1:8080/ws',
];

// Расширенный список подсетей для сканирования
const SUBNETS = [
	'192.168.1.',
	'192.168.0.',
	'192.168.88.',
	'192.168.2.',
	'192.168.10.',
	'10.0.0.',
	'10.0.1.',
	'10.0.2.',
	'172.16.0.',
	'172.16.1.',
];

const MESSAGE_TYPES = {
	REGISTER: 'register',
	REGISTERED: 'registered',
	MESSAGE: 'message',
	ACK: 'ack',
	MESSAGES: 'messages',
	USER_ONLINE: 'user_online',
	USER_UPDATED: 'user_updated',
	GET_MESSAGES: 'get_messages',
	UPDATE_PROFILE: 'update_profile',
};

const CACHE_CONFIG = {
	KEY: 'xam_server_cache',
	TTL: 24 * 60 * 60 * 1000, // 24 часа в миллисекундах
};

// ============================================================================
// Вспомогательные функции
// ============================================================================

/**
 * Вызов Tauri команды (совместимость с v1 и v2)
 * @param {string} cmd - Имя команды
 * @param {Object} [args] - Аргументы
 * @returns {Promise<any>}
 */
async function invokeTauri(cmd, args = {}) {
	if (window.__TAURI__?.core?.invoke) {
		// Tauri v2
		return window.__TAURI__.core.invoke(cmd, args);
	} else if (window.__TAURI__?.invoke) {
		// Tauri v1
		return window.__TAURI__.invoke(cmd, args);
	}
	throw new Error('Tauri API недоступен');
}

// Делаем функцию доступной глобально для app.js
window.invokeTauri = invokeTauri;

/**
 * Генерирует список серверов для сканирования локальной сети
 * @returns {string[]} Список WebSocket URL
 */
function generateLocalNetworkServers() {
	const servers = [];
	SUBNETS.forEach((subnet) => {
		for (let i = 1; i <= 10; i++) {
			servers.push(`ws://${subnet}${i}:8080/ws`);
		}
		for (let i = 100; i <= 110; i++) {
			servers.push(`ws://${subnet}${i}:8080/ws`);
		}
	});
	return servers;
}

/**
 * Преобразует WebSocket URL в HTTP API URL
 * @param {string} wsUrl - WebSocket URL
 * @returns {string} HTTP API URL
 */
function wsToHttpUrl(wsUrl) {
	return wsUrl.replace('ws://', 'http://').replace('/ws', '/api/v1');
}

/**
 * Извлекает IP из WebSocket URL
 * @param {string} wsUrl - WebSocket URL
 * @returns {string} IP адрес
 */
function extractIpFromWsUrl(wsUrl) {
	const match = wsUrl.match(/ws:\/\/([^:]+):(\d+)/);
	return match ? match[1] : '';
}

/**
 * Сохраняет сервер в кэш localStorage
 * @param {string} ip - IP адрес
 * @param {number} port - Порт
 * @param {string} source - Источник (mdns, scan, manual)
 */
function cacheServer(ip, port, source) {
	try {
		const cache = JSON.parse(localStorage.getItem(CACHE_CONFIG.KEY) || '[]');
		const timestamp = Date.now();

		// Удаляем старую запись для этого IP
		const filtered = cache.filter(s => s.ip !== ip);

		// Добавляем новую
		filtered.push({ ip, port, lastSeen: timestamp, source });

		localStorage.setItem(CACHE_CONFIG.KEY, JSON.stringify(filtered));

		// Если в Tauri, вызываем нативную команду для кэширования
		const isTauri = !!(window.__TAURI__?.core?.invoke || window.__TAURI__?.invoke);
		if (isTauri) {
			invokeTauri('cache_server', { ip, port, source }).catch(console.warn);
		}
	} catch (e) {
		console.warn('⚠️ Не удалось сохранить сервер в кэш:', e);
	}
}

/**
 * Получает кэшированные серверы из localStorage
 * @returns {Array<{ip: string, port: number, lastSeen: number, source: string}>}
 */
function getCachedServers() {
	try {
		const cache = JSON.parse(localStorage.getItem(CACHE_CONFIG.KEY) || '[]');
		const now = Date.now();
		
		// Фильтруем по TTL
		return cache.filter(server => (now - server.lastSeen) < CACHE_CONFIG.TTL);
	} catch (e) {
		console.warn('⚠️ Не удалось прочитать кэш серверов:', e);
		return [];
	}
}

/**
 * Проверяет доступность сервера через HTTP ping
 * @param {string} httpUrl - HTTP API URL
 * @param {number} timeout - Таймаут в мс
 * @returns {Promise<boolean>}
 */
async function pingServer(httpUrl, timeout = 3000) {
	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeout);
		
		const response = await fetch(`${httpUrl}/users`, {
			method: 'GET',
			signal: controller.signal,
		});
		
		clearTimeout(timer);
		return response.ok;
	} catch (e) {
		return false;
	}
}

// ============================================================================
// Класс ServerClient
// ============================================================================

/**
 * Клиент для взаимодействия с сервером мессенджера
 * @class
 */
class ServerClient {
	constructor() {
		/** @type {WebSocket|null} */
		this.ws = null;

		/** @type {Object|null} */
		this.user = null;

		/** @type {Array<{event: string, handler: Function}>} */
		this.messageHandlers = [];

		/** @type {number} */
		this.reconnectAttempts = 0;

		/** @type {string|null} */
		this.serverUrl = null;

		/** @type {string|null} */
		this.httpUrl = null;

		/** @type {Array<{ip: string, port: number, wsUrl: string, httpUrl: string, source: string, hostname?: string}>} */
		this.discoveredServers = [];

		/** @type {boolean} */
		this.isTauri = !!(window.__TAURI__?.core?.invoke || window.__TAURI__?.invoke);
		
		// Отладка
		console.log('🔧 ServerClient init:', {
			isTauri: this.isTauri,
			hasTauri: !!window.__TAURI__,
			hasCoreInvoke: !!window.__TAURI__?.core?.invoke,
			hasDirectInvoke: !!window.__TAURI__?.invoke,
			tauriKeys: window.__TAURI__ ? Object.keys(window.__TAURI__) : []
		});
	}

	// ========================================================================
	// Обнаружение серверов
	// ========================================================================

	/**
	 * Поиск серверов через mDNS (только Tauri)
	 * @returns {Promise<Array<{ip: string, port: number, wsUrl: string, httpUrl: string, source: string, hostname?: string}>}
	 */
	async discoverViaMdns() {
		if (!this.isTauri) {
			console.log('ℹ️ mDNS недоступен в веб-версии');
			return [];
		}

		try {
			console.log('🔍 Поиск серверов через mDNS...');
			const servers = await invokeTauri('search_mdns_servers');

			console.log(`✅ Найдено ${servers.length} серверов через mDNS:`, servers);

			// Кэшируем найденные серверы и преобразуем поля из snake_case в camelCase
			const normalizedServers = servers.map(s => ({
				ip: s.ip,
				port: s.port,
				hostname: s.hostname,
				wsUrl: s.ws_url,
				httpUrl: s.http_url,
				source: s.source,
				txtRecords: s.txt_records,
			}));

			normalizedServers.forEach(s => cacheServer(s.ip, s.port, 'mdns'));

			return normalizedServers;
		} catch (e) {
			console.warn('⚠️ Ошибка mDNS поиска:', e);
			return [];
		}
	}

	/**
	 * Поиск серверов в кэше
	 * @returns {Array<{ip: string, port: number, wsUrl: string, httpUrl: string, source: string}>}
	 */
	discoverViaCache() {
		const cached = getCachedServers();
		const servers = cached.map(s => ({
			ip: s.ip,
			port: s.port,
			wsUrl: `ws://${s.ip}:${s.port}/ws`,
			httpUrl: `http://${s.ip}:${s.port}/api`,
			source: s.source,
		}));
		
		console.log(`📦 Найдено ${servers.length} серверов в кэше`);
		return servers;
	}

	/**
	 * Поиск серверов через сканирование подсетей
	 * @returns {Promise<Array<{ip: string, port: number, wsUrl: string, httpUrl: string, source: string}>>}
	 */
	async discoverViaScan() {
		console.log('🔍 Сканирование локальной сети...');
		const candidates = generateLocalNetworkServers();
		const found = [];
		
		// Оптимизация: параллельное сканирование с ограничением concurrent запросов
		const CONCURRENCY = 20;  // Максимум 20 одновременных запросов
		const SCAN_TIMEOUT = 500;  // Уменьшенный таймаут (500ms вместо 2000ms)
		
		console.log(`📡 Сканирование ${candidates.length} адресов (параллельно по ${CONCURRENCY})...`);
		
		// Функция для пинга с ограничением по времени
		const pingWithTimeout = async (url) => {
			const httpUrl = wsToHttpUrl(url);
			const isAlive = await pingServer(httpUrl, SCAN_TIMEOUT);
			return { url, httpUrl, isAlive };
		};
		
		// Сканируем пачками по CONCURRENCY адресов
		for (let i = 0; i < candidates.length; i += CONCURRENCY) {
			const batch = candidates.slice(i, i + CONCURRENCY);
			
			// Параллельный пинг всех адресов в пачке
			const results = await Promise.allSettled(
				batch.map(url => pingWithTimeout(url))
			);
			
			// Обрабатываем результаты
			for (const result of results) {
				if (result.status === 'fulfilled' && result.value.isAlive) {
					const { url, httpUrl } = result.value;
					const ip = extractIpFromWsUrl(url);
					found.push({
						ip,
						port: 8080,
						wsUrl: url,
						httpUrl,
						source: 'scan',
					});
					console.log('✅ Найден сервер:', url);
				}
			}
			
			// Небольшая задержка между пачками для избежания перегрузки сети
			if (i + CONCURRENCY < candidates.length) {
				await new Promise(resolve => setTimeout(resolve, 50));
			}
		}

		console.log(`✅ Сканирование завершено, найдено ${found.length} серверов`);
		return found;
	}

	/**
	 * Полное обнаружение серверов (mDNS → кэш → сканирование)
	 * @returns {Promise<Array<{ip: string, port: number, wsUrl: string, httpUrl: string, source: string, hostname?: string}>}
	 */
	async discoverAllServers() {
		console.log('🔍 Запуск обнаружения серверов...');
		this.discoveredServers = [];

		// 1. mDNS (приоритет)
		const mdnsServers = await this.discoverViaMdns();
		this.discoveredServers.push(...mdnsServers);

		// 2. Кэш (если mDNS ничего не нашёл)
		if (mdnsServers.length === 0) {
			const cachedServers = this.discoverViaCache();
			this.discoveredServers.push(...cachedServers);
		}

		// 3. Сканирование (если ничего не найдено)
		if (this.discoveredServers.length === 0) {
			const scannedServers = await this.discoverViaScan();
			this.discoveredServers.push(...scannedServers);
		}

		// Сортировка: mDNS > кэш > сканирование
		const priority = { mdns: 0, cache: 1, scan: 2, manual: 3 };
		this.discoveredServers.sort((a, b) => priority[a.source] - priority[b.source]);

		console.log(`📊 Всего найдено серверов: ${this.discoveredServers.length}`);
		return this.discoveredServers;
	}

	/**
	 * Получение списка всех найденных серверов
	 * @returns {Array<{ip: string, port: number, wsUrl: string, httpUrl: string, source: string, hostname?: string}>}
	 */
	getAllDiscoveredServers() {
		return this.discoveredServers;
	}

	// ========================================================================
	// Подключение к серверу
	// ========================================================================

	/**
	 * Автоматическое обнаружение и подключение к серверу
	 * @returns {Promise<string>} URL найденного сервера
	 * @throws {Error} Если сервер не найден
	 */
	async discoverServer() {
		const servers = await this.discoverAllServers();

		if (servers.length === 0) {
			throw new Error('Сервер не найден. Убедитесь, что сервер запущен.');
		}

		// В Tauri пропускаем HTTP ping — WebSocket работает напрямую
		if (this.isTauri) {
			console.log('✅ Tauri: подключаемся напрямую к', servers[0].wsUrl);
			return servers[0].wsUrl;
		}

		// Если нет интернета, пробуем подключиться напрямую без HTTP ping
		if (!navigator.onLine) {
			console.log('⚠️ Нет интернета, пробуем подключиться напрямую...');
			console.log('✅ Сервер найден:', servers[0].wsUrl);
			return servers[0].wsUrl;
		}

		// Проверяем доступность первого сервера (приоритетного)
		for (const server of servers) {
			const isAlive = await pingServer(server.httpUrl, WS_CONFIG.CONNECTION_TIMEOUT);
			if (isAlive) {
				console.log('✅ Сервер найден:', server.wsUrl);
				return server.wsUrl;
			}
		}

		throw new Error('Найденные серверы недоступны');
	}

	/**
	 * Попытка подключения к конкретному серверу
	 * @param {string} url - WebSocket URL
	 * @param {number} timeout - Таймаут в мс
	 * @returns {Promise<boolean>} true если сервер доступен
	 */
	async tryConnect(url, timeout = WS_CONFIG.CONNECTION_TIMEOUT) {
		return new Promise((resolve) => {
			const ws = new WebSocket(url);
			const timer = setTimeout(() => {
				ws.close();
				resolve(false);
			}, timeout);

			ws.onopen = () => {
				clearTimeout(timer);
				ws.close();
				resolve(true);
			};

			ws.onerror = () => {
				clearTimeout(timer);
				resolve(false);
			};
		});
	}

	/**
	 * Подключение к серверу
	 * @param {string|null} serverUrl - URL сервера (опционально)
	 * @returns {Promise<void>}
	 */
	async connect(serverUrl = null) {
		const url = serverUrl || (await this.discoverServer());

		this.serverUrl = url;
		this.httpUrl = wsToHttpUrl(url);

		console.log('🔧 connect():', {
			serverUrl,
			url,
			httpUrl: this.httpUrl,
			serverUrlSet: !!this.serverUrl
		});

		// Кэшируем подключенный сервер
		const ip = extractIpFromWsUrl(url);
		if (ip) {
			const isTauri = !!(window.__TAURI__?.core?.invoke || window.__TAURI__?.invoke);
			cacheServer(ip, 8080, isTauri ? 'mdns' : 'manual');
		}

		console.log('🔌 Подключение к', url);

		return new Promise((resolve, reject) => {
			try {
				this.ws = new WebSocket(url);

				this.ws.onopen = () => {
					console.log('✅ Подключено к серверу');
					this.reconnectAttempts = 0;
					resolve();
				};

				this.ws.onclose = (event) => {
					console.log('🔌 Отключено от сервера:', event.code, event.reason);
					this.attemptReconnect();
				};

				this.ws.onerror = (error) => {
					console.error('❌ Ошибка WebSocket:', error);
					reject(error);
				};

				this.ws.onmessage = (event) => {
					try {
						const data = JSON.parse(event.data);
						this.handleMessage(data);
					} catch (e) {
						console.error('❌ Ошибка парсинга WebSocket сообщения:', e);
					}
				};
			} catch (error) {
				reject(error);
			}
		});
	}

	/**
	 * Подключение к конкретному серверу из списка
	 * @param {string} wsUrl - WebSocket URL
	 * @returns {Promise<void>}
	 */
	async connectToServer(wsUrl) {
		// Отключаемся от текущего
		this.disconnect();

		// Сбрасываем счётчик попыток
		this.reconnectAttempts = 0;

		// Устанавливаем URL напрямую, без discoverServer()
		this.serverUrl = wsUrl;
		this.httpUrl = wsToHttpUrl(wsUrl);

		console.log('🔧 connectToServer():', {
			wsUrl,
			httpUrl: this.httpUrl
		});

		// Кэшируем подключенный сервер
		const ip = extractIpFromWsUrl(wsUrl);
		if (ip) {
			const isTauri = !!(window.__TAURI__?.core?.invoke || window.__TAURI__?.invoke);
			cacheServer(ip, 8080, isTauri ? 'mdns' : 'manual');
		}

		// Подключаемся
		return this._connectWebSocket(wsUrl);
	}

	/**
	 * Подключение к WebSocket (внутренняя функция)
	 * @private
	 * @param {string} url - WebSocket URL
	 * @returns {Promise<void>}
	 */
	_connectWebSocket(url) {
		console.log('🔌 Подключение к', url);

		return new Promise((resolve, reject) => {
			try {
				this.ws = new WebSocket(url);

				// Увеличенный таймаут для локальной сети (10 секунд)
				const connectionTimeout = setTimeout(() => {
					console.error('❌ Таймаут подключения к WebSocket');
					this.ws.close();
					reject(new Error('Таймаут подключения'));
				}, 10000);

				this.ws.onopen = () => {
					clearTimeout(connectionTimeout);
					console.log('✅ Подключено к серверу');
					this.reconnectAttempts = 0;
					resolve();
				};

				this.ws.onclose = (event) => {
					clearTimeout(connectionTimeout);
					console.log('🔌 Отключено от сервера:', event.code, event.reason);
					this.attemptReconnect();
				};

				this.ws.onerror = (error) => {
					clearTimeout(connectionTimeout);
					console.error('❌ Ошибка WebSocket:', error);
					reject(error);
				};

				this.ws.onmessage = (event) => {
					try {
						const data = JSON.parse(event.data);
						this.handleMessage(data);
					} catch (e) {
						console.error('❌ Ошибка парсинга WebSocket сообщения:', e);
					}
				};
			} catch (error) {
				reject(error);
			}
		});
	}

	/**
	 * Попытка переподключения при разрыве соединения
	 * @private
	 */
	attemptReconnect() {
		if (this.reconnectAttempts < WS_CONFIG.MAX_RECONNECT_ATTEMPTS) {
			this.reconnectAttempts++;
			console.log(
				`🔄 Попытка переподключения ${this.reconnectAttempts}/${WS_CONFIG.MAX_RECONNECT_ATTEMPTS}...`
			);
			
			// В Tauri не проверяем интернет — WebSocket работает напрямую
			if (!this.isTauri && !navigator.onLine) {
				console.warn('⚠️ Нет подключения к интернету. Переподключение приостановлено.');
				setTimeout(() => this.attemptReconnect(), 5000);
				return;
			}
			
			setTimeout(() => {
				this.connect().catch(e => {
					console.error('❌ Ошибка переподключения:', e);
				});
			}, WS_CONFIG.RECONNECT_DELAY);
		} else {
			console.error('❌ Превышено количество попыток переподключения');
		}
	}

	// ========================================================================
	// Обработка сообщений
	// ========================================================================

	/**
	 * Обработка входящих сообщений от сервера
	 * @private
	 * @param {Object} data - Данные сообщения
	 */
	handleMessage(data) {
		const { type } = data;

		switch (type) {
			case MESSAGE_TYPES.REGISTERED:
				this.user = data.user;
				break;

			case MESSAGE_TYPES.MESSAGE:
				console.log('📨 Message:', {
					id: data.message?.id,
					text: data.message?.text,
					files: data.message?.files,
					filesCount: data.message?.files?.length,
				});
				this.notifyHandlers(MESSAGE_TYPES.MESSAGE, data.message);
				break;

			case MESSAGE_TYPES.ACK:
				console.log('📨 ACK received:', data);
				this.notifyHandlers(MESSAGE_TYPES.ACK, data);
				break;

			case MESSAGE_TYPES.MESSAGES:
				this.notifyHandlers(MESSAGE_TYPES.MESSAGES, data);
				break;

			case MESSAGE_TYPES.USER_ONLINE:
				this.notifyHandlers(MESSAGE_TYPES.USER_ONLINE, data);
				break;

			default:
				console.warn('⚠️ Неизвестный тип сообщения:', type);
		}
	}

	/**
	 * Подписка на события сервера
	 * @param {string} event - Тип события
	 * @param {Function} handler - Обработчик события
	 */
	on(event, handler) {
		this.messageHandlers.push({ event, handler });
	}

	/**
	 * Уведомление подписчиков о событии
	 * @private
	 * @param {string} event - Тип события
	 * @param {Object} data - Данные события
	 */
	notifyHandlers(event, data) {
		this.messageHandlers.filter((h) => h.event === event).forEach((h) => h.handler(data));
	}

	// ========================================================================
	// HTTP API методы
	// ========================================================================

	/**
	 * Регистрация пользователя
	 * @param {string} name - Имя пользователя
	 * @param {string} [avatar='👤'] - Аватар (эмодзи)
	 * @returns {Promise<Object>} Данные пользователя
	 * @throws {Error} При ошибке регистрации
	 */
	async register(name, avatar = '👤') {
		const response = await fetch(`${this.httpUrl}/register`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name, avatar }),
		});

		const result = await response.json();

		if (result.success) {
			this.user = result.data;
			this.send({ type: MESSAGE_TYPES.REGISTER, name, avatar });
			return result.data;
		} else {
			throw new Error(result.error || 'Registration failed');
		}
	}

	/**
	 * Получение списка пользователей
	 * @returns {Promise<Object[]>} Список пользователей
	 */
	async getUsers() {
		const response = await fetch(`${this.httpUrl}/users`);
		const result = await response.json();
		return result.data || [];
	}

	/**
	 * Загрузка файла на сервер
	 * @param {File} file - Файл для загрузки
	 * @returns {Promise<Object>} Информация о загруженном файле
	 * @throws {Error} При ошибке загрузки
	 */
	async uploadFile(file) {
		const formData = new FormData();
		formData.append('file', file);

		const response = await fetch(`${this.httpUrl}/files`, {
			method: 'POST',
			body: formData,
		});

		const result = await response.json();

		if (result.success) {
			return {
				name: file.name,
				size: file.size,
				path: result.data.path,
			};
		} else {
			throw new Error(result.error || 'Failed to upload file');
		}
	}

	// ========================================================================
	// WebSocket методы
	// ========================================================================

	/**
	 * Отправка сообщения через WebSocket
	 * @private
	 * @param {Object} message - Сообщение для отправки
	 */
	send(message) {
		if (this.ws?.readyState === WebSocket.OPEN) {
			this.ws.send(JSON.stringify(message));
		} else {
			console.error('❌ Нет подключения к серверу');
		}
	}

	/**
	 * Отправка текстового сообщения
	 * @param {string} text - Текст сообщения
	 * @param {string|null} recipientId - ID получателя (опционально)
	 */
	sendMessage(text, recipientId = null) {
		this.send({
			type: MESSAGE_TYPES.MESSAGE,
			text,
			files: [],
			recipient_id: recipientId,
		});
	}

	/**
	 * Отправка сообщения с файлами
	 * @param {string} text - Текст сообщения
	 * @param {Object[]} files - Массив файлов
	 * @param {string|null} recipientId - ID получателя (опционально)
	 */
	sendMessageWithFiles(text, files, recipientId = null) {
		const message = {
			type: MESSAGE_TYPES.MESSAGE,
			text,
			files,
			recipient_id: recipientId,
		};

		if (this.ws?.readyState === WebSocket.OPEN) {
			try {
				this.ws.send(JSON.stringify(message));
				console.log('✅ Файлы отправлены в WebSocket');
			} catch (error) {
				console.error('❌ Ошибка отправки в WebSocket:', error);
			}
		} else {
			console.error('❌ WebSocket не готов! readyState=', this.ws?.readyState);
		}
	}

	/**
	 * Отправка подтверждения прочтения (ACK)
	 * @param {string} messageId - ID сообщения
	 * @param {'read'|'delivered'} status - Статус прочтения
	 */
	sendAck(messageId, status = 'read') {
		this.send({
			type: MESSAGE_TYPES.ACK,
			message_id: messageId,
			status,
		});
	}

	/**
	 * Запрос истории сообщений с пагинацией
	 * @param {number} limit - Количество сообщений (макс. 200)
	 * @param {string|null} beforeId - ID сообщения для пагинации
	 * @param {string|null} chatPeerId - ID пользователя для фильтрации по чату
	 */
	getMessages(limit = 50, beforeId = null, chatPeerId = null) {
		this.send({
			type: MESSAGE_TYPES.GET_MESSAGES,
			limit: Math.max(1, Math.min(200, limit)),
			before_id: beforeId,
			chat_peer_id: chatPeerId,
		});
	}

	/**
	 * Обновление профиля пользователя
	 * @param {string} avatar - Новый аватар (эмодзи)
	 */
	updateProfile(avatar) {
		this.send({
			type: MESSAGE_TYPES.UPDATE_PROFILE,
			text: avatar,
		});
	}

	// ========================================================================
	// Управление подключением
	// ========================================================================

	/**
	 * Отключение от сервера
	 */
	disconnect() {
		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}
	}

	/**
	 * Проверка состояния подключения
	 * @returns {boolean} true если подключено
	 */
	isConnected() {
		return this.ws?.readyState === WebSocket.OPEN;
	}

	/**
	 * Проверка доступности сервера
	 * @param {string} httpUrl - HTTP API URL
	 * @returns {Promise<boolean>}
	 */
	async checkServerAvailability(httpUrl) {
		return await pingServer(httpUrl, 3000);
	}
}

// Экспортируем класс для ES modules
export { ServerClient };

// Экспортируем глобально для обратной совместимости
if (typeof window !== 'undefined') {
	window.ServerClient = ServerClient;
}
