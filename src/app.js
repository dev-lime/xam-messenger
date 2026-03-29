// XAM Messenger - Клиент для работы с сервером (WebSocket + HTTP)

// DOM элементы
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
    serverStatus: document.getElementById('serverStatus'),
    confirmConnect: document.getElementById('confirmConnect'),
    cancelSettings: document.getElementById('cancelSettings'),
    saveSettings: document.getElementById('saveSettings'),
    settingsNameInput: document.getElementById('settingsNameInput'),
    settingsAvatarInput: document.getElementById('settingsAvatarInput'),
    loadMoreBtn: document.getElementById('loadMoreBtn'),
};

// Состояние
let state = {
    connected: false,
    serverUrl: null,
    user: null,
    messages: [],
    peers: [],
    currentPeer: null,
    filteredMessages: [],
    onlineUsers: new Set(), // ID пользователей онлайн
    messageOffset: 0,       // Текущий offset для пагинации
    messageLimit: 50,       // Количество сообщений за один запрос
    isLoadingMessages: false,
    hasMoreMessages: true,
};

// Прикреплённые файлы
let attachedFiles = [];

// Серверный клиент
let serverClient = null;

// Инициализация
async function init() {
    serverClient = new ServerClient();

    serverClient.on('message', handleNewMessage);
    serverClient.on('ack', handleAck);
    serverClient.on('messages', handleMessages);
    serverClient.on('user_online', handleUserOnline);

    setupEventListeners();

    // Показываем диалог подключения
    setTimeout(() => {
        elements.connectDialog.showModal();
        elements.userNameInput.focus();
    }, 300);
}

// Обработка нового сообщения
function handleNewMessage(msg) {
    console.log('📩 Новое сообщение:', {
        id: msg.id,
        text: msg.text,
        files: msg.files,
        filesCount: msg.files?.length,
        sender_id: msg.sender_id
    });

    const isForMe = msg.recipient_id === state.user?.id || !msg.recipient_id;
    const isMine = msg.sender_id === state.user?.id;

    // Проверяем дубликаты
    const exists = state.messages.some(m => m.id === msg.id);
    if (exists) return;

    // Если это наше сообщение (от того же sender_id), ищем локальное сообщение и заменяем его
    if (isMine) {
        const localMsgIndex = state.messages.findIndex(m => 
            m.id.startsWith('local_') && 
            m.sender_id === state.user?.id &&
            m.text === msg.text &&
            Math.abs(m.timestamp - msg.timestamp) < 5 // В пределах 5 секунд
        );

        if (localMsgIndex !== -1) {
            // Сохраняем delivery_status из локального сообщения
            msg.delivery_status = state.messages[localMsgIndex].delivery_status;
            // Заменяем локальное сообщение реальным
            state.messages[localMsgIndex] = msg;
            
            // Обновляем отфильтрованные сообщения
            const filteredIndex = state.filteredMessages.findIndex(m => m.id.startsWith('local_'));
            if (filteredIndex !== -1) {
                state.filteredMessages[filteredIndex] = msg;
            }
            
            renderMessages(!!state.currentPeer);
            return;
        }
    }

    state.messages.push(msg);

    // Обновляем отфильтрованные сообщения если выбран чат
    if (state.currentPeer) {
        const isInCurrentChat = (m => {
            return (m.sender_id === state.user?.id && m.recipient_id === state.currentPeer) ||
                   (m.sender_id === state.currentPeer && (m.recipient_id === state.user?.id || !m.recipient_id));
        })(msg);

        if (isInCurrentChat) {
            state.filteredMessages.push(msg);
            renderMessages(true);
            
            // Если получили сообщение в открытом чате — отправляем READ ACK
            if (!isMine) {
                serverClient.sendAck(msg.id, 'read');
                msg.delivery_status = 2;
            }
        }
    } else {
        renderMessages();
    }

    // Обновляем список пользователей
    if (!isMine) {
        const existingPeer = state.peers.find(p => p.id === msg.sender_id);
        if (!existingPeer) {
            loadPeers();
        } else {
            renderPeers();
        }
    }
}

// Обработка ACK
function handleAck(data) {
    console.log('📨 ACK получен:', data);
    
    // Игнорируем ACK которые мы отправили сами (когда мы прочитали чужое сообщение)
    if (data.sender_id === state.user?.id) {
        console.log('⚠️ Игнорируем свой ACK');
        return;
    }

    // Ищем сообщение по реальному ID
    let msg = state.messages.find(m => m.id === data.message_id);
    
    // Если не нашли, ищем по локальному ID (для отправителя)
    if (!msg) {
        // Ищем сообщение которое было отправлено недавно (в пределах 10 секунд)
        const localMsg = state.messages.find(m => 
            m.id.startsWith('local_') &&
            m.sender_id === state.user?.id &&
            Math.abs(Date.now()/1000 - m.timestamp) < 10
        );
        
        // Если нашли локальное сообщение, обновляем его ID на реальный
        if (localMsg) {
            console.log('🔄 Найдено локальное сообщение, обновляем ID:', localMsg.id, '→', data.message_id);
            localMsg.id = data.message_id;
            msg = localMsg;
        }
    }
    
    if (msg) {
        const oldStatus = msg.delivery_status;
        msg.delivery_status = data.status === 'read' ? 2 : 1;
        console.log(`🔄 Статус сообщения ${data.message_id}: ${oldStatus} → ${msg.delivery_status}`);

        const filteredMsg = state.filteredMessages?.find(m => m.id === data.message_id || m.id.startsWith('local_'));
        if (filteredMsg) {
            filteredMsg.delivery_status = msg.delivery_status;
            filteredMsg.id = data.message_id;
        }
        renderMessages(!!state.currentPeer);
    } else {
        console.log('⚠️ Сообщение не найдено для ACK:', data.message_id);
    }
}

// Обработка истории сообщений
function handleMessages(data) {
    // Поддержка нового формата с пагинацией
    const messages = Array.isArray(data) ? data : data.messages;
    const offset = data.offset || 0;
    const hasMore = data.has_more !== undefined ? data.has_more : offset > 0;
    
    if (offset === 0) {
        // Первая загрузка - заменяем все сообщения
        state.messages = messages;
        state.messageOffset = messages.length;
    } else {
        // Подгрузка старых - добавляем в начало
        state.messages = [...messages, ...state.messages];
        state.messageOffset += messages.length;
    }
    
    state.hasMoreMessages = hasMore && messages.length > 0;
    state.isLoadingMessages = false;
    
    log(`📚 Загружено сообщений: ${messages.length}, всего: ${state.messages.length}, offset: ${state.messageOffset}`);

    // Фильтруем для текущего чата
    if (state.currentPeer) {
        state.filteredMessages = state.messages.filter(m => {
            return (m.sender_id === state.user?.id && m.recipient_id === state.currentPeer) ||
                   (m.sender_id === state.currentPeer && (m.recipient_id === state.user?.id || !m.recipient_id));
        });
        renderMessages(true);
    } else {
        renderMessages();
    }
    
    // Обновляем видимость кнопки загрузки
    updateLoadMoreButton();
}

// Обработка статуса онлайн
function handleUserOnline(data) {
    if (data.online) {
        state.onlineUsers.add(data.user_id);
    } else {
        state.onlineUsers.delete(data.user_id);
    }
    // Обновляем список контактов
    renderPeers();
}

// Подключение к серверу
async function connectToServer() {
    const name = elements.userNameInput.value.trim();

    if (!name) {
        alert('Введите ваше имя');
        return;
    }

    try {
        elements.serverStatus.innerHTML = '<span style="color: var(--warning);">🔌 Подключение...</span>';
        elements.confirmConnect.disabled = true;

        // Находим и подключаемся к серверу
        await serverClient.connect();

        // Регистрируемся
        const user = await serverClient.register(name);
        state.user = user;
        state.connected = true;

        // Обновляем UI
        updateUserProfile(user.name, 'В сети');
        updateStatusDisplay(true, 'В сети');

        // Сбрасываем пагинацию и загружаем историю
        state.messageOffset = 0;
        state.hasMoreMessages = true;
        serverClient.getMessages(state.messageLimit, 0);
        await loadPeers();

        // renderPeers() будет вызван автоматически когда придут события user_online
        setTimeout(() => {
            renderPeers();
        }, 500);

        elements.serverStatus.innerHTML = '<span style="color: var(--success);">✅ Подключено</span>';

        setTimeout(() => {
            elements.connectDialog.close();
        }, 500);
    } catch (error) {
        console.error('❌ Ошибка подключения:', error);
        elements.serverStatus.innerHTML = '<span style="color: var(--error);">❌ Ошибка подключения<br><small>Проверьте что сервер запущен</small></span>';
        elements.confirmConnect.disabled = false;
    }
}

// Отправка сообщения
async function sendMessage() {
    const text = elements.messageInput.value.trim();
    const filesToSend = [...attachedFiles];

    if (!text && filesToSend.length === 0) return;
    if (!state.connected) {
        alert('Нет подключения к серверу');
        return;
    }

    // Генерируем локальный ID для отслеживания
    const localId = 'local_' + Date.now();
    const filesData = [];

    // Если есть файлы, сначала загружаем их
    if (filesToSend.length > 0) {
        for (const file of filesToSend) {
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
        
        // Ждём чтобы WebSocket успел восстановиться после HTTP запроса
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Проверяем что WebSocket ещё открыт
        if (serverClient.ws?.readyState !== WebSocket.OPEN) {
            console.log('⚠️ WebSocket закрыт, ждём переподключения...');
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    // Отправляем единое сообщение с текстом и файлами
    const messageData = {
        id: localId,
        sender_id: state.user.id,
        sender_name: state.user.name,
        text: text || (filesData.length > 0 ? `📎 Файлов: ${filesData.length}` : ''),
        timestamp: Date.now() / 1000,
        delivery_status: 0,
        files: filesData,
        recipient_id: state.currentPeer,
    };

    console.log('📤 Отправка сообщения:', {
        id: localId,
        text,
        filesCount: filesData.length,
        files: filesData
    });
    
    console.log('🔌 WebSocket readyState:', serverClient.ws?.readyState);
    console.log('🔌 connected:', state.connected);
    
    serverClient.sendMessageWithFiles(text, filesData, state.currentPeer);
    
    console.log('✅ Сообщение отправлено в WebSocket');

    // Добавляем локально
    state.messages.push(messageData);

    if (state.currentPeer) {
        state.filteredMessages.push(messageData);
        renderMessages(true);
    } else {
        renderMessages();
    }

    // Очистка
    elements.messageInput.value = '';
    attachedFiles = [];
    renderAttachedFiles();
    updateSendButton();
}

// Загрузка списка контактов
async function loadPeers() {
    try {
        const users = await serverClient.getUsers();
        state.peers = users.filter(u => u.id !== state.user?.id);
        renderPeers();
    } catch (error) {
        console.error('❌ Загрузка пользователей:', error);
    }
}

// Загрузка старых сообщений
async function loadMoreMessages() {
    if (state.isLoadingMessages || !state.hasMoreMessages) return;
    
    state.isLoadingMessages = true;
    updateLoadMoreButton();
    
    log(`📚 Загрузка старых сообщений (offset: ${state.messageOffset})`);
    serverClient.getMessages(state.messageLimit, state.messageOffset);
}

// Обновление кнопки загрузки
function updateLoadMoreButton() {
    if (!elements.loadMoreBtn || !elements.loadMoreContainer) return;
    
    const shouldShow = state.hasMoreMessages && state.currentPeer;
    elements.loadMoreContainer.style.display = shouldShow ? 'block' : 'none';
    
    if (elements.loadMoreBtn) {
        elements.loadMoreBtn.disabled = state.isLoadingMessages || !state.hasMoreMessages;
        elements.loadMoreBtn.textContent = state.isLoadingMessages ? '⏳ Загрузка...' : '⏳ Загрузить старые сообщения';
    }
}

// Рендеринг контактов
function renderPeers() {
    if (!elements.peersList) return;

    elements.peersList.innerHTML = '';

    if (state.peers.length === 0) {
        elements.peersList.innerHTML = '<p style="padding: 20px; color: var(--text-tertiary); text-align: center;">Нет других пользователей</p>';
        return;
    }

    state.peers.forEach((peer) => {
        const item = document.createElement('div');
        item.className = `peer-item ${state.currentPeer === peer.id ? 'active' : ''}`;
        item.dataset.userId = peer.id;
        item.dataset.userName = peer.name;
        item.style.cursor = 'pointer';

        // Находим последнее сообщение от этого пользователя
        const lastMsg = state.messages
            .filter(m => m.sender_id === peer.id)
            .sort((a, b) => b.timestamp - a.timestamp)[0];

        // Проверяем онлайн статус
        const isOnline = state.onlineUsers.has(peer.id);

        // Форматируем время
        let timeStr = '';
        if (isOnline) {
            timeStr = 'в сети';
        } else if (lastMsg) {
            const lastTime = new Date(lastMsg.timestamp * 1000);
            const now = new Date();
            const diff = now - lastTime;

            if (diff < 60000) { // < 1 минуты
                timeStr = 'был(а) только что';
            } else if (diff < 3600000) { // < 1 часа
                timeStr = 'был(а) в ' + lastTime.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
            } else if (diff < 86400000) { // < 1 дня
                timeStr = 'был(а) ' + lastTime.toLocaleDateString('ru-RU', { day: 'numeric', month: 'numeric' });
            } else {
                timeStr = 'был(а) ' + lastTime.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
            }
        } else {
            timeStr = 'давно не был(а)';
        }

        item.innerHTML = `
            <span class="peer-icon">👤</span>
            <div class="peer-info">
                <div class="peer-name">${escapeHtml(peer.name)}</div>
                <div class="peer-address">ID: ${peer.id.slice(0, 8)}</div>
            </div>
            <span class="peer-time ${isOnline ? 'online' : 'offline'}" title="${timeStr}">${isOnline ? 'в сети' : 'не в сети'}</span>
        `;

        item.addEventListener('click', (e) => {
            e.stopPropagation();
            selectPeer(peer.id, peer.name);
        });

        elements.peersList.appendChild(item);
    });
}

// Выбор контакта
function selectPeer(userId, userName) {
    state.currentPeer = userId;

    document.querySelectorAll('.peer-item').forEach(item => {
        item.classList.toggle('active', item.dataset.userId === userId);
    });

    updateStatusDisplay(true, `Чат с ${userName}`);
    
    // Сбрасываем пагинацию при выборе нового чата
    state.messageOffset = 0;
    state.hasMoreMessages = true;
    loadMessagesForPeer(userId);
    
    // Обновляем кнопку загрузки
    updateLoadMoreButton();

    // Отправляем READ ACK для всех непрочитанных сообщений от этого пользователя
    const unreadIds = state.messages
        .filter(m => m.sender_id === userId && m.delivery_status < 2)
        .map(m => m.id);

    if (unreadIds.length > 0) {
        unreadIds.forEach(id => {
            serverClient.sendAck(id, 'read');
            // Обновляем локально
            const msg = state.messages.find(m => m.id === id);
            if (msg) msg.delivery_status = 2;
        });
        const filteredIds = state.filteredMessages
            .filter(m => unreadIds.includes(m.id))
            .map(m => m.id);
        filteredIds.forEach(id => {
            const msg = state.filteredMessages.find(m => m.id === id);
            if (msg) msg.delivery_status = 2;
        });
        renderMessages(true);
    }
}

// Загрузка сообщений для выбранного пира
function loadMessagesForPeer(userId) {
    state.filteredMessages = state.messages.filter(m => {
        return (m.sender_id === state.user?.id && m.recipient_id === userId) ||
               (m.sender_id === userId && (m.recipient_id === state.user?.id || !m.recipient_id));
    });
    renderMessages(true);
}

// Рендеринг сообщений
function renderMessages(useFiltered = false) {
    elements.messages.innerHTML = '';

    // Если нет выбранного чата, показываем пустое состояние и скрываем ввод
    if (!state.currentPeer) {
        elements.messages.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--text-tertiary); text-align: center; padding: 40px;">
                <div style="font-size: 18px; margin-bottom: 10px;">Выберите чат</div>
                <div style="font-size: 14px;">Выберите контакт из списка слева чтобы начать общение</div>
            </div>
        `;
        // Скрываем панель ввода
        if (elements.messageInput) {
            elements.messageInput.closest('.input-area').style.display = 'none';
        }
        return;
    }

    // Показываем панель ввода когда чат выбран
    if (elements.messageInput) {
        elements.messageInput.closest('.input-area').style.display = 'flex';
    }

    const messagesToRender = (useFiltered && state.filteredMessages) ? state.filteredMessages : state.messages;

    if (messagesToRender.length === 0) {
        elements.messages.innerHTML = '<p style="text-align: center; color: var(--text-tertiary); padding: 20px;">Нет сообщений</p>';
        return;
    }

    let lastDate = null;

    messagesToRender.forEach(msg => {
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

// Создание элемента сообщения
function createMessageElement(msg) {
    const div = document.createElement('div');
    const isMine = msg.sender_id === state.user?.id;
    div.className = `message ${isMine ? 'mine' : 'theirs'}`;

    const time = new Date(msg.timestamp * 1000).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

    if (isMine) {
        let statusIcon = '🕐';
        let statusTitle = 'Отправлено';

        if (msg.delivery_status === 1) {
            statusIcon = '✓';
            statusTitle = 'Доставлено';
        } else if (msg.delivery_status === 2) {
            statusIcon = '✓✓';
            statusTitle = 'Прочитано';
        } else if (msg.delivery_status === 0) {
            statusIcon = '⏳';
            statusTitle = 'Отправка...';
        }

        if (msg.files && msg.files.length > 0) {
            const filesHtml = msg.files.map(f => `
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
            `).join('');

            div.innerHTML = `
                ${msg.text ? `<div class="message-text">${escapeHtml(msg.text)}</div>` : ''}
                <div class="files-container">
                    ${filesHtml}
                </div>
                <div class="message-meta">
                    <span class="read-status" title="${statusTitle}">${statusIcon}</span>
                    <span>${time}</span>
                </div>
            `;
        } else {
            div.innerHTML = `
                <div class="message-text">${escapeHtml(msg.text)}</div>
                <div class="message-meta">
                    <span class="read-status" title="${statusTitle}">${statusIcon}</span>
                    <span>${time}</span>
                </div>
            `;
        }
    } else {
        if (msg.files && msg.files.length > 0) {
            const filesHtml = msg.files.map(f => `
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
            `).join('');

            div.innerHTML = `
                <div class="message-sender">👤 ${escapeHtml(msg.sender_name)}</div>
                ${msg.text ? `<div class="message-text">${escapeHtml(msg.text)}</div>` : ''}
                <div class="files-container">
                    ${filesHtml}
                </div>
                <div class="message-meta">${time}</div>
            `;
        } else {
            div.innerHTML = `
                <div class="message-sender">👤 ${escapeHtml(msg.sender_name)}</div>
                <div class="message-text">${escapeHtml(msg.text)}</div>
                <div class="message-meta">${time}</div>
            `;
        }
    }

    return div;
}

// Обновление статуса
function updateStatusDisplay(connected, statusText) {
    if (connected) {
        elements.status.textContent = `🟢 ${statusText}`;
        elements.status.style.color = 'var(--success)';
    } else {
        elements.status.textContent = `⚫ Не в сети`;
        elements.status.style.color = 'var(--text-tertiary)';
    }
    updateSendButton();
}

// Обновление профиля
function updateUserProfile(name, status) {
    const avatar = userSettings?.avatar || '👤';
    elements.userName.textContent = name || 'Не подключен';
    elements.userAddress.textContent = status || '--';
    elements.userAvatar.textContent = avatar;
}

// Прокрутка вниз
function scrollToBottom() {
    elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;
}

// Экранирование HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Форматирование размера файла
function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// Иконка файла
function getFileIcon(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const icons = {
        'pdf': '📄',
        'doc': '📝', 'docx': '📝',
        'xls': '📊', 'xlsx': '📊',
        'ppt': '📊', 'pptx': '📊',
        'txt': '📄',
        'jpg': '🖼️', 'jpeg': '🖼️', 'png': '🖼️', 'gif': '🖼️', 'bmp': '🖼️', 'svg': '🖼️',
        'mp3': '🎵', 'wav': '🎵', 'ogg': '🎵',
        'mp4': '🎬', 'avi': '🎬', 'mkv': '🎬', 'mov': '🎬',
        'zip': '📦', 'rar': '📦', '7z': '📦', 'tar': '📦', 'gz': '📦',
        'exe': '⚙️', 'msi': '⚙️', 'deb': '⚙️', 'rpm': '⚙️',
        'js': '📜', 'ts': '📜', 'py': '📜', 'java': '📜', 'cpp': '📜', 'c': '📜', 'h': '📜',
        'html': '🌐', 'css': '🎨', 'json': '📋', 'xml': '📋', 'yaml': '📋', 'yml': '📋',
        'md': '📝', 'rtf': '📄',
    };
    return icons[ext] || '📎';
}

// Открытие файла — скачивание и открытие системой
window.openFile = async (filepath, filename) => {
    if (!filepath) {
        alert('Путь к файлу не указан');
        return;
    }

    try {
        const fileUrl = filepath.startsWith('http')
            ? filepath
            : `http://localhost:8080/api/files/download?path=${encodeURIComponent(filepath)}`;

        // Скачиваем файл
        const response = await fetch(fileUrl);
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        
        // Создаём временную ссылку и кликаем для скачивания
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        
        // Очищаем
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        
        log(`📁 Файл скачан: ${filename}`);
    } catch (error) {
        alert(`Не удалось открыть файл: ${error.message}`);
    }
};

// Скачивание файла
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

// Отображение прикреплённых файлов
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

// Удаление файла
window.removeAttachedFile = (event, index) => {
    event.stopPropagation();
    attachedFiles.splice(index, 1);
    renderAttachedFiles();
};

// Обновление кнопки отправки
function updateSendButton() {
    const hasText = elements.messageInput.value.trim().length > 0;
    const hasFiles = attachedFiles.length > 0;
    elements.sendBtn.disabled = (!hasText && !hasFiles) || !state.connected;
}

// Настройка событий
function setupEventListeners() {
    elements.status.addEventListener('click', () => {
        elements.connectDialog.showModal();
        elements.userNameInput.focus();
    });

    elements.confirmConnect.addEventListener('click', connectToServer);

    elements.userNameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            connectToServer();
        }
    });

    elements.userNameInput.addEventListener('input', () => {
        elements.confirmConnect.disabled = elements.userNameInput.value.trim().length === 0;
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

    elements.fileInput.addEventListener('change', (e) => {
        const files = Array.from(e.target.files);
        files.forEach(file => {
            if (file.size > 100 * 1024 * 1024) {
                alert(`Файл "${file.name}" слишком большой (макс. 100MB)`);
                return;
            }
            attachedFiles.push(file);
        });
        elements.fileInput.value = '';
        renderAttachedFiles();
        updateSendButton();
    });

    // Обработчик кнопки "Загрузить старые сообщения"
    if (elements.loadMoreBtn) {
        elements.loadMoreBtn.addEventListener('click', loadMoreMessages);
    }

    elements.userProfileHeader.addEventListener('click', () => {
        elements.settingsNameInput.value = state.user?.name || '';
        elements.settingsAvatarInput.value = userSettings?.avatar || '👤';
        elements.settingsDialog.showModal();
    });

    elements.cancelSettings.addEventListener('click', () => {
        elements.settingsDialog.close();
    });

    elements.saveSettings.addEventListener('click', () => {
        const name = elements.settingsNameInput.value.trim();
        const avatar = elements.settingsAvatarInput.value.trim() || '👤';
        if (name && state.user) {
            state.user.name = name;
            userSettings = { name, avatar };
            updateUserProfile(name, elements.userAddress.textContent);
        }
        elements.settingsDialog.close();
    });
}

// Настройки пользователя
let userSettings = {
    name: '',
    avatar: '👤',
};

// Загрузка настроек
function loadUserSettings() {
    const saved = localStorage.getItem('xam-user-settings');
    if (saved) {
        try {
            userSettings = JSON.parse(saved);
        } catch (e) {
            console.warn('Failed to load user settings');
        }
    }
}

// Сохранение настроек
function saveUserSettings() {
    localStorage.setItem('xam-user-settings', JSON.stringify(userSettings));
}

// Запуск
loadUserSettings();
init();
