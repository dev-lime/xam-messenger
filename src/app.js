const { invoke } = window.__TAURI__ ? window.__TAURI__.core : { invoke: async () => {} };

// Состояние приложения
let state = {
    connected: false,
    peerAddress: null,
    myPort: null,
    myName: '',
    currentPeer: null,
    messages: [],
    peers: [],
};

// DOM элементы
const elements = {
    status: document.getElementById('status'),
    userName: document.getElementById('userName'),
    userAddress: document.getElementById('userAddress'),
    userAvatar: document.getElementById('userAvatar'),
    userProfileHeader: document.getElementById('userProfileHeader'),
    connectBtn: document.getElementById('connectBtn'),
    sendBtn: document.getElementById('sendBtn'),
    attachBtn: document.getElementById('attachBtn'),
    fileInput: document.getElementById('fileInput'),
    messageInput: document.getElementById('messageInput'),
    messages: document.getElementById('messages'),
    messagesContainer: document.getElementById('messagesContainer'),
    peersList: document.getElementById('peersList'),
    connectDialog: document.getElementById('connectDialog'),
    settingsDialog: document.getElementById('settingsDialog'),
    portInput: document.getElementById('portInput'),
    ipInput: document.getElementById('ipInput'),
    cancelConnect: document.getElementById('cancelConnect'),
    confirmConnect: document.getElementById('confirmConnect'),
    cancelSettings: document.getElementById('cancelSettings'),
    saveSettings: document.getElementById('saveSettings'),
    settingsNameInput: document.getElementById('settingsNameInput'),
    settingsAvatarInput: document.getElementById('settingsAvatarInput'),
};

// Настройки пользователя
let userSettings = {
    name: '',
    avatar: '👤',
};

// Загружаем настройки из localStorage
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

// Сохраняем настройки в localStorage
function saveUserSettings() {
    localStorage.setItem('xam-user-settings', JSON.stringify(userSettings));
}

// Инициализация
async function init() {
    // Загружаем настройки пользователя
    loadUserSettings();

    try {
        await invoke('init_app');
        await loadPeers();
        await updateStatus();
    } catch (error) {
        console.error('Failed to initialize:', error);
    }

    setupEventListeners();
    
    // Периодическая проверка новых сообщений
    setInterval(checkNewMessages, 1000);
}

// Загрузка списка контактов
async function loadPeers() {
    try {
        const peers = await invoke('get_peers');
        state.peers = peers;
        renderPeers();
    } catch (error) {
        console.error('Failed to load peers:', error);
    }
}

// Рендеринг списка контактов
function renderPeers() {
    elements.peersList.innerHTML = '';

    if (state.peers.length === 0) {
        elements.peersList.innerHTML = '<p style="padding: 20px; color: var(--text-tertiary); text-align: center;">Нет контактов</p>';
        return;
    }

    state.peers.forEach(peer => {
        const item = document.createElement('div');
        item.className = `peer-item ${state.currentPeer === peer.address ? 'active' : ''}`;
        item.dataset.address = peer.address;

        // last_message приходит как timestamp в секундах
        const time = peer.last_message > 0 ? new Date(peer.last_message * 1000) : new Date();
        const timeStr = time.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

        item.innerHTML = `
            <span class="peer-icon">👤</span>
            <div class="peer-info">
                <div class="peer-name">${escapeHtml(peer.name)}</div>
                <div class="peer-address">${escapeHtml(peer.address)}</div>
            </div>
            <span class="peer-time">${timeStr}</span>
        `;

        item.addEventListener('click', () => selectPeer(peer.address));
        elements.peersList.appendChild(item);
    });
}

// Выбор контакта
async function selectPeer(address) {
    state.currentPeer = address;
    state.peerAddress = address;

    // Обновляем активный класс
    document.querySelectorAll('.peer-item').forEach(item => {
        item.classList.toggle('active', item.dataset.address === address);
    });

    // Загружаем сообщения
    await loadMessages(address);

    // Подключаемся если ещё не подключены
    if (!state.connected) {
        try {
            await invoke('connect_to_peer', { peerAddress: address });
            updateStatusDisplay(true, address);
        } catch (error) {
            console.error('Failed to connect:', error);
        }
    }
}

// Загрузка сообщений
async function loadMessages(peerAddress) {
    console.log('📂 Загрузка сообщений для:', peerAddress);
    
    try {
        const messages = await invoke('get_messages', { peerAddress });
        console.log('📚 Загружено сообщений:', messages.length);
        
        state.messages = messages;
        
        // Если peer_address не установлен, устанавливаем его
        if (!state.peerAddress && peerAddress) {
            state.peerAddress = peerAddress;
            try {
                await invoke('set_peer_address', { peerAddress });
            } catch (e) {
                console.warn('Failed to set peer_address:', e);
            }
        }
        
        // Отправляем ACK для непрочитанных сообщений (✓ → ✓✓)
        const unreadIds = messages
            .filter(m => !m.is_mine && m.delivery_status < 2)
            .map(m => m.id);
        
        if (unreadIds.length > 0) {
            console.log('📤 Отправка ACK (прочитано) для', unreadIds.length, 'сообщений');
            try {
                await invoke('mark_read', { peerAddress, messageIds: unreadIds });
                await invoke('send_ack', { peerAddress, messageIds: unreadIds });
                
                // Обновляем статус локально
                unreadIds.forEach(id => {
                    const msg = state.messages.find(m => m.id === id);
                    if (msg) msg.delivery_status = 2; // ✓✓
                });
            } catch (e) {
                console.warn('Failed to send read ACK:', e);
            }
        }
        
        renderMessages();
        
        // Обновляем статус - показываем что подключены
        updateStatusDisplay(true, peerAddress);
    } catch (error) {
        console.error('❌ Ошибка загрузки сообщений:', error);
    }
}

// Рендеринг сообщений
function renderMessages() {
    console.log('🎨 Рендеринг сообщений:', state.messages.length);
    
    elements.messages.innerHTML = '';

    if (state.messages.length === 0) {
        elements.messages.innerHTML = '<p style="text-align: center; color: var(--text-tertiary); padding: 20px;">Нет сообщений</p>';
        return;
    }

    state.messages.forEach(msg => {
        const messageEl = createMessageElement(msg);
        elements.messages.appendChild(messageEl);
    });

    scrollToBottom();
    console.log('✅ Сообщения отрендерены');
}

// Создание элемента сообщения
function createMessageElement(msg) {
    const div = document.createElement('div');
    div.className = `message ${msg.is_mine ? 'mine' : msg.sender === '📢' ? 'system' : 'theirs'}`;

    const time = new Date(msg.timestamp * 1000).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

    if (msg.sender === '📢') {
        // Системное сообщение
        div.innerHTML = `
            <div class="message-text">${escapeHtml(msg.text)}</div>
            <div class="message-meta">${time}</div>
        `;
    } else if (msg.is_mine) {
        // Своё сообщение с галочками
        let statusIcon = '⏳';
        let statusTitle = 'Отправлено';
        
        if (msg.delivery_status === 1) {
            statusIcon = '✓';
            statusTitle = 'Доставлено';
        } else if (msg.delivery_status === 2) {
            statusIcon = '✓✓';
            statusTitle = 'Прочитано';
        }
        
        div.innerHTML = `
            <div class="message-text">${escapeHtml(msg.text)}</div>
            <div class="message-meta">
                <span class="read-status" title="${statusTitle}">${statusIcon}</span>
                <span>${time}</span>
            </div>
        `;
    } else {
        // Чужое сообщение
        div.innerHTML = `
            <div class="message-sender">👤 ${escapeHtml(msg.sender)}</div>
            <div class="message-text">${escapeHtml(msg.text)}</div>
            <div class="message-meta">${time}</div>
        `;
    }

    return div;
}

// Отправка сообщения
async function sendMessage() {
    const text = elements.messageInput.value.trim();
    const peerAddress = state.peerAddress || state.currentPeer;
    
    if (!text || !peerAddress) {
        console.log('❌ Не отправлено: text=', !!text, 'peerAddress=', peerAddress);
        return;
    }
    
    console.log('📤 Отправка сообщения:', { text, peerAddress });

    try {
        await invoke('send_message', {
            peerAddress: peerAddress,
            text: text,
        });
        console.log('✅ Сообщение отправлено');

        // Добавляем сообщение локально
        state.messages.push({
            id: Date.now().toString(),
            text: text,
            is_mine: true,
            timestamp: Math.floor(Date.now() / 1000),
            sender: state.myName,
            is_read: false,
        });

        renderMessages();
        elements.messageInput.value = '';
        updateSendButton();
    } catch (error) {
        console.error('❌ Ошибка отправки:', error);
        alert('Ошибка отправки: ' + error);
    }
}

// Обновление статуса
async function updateStatus() {
    try {
        const status = await invoke('get_connection_status');
        state.connected = status.connected;
        state.peerAddress = status.peer_address;
        state.myPort = status.my_port;
        state.myName = status.my_name;

        updateStatusDisplay(status.connected, status.peer_address);
        updateUserProfile(status.my_name, status.my_port);
    } catch (error) {
        console.error('Failed to get status:', error);
    }
}

function updateStatusDisplay(connected, peerAddress) {
    if (connected && peerAddress) {
        elements.status.textContent = `🟢 Подключен к ${peerAddress}`;
        elements.status.style.color = 'var(--success)';
    } else if (connected) {
        elements.status.textContent = `🟡 Ожидание подключения`;
        elements.status.style.color = 'var(--warning)';
    } else {
        elements.status.textContent = `⚫ Не подключен`;
        elements.status.style.color = 'var(--text-tertiary)';
    }
    updateSendButton();
}

function updateUserProfile(name, address) {
    // Показываем данные текущего пользователя (не собеседника!)
    const displayName = userSettings.name || name || 'Не подключен';
    const avatar = userSettings.avatar || '👤';
    
    elements.userName.textContent = displayName;
    elements.userAddress.textContent = address ? `:${address}` : '--';
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

// Обработчики событий
function setupEventListeners() {
    // Кнопка подключения
    elements.connectBtn.addEventListener('click', () => {
        elements.connectDialog.showModal();
        elements.portInput.focus();
    });

    // Отмена подключения
    elements.cancelConnect.addEventListener('click', () => {
        elements.connectDialog.close();
    });
    
    // Enter в диалоге подключения
    elements.portInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            elements.ipInput.focus();
        }
    });
    
    elements.ipInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            elements.confirmConnect.click();
        }
    });

    // Подтверждение подключения
    elements.confirmConnect.addEventListener('click', async () => {
        const port = elements.portInput.value.trim();
        const ip = elements.ipInput.value.trim();

        if (!port) {
            alert('Укажите порт');
            return;
        }

        try {
            await invoke('start_server', { port, name: userSettings.name });

            state.myPort = port;
            state.myName = userSettings.name;

            // Обновляем профиль пользователя
            updateUserProfile(userSettings.name, port);

            if (ip) {
                state.currentPeer = ip;
                state.peerAddress = ip;
                await loadMessages(ip);
                updateStatusDisplay(true, ip);
            } else {
                updateStatusDisplay(true, null);
            }

            elements.connectDialog.close();
            await loadPeers();
            updateSendButton();
        } catch (error) {
            alert('Ошибка: ' + error);
        }
    });

    // Отправка сообщения
    elements.sendBtn.addEventListener('click', sendMessage);

    // Ввод сообщения
    elements.messageInput.addEventListener('input', () => {
        updateSendButton();
    });

    elements.messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // Периодическое обновление статуса
    setInterval(updateStatus, 5000);
    
    // Настройки профиля - клик по аватару/имени
    elements.userProfileHeader.addEventListener('click', () => {
        elements.settingsNameInput.value = userSettings.name;
        elements.settingsAvatarInput.value = userSettings.avatar;
        elements.settingsDialog.showModal();
        elements.settingsNameInput.focus();
    });
    
    elements.cancelSettings.addEventListener('click', () => {
        elements.settingsDialog.close();
    });
    
    // Enter в диалоге настроек
    elements.settingsNameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            elements.settingsAvatarInput.focus();
        }
    });
    
    elements.settingsAvatarInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            elements.saveSettings.click();
        }
    });
    
    elements.saveSettings.addEventListener('click', () => {
        userSettings.name = elements.settingsNameInput.value.trim();
        userSettings.avatar = elements.settingsAvatarInput.value.trim() || '👤';
        saveUserSettings();
        updateUserProfile(state.myName, state.myPort);
        elements.settingsDialog.close();
    });
    
    // Прикрепление файла (подготовка)
    elements.attachBtn.addEventListener('click', () => {
        elements.fileInput.click();
    });
    
    elements.fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            const peerAddress = state.peerAddress || state.currentPeer;
            if (!peerAddress) {
                alert('Сначала подключитесь к собеседнику');
                elements.fileInput.value = '';
                return;
            }
            
            console.log('📁 Отправка файла:', file.name, file.size);
            
            try {
                // Для отправки файла нужен полный путь, но браузеры не дают доступ к нему
                // Поэтому показываем сообщение о будущей реализации
                alert(`Файл выбран: ${file.name}\n\nОтправка файлов требует доступа к файловой системе.\nФайлы будут сохраняться в ~/Downloads/xam-messenger/`);
                
                // TODO: Реализовать через Tauri FS API
                // await invoke('send_file', { peerAddress, filePath: file.path });
                
                elements.fileInput.value = '';
            } catch (error) {
                console.error('Ошибка отправки файла:', error);
                alert('Ошибка отправки файла: ' + error);
            }
        }
    });
}

// Обновление кнопки отправки
function updateSendButton() {
    const hasText = elements.messageInput.value.trim().length > 0;
    elements.sendBtn.disabled = !hasText || !state.connected;
}

// Периодическая проверка новых сообщений
async function checkNewMessages() {
    try {
        // Сначала проверяем список контактов
        const peers = await invoke('get_peers');
        if (peers.length > 0 && !state.currentPeer) {
            // Если currentPeer не установлен, но есть контакты - используем первый
            state.currentPeer = peers[0].address;
            state.peerAddress = peers[0].address;
            console.log('🔗 Автоматически выбран peer:', state.currentPeer);
            await loadMessages(state.currentPeer);
            return;
        }
        
        // Обновляем список контактов если изменился
        if (peers.length !== state.peers.length) {
            console.log('📋 Обновление списка контактов');
            state.peers = peers;
            renderPeers();
        }
        
        // Если нет активного пира - не проверяем сообщения
        if (!state.currentPeer) return;
        
        const status = await invoke('get_connection_status');
        
        // Обновляем статус подключения
        if (status.connected && status.peer_address) {
            updateStatusDisplay(true, status.peer_address);
        }
        
        // Используем get_messages для получения сообщений
        const messages = await invoke('get_messages', { peerAddress: state.currentPeer });
        
        // Проверяем, есть ли новые сообщения
        if (messages.length > state.messages.length) {
            console.log('📬 Найдены новые сообщения:', messages.length - state.messages.length);
            
            // Отправляем ACK для новых сообщений (⏳ → ✓)
            const newMessages = messages.slice(state.messages.length);
            const newIds = newMessages.filter(m => !m.is_mine).map(m => m.id);
            
            if (newIds.length > 0) {
                console.log('📤 Отправка ACK (доставлено) для', newIds.length, 'сообщений');
                await invoke('send_ack', { peerAddress: state.currentPeer, messageIds: newIds });
            }
            
            state.messages = messages;
            renderMessages();
        } else {
            // Проверяем обновления статуса для существующих сообщений
            let needsRender = false;
            messages.forEach((newMsg, i) => {
                if (state.messages[i] && state.messages[i].delivery_status !== newMsg.delivery_status) {
                    state.messages[i].delivery_status = newMsg.delivery_status;
                    needsRender = true;
                }
            });
            if (needsRender) renderMessages();
        }
    } catch (error) {
        // Игнорируем ошибки, это фоновая проверка
    }
}

// Запуск
init();
