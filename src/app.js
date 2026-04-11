/**
 * @file XAM Messenger - Клиентское приложение
 * @module App
 */

'use strict';

import {
	escapeHtml,
	escapeJsString,
	formatFileSize,
	getFileIcon,
	CONFIG,
	DELIVERY_STATUS,
	STATUS_ICONS,
} from './utils/helpers.js';

// Импортируем ServerClient для инициализации
import './server-client.js';

// ============================================================================
// DOM элементы
// ============================================================================

const elements = {
	status: document.getElementById('status'),
	statusIndicator: document.getElementById('statusIndicator'),
	statusText: document.getElementById('statusText'),
	connectionStatus: document.getElementById('connectionStatus'),
	statusLatency: document.getElementById('statusLatency'),
	userName: document.getElementById('userName'),
	userAddress: document.getElementById('userAddress'),
	userAvatar: document.getElementById('userAvatar'),
	profileMenuContainer: document.getElementById('profileMenuContainer'),
	profileAvatarBtn: document.getElementById('profileAvatarBtn'),
	profileContextMenu: document.getElementById('profileContextMenu'),
	profileMenuAvatar: document.getElementById('profileMenuAvatar'),
	profileMenuName: document.getElementById('profileMenuName'),
	menuProfile: document.getElementById('menuProfile'),
	menuSettings: document.getElementById('menuSettings'),
	menuLogout: document.getElementById('menuLogout'),
	menuChangeServer: document.getElementById('menuChangeServer'),
	appSettingsDialog: document.getElementById('appSettingsDialog'),
	closeAppSettings: document.getElementById('closeAppSettings'),
	saveAppSettings: document.getElementById('saveAppSettings'),
	resetAppSettings: document.getElementById('resetAppSettings'),
	clearCacheBtn: document.getElementById('clearCacheBtn'),
	exportDataBtn: document.getElementById('exportDataBtn'),
	settingFontSize: document.getElementById('settingFontSize'),
	fontSizeValue: document.getElementById('fontSizeValue'),
	settingTheme: document.getElementById('settingTheme'),
	userProfileHeader: document.getElementById('userProfileHeader'),
	chatTitle: document.getElementById('chatTitle'),
	chatTitleText: document.getElementById('chatTitleText'),
	sendBtn: document.getElementById('sendBtn'),
	attachBtn: document.getElementById('attachBtn'),
	fileInput: document.getElementById('fileInput'),
	attachedFiles: document.getElementById('attachedFiles'),
	messageInput: document.getElementById('messageInput'),
	inputArea: document.getElementById('inputArea'),
	messages: document.getElementById('messages'),
	messagesContainer: document.getElementById('messagesContainer'),
	chatScrollContainer: document.getElementById('chatScrollContainer'),
	peersList: document.getElementById('peersList'),
	connectDialog: document.getElementById('connectDialog'),
	settingsDialog: document.getElementById('settingsDialog'),
	userNameInput: document.getElementById('userNameInput'),
	serverStatus: document.getElementById('serverStatus'),
	confirmConnect: document.getElementById('confirmConnect'),
	cancelSettings: document.getElementById('cancelSettings'),
	saveSettings: document.getElementById('saveSettings'),
	settingsNameInput: document.getElementById('settingsNameInput'),
	settingsAvatarInput: document.getElementById('settingsAvatarInput'),
	loadMoreBtn: document.getElementById('loadMoreBtn'),
	loadMoreContainer: document.getElementById('loadMoreContainer'),
	serverSelectorDialog: document.getElementById('serverSelectorDialog'),
	serverList: document.getElementById('serverList'),
	manualServerInput: document.getElementById('manualServerInput'),
	confirmManualServer: document.getElementById('confirmManualServer'),
	cancelServerSelector: document.getElementById('cancelServerSelector'),
	refreshServersBtn: document.getElementById('refreshServersBtn'),
	changeServerBtn: document.getElementById('changeServerBtn'),
	selectedServerInfo: document.getElementById('selectedServerInfo'),
};

// ============================================================================
// Состояние приложения
// ============================================================================

const state = {
	connected: false,
	serverUrl: null,
	selectedServer: null, // Выбранный сервер (объект с wsUrl, httpUrl, ip, port)
	user: null,
	messages: [],
	peers: [],
	currentPeer: null,
	filteredMessages: [],
	onlineUsers: new Set(),
	lastMessageId: null,
	hasMoreMessages: true,
	isLoadingMessages: false,
	lastRequestedBeforeId: null, // Для защиты от бесконечного цикла
	currentPeerBeforeId: null, // ID для пагинации текущего чата
	discoveredServers: [], // Найденные серверы
	isDiscovering: false, // Процесс обнаружения
};

let attachedFiles = [];
let serverClient = null;
let userSettings = { name: '', avatar: CONFIG.AVATAR_DEFAULT };

// Debounce таймер для loadPeers (защита от лавины запросов при user_online событиях)
let loadPeersTimer = null;

// ============================================================================
// Анимации
// ============================================================================

/**
 * Создание ripple-эффекта на кнопке
 */
function createRipple(event, element) {
	// Удаляем предыдущий ripple
	const existing = element.querySelector('.ripple-effect');
	if (existing) existing.remove();

	const circle = document.createElement('span');
	circle.classList.add('ripple-effect');

	const rect = element.getBoundingClientRect();
	const diameter = Math.max(rect.width, rect.height);
	const radius = diameter / 2;

	circle.style.width = circle.style.height = `${diameter}px`;
	circle.style.left = `${event.clientX - rect.left - radius}px`;
	circle.style.top = `${event.clientY - rect.top - radius}px`;

	element.appendChild(circle);

	// Удаляем после анимации
	setTimeout(() => circle.remove(), 600);
}

// ============================================================================
// Утилиты
// ============================================================================

// Функции escapeHtml, formatFileSize, getFileIcon импортированы из utils/helpers.js

/**
 * Сохранение настроек пользователя
 */
function saveUserSettings() {
	localStorage.setItem(CONFIG.STORAGE_KEYS.USER_SETTINGS, JSON.stringify(userSettings));
}

/**
 * Загрузка настроек пользователя
 */
function loadUserSettings() {
	const saved = localStorage.getItem(CONFIG.STORAGE_KEYS.USER_SETTINGS);
	if (saved) {
		try {
			userSettings = JSON.parse(saved);
		} catch (e) {
			console.warn('Failed to load user settings');
		}
	}
}

/**
 * Сохранение состояния пагинации
 */
function savePaginationState() {
	localStorage.setItem(CONFIG.STORAGE_KEYS.HAS_MORE, state.hasMoreMessages.toString());
	if (state.currentPeerBeforeId) {
		localStorage.setItem(CONFIG.STORAGE_KEYS.LAST_MESSAGE_ID, state.currentPeerBeforeId);
	}
}

/**
 * Восстановление состояния пагинации
 */
function restorePaginationState() {
	const savedLastId = localStorage.getItem(CONFIG.STORAGE_KEYS.LAST_MESSAGE_ID);
	const savedHasMore = localStorage.getItem(CONFIG.STORAGE_KEYS.HAS_MORE);

	if (savedHasMore !== null && state.messages.length === 0) {
		state.hasMoreMessages = savedHasMore === 'true';
		// lastMessageId не восстанавливаем принудительно - он будет установлен из handleMessages
		// при первой загрузке сообщений
		console.log(`📚 Восстановлена пагинация: hasMore=${state.hasMoreMessages}`);
	}
}

/**
 * Очистка состояния пагинации
 */
function clearPaginationState() {
	// Сбрасываем hasMoreMessages для новой загрузки
	state.hasMoreMessages = true;
	state.currentPeerBeforeId = null;
	// localStorage не трогаем — он общий для всех чатов
}

// ============================================================================
// Инициализация
// ============================================================================

/**
 * Инициализация приложения
 */
async function init() {
	serverClient = new ServerClient();

	// Подписка на события сервера
	serverClient.on('message', handleNewMessage);
	serverClient.on('ack', handleAck);
	serverClient.on('messages', handleMessages);
	serverClient.on('user_online', handleUserOnline);
	serverClient.on('user_updated', handleUserUpdated);
	serverClient.on('connection_lost', handleConnectionLost);
	serverClient.on('chat_deleted', handleChatDeleted);

	loadUserSettings();
	setupEventListeners();
	
	// Инициализация аватарки
	if (elements.userAvatar) {
		elements.userAvatar.textContent = userSettings?.avatar || CONFIG.AVATAR_DEFAULT;
	}
	if (elements.profileMenuAvatar) {
		elements.profileMenuAvatar.textContent = userSettings?.avatar || CONFIG.AVATAR_DEFAULT;
	}

	// Проверяем сохранённую сессию для восстановления
	const savedUser = localStorage.getItem(CONFIG.STORAGE_KEYS.SESSION_USER);
	const savedServer = localStorage.getItem(CONFIG.STORAGE_KEYS.SESSION_SERVER);

	if (savedUser && savedServer) {
		try {
			const user = JSON.parse(savedUser);
			const server = JSON.parse(savedServer);

			// Восстанавливаем сессию — пропускаем диалоги, сразу подключаемся
			state.selectedServer = server;
			elements.userNameInput.value = user.name;

			// Показываем статус подключения
			if (elements.serverStatus) {
				elements.serverStatus.innerHTML =
					'<span style="color: var(--warning);">🔄 Восстановление сессии...</span>';
			}

			await connectToServer();
		} catch (e) {
			console.warn('⚠️ Не удалось восстановить сессию:', e);
			// Сессия битая — начинаем сначала
			setTimeout(() => {
				openServerSelector();
			}, 300);
		}
	} else {
		// Нет сохранённой сессии — начинаем с выбора сервера
		setTimeout(() => {
			openServerSelector();
		}, 300);
	}
}

// ============================================================================
// Обнаружение и выбор сервера
// ============================================================================

/**
 * Обнаружение серверов
 * @returns {Promise<boolean>} true если серверы найдены
 */
async function discoverServers() {
	if (state.isDiscovering) return false;

	state.isDiscovering = true;
	updateServerStatus('🔍 Поиск серверов...', 'warning');

	try {
		// Запускаем обнаружение
		const servers = await serverClient.discoverAllServers();
		state.discoveredServers = servers;

		if (servers.length === 0) {
			updateServerStatus('❌ Серверы не найдены', 'error');
			state.isDiscovering = false;
			return false;
		}

		// Показываем количество найденных серверов
		updateServerStatus(`✅ Найдено серверов: ${servers.length}`, 'success');

		state.isDiscovering = false;
		return true;

	} catch (error) {
		console.error('❌ Ошибка обнаружения серверов:', error);
		updateServerStatus('❌ Ошибка подключения', 'error');
		state.isDiscovering = false;
		return false;
	}
}

/**
 * Обновление статуса подключения к серверу
 */
function updateServerStatus(message, type = 'info') {
	if (!elements.serverStatus) return;

	const colors = {
		info: 'var(--text-secondary)',
		success: 'var(--success)',
		warning: 'var(--warning)',
		error: 'var(--error)',
	};

	elements.serverStatus.innerHTML = `<span id="selectedServerInfo" style="color: ${colors[type]};">${message}</span>`;
	// Обновляем ссылку на элемент
	elements.selectedServerInfo = document.getElementById('selectedServerInfo');
}

/**
 * Открытие диалога выбора сервера
 */
async function openServerSelector() {
	if (!elements.serverSelectorDialog) return;
	
	// Очищаем список
	if (elements.serverList) {
		elements.serverList.innerHTML = '<div style="padding: 20px; text-align: center;">🔍 Поиск серверов...</div>';
	}
	
	elements.serverSelectorDialog.showModal();
	
	// Запускаем обнаружение
	await refreshServerList();
}

/**
 * Обновление списка серверов в диалоге
 */
async function refreshServerList() {
	if (!elements.serverList) return;
	
	state.isDiscovering = true;
	renderServerList([]);
	
	try {
		const servers = await serverClient.discoverAllServers();
		state.discoveredServers = servers;
		
		if (servers.length === 0) {
			renderServerList([]);
			return;
		}
		
		// Проверяем доступность каждого сервера
		const serversWithStatus = await Promise.all(
			servers.map(async (s) => {
				const isOnline = await serverClient.checkServerAvailability(s.httpUrl);
				return { ...s, online: isOnline };
			})
		);
		
		renderServerList(serversWithStatus);
	} catch (error) {
		console.error('❌ Ошибка обновления списка серверов:', error);
		elements.serverList.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--error);">❌ Ошибка поиска серверов</div>';
	}
	
	state.isDiscovering = false;
}

/**
 * Рендеринг списка серверов
 */
function renderServerList(servers) {
	if (!elements.serverList) return;
	
	if (servers.length === 0) {
		elements.serverList.innerHTML = `
			<div style="padding: 20px; text-align: center; color: var(--text-tertiary);">
				<div style="font-size: 18px; margin-bottom: 10px;">📡</div>
				<div>Серверы не найдены</div>
				<div style="font-size: 12px; margin-top: 10px;">
					Убедитесь, что сервер запущен и доступен в локальной сети
				</div>
			</div>
		`;
		return;
	}
	
	const sourceIcons = {
		mdns: '📢',
		cache: '📦',
		scan: '🔍',
		manual: '✏️',
	};
	
	elements.serverList.innerHTML = servers.map((s) => {
		const statusClass = s.online ? 'online' : 'offline';
		const statusText = s.online ? 'в сети' : 'офлайн';
		const sourceIcon = sourceIcons[s.source] || '📡';
		const hostname = s.hostname ? `<br><small style="color: var(--text-tertiary);">${s.hostname}</small>` : '';
		
		return `
			<div class="server-item ${statusClass}" data-ws-url="${s.wsUrl}">
				<div class="server-status-indicator ${statusClass}"></div>
				<div class="server-info">
					<div class="server-address">${s.ip}:${s.port}</div>
					<div class="server-source">${sourceIcon} ${getSourceName(s.source)} ${hostname}</div>
				</div>
				<div class="server-status-text ${statusClass}">${statusText}</div>
				<button class="server-connect-btn" onclick="connectToSelectedServer('${s.wsUrl}')">
					Подключиться
				</button>
			</div>
		`;
	}).join('');
}

/**
 * Получение названия источника сервера
 */
function getSourceName(source) {
	const names = {
		mdns: 'mDNS',
		cache: 'кэш',
		scan: 'сканирование',
		manual: 'вручную',
	};
	return names[source] || source;
}

/**
 * Подключение к выбранному серверу
 */
window.connectToSelectedServer = async (wsUrl) => {
	if (!wsUrl) return;

	try {
		// Находим сервер в списке для получения httpUrl
		const server = state.discoveredServers.find(s => s.wsUrl === wsUrl);

		// Сохраняем выбранный сервер
		state.selectedServer = server || { wsUrl, httpUrl: wsUrl.replace('ws://', 'http://').replace('/ws', '') };

		// Закрываем диалог выбора сервера
		if (elements.serverSelectorDialog) {
			elements.serverSelectorDialog.close();
		}

		// Обновляем информацию о выбранном сервере в диалоге логина
		updateSelectedServerInfo(state.selectedServer);

		// Показываем диалог ввода имени
		elements.connectDialog.showModal();
		elements.userNameInput.value = userSettings?.name || '';
		elements.userNameInput.focus();
		updateConnectButton();

	} catch (error) {
		console.error('❌ Ошибка выбора сервера:', error);
		alert(`Не удалось выбрать сервер: ${error.message}`);
	}
};

/**
 * Обновление информации о выбранном сервере в диалоге логина
 */
function updateSelectedServerInfo(server) {
	if (!elements.selectedServerInfo) return;
	const address = server.ip ? `${server.ip}:${server.port}` : server.wsUrl;
	elements.selectedServerInfo.textContent = `📡 ${address}`;
	elements.selectedServerInfo.style.color = 'var(--success)';
}

/**
 * Обновление состояния кнопки подключения
 */
function updateConnectButton() {
	if (elements.confirmConnect) {
		elements.confirmConnect.disabled = !elements.userNameInput?.value.trim() || !state.selectedServer;
	}
}

/**
 * Подключение к серверу по ручному адресу
 */
async function connectToManualServer() {
	const address = elements.manualServerInput?.value.trim();

	if (!address) {
		alert('Введите адрес сервера');
		return;
	}

	try {
		// Формируем WebSocket URL
		let wsUrl = address;
		if (!wsUrl.startsWith('ws://') && !wsUrl.startsWith('wss://')) {
			wsUrl = `ws://${address}`;
		}

		// Парсим URL для извлечения host:port
		let ip, port, httpUrl;
		try {
			const parsed = new URL(wsUrl);
			ip = parsed.hostname;
			port = parsed.port ? parseInt(parsed.port) : 8080;
			httpUrl = `http://${ip}:${port}`;

			// Если нет пути /ws, добавляем
			if (!parsed.pathname.endsWith('/ws')) {
				wsUrl = `ws://${ip}:${port}/ws`;
			}
		} catch {
			// Fallback для невалидных URL
			const match = wsUrl.match(/^wss?:\/\/([^:]+):?(\d*)/);
			if (match) {
				ip = match[1];
				port = match[2] ? parseInt(match[2]) : 8080;
				httpUrl = `http://${ip}:${port}`;
			} else {
				throw new Error('Неверный формат адреса');
			}
		}

		// Сохраняем выбранный сервер
		state.selectedServer = { wsUrl, httpUrl, ip, port, source: 'manual' };

		// Кэшируем как ручной сервер
		if (window.__TAURI__?.core?.invoke || window.__TAURI__?.invoke) {
			invokeTauri('cache_server', { ip, port, source: 'manual' }).catch(console.warn);
		}

		// Закрываем диалог выбора сервера
		if (elements.serverSelectorDialog) {
			elements.serverSelectorDialog.close();
		}

		// Обновляем информацию о выбранном сервере
		updateSelectedServerInfo(state.selectedServer);

		// Показываем диалог ввода имени
		elements.connectDialog.showModal();
		elements.userNameInput.value = userSettings?.name || '';
		elements.userNameInput.focus();
		updateConnectButton();

	} catch (error) {
		console.error('❌ Ошибка подключения:', error);
		alert(`Не удалось подключиться: ${error.message}`);
	}
}

// ============================================================================
// Управление профилем и меню
// ============================================================================

/**
 * Открытие контекстного меню профиля
 */
function openProfileMenu() {
	if (elements.profileContextMenu) {
		elements.profileContextMenu.classList.add('open');
	}
	if (elements.profileMenuContainer) {
		elements.profileMenuContainer.classList.add('open');
	}
}

/**
 * Закрытие контекстного меню профиля
 */
function closeProfileMenu() {
	if (elements.profileContextMenu) {
		elements.profileContextMenu.classList.remove('open');
	}
	if (elements.profileMenuContainer) {
		elements.profileMenuContainer.classList.remove('open');
	}
}

/**
 * Обновление имени в меню профиля
 */
function updateProfileMenuName(name, avatar) {
	if (elements.profileMenuName) {
		elements.profileMenuName.textContent = name || 'Не подключен';
	}
	if (elements.profileMenuAvatar) {
		elements.profileMenuAvatar.textContent = avatar || '👤';
	}
}

/**
 * Обновление статуса подключения (новый UI)
 */
function updateConnectionStatus(connected, statusText) {
	if (elements.statusIndicator) {
		elements.statusIndicator.className = `status-indicator ${connected ? 'online' : 'offline'}`;
	}
	if (elements.statusText) {
		elements.statusText.textContent = statusText || (connected ? 'В сети' : 'Не в сети');
	}
}

/**
 * Показывает задержку до сервера при клике на статус
 */
async function showServerLatency() {
	if (!state.connected || !state.selectedServer) return;

	const latencyElement = elements.statusLatency;
	const connectionStatus = elements.connectionStatus;

	// Предотвращаем повторный клик во время анимации
	if (connectionStatus.classList.contains('pinging')) return;

	// Добавляем класс pinging для скрытия основного текста
	connectionStatus.classList.add('pinging');

	// Показываем "измерение..."
	latencyElement.textContent = '⏳ ...';
	latencyElement.className = 'status-latency visible';

	const startTime = performance.now();

	try {
		// Делаем ping серверу
		const httpUrl = state.selectedServer?.httpUrl || serverClient?.httpUrl;
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 3000);

		try {
			await fetch(`${httpUrl}/users`, {
				method: 'GET',
				signal: controller.signal,
			});
			clearTimeout(timer);

			const latency = Math.round(performance.now() - startTime);
			latencyElement.textContent = `⏱ ${latency} мс`;
		} catch {
			latencyElement.textContent = '❌ Нет ответа';
		} finally {
			clearTimeout(timer);
		}
	} catch (error) {
		latencyElement.textContent = '❌ Ошибка';
	}

	// Скрываем через 2 секунды
	setTimeout(() => {
		latencyElement.classList.remove('visible');
		latencyElement.classList.add('hiding');

		// Убираем класс pinging после завершения анимации
		setTimeout(() => {
			connectionStatus.classList.remove('pinging');
			latencyElement.className = 'status-latency';
		}, 400);
	}, 2000);
}

/**
 * Открытие меню контакта
 */
function openPeerMenu(event, peerId, peerName) {
	// Закрываем другие открытые меню
	document.querySelectorAll('.peer-context-menu.open').forEach(menu => {
		menu.classList.remove('open');
	});

	// Находим или создаём меню для этого контакта
	let menu = document.querySelector(`.peer-context-menu[data-user-id="${peerId}"]`);

	if (!menu) {
		// Создаём меню
		menu = document.createElement('div');
		menu.className = 'peer-context-menu';
		menu.dataset.userId = peerId;
		menu.innerHTML = `
			<div class="peer-menu-info">
				<div class="peer-menu-id">ID: ${peerId}</div>
			</div>
			<div class="profile-menu-divider"></div>
			<button class="profile-menu-item" data-action="delete-chat">
				<svg class="menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<polyline points="3 6 5 6 21 6"/>
					<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
				</svg>
				<span>Удалить чат</span>
			</button>
		`;

		// Обработчик клика по пунктам меню
		menu.addEventListener('click', (e) => {
			const actionBtn = e.target.closest('[data-action]');
			if (actionBtn) {
				const action = actionBtn.dataset.action;
				if (action === 'delete-chat') {
					deleteChatWithPeer(peerId, peerName);
				}
				closePeerMenu(peerId);
			}
		});

		// Добавляем меню в элемент контакта
		const peerElement = document.querySelector(`.peer-item[data-user-id="${peerId}"]`);
		if (peerElement) {
			peerElement.appendChild(menu);
		}
	}

	// Показываем меню
	menu.classList.add('open');
}

// Единый обработчик закрытия меню при клике вне — добавляется один раз
document.addEventListener('click', (e) => {
	const openMenu = document.querySelector('.peer-context-menu.open');
	if (openMenu && !openMenu.contains(e.target)) {
		const peerId = openMenu.dataset.userId;
		closePeerMenu(peerId);
	}
});

/**
 * Закрытие меню контакта
 */
function closePeerMenu(peerId) {
	const menu = document.querySelector(`.peer-context-menu[data-user-id="${peerId}"]`);
	if (menu) {
		menu.classList.remove('open');
	}
}

// ============================================================================
// Обработчики событий сервера
// ============================================================================

/**
 * Обработка нового сообщения
 */
function handleNewMessage(msg) {
	console.log('📩 Новое сообщение:', { id: msg.id, text: msg.text, filesCount: msg.files?.length });

	const isMine = msg.sender_id === state.user?.id;

	// Проверяем дубликаты по реальному ID
	const exists = state.messages.some((m) => m.id === msg.id);
	if (exists) {
		console.log('⚠️ Сообщение уже существует:', msg.id);
		return;
	}

	// Если это наше сообщение, ищем локальное и заменяем
	if (isMine) {
		const localIndex = findLocalMessageIndex(msg);
		if (localIndex !== -1) {
			updateMessageWithReal(msg, localIndex);
			return;
		}
		// Если локальное сообщение не найдено, но это наше — возможно оно уже добавлено
		// Проверяем есть ли сообщение с таким же sender_id, текстом и timestamp (±2 сек)
		const duplicateIndex = state.messages.findIndex(
			(m) => m.sender_id === msg.sender_id &&
				   m.text === msg.text &&
				   m.files?.length === msg.files?.length &&
				   Math.abs(m.timestamp - msg.timestamp) < 2
		);
		if (duplicateIndex !== -1) {
			console.log('⚠️ Найден дубликат по timestamp+text, заменяем:', msg.id);
			msg.delivery_status = state.messages[duplicateIndex].delivery_status;
			state.messages[duplicateIndex] = msg;

			// Заменяем в filteredMessages тоже — по тексту, не по произвольному local_
			const filteredIndex = state.filteredMessages.findIndex(
				(m) => m.sender_id === msg.sender_id &&
					   m.text === msg.text &&
					   m.files?.length === msg.files?.length &&
					   Math.abs(m.timestamp - msg.timestamp) < 2
			);
			if (filteredIndex !== -1) {
				state.filteredMessages[filteredIndex] = msg;
			}

			renderMessages(!!state.currentPeer);
			return;
		}
	}

	// Добавляем сообщение
	state.messages.push(msg);

	// Обновляем отфильтрованные сообщения если выбран чат
	if (state.currentPeer && isMessageInCurrentChat(msg)) {
		state.filteredMessages.push(msg);
		renderMessages(true);

		// Если получили сообщение в открытом чате — отправляем READ ACK
		if (!isMine) {
			serverClient.sendAck(msg.id, 'read');
			msg.delivery_status = DELIVERY_STATUS.READ;
		}
	} else {
		renderMessages();
		// Обновляем бейдж непрочитанных если сообщение не от нас
		if (!isMine) {
			updateUnreadBadge(msg.sender_id);
		}
	}

	// Обновляем список пользователей
	if (!isMine && !state.peers.some((p) => p.id === msg.sender_id)) {
		loadPeers();
	}
}

/**
 * Поиск локального сообщения по тексту и времени
 */
function findLocalMessageIndex(msg) {
	return state.messages.findIndex((m) => {
		if (!m.id.startsWith('local_') || m.sender_id !== state.user?.id) return false;
		if (Math.abs(m.timestamp - msg.timestamp) >= CONFIG.LOCAL_MESSAGE_TTL) return false;
		// Текстовое совпадение (оба пустых = совпадение)
		if (m.text === msg.text) return true;
		// Fallback для файлов: один получатель, совпадение по именам файлов
		if (m.recipient_id === msg.recipient_id &&
			m.files?.length > 0 && msg.files?.length > 0 &&
			m.files.length === msg.files.length) {
			return m.files.every((f, i) => f.name === msg.files[i]?.name);
		}
		return false;
	});
}

/**
 * Обновление локального сообщения реальным
 */
function updateMessageWithReal(msg, localIndex) {
	msg.delivery_status = state.messages[localIndex].delivery_status;
	state.messages[localIndex] = msg;

	// Заменяем конкретное локальное сообщение в filteredMessages (по тексту и sender)
	const localMsg = msg; // real message already has correct text/sender
	const filteredIndex = state.filteredMessages.findIndex(
		(m) => m.id.startsWith('local_') &&
			   m.text === localMsg.text &&
			   m.sender_id === localMsg.sender_id
	);
	if (filteredIndex !== -1) {
		state.filteredMessages[filteredIndex] = msg;
	}

	renderMessages(!!state.currentPeer);
}

/**
 * Проверка: сообщение в текущем чате
 */
function isMessageInCurrentChat(msg) {
	// Сообщения без recipient_id — это сообщения для всех (общие)
	// Показываем их только в чате с отправителем
	if (!msg.recipient_id) {
		return msg.sender_id === state.currentPeer;
	}

	// Сообщения с получателем показываем только в соответствующем чате
	return (
		(msg.sender_id === state.user?.id && msg.recipient_id === state.currentPeer) ||
		(msg.sender_id === state.currentPeer && msg.recipient_id === state.user?.id)
	);
}

/**
 * Обработка ACK (подтверждения прочтения)
 */
function handleAck(data) {
	console.log('📨 ACK получен:', data);

	// Игнорируем ACK которые мы отправили сами
	if (data.sender_id === state.user?.id) return;

	const msg = findMessageByAck(data);
	if (msg) {
		const oldStatus = msg.delivery_status;
		msg.delivery_status = data.status === 'read' ? DELIVERY_STATUS.READ : DELIVERY_STATUS.DELIVERED;
		console.log(`🔄 Статус сообщения ${data.message_id}: ${oldStatus} → ${msg.delivery_status}`);

		updateFilteredMessage(msg);
		renderMessages(!!state.currentPeer);

		// Анимация обновления статуса на последнем сообщении
		const messageElements = elements.messages.querySelectorAll('.message.mine');
		if (messageElements.length > 0) {
			const lastMsg = messageElements[messageElements.length - 1];
			const statusEl = lastMsg.querySelector('.read-status');
			if (statusEl) {
				statusEl.classList.add('status-changed');
				// Убираем класс после завершения анимации
				setTimeout(() => statusEl.classList.remove('status-changed'), 400);
			}
		}
	} else {
		console.log('⚠️ Сообщение не найдено для ACK:', data.message_id);
	}
}

/**
 * Поиск сообщения для обновления ACK
 */
function findMessageByAck(data) {
	// Ищем по реальному ID
	let msg = state.messages.find((m) => m.id === data.message_id);

	// Если не нашли, ищем по локальному ID
	if (!msg) {
		const localMsg = state.messages.find(
			(m) =>
				m.id.startsWith('local_') &&
				m.sender_id === state.user?.id &&
				Math.abs(Date.now() / 1000 - m.timestamp) < CONFIG.LOCAL_MESSAGE_TTL
		);

		if (localMsg) {
			console.log('🔄 Найдено локальное сообщение, обновляем ID:', localMsg.id, '→', data.message_id);
			localMsg.id = data.message_id;
			msg = localMsg;
		}
	}

	return msg;
}

/**
 * Обновление отфильтрованного сообщения
 */
function updateFilteredMessage(msg) {
	const filteredMsg = state.filteredMessages?.find(
		(m) => m.id === msg.id || m.id.startsWith('local_')
	);
	if (filteredMsg) {
		filteredMsg.delivery_status = msg.delivery_status;
		filteredMsg.id = msg.id;
	}
}

/**
 * Обработка истории сообщений
 */
function handleMessages(data) {
	const messages = Array.isArray(data) ? data : data.messages;
	const beforeId = data.before_id || data.beforeId || null;
	const nextBeforeId = data.next_before_id || data.nextBeforeId || null;
	const hasMore = data.has_more !== undefined ? data.has_more : messages.length >= 50;

	const scrollContainer = document.getElementById('chatScrollContainer') || elements.messagesContainer;
	const oldScrollHeight = elements.messagesContainer.scrollHeight;
	const oldScrollTop = scrollContainer.scrollTop;

	// ПРОВЕРКА на зацикливание: если получили ответ на запрос который уже делали
	if (beforeId && beforeId === state.lastRequestedBeforeId) {
		console.log(`📚 Зацикливание: ответ на уже запрошенный beforeId=${beforeId}, прекращаем`);
		state.hasMoreMessages = false;
		state.currentPeerBeforeId = null;
		state.lastRequestedBeforeId = null;
		state.isLoadingMessages = false;
		updateLoadMoreButton();
		return;
	}

	if (!beforeId) {
		// Первая загрузка - заменяем все сообщения
		state.messages = messages;
		state.lastRequestedBeforeId = null;

		// Сохраняем ID для следующей пагинации
		state.currentPeerBeforeId = nextBeforeId;
		state.lastMessageId = nextBeforeId;
	} else {
		// Подгрузка старых - добавляем в начало
		state.messages = [...messages, ...state.messages];
		state.currentPeerBeforeId = nextBeforeId;
	}

	state.hasMoreMessages = hasMore;
	state.isLoadingMessages = false;

	savePaginationState();

	// Фильтруем для текущего чата
	if (state.currentPeer) {
		filterMessagesForCurrentPeer();
		renderMessages(true, !!beforeId);

		// Если в текущем чате нет сообщений, продолжаем загрузку
		if (beforeId && state.filteredMessages.length === 0 && state.hasMoreMessages && nextBeforeId) {
			console.log('📚 В текущем чате нет сообщений, загружаем дальше...');
			state.lastRequestedBeforeId = nextBeforeId;
			state.isLoadingMessages = true;
			updateLoadMoreButton();
			serverClient.getMessages(50, nextBeforeId, state.currentPeer);
			return;
		}

		// Сохраняем позицию прокрутки при загрузке старых сообщений
		if (beforeId) {
			const newScrollHeight = elements.messagesContainer.scrollHeight;
			scrollContainer.scrollTop = oldScrollTop + (newScrollHeight - oldScrollHeight);
		}
	} else {
		renderMessages();
	}

	updateLoadMoreButton();
}

/**
 * Фильтрация сообщений для текущего пира
 */
function filterMessagesForCurrentPeer() {
	state.filteredMessages = state.messages.filter((m) => isMessageInCurrentChat(m));
}

/**
 * Проверка: есть ли ещё сообщения для текущего чата
 * Возвращает true если есть возможность загрузки старых сообщений
 */
function hasMoreMessagesForCurrentPeer() {
	if (!state.currentPeer) return false;
	if (!state.hasMoreMessages) return false;
	if (state.isLoadingMessages) return false;

	// Кнопка показывается только если есть ID для пагинации
	return !!state.currentPeerBeforeId;
}

/**
 * Обработка статуса онлайн
 */
function handleUserOnline(data) {
	if (data.online) {
		state.onlineUsers.add(data.user_id);
	} else {
		state.onlineUsers.delete(data.user_id);
	}
	// BUG-11 FIX: при изменении онлайн-статуса обновляем список peers с сервера
	// т.к. мог появиться новый пользователь которого нет в state.peers
	if (state.connected) {
		loadPeers();
	} else {
		renderPeers();
	}
}

/**
 * Обработка полной потери соединения (после всех попыток reconnect)
 */
function handleConnectionLost(data) {
	console.error('💔 Соединение потеряно после', data.attempts, 'попыток');
	state.connected = false;
	updateStatusDisplay(false, '❌ Соединение потеряно');
	// Очищаем сохранённую сессию
	localStorage.removeItem(CONFIG.STORAGE_KEYS.SESSION_USER);
	localStorage.removeItem(CONFIG.STORAGE_KEYS.SESSION_SERVER);
}

/**
 * Обработка обновления профиля
 */
function handleUserUpdated(data) {
	console.log(`👤 Пользователь ${data.user_id} обновил аватар: ${data.avatar}`);

	const peer = state.peers.find((p) => p.id === data.user_id);
	if (peer) {
		peer.avatar = data.avatar;
		renderPeers();
	}

	if (data.user_id === state.user?.id) {
		state.user.avatar = data.avatar;
		updateUserProfile(state.user.name, elements.userAddress.textContent);
	}
}

// ============================================================================
// Подключение и регистрация
// ============================================================================

/**
 * Подключение к серверу и регистрация
 * Использует уже выбранный сервер
 */
async function connectToServer() {
	const name = elements.userNameInput.value.trim();
	const avatar = userSettings?.avatar || CONFIG.AVATAR_DEFAULT;

	if (!name) {
		alert('Введите ваше имя');
		return;
	}

	if (!state.selectedServer) {
		alert('Сначала выберите сервер');
		return;
	}

	try {
		elements.serverStatus.innerHTML =
			'<span style="color: var(--warning);">🔌 Подключение...</span>';
		elements.confirmConnect.disabled = true;

		// Подключаемся к выбранному серверу
		await serverClient.connectToServer(state.selectedServer.wsUrl);

		const user = await serverClient.register(name, avatar);
		state.user = user;
		state.connected = true;
		state.serverUrl = state.selectedServer.wsUrl;

		// Сохраняем сессию для восстановления при перезагрузке
		localStorage.setItem(CONFIG.STORAGE_KEYS.SESSION_USER, JSON.stringify(state.user));
		localStorage.setItem(CONFIG.STORAGE_KEYS.SESSION_SERVER, JSON.stringify(state.selectedServer));

		updateUserProfile(user.name, 'В сети');
		updateStatusDisplay(true, 'В сети');

		restorePaginationState();

		if (!state.lastMessageId && state.messages.length === 0) {
			state.isLoadingMessages = true;
			updateLoadMoreButton();
			serverClient.getMessages(50, null, state.currentPeer);
		} else {
			state.isLoadingMessages = false;
			updateLoadMoreButton();
		}

		await loadPeers();
		setTimeout(renderPeers, 500);

		elements.serverStatus.innerHTML =
			'<span style="color: var(--success);">✅ Подключено</span>';

		setTimeout(() => {
			elements.connectDialog.close();
		}, 500);
	} catch (error) {
		console.error('❌ Ошибка подключения:', error);
		elements.serverStatus.innerHTML =
			'<span style="color: var(--error);">❌ Ошибка подключения<br><small>Проверьте что сервер запущен</small></span>';
		elements.confirmConnect.disabled = false;
	}
}

// ============================================================================
// Отправка сообщений
// ============================================================================

/**
 * Отправка сообщения
 */
async function sendMessage() {
	const text = elements.messageInput.value.trim();
	const filesToSend = [...attachedFiles];

	if (!text && filesToSend.length === 0) return;
	if (!state.connected) {
		alert('Нет подключения к серверу');
		return;
	}

	// Генерируем локальный ID для отслеживания
	const localId = `local_${Date.now()}`;

	// Формируем локальное сообщение для UI
	const messageData = {
		id: localId,
		sender_id: state.user.id,
		sender_name: state.user.name,
		text: text,
		timestamp: Date.now() / 1000,
		delivery_status: DELIVERY_STATUS.SENT,
		files: filesToSend.map(f => ({ name: f.name, size: f.size, path: '' })),
		recipient_id: state.currentPeer,
	};

	console.log('📤 Отправка сообщения:', {
		id: localId,
		text,
		filesCount: filesToSend.length,
	});

	// Отправляем файлы + текст через WebSocket чанки (асинхронно)
	if (filesToSend.length > 0) {
		serverClient.sendMessageWithFiles(text, filesToSend, state.currentPeer)
			.catch(e => console.error('❌ Ошибка отправки файлов:', e));
	} else if (text) {
		serverClient.sendMessage(text, state.currentPeer);
	}

	// Добавляем локально
	state.messages.push(messageData);

	if (state.currentPeer) {
		state.filteredMessages.push(messageData);
		renderMessages(true);
	} else {
		renderMessages();
	}

	// Очистка
	clearMessageInput();
}

/**
 * Очистка поля ввода и прикреплённых файлов
 */
function clearMessageInput() {
	elements.messageInput.value = '';
	attachedFiles = [];
	renderAttachedFiles();
	updateSendButton();
}

// ============================================================================
// Управление контактами
// ============================================================================

/**
 * Загрузка списка контактов (debounce 2с для защиты от лавины запросов)
 */
function loadPeers() {
	if (loadPeersTimer !== null) {
		clearTimeout(loadPeersTimer);
	}
	loadPeersTimer = setTimeout(async () => {
		loadPeersTimer = null;
		try {
			const users = await serverClient.getUsers();
			state.peers = users.filter((u) => u.id !== state.user?.id);
			renderPeers();
		} catch (error) {
			console.error('❌ Загрузка пользователей:', error);
		}
	}, 2000);
}

/**
 * Рендеринг контактов
 */
function renderPeers() {
	if (!elements.peersList) return;

	elements.peersList.innerHTML = '';

	if (!state.connected) {
		elements.peersList.innerHTML =
			'<p style="padding: 20px; color: var(--text-tertiary); text-align: center;">Не подключены</p>';
		return;
	}

	if (state.peers.length === 0) {
		elements.peersList.innerHTML =
			'<p style="padding: 20px; color: var(--text-tertiary); text-align: center;">Нет других пользователей</p>';
		return;
	}

	state.peers.forEach((peer, index) => {
		const item = createPeerElement(peer);
		// Staggered-анимация: каждый контакт появляется с задержкой
		item.style.animationDelay = `${index * 50}ms`;
		item.classList.add('animate-in');
		elements.peersList.appendChild(item);
	});
}

/**
 * Обновление бейджа непрочитанных сообщений
 */
function updateUnreadBadge(peerId) {
	const peerElement = document.querySelector(`.peer-item[data-user-id="${peerId}"]`);
	if (!peerElement) return;
	
	const unreadCount = countUnreadMessages(peerId);
	let badge = peerElement.querySelector('.unread-badge');
	
	if (unreadCount > 0) {
		if (!badge) {
			badge = document.createElement('span');
			badge.className = 'unread-badge';
			const menuBtn = peerElement.querySelector('.peer-menu-btn');
			peerElement.insertBefore(badge, menuBtn);
		}
		badge.textContent = unreadCount;
	} else if (badge) {
		badge.remove();
	}
}

/**
 * Создание элемента контакта
 */
function createPeerElement(peer) {
	const item = document.createElement('div');
	item.className = `peer-item ${state.currentPeer === peer.id ? 'active' : ''}`;
	item.dataset.userId = peer.id;
	item.dataset.userName = peer.name;

	const lastMsg = getLastMessageFromUser(peer.id);
	const isOnline = state.onlineUsers.has(peer.id);
	const peerAvatar = peer.avatar || CONFIG.AVATAR_DEFAULT;
	const unreadCount = countUnreadMessages(peer.id);
	const unreadBadge = unreadCount > 0 
		? `<span class="unread-badge">${unreadCount}</span>` 
		: '';

	item.innerHTML = `
		<span class="peer-icon">${peerAvatar}</span>
		<div class="peer-info">
			<div class="peer-name">${escapeHtml(peer.name)}</div>
			<div class="peer-status ${isOnline ? 'online' : 'offline'}">
				${isOnline ? 'в сети' : 'не в сети'}
			</div>
		</div>
		${unreadBadge}
		<button class="peer-menu-btn" title="Меню" data-user-id="${peer.id}">
			<svg class="menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<circle cx="12" cy="12" r="1"/>
				<circle cx="12" cy="5" r="1"/>
				<circle cx="12" cy="19" r="1"/>
			</svg>
		</button>
	`;

	// Клик по контакту — выбор пира
	item.addEventListener('click', (e) => {
		if (e.target.closest('.peer-menu-btn')) return; // Игнорируем клик по кнопке меню
		e.stopPropagation();
		selectPeer(peer.id, peer.name);
	});

	// Клик по кнопке меню — открываем меню
	const menuBtn = item.querySelector('.peer-menu-btn');
	menuBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		openPeerMenu(e, peer.id, peer.name);
	});

	return item;
}

/**
 * Подсчёт непрочитанных сообщений от контакта
 */
function countUnreadMessages(peerId) {
	return state.messages.filter(
		m => m.sender_id === peerId && 
		     m.delivery_status < DELIVERY_STATUS.READ
	).length;
}

/**
 * Получение последнего сообщения от пользователя
 */
function getLastMessageFromUser(userId) {
	return state.messages
		.filter((m) => m.sender_id === userId)
		.sort((a, b) => b.timestamp - a.timestamp)[0];
}

/**
 * Выбор контакта
 */
function selectPeer(userId, userName) {
	state.currentPeer = userId;
	// Сбрасываем пагинацию при смене чата
	state.lastRequestedBeforeId = null;
	state.currentPeerBeforeId = null;
	state.hasMoreMessages = true;

	document.querySelectorAll('.peer-item').forEach((item) => {
		item.classList.toggle('active', item.dataset.userId === userId);
	});

	updateStatusDisplay(true, 'В сети');

	// Фильтруем уже загруженные сообщения для этого чата
	filterMessagesForCurrentPeer();
	renderMessages(true);

	// Проверяем есть ли ещё сообщения для загрузки
	updateLoadMoreButton();

	// Отправляем READ ACK для всех непрочитанных сообщений
	markMessagesAsRead(userId);
	
	// Сбрасываем бейдж непрочитанных
	updateUnreadBadge(userId);
}

/**
 * Отметка сообщений как прочитанных
 */
function markMessagesAsRead(userId) {
	const unreadIds = state.messages
		.filter((m) => m.sender_id === userId && m.delivery_status < DELIVERY_STATUS.READ)
		.map((m) => m.id);

	if (unreadIds.length === 0) return;

	unreadIds.forEach((id) => {
		serverClient.sendAck(id, 'read');
		const msg = state.messages.find((m) => m.id === id);
		if (msg) msg.delivery_status = DELIVERY_STATUS.READ;
	});

	state.filteredMessages
		.filter((m) => unreadIds.includes(m.id))
		.forEach((m) => {
			m.delivery_status = DELIVERY_STATUS.READ;
		});

	renderMessages(true);
}

/**
 * Загрузка сообщений для выбранного контакта
 */
function loadMessagesForPeer(userId) {
	filterMessagesForCurrentPeer();
	renderMessages(true);
}

/**
 * Удаление чата с подтверждением
 */
async function deleteChatWithPeer(peerId, peerName) {
	const confirmed = confirm(`Удалить всю переписку с ${peerName}?\n\nЭто действие нельзя отменить.`);
	if (!confirmed) return;

	try {
		console.log(`🗑️ Удаление чата с ${peerName} (${peerId})`);
		await serverClient.deleteChat(peerId);

		// Очищаем сообщения этого чата
		state.messages = state.messages.filter(
			(m) => !(
				(m.sender_id === state.user?.id && m.recipient_id === peerId) ||
				(m.sender_id === peerId && m.recipient_id === state.user?.id)
			)
		);

		// Если сейчас открыт этот чат — закрываем
		if (state.currentPeer === peerId) {
			state.currentPeer = null;
			state.filteredMessages = [];
			state.currentPeerBeforeId = null;
			state.hasMoreMessages = true;
			renderMessages();
		} else {
			// Перерисовываем текущий чат если открыт
			if (state.currentPeer) {
				filterMessagesForCurrentPeer();
				renderMessages(true);
			}
		}

		console.log(`✅ Чат с ${peerName} удалён`);
	} catch (error) {
		console.error('❌ Ошибка удаления чата:', error);
		alert(`Не удалось удалить чат: ${error.message}`);
	}
}

/**
 * Обработка уведомления об удалении чата (от сервера)
 */
function handleChatDeleted(data) {
	console.log('🗑️ Чат удалён:', data);
	const peerId = data.peer_id;

	// Очищаем сообщения этого чата
	state.messages = state.messages.filter(
		(m) => !(
			(m.sender_id === state.user?.id && m.recipient_id === peerId) ||
			(m.sender_id === peerId && m.recipient_id === state.user?.id)
		)
	);

	// Если открыт этот чат — закрываем
	if (state.currentPeer === peerId) {
		state.currentPeer = null;
		state.filteredMessages = [];
		state.currentPeerBeforeId = null;
		state.hasMoreMessages = true;
		renderMessages();
	} else if (state.currentPeer) {
		filterMessagesForCurrentPeer();
		renderMessages(true);
	}
}

// ============================================================================
// Пагинация сообщений
// ============================================================================

/**
 * Загрузка старых сообщений
 */
async function loadMoreMessages() {
	if (state.isLoadingMessages || !state.hasMoreMessages) {
		return;
	}

	if (!state.currentPeer) {
		return;
	}

	// Используем currentPeerBeforeId для пагинации текущего чата
	const beforeId = state.currentPeerBeforeId;

	if (!beforeId) {
		console.log('📚 Нет ID для пагинации');
		return;
	}

	console.log(`📚 Загрузка старых сообщений до: ${beforeId}`);
	state.isLoadingMessages = true;
	state.lastRequestedBeforeId = beforeId;
	updateLoadMoreButton();

	serverClient.getMessages(50, beforeId, state.currentPeer);
}

/**
 * Обновление кнопки загрузки сообщений
 */
function updateLoadMoreButton() {
	if (!elements.loadMoreBtn || !elements.loadMoreContainer) return;

	// Кнопка показывается только если есть выбранный чат и есть возможность загрузки
	const shouldShow = hasMoreMessagesForCurrentPeer();
	elements.loadMoreContainer.style.display = shouldShow ? 'flex' : 'none';

	if (elements.loadMoreBtn) {
		elements.loadMoreBtn.disabled = state.isLoadingMessages || !shouldShow;
		elements.loadMoreBtn.textContent = state.isLoadingMessages ? 'Загрузка...' : 'Загрузить старые';
	}
}

// ============================================================================
// Рендеринг сообщений
// ============================================================================

/**
 * Рендеринг сообщений
 */
function renderMessages(useFiltered = false, preserveScroll = false) {
	const scrollContainer = elements.chatScrollContainer || elements.messagesContainer;
	let oldScrollHeight, oldScrollTop;

	// Сохраняем позицию скролла если нужно
	if (preserveScroll) {
		oldScrollHeight = scrollContainer.scrollHeight;
		oldScrollTop = scrollContainer.scrollTop;
	}

	elements.messages.innerHTML = '';

	// Если нет выбранного чата, показываем пустое состояние
	if (!state.currentPeer) {
		renderEmptyChatState();
		hideMessageInput();
		return;
	}

	showMessageInput();

	const messagesToRender = useFiltered && state.filteredMessages ? state.filteredMessages : state.messages;

	if (messagesToRender.length === 0) {
		elements.messages.innerHTML =
			'<p style="text-align: center; color: var(--text-tertiary); padding: 20px;">Нет сообщений</p>';
		return;
	}

	let lastDate = null;
	messagesToRender.forEach((msg) => {
		const msgDate = new Date(msg.timestamp * 1000);
		const dateStr = msgDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

		if (lastDate !== dateStr) {
			const dateEl = document.createElement('div');
			dateEl.className = 'message-date-separator';
			dateEl.textContent = dateStr;
			elements.messages.appendChild(dateEl);
			lastDate = dateStr;
		}

		const messageEl = createMessageElement(msg);
		elements.messages.appendChild(messageEl);
	});

	// Восстанавливаем позицию скролла или прокручиваем вниз
	if (preserveScroll && oldScrollHeight !== undefined) {
		const newScrollHeight = scrollContainer.scrollHeight;
		scrollContainer.scrollTop = oldScrollTop + (newScrollHeight - oldScrollHeight);
	} else {
		scrollToBottom();
	}
}

/**
 * Рендеринг пустого состояния чата
 */
function renderEmptyChatState() {
	elements.messages.innerHTML = `
		<div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--text-tertiary); text-align: center; padding: 40px;">
			<div style="font-size: 18px; margin-bottom: 10px;">Выберите чат</div>
			<div style="font-size: 14px;">Выберите контакт из списка слева чтобы начать общение</div>
		</div>
	`;
}

/**
 * Скрытие/показ панели ввода
 */
function hideMessageInput() {
	if (elements.messageInput) {
		elements.messageInput.closest('.input-area').style.display = 'none';
	}
}

function showMessageInput() {
	if (elements.messageInput) {
		elements.messageInput.closest('.input-area').style.display = 'flex';
	}
}

/**
 * Создание элемента сообщения
 */
function createMessageElement(msg) {
	const div = document.createElement('div');
	const isMine = msg.sender_id === state.user?.id;
	div.className = `message ${isMine ? 'mine' : 'theirs'}`;

	const time = new Date(msg.timestamp * 1000).toLocaleTimeString('ru-RU', {
		hour: '2-digit',
		minute: '2-digit',
	});

	if (isMine) {
		div.innerHTML = createMineMessageContent(msg, time);
	} else {
		div.innerHTML = createTheirsMessageContent(msg, time);
	}

	return div;
}

/**
 * Создание контента сообщения (моё)
 */
function createMineMessageContent(msg, time) {
	const statusIcon = getStatusIcon(msg.delivery_status);
	const statusTitle = getStatusTitle(msg.delivery_status);

	if (msg.files && msg.files.length > 0) {
		const filesHtml = createFilesHtml(msg.files);
		return `
			${msg.text ? `<div class="message-text">${escapeHtml(msg.text)}</div>` : ''}
			<div class="files-container">${filesHtml}</div>
			<div class="message-meta">
				<span class="read-status" title="${statusTitle}">${statusIcon}</span>
				<span>${time}</span>
			</div>
		`;
	}

	return `
		<div class="message-text">${escapeHtml(msg.text)}</div>
		<div class="message-meta">
			<span class="read-status" title="${statusTitle}">${statusIcon}</span>
			<span>${time}</span>
		</div>
	`;
}

/**
 * Создание контента сообщения (чужое)
 */
function createTheirsMessageContent(msg, time) {
	if (msg.files && msg.files.length > 0) {
		const filesHtml = createFilesHtml(msg.files);
		return `
			<div class="message-sender">👤 ${escapeHtml(msg.sender_name)}</div>
			${msg.text ? `<div class="message-text">${escapeHtml(msg.text)}</div>` : ''}
			<div class="files-container">${filesHtml}</div>
			<div class="message-meta">${time}</div>
		`;
	}

	return `
		<div class="message-sender">👤 ${escapeHtml(msg.sender_name)}</div>
		<div class="message-text">${escapeHtml(msg.text)}</div>
		<div class="message-meta">${time}</div>
	`;
}

/**
 * Получение иконки статуса
 */
function getStatusIcon(status) {
	switch (status) {
		case DELIVERY_STATUS.SENT:
			return STATUS_ICONS.SENT;
		case DELIVERY_STATUS.DELIVERED:
			return STATUS_ICONS.DELIVERED;
		case DELIVERY_STATUS.READ:
			return STATUS_ICONS.READ;
		default:
			return STATUS_ICONS.SENT;
	}
}

/**
 * Получение названия статуса
 */
function getStatusTitle(status) {
	switch (status) {
		case DELIVERY_STATUS.SENT:
			return 'Отправлено';
		case DELIVERY_STATUS.DELIVERED:
			return 'Доставлено';
		case DELIVERY_STATUS.READ:
			return 'Прочитано';
		default:
			return 'Отправлено';
	}
}

/**
 * Создание HTML для файлов
 */
function createFilesHtml(files) {
	return files
		.map(
			(f) => `
			<div class="file-item"
				 data-filename="${escapeHtml(f.name)}"
				 data-filesize="${f.size}"
				 data-filepath="${escapeHtml(f.path || '')}"
				 onclick="openFile('${escapeJsString(f.path || '')}', '${escapeJsString(f.name)}')">
				<span class="file-icon">${getFileIcon(f.name)}</span>
				<span class="file-info">
					<span class="file-name-row">
						<span class="file-name">${escapeHtml(f.name)}</span>
						<button class="file-download-btn"
								onclick="event.stopPropagation(); downloadFile('${escapeJsString(f.path || '')}', '${escapeJsString(f.name)}')"
								title="Скачать файл">
							<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
								<path d="M12 5v14M5 12l7 7 7-7"/>
							</svg>
						</button>
					</span>
					<span class="file-size">${formatFileSize(f.size)}</span>
				</span>
			</div>
		`
		)
		.join('');
}

// ============================================================================
// Обновление UI
// ============================================================================

/**
 * Обновление статуса подключения
 */
function updateStatusDisplay(connected, statusText) {
	// Новый UI
	updateConnectionStatus(connected, statusText);
	
	// Старый UI (для обратной совместимости)
	if (elements.status) {
		if (connected) {
			elements.status.textContent = `🟢 ${statusText}`;
			elements.status.style.color = 'var(--success)';
		} else {
			elements.status.textContent = '⚫ Не в сети';
			elements.status.style.color = 'var(--text-tertiary)';
		}
	}
	
	updateSendButton();
}

/**
 * Обновление профиля пользователя
 */
function updateUserProfile(name, status) {
	const avatar = state.user?.avatar || userSettings?.avatar || CONFIG.AVATAR_DEFAULT;
	
	// Новый UI
	updateProfileMenuName(name, avatar);
	if (elements.userAvatar) {
		elements.userAvatar.textContent = avatar;
	}
	if (elements.profileMenuAvatar) {
		elements.profileMenuAvatar.textContent = avatar;
	}
	
	// Старый UI (для обратной совместимости)
	if (elements.userName) {
		elements.userName.textContent = name || 'Не подключен';
	}
	if (elements.userAddress) {
		elements.userAddress.textContent = status || '--';
	}
}

/**
 * Прокрутка вниз
 */
function scrollToBottom() {
	const container = elements.chatScrollContainer || elements.messagesContainer;
	container.scrollTop = container.scrollHeight;
}

// ============================================================================
// Работа с файлами
// ============================================================================

/**
 * Отображение прикреплённых файлов
 */
function renderAttachedFiles() {
	elements.attachedFiles.innerHTML = '';
	attachedFiles.forEach((file, index) => {
		const fileEl = document.createElement('div');
		fileEl.className = 'attached-file';
		fileEl.innerHTML = `
			<span class="attached-file-icon">${getFileIcon(file.name)}</span>
			<span class="attached-file-name">${file.name}</span>
			<button class="attached-file-remove" onclick="removeAttachedFile(event, ${index})">×</button>
		`;
		elements.attachedFiles.appendChild(fileEl);
	});
	elements.attachedFiles.style.display = attachedFiles.length > 0 ? 'flex' : 'none';
	elements.messageInput.parentElement.classList.toggle('no-border', attachedFiles.length > 0);
}

/**
 * Удаление файла из списка прикреплённых
 */
window.removeAttachedFile = (event, index) => {
	event.stopPropagation();

	// Анимация удаления
	const fileElement = elements.attachedFiles.querySelector(`.attached-file:nth-child(${index + 1})`);
	if (fileElement) {
		fileElement.classList.add('animate-out');
		// Ждём окончания анимации перед удалением
		fileElement.addEventListener('animationend', () => {
			attachedFiles.splice(index, 1);
			renderAttachedFiles();
			updateSendButton();
		}, { once: true });
	} else {
		attachedFiles.splice(index, 1);
		renderAttachedFiles();
		updateSendButton();
	}
};

/**
 * Открытие файла — скачивание и открытие системой
 */
window.openFile = async (filepath, filename) => {
	if (!filepath) {
		alert('Путь к файлу не указан');
		return;
	}

	try {
		// Используем реальный URL сервера вместо localhost
		const fileUrl = filepath.startsWith('http')
			? filepath
			: `${serverClient.httpUrl}/files/download?file_id=${encodeURIComponent(filepath)}`;

		const response = await fetch(fileUrl);
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}
		const blob = await response.blob();
		const url = window.URL.createObjectURL(blob);

		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();

		window.URL.revokeObjectURL(url);
		document.body.removeChild(a);

		console.log(`📁 Файл скачан: ${filename}`);
	} catch (error) {
		alert(`Не удалось открыть файл: ${error.message}`);
	}
};

/**
 * Скачивание файла
 */
window.downloadFile = async (filepath, filename) => {
	if (!filepath) {
		alert('Путь к файлу не указан');
		return;
	}

	try {
		// Используем реальный URL сервера вместо localhost
		const fileUrl = filepath.startsWith('http')
			? filepath
			: `${serverClient.httpUrl}/files/download?file_id=${encodeURIComponent(filepath)}`;

		const response = await fetch(fileUrl);
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}
		const blob = await response.blob();
		const url = window.URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		window.URL.revokeObjectURL(url);
		document.body.removeChild(a);
	} catch (error) {
		alert(`Не удалось скачать файл: ${error.message}`);
	}
};

// ============================================================================
// Обработчики событий UI
// ============================================================================

/**
 * Обновление кнопки отправки
 */
function updateSendButton() {
	const hasText = elements.messageInput.value.trim().length > 0;
	const hasFiles = attachedFiles.length > 0;
	elements.sendBtn.disabled = (!hasText && !hasFiles) || !state.connected;
}

/**
 * Настройка событий
 */
function setupEventListeners() {
	// Новый UI: клик по статусу — задержка или переподключение
	if (elements.connectionStatus) {
		elements.connectionStatus.addEventListener('click', async () => {
			if (state.connected) {
				showServerLatency();
			} else {
				// Пытаемся восстановить сессию
				const savedUser = localStorage.getItem(CONFIG.STORAGE_KEYS.SESSION_USER);
				const savedServer = localStorage.getItem(CONFIG.STORAGE_KEYS.SESSION_SERVER);

				if (savedUser && savedServer) {
					try {
						const user = JSON.parse(savedUser);
						const server = JSON.parse(savedServer);
						state.selectedServer = server;
						elements.userNameInput.value = user.name;
						if (elements.serverStatus) {
							elements.serverStatus.innerHTML =
								'<span style="color: var(--warning);">🔄 Переподключение...</span>';
						}
						await connectToServer();
					} catch (e) {
						console.warn('⚠️ Переподключение не удалось:', e);
						openServerSelector();
					}
				} else {
					// Нет сохранённой сессии — открываем выбор сервера
					openServerSelector();
				}
			}
		});
	}

	// Старый UI (для обратной совместимости)
	if (elements.status) {
		elements.status.addEventListener('click', () => {
			if (!state.connected) {
				openServerSelector();
			}
		});
	}

	elements.confirmConnect.addEventListener('click', connectToServer);

	elements.userNameInput.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') connectToServer();
	});

	elements.userNameInput.addEventListener('input', () => {
		updateConnectButton();
	});

	// Кнопка смены сервера
	if (elements.changeServerBtn) {
		elements.changeServerBtn.addEventListener('click', () => {
			elements.connectDialog.close();
			openServerSelector();
		});
	}

	elements.sendBtn.addEventListener('click', (e) => {
		// Ripple эффект
		createRipple(e, elements.sendBtn);
		sendMessage();
	});
	elements.messageInput.addEventListener('input', updateSendButton);

	elements.messageInput.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			sendMessage();
		}
	});

	elements.attachBtn.addEventListener('click', () => {
		elements.fileInput.click();
	});

	elements.fileInput.addEventListener('change', handleFileSelect);

	// Drag'n'drop для файлов
	initDragAndDrop();

	if (elements.loadMoreBtn) {
		elements.loadMoreBtn.addEventListener('click', loadMoreMessages);
	}

	// Новый UI: профиль и меню
	if (elements.profileAvatarBtn) {
		elements.profileAvatarBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			openProfileMenu();
		});
	}
	
	// Закрытие меню при клике вне
	document.addEventListener('click', (e) => {
		if (elements.profileContextMenu && elements.profileMenuContainer) {
			if (!elements.profileMenuContainer.contains(e.target)) {
				closeProfileMenu();
			}
		}
	});
	
	// Пункты меню профиля
	if (elements.menuProfile) {
		elements.menuProfile.addEventListener('click', () => {
			openSettingsDialog();
			closeProfileMenu();
		});
	}
	
	if (elements.menuSettings) {
		elements.menuSettings.addEventListener('click', () => {
			if (!state.connected) {
				alert('Подключитесь к серверу');
				closeProfileMenu();
				return;
			}
			elements.appSettingsDialog.showModal();
			closeProfileMenu();
		});
	}
	
	if (elements.menuLogout) {
		elements.menuLogout.addEventListener('click', () => {
			if (state.connected) {
				serverClient.disconnect();
			}
			state.connected = false;
			state.user = null;
			state.selectedServer = null;
			state.peers = [];
			state.messages = [];
			state.filteredMessages = [];
			state.currentPeer = null;
			updateStatusDisplay(false, 'Не в сети');
			// Очищаем сохранённую сессию
			localStorage.removeItem(CONFIG.STORAGE_KEYS.SESSION_USER);
			localStorage.removeItem(CONFIG.STORAGE_KEYS.SESSION_SERVER);
			closeProfileMenu();
			// Перезагружаем страницу чтобы показать меню входа
			location.reload();
		});
	}

	// ========================================================================
	// Обработчики диалога настроек приложения
	// ========================================================================

	if (elements.closeAppSettings) {
		elements.closeAppSettings.addEventListener('click', () => {
			elements.appSettingsDialog.close();
		});
	}

	if (elements.saveAppSettings) {
		elements.saveAppSettings.addEventListener('click', () => {
			// TODO: Сохранить настройки в localStorage / на сервер
			console.log('💾 Сохранение настроек (мок)');
			elements.appSettingsDialog.close();
		});
	}

	if (elements.resetAppSettings) {
		elements.resetAppSettings.addEventListener('click', () => {
			// TODO: Сбросить настройки к значениям по умолчанию
			console.log('🔄 Сброс настроек (мок)');
			elements.appSettingsDialog.close();
		});
	}

	// Обновление отображения размера шрифта при движении ползунка
	if (elements.settingFontSize && elements.fontSizeValue) {
		elements.settingFontSize.addEventListener('input', () => {
			elements.fontSizeValue.textContent = `${elements.settingFontSize.value}px`;
		});
	}

	if (elements.clearCacheBtn) {
		elements.clearCacheBtn.addEventListener('click', () => {
			// TODO: Очистить кэш серверов
			console.log('🗑️ Очистка кэша (мок)');
		});
	}

	if (elements.exportDataBtn) {
		elements.exportDataBtn.addEventListener('click', () => {
			// TODO: Экспорт истории сообщений
			console.log('📤 Экспорт данных (мок)');
		});
	}

	if (elements.menuChangeServer) {
		elements.menuChangeServer.addEventListener('click', () => {
			// Если подключены — отключаемся и сбрасываем состояние
			if (state.connected) {
				serverClient.disconnect();
				state.connected = false;
				state.user = null;
				state.selectedServer = null;
				state.peers = [];
				state.messages = [];
				state.filteredMessages = [];
				state.currentPeer = null;
				updateStatusDisplay(false, 'Не в сети');
				updateProfileMenuName('', CONFIG.AVATAR_DEFAULT);
				if (elements.userAvatar) {
					elements.userAvatar.textContent = CONFIG.AVATAR_DEFAULT;
				}
				// Очищаем сохранённую сессию
				localStorage.removeItem(CONFIG.STORAGE_KEYS.SESSION_USER);
				localStorage.removeItem(CONFIG.STORAGE_KEYS.SESSION_SERVER);
			}
			openServerSelector();
			closeProfileMenu();
		});
	}

	// Старый UI (для обратной совместимости)
	if (elements.userProfileHeader) {
		elements.userProfileHeader.addEventListener('click', openSettingsDialog);
	}
	
	elements.cancelSettings.addEventListener('click', () => {
		elements.settingsDialog.close();
	});
	elements.saveSettings.addEventListener('click', saveSettings);

	// Обработчики для выбора сервера
	if (elements.refreshServersBtn) {
		elements.refreshServersBtn.addEventListener('click', refreshServerList);
	}

	if (elements.confirmManualServer) {
		elements.confirmManualServer.addEventListener('click', connectToManualServer);
	}

	if (elements.cancelServerSelector) {
		elements.cancelServerSelector.addEventListener('click', () => {
			elements.serverSelectorDialog.close();
		});
	}

	if (elements.manualServerInput) {
		elements.manualServerInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') connectToManualServer();
		});
	}

	// Обработчики для меню контакта уже добавлены в createPeerElement
}

/**
 * Обработка выбора файлов
 */
function handleFileSelect(e) {
	const files = Array.from(e.target.files);
	files.forEach((file) => {
		if (file.size > CONFIG.MAX_FILE_SIZE) {
			alert(`Файл "${file.name}" слишком большой (макс. 100MB)`);
			return;
		}
		// Не добавляем дубликаты
		if (!attachedFiles.some(f => f.name === file.name && f.size === file.size)) {
			attachedFiles.push(file);
		}
	});
	elements.fileInput.value = '';
	renderAttachedFiles();
	updateSendButton();
}

/**
 * Инициализация drag'n'drop для файлов
 */
function initDragAndDrop() {
	const dropZone = elements.inputArea;

	console.log('🔧 initDragAndDrop called');

	// Обработка входа драга в зону
	dropZone.addEventListener('dragenter', (e) => {
		e.preventDefault();
		e.stopPropagation();
		console.log('🎯 Drag enter');
		dropZone.classList.add('drag-over');
	}, false);

	// Обработка перемещения над зоной
	dropZone.addEventListener('dragover', (e) => {
		e.preventDefault();
		e.stopPropagation();
		if (e.dataTransfer) {
			e.dataTransfer.dropEffect = 'copy';
		}
		console.log('📌 Drag over');
		dropZone.classList.add('drag-over');
	}, false);

	// Обработка выхода из зоны
	dropZone.addEventListener('dragleave', (e) => {
		e.preventDefault();
		e.stopPropagation();
		
		// Проверяем что уходим именно из dropZone
		if (e.target === dropZone) {
			dropZone.classList.remove('drag-over');
			console.log('👋 Drag leave');
		}
	}, false);

	// Обработка сброса файлов
	dropZone.addEventListener('drop', (e) => {
		e.preventDefault();
		e.stopPropagation();
		dropZone.classList.remove('drag-over');
		
		console.log('📁 Drop event');
		console.log('DataTransfer types:', e.dataTransfer?.types);
		console.log('Files:', e.dataTransfer?.files?.length);
		
		if (e.dataTransfer?.files?.length > 0) {
			const files = Array.from(e.dataTransfer.files);
			console.log('📄 Files dropped:', files.map(f => `${f.name} (${f.size} bytes)`));
			handleDroppedFiles(files);
		}
	}, false);
}

/**
 * Обработка сброшенных файлов
 */
function handleDroppedFiles(files) {
	console.log('📁 Drop files:', files);
	
	files.forEach((file) => {
		console.log('📄 File:', file.name, file.size, 'bytes');
		
		if (file.size > CONFIG.MAX_FILE_SIZE) {
			alert(`Файл "${file.name}" слишком большой (макс. 100MB)`);
			return;
		}
		attachedFiles.push(file);
	});
	renderAttachedFiles();
	updateSendButton();
}

/**
 * Открытие диалога настроек
 */
function openSettingsDialog() {
	elements.settingsNameInput.value = state.user?.name || '';
	elements.settingsAvatarInput.value = userSettings?.avatar || CONFIG.AVATAR_DEFAULT;
	elements.settingsDialog.showModal();
}

/**
 * Сохранение настроек
 */
function saveSettings() {
	const name = elements.settingsNameInput.value.trim();
	const avatar = elements.settingsAvatarInput.value.trim() || CONFIG.AVATAR_DEFAULT;

	if (name && state.user) {
		state.user.name = name;
		userSettings = { name, avatar };
		saveUserSettings();
		updateUserProfile(name, elements.userAddress.textContent);

		if (state.connected) {
			serverClient.updateProfile(avatar);
			console.log(`👤 Профиль обновлён: ${name}, аватар: ${avatar}`);
		}
	}

	elements.settingsDialog.close();
}

// ============================================================================
// Инициализация приложения
// ============================================================================

/**
 * Запуск приложения
 */
if (typeof window !== 'undefined' && !window.__TEST_MODE__) {
	loadUserSettings();
	init();
}

/**
 * Экспорт для тестов (ES modules + CommonJS)
 */
export {
	init,
	loadUserSettings,
	saveUserSettings,
	connectToServer,
	discoverServers,
	openServerSelector,
	refreshServerList,
	handleNewMessage,
	handleAck,
	handleMessages,
	handleUserOnline,
	handleUserUpdated,
	selectPeer,
	renderPeers,
	loadPeers,
	sendMessage,
	renderMessages,
	filterMessagesForCurrentPeer,
	isMessageInCurrentChat,
	updateLoadMoreButton,
	loadMoreMessages,
};

/**
 * Экспорт для тестов (CommonJS для Jest)
 */
if (typeof module !== 'undefined' && module.exports) {
	module.exports = {
		init,
		loadUserSettings,
		saveUserSettings,
		connectToServer,
		discoverServers,
		openServerSelector,
		refreshServerList,
		handleNewMessage,
		handleAck,
		handleMessages,
		handleUserOnline,
		handleUserUpdated,
		selectPeer,
		renderPeers,
		loadPeers,
		sendMessage,
		renderMessages,
		filterMessagesForCurrentPeer,
		isMessageInCurrentChat,
		updateLoadMoreButton,
		loadMoreMessages,
	};
}
