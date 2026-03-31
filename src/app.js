/**
 * @file XAM Messenger - Клиентское приложение
 * @module App
 */

'use strict';

// ============================================================================
// Константы
// ============================================================================

const CONFIG = {
	MAX_FILE_SIZE: 100 * 1024 * 1024, // 100MB
	LOCAL_MESSAGE_TTL: 10, // секунд для поиска локального сообщения
	AVATAR_DEFAULT: '👤',
	STORAGE_KEYS: {
		USER_SETTINGS: 'xam-user-settings',
		LAST_MESSAGE_ID: 'xam-last-message-id',
		HAS_MORE: 'xam-has-more',
	},
};

const DELIVERY_STATUS = {
	SENDING: 0,
	SENT: 1,
	READ: 2,
};

const STATUS_ICONS = {
	SENDING: '⏳',
	SENT: '✓',
	READ: '✓✓',
	PENDING: '🕐',
};

// ============================================================================
// DOM элементы
// ============================================================================

const elements = {
	status: document.getElementById('status'),
	userName: document.getElementById('userName'),
	userAddress: document.getElementById('userAddress'),
	userAvatar: document.getElementById('userAvatar'),
	userProfileHeader: document.getElementById('userProfileHeader'),
	sendBtn: document.getElementById('sendBtn'),
	attachBtn: document.getElementById('attachBtn'),
	fileInput: document.getElementById('fileInput'),
	attachedFiles: document.getElementById('attachedFiles'),
	messageInput: document.getElementById('messageInput'),
	messages: document.getElementById('messages'),
	messagesContainer: document.getElementById('messagesContainer'),
	peersList: document.getElementById('peersList'),
	connectDialog: document.getElementById('connectDialog'),
	settingsDialog: document.getElementById('settingsDialog'),
	userNameInput: document.getElementById('userNameInput'),
	serverAddressInput: document.getElementById('serverAddressInput'),
	serverStatus: document.getElementById('serverStatus'),
	confirmConnect: document.getElementById('confirmConnect'),
	cancelSettings: document.getElementById('cancelSettings'),
	saveSettings: document.getElementById('saveSettings'),
	settingsNameInput: document.getElementById('settingsNameInput'),
	settingsAvatarInput: document.getElementById('settingsAvatarInput'),
	loadMoreBtn: document.getElementById('loadMoreBtn'),
	loadMoreContainer: document.getElementById('loadMoreContainer'),
};

// ============================================================================
// Состояние приложения
// ============================================================================

const state = {
	connected: false,
	serverUrl: null,
	user: null,
	messages: [],
	peers: [],
	currentPeer: null,
	filteredMessages: [],
	onlineUsers: new Set(),
	lastMessageId: null,
	hasMoreMessages: true,
	isLoadingMessages: false,
};

let attachedFiles = [];
let serverClient = null;
let userSettings = { name: '', avatar: CONFIG.AVATAR_DEFAULT };

// ============================================================================
// Утилиты
// ============================================================================

/**
 * Экранирование HTML для безопасного отображения
 */
function escapeHtml(text) {
	const div = document.createElement('div');
	div.textContent = text;
	return div.innerHTML;
}

/**
 * Форматирование размера файла
 */
function formatFileSize(bytes) {
	if (bytes === 0) return '0 B';
	const k = 1024;
	const sizes = ['B', 'KB', 'MB', 'GB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Получение иконки файла по расширению
 */
function getFileIcon(filename) {
	const ext = filename.split('.').pop().toLowerCase();
	const icons = {
		pdf: '📄',
		doc: '📝',
		docx: '📝',
		xls: '📊',
		xlsx: '📊',
		ppt: '📊',
		pptx: '📊',
		txt: '📄',
		jpg: '🖼️',
		jpeg: '🖼️',
		png: '🖼️',
		gif: '🖼️',
		bmp: '🖼️',
		svg: '🖼️',
		mp3: '🎵',
		wav: '🎵',
		ogg: '🎵',
		mp4: '🎬',
		avi: '🎬',
		mkv: '🎬',
		mov: '🎬',
		zip: '📦',
		rar: '📦',
		'7z': '📦',
		tar: '📦',
		gz: '📦',
		exe: '⚙️',
		msi: '⚙️',
		deb: '⚙️',
		rpm: '⚙️',
		js: '📜',
		ts: '📜',
		py: '📜',
		java: '📜',
		cpp: '📜',
		c: '📜',
		h: '📜',
		html: '🌐',
		css: '🎨',
		json: '📋',
		xml: '📋',
		yaml: '📋',
		yml: '📋',
		md: '📝',
		rtf: '📄',
	};
	return icons[ext] || '📎';
}

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
	localStorage.setItem(CONFIG.STORAGE_KEYS.LAST_MESSAGE_ID, state.lastMessageId || '');
	localStorage.setItem(CONFIG.STORAGE_KEYS.HAS_MORE, state.hasMoreMessages.toString());
}

/**
 * Восстановление состояния пагинации
 */
function restorePaginationState() {
	const savedLastId = localStorage.getItem(CONFIG.STORAGE_KEYS.LAST_MESSAGE_ID);
	const savedHasMore = localStorage.getItem(CONFIG.STORAGE_KEYS.HAS_MORE);

	if (savedLastId && savedHasMore !== null && state.messages.length === 0) {
		state.lastMessageId = savedLastId;
		state.hasMoreMessages = savedHasMore === 'true';
		console.log(`📚 Восстановлена пагинация: lastMessageId=${state.lastMessageId}, hasMore=${state.hasMoreMessages}`);
	}
}

/**
 * Очистка состояния пагинации
 */
function clearPaginationState() {
	// Не сбрасываем lastMessageId - он нужен для пагинации
	// Сбрасываем только hasMoreMessages для новой загрузки
	state.hasMoreMessages = true;
	// localStorage не трогаем - он общий для всех чатов
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

	loadUserSettings();
	setupEventListeners();

	// Показываем диалог подключения
	setTimeout(() => {
		elements.connectDialog.showModal();
		elements.userNameInput.focus();
	}, 300);
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

	// Проверяем дубликаты
	const exists = state.messages.some((m) => m.id === msg.id);
	if (exists) return;

	// Если это наше сообщение, ищем локальное и заменяем
	if (isMine) {
		const localIndex = findLocalMessageIndex(msg);
		if (localIndex !== -1) {
			updateMessageWithReal(msg, localIndex);
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
	return state.messages.findIndex(
		(m) =>
			m.id.startsWith('local_') &&
			m.sender_id === state.user?.id &&
			m.text === msg.text &&
			Math.abs(m.timestamp - msg.timestamp) < CONFIG.LOCAL_MESSAGE_TTL
	);
}

/**
 * Обновление локального сообщения реальным
 */
function updateMessageWithReal(msg, localIndex) {
	msg.delivery_status = state.messages[localIndex].delivery_status;
	state.messages[localIndex] = msg;

	const filteredIndex = state.filteredMessages.findIndex((m) => m.id.startsWith('local_'));
	if (filteredIndex !== -1) {
		state.filteredMessages[filteredIndex] = msg;
	}

	renderMessages(!!state.currentPeer);
}

/**
 * Проверка: сообщение в текущем чате
 */
function isMessageInCurrentChat(msg) {
	return (
		(msg.sender_id === state.user?.id && msg.recipient_id === state.currentPeer) ||
		(msg.sender_id === state.currentPeer && (msg.recipient_id === state.user?.id || !msg.recipient_id))
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
		msg.delivery_status = data.status === 'read' ? DELIVERY_STATUS.READ : DELIVERY_STATUS.SENT;
		console.log(`🔄 Статус сообщения ${data.message_id}: ${oldStatus} → ${msg.delivery_status}`);

		updateFilteredMessage(msg);
		renderMessages(!!state.currentPeer);
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

	const oldScrollHeight = elements.messagesContainer.scrollHeight;
	const oldScrollTop = elements.messagesContainer.scrollTop;

	if (!beforeId) {
		// Первая загрузка - заменяем все сообщения
		state.messages = messages;
		// Сохраняем ID самого старого сообщения для пагинации
		state.lastMessageId = messages.length > 0 ? messages[0].id : null;
	} else {
		// Подгрузка старых - добавляем в начало
		state.messages = [...messages, ...state.messages];
		// Обновляем ID для следующей пагинации
		state.lastMessageId = nextBeforeId;
	}

	state.hasMoreMessages = hasMore;
	state.isLoadingMessages = false;

	savePaginationState();

	// Фильтруем для текущего чата
	if (state.currentPeer) {
		filterMessagesForCurrentPeer();
		renderMessages(true);

		// Сохраняем позицию прокрутки при загрузке старых сообщений
		if (beforeId) {
			const newScrollHeight = elements.messagesContainer.scrollHeight;
			elements.messagesContainer.scrollTop = oldScrollTop + (newScrollHeight - oldScrollHeight);
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
 * Обработка статуса онлайн
 */
function handleUserOnline(data) {
	if (data.online) {
		state.onlineUsers.add(data.user_id);
	} else {
		state.onlineUsers.delete(data.user_id);
	}
	renderPeers();
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
 */
async function connectToServer() {
	const name = elements.userNameInput.value.trim();
	const avatar = userSettings?.avatar || CONFIG.AVATAR_DEFAULT;
	const serverAddress = elements.serverAddressInput.value.trim();

	if (!name) {
		alert('Введите ваше имя');
		return;
	}

	try {
		elements.serverStatus.innerHTML =
			'<span style="color: var(--warning);">🔌 Подключение...</span>';
		elements.confirmConnect.disabled = true;

		// Если указан адрес сервера, подключаемся напрямую
		if (serverAddress) {
			const wsUrl = serverAddress.startsWith('ws://') 
				? `${serverAddress}/ws` 
				: `ws://${serverAddress}:8080/ws`;
			console.log('🔌 Подключение к указанному серверу:', wsUrl);
			await serverClient.connect(wsUrl);
		} else {
			// Автоматическое обнаружение
			await serverClient.connect();
		}

		const user = await serverClient.register(name, avatar);
		state.user = user;
		state.connected = true;

		updateUserProfile(user.name, 'В сети');
		updateStatusDisplay(true, 'В сети');

		restorePaginationState();

		if (!state.lastMessageId && state.messages.length === 0) {
			state.isLoadingMessages = true;
			updateLoadMoreButton();
			serverClient.getMessages(50, null);
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

	// Загружаем файлы если есть
	const filesData = filesToSend.length > 0 ? await uploadFiles(filesToSend) : [];

	// Ждём восстановления WebSocket после HTTP запросов
	if (filesToSend.length > 0) {
		await waitForWebSocket();
	}

	// Формируем сообщение
	const messageData = {
		id: localId,
		sender_id: state.user.id,
		sender_name: state.user.name,
		text: text || (filesData.length > 0 ? `📎 Файлов: ${filesData.length}` : ''),
		timestamp: Date.now() / 1000,
		delivery_status: DELIVERY_STATUS.SENDING,
		files: filesData,
		recipient_id: state.currentPeer,
	};

	console.log('📤 Отправка сообщения:', {
		id: localId,
		text,
		filesCount: filesData.length,
		files: filesData,
	});

	serverClient.sendMessageWithFiles(text, filesData, state.currentPeer);

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
 * Загрузка файлов на сервер
 */
async function uploadFiles(files) {
	const filesData = [];
	for (const file of files) {
		try {
			console.log('📁 Загрузка файла:', file.name);
			const fileResult = await serverClient.uploadFile(file);
			if (fileResult) {
				filesData.push({
					name: file.name,
					size: file.size,
					path: fileResult.path,
				});
			}
		} catch (error) {
			console.error('❌ Ошибка загрузки файла:', error);
		}
	}
	return filesData;
}

/**
 * Ожидание готовности WebSocket
 */
async function waitForWebSocket() {
	await new Promise((resolve) => setTimeout(resolve, 200));

	if (serverClient.ws?.readyState !== WebSocket.OPEN) {
		console.log('⚠️ WebSocket закрыт, ждём переподключения...');
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}
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
 * Загрузка списка контактов
 */
async function loadPeers() {
	try {
		const users = await serverClient.getUsers();
		state.peers = users.filter((u) => u.id !== state.user?.id);
		renderPeers();
	} catch (error) {
		console.error('❌ Загрузка пользователей:', error);
	}
}

/**
 * Рендеринг контактов
 */
function renderPeers() {
	if (!elements.peersList) return;

	elements.peersList.innerHTML = '';

	if (state.peers.length === 0) {
		elements.peersList.innerHTML =
			'<p style="padding: 20px; color: var(--text-tertiary); text-align: center;">Нет других пользователей</p>';
		return;
	}

	state.peers.forEach((peer) => {
		const item = createPeerElement(peer);
		elements.peersList.appendChild(item);
	});
}

/**
 * Создание элемента контакта
 */
function createPeerElement(peer) {
	const item = document.createElement('div');
	item.className = `peer-item ${state.currentPeer === peer.id ? 'active' : ''}`;
	item.dataset.userId = peer.id;
	item.dataset.userName = peer.name;
	item.style.cursor = 'pointer';

	const lastMsg = getLastMessageFromUser(peer.id);
	const isOnline = state.onlineUsers.has(peer.id);
	const peerAvatar = peer.avatar || CONFIG.AVATAR_DEFAULT;
	const timeStr = formatUserLastSeen(lastMsg, isOnline);

	item.innerHTML = `
		<span class="peer-icon">${peerAvatar}</span>
		<div class="peer-info">
			<div class="peer-name">${escapeHtml(peer.name)}</div>
			<div class="peer-address">ID: ${peer.id.slice(0, 8)}</div>
		</div>
		<span class="peer-time ${isOnline ? 'online' : 'offline'}" title="${timeStr}">
			${isOnline ? 'в сети' : 'не в сети'}
		</span>
	`;

	item.addEventListener('click', (e) => {
		e.stopPropagation();
		selectPeer(peer.id, peer.name);
	});

	return item;
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
 * Форматирование времени последней активности
 */
function formatUserLastSeen(lastMsg, isOnline) {
	if (isOnline) return 'в сети';

	if (!lastMsg) return 'давно не был(а)';

	const lastTime = new Date(lastMsg.timestamp * 1000);
	const now = new Date();
	const diff = now - lastTime;

	if (diff < 60000) return 'был(а) только что';
	if (diff < 3600000)
		return 'был(а) в ' + lastTime.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
	if (diff < 86400000)
		return 'был(а) ' + lastTime.toLocaleDateString('ru-RU', { day: 'numeric', month: 'numeric' });
	return 'был(а) ' + lastTime.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

/**
 * Выбор контакта
 */
function selectPeer(userId, userName) {
	state.currentPeer = userId;

	document.querySelectorAll('.peer-item').forEach((item) => {
		item.classList.toggle('active', item.dataset.userId === userId);
	});

	updateStatusDisplay(true, `Чат с ${userName}`);
	
	// Сбрасываем hasMoreMessages для возможности загрузки
	state.hasMoreMessages = true;
	
	// Фильтруем уже загруженные сообщения для этого чата
	filterMessagesForCurrentPeer();
	renderMessages(true);
	
	updateLoadMoreButton();

	// Отправляем READ ACK для всех непрочитанных сообщений
	markMessagesAsRead(userId);
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

	if (!state.lastMessageId) {
		return;
	}

	state.isLoadingMessages = true;
	updateLoadMoreButton();

	serverClient.getMessages(50, state.lastMessageId);
}

/**
 * Обновление кнопки загрузки сообщений
 */
function updateLoadMoreButton() {
	if (!elements.loadMoreBtn || !elements.loadMoreContainer) return;

	const shouldShow = state.currentPeer && state.hasMoreMessages && state.messages.length > 0;
	elements.loadMoreContainer.style.display = shouldShow ? 'flex' : 'none';

	if (elements.loadMoreBtn) {
		elements.loadMoreBtn.disabled = state.isLoadingMessages || !state.hasMoreMessages;
		elements.loadMoreBtn.textContent = state.isLoadingMessages ? 'Загрузка...' : 'Загрузить старые';
	}
}

// ============================================================================
// Рендеринг сообщений
// ============================================================================

/**
 * Рендеринг сообщений
 */
function renderMessages(useFiltered = false) {
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

	scrollToBottom();
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
		case DELIVERY_STATUS.SENDING:
			return STATUS_ICONS.SENDING;
		case DELIVERY_STATUS.SENT:
			return STATUS_ICONS.SENT;
		case DELIVERY_STATUS.READ:
			return STATUS_ICONS.READ;
		default:
			return STATUS_ICONS.PENDING;
	}
}

/**
 * Получение названия статуса
 */
function getStatusTitle(status) {
	switch (status) {
		case DELIVERY_STATUS.SENDING:
			return 'Отправка...';
		case DELIVERY_STATUS.SENT:
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
				 onclick="openFile('${escapeHtml(f.path || '')}', '${escapeHtml(f.name)}')">
				<span class="file-icon">${getFileIcon(f.name)}</span>
				<span class="file-info">
					<span class="file-name-row">
						<span class="file-name">${escapeHtml(f.name)}</span>
						<button class="file-download-btn"
								onclick="event.stopPropagation(); downloadFile('${escapeHtml(f.path || '')}', '${escapeHtml(f.name)}')"
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
	if (connected) {
		elements.status.textContent = `🟢 ${statusText}`;
		elements.status.style.color = 'var(--success)';
	} else {
		elements.status.textContent = '⚫ Не в сети';
		elements.status.style.color = 'var(--text-tertiary)';
	}
	updateSendButton();
}

/**
 * Обновление профиля пользователя
 */
function updateUserProfile(name, status) {
	const avatar = state.user?.avatar || userSettings?.avatar || CONFIG.AVATAR_DEFAULT;
	elements.userName.textContent = name || 'Не подключен';
	elements.userAddress.textContent = status || '--';
	elements.userAvatar.textContent = avatar;
}

/**
 * Прокрутка вниз
 */
function scrollToBottom() {
	elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;
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
	attachedFiles.splice(index, 1);
	renderAttachedFiles();
	updateSendButton();
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
		const fileUrl = filepath.startsWith('http')
			? filepath
			: `http://localhost:8080/api/files/download?path=${encodeURIComponent(filepath)}`;

		const response = await fetch(fileUrl);
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
		const fileUrl = filepath.startsWith('http')
			? filepath
			: `http://localhost:8080/api/files/download?path=${encodeURIComponent(filepath)}`;

		const response = await fetch(fileUrl);
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
	elements.status.addEventListener('click', () => {
		elements.connectDialog.showModal();
		elements.userNameInput.focus();
	});

	elements.confirmConnect.addEventListener('click', connectToServer);

	elements.userNameInput.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') connectToServer();
	});

	elements.userNameInput.addEventListener('input', () => {
		elements.confirmConnect.disabled = elements.userNameInput.value.trim().length === 0;
	});

	elements.serverAddressInput.addEventListener('input', () => {
		// При вводе адреса сервера показываем что будет использован ручной режим
		const addr = elements.serverAddressInput.value.trim();
		if (addr) {
			elements.serverStatus.innerHTML =
				`<span style="color: var(--text-secondary);">🔧 Будет использован сервер: ${addr}</span>`;
		} else {
			elements.serverStatus.innerHTML =
				'<span style="color: var(--text-secondary);">🔍 Поиск сервера...</span>';
		}
	});

	elements.sendBtn.addEventListener('click', sendMessage);
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

	if (elements.loadMoreBtn) {
		elements.loadMoreBtn.addEventListener('click', loadMoreMessages);
	}

	elements.userProfileHeader.addEventListener('click', openSettingsDialog);
	elements.cancelSettings.addEventListener('click', () => {
		elements.settingsDialog.close();
	});
	elements.saveSettings.addEventListener('click', saveSettings);
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
		attachedFiles.push(file);
	});
	elements.fileInput.value = '';
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
 * Экспорт для тестов
 */
if (typeof module !== 'undefined' && module.exports) {
	module.exports = { init, loadUserSettings };
}
