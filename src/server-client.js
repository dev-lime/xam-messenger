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
	CONNECTION_TIMEOUT: 1000,
};

const SERVER_CANDIDATES = [
	'ws://localhost:8080/ws',
	'ws://127.0.0.1:8080/ws',
];

const SUBNETS = ['192.168.1.', '192.168.0.', '192.168.88.', '10.0.0.', '10.0.1.'];

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

const DELIVERY_STATUS = {
	SENDING: 0,
	SENT: 1,
	READ: 2,
};

// ============================================================================
// Вспомогательные функции
// ============================================================================

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
	return wsUrl.replace('ws://', 'http://').replace('/ws', '/api');
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

		/** @type {string[]} */
		this.serverCandidates = [...SERVER_CANDIDATES, ...generateLocalNetworkServers()];
	}

	// ========================================================================
	// Подключение к серверу
	// ========================================================================

	/**
	 * Автоматическое обнаружение сервера в локальной сети
	 * @returns {Promise<string>} URL найденного сервера
	 * @throws {Error} Если сервер не найден
	 */
	async discoverServer() {
		console.log('🔍 Поиск сервера...');

		for (const url of this.serverCandidates) {
			const found = await this.tryConnect(url, WS_CONFIG.CONNECTION_TIMEOUT);
			if (found) {
				console.log('✅ Сервер найден:', url);
				return url;
			}
		}

		throw new Error('Сервер не найден. Убедитесь, что сервер запущен.');
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
	 * Попытка переподключения при разрыве соединения
	 * @private
	 */
	attemptReconnect() {
		if (this.reconnectAttempts < WS_CONFIG.MAX_RECONNECT_ATTEMPTS) {
			this.reconnectAttempts++;
			console.log(
				`🔄 Попытка переподключения ${this.reconnectAttempts}/${WS_CONFIG.MAX_RECONNECT_ATTEMPTS}...`
			);
			setTimeout(() => this.connect(), WS_CONFIG.RECONNECT_DELAY);
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
	 */
	getMessages(limit = 50, beforeId = null) {
		this.send({
			type: MESSAGE_TYPES.GET_MESSAGES,
			limit: Math.max(1, Math.min(200, limit)),
			before_id: beforeId,
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
}

// Экспортируем глобально для использования в app.js
window.ServerClient = ServerClient;
