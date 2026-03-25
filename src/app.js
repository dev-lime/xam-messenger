const { invoke } = window.__TAURI__.core;

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
    connectBtn: document.getElementById('connectBtn'),
    sendBtn: document.getElementById('sendBtn'),
    messageInput: document.getElementById('messageInput'),
    messages: document.getElementById('messages'),
    messagesContainer: document.getElementById('messagesContainer'),
    peersList: document.getElementById('peersList'),
    connectDialog: document.getElementById('connectDialog'),
    portInput: document.getElementById('portInput'),
    nameInput: document.getElementById('nameInput'),
    ipInput: document.getElementById('ipInput'),
    cancelConnect: document.getElementById('cancelConnect'),
    confirmConnect: document.getElementById('confirmConnect'),
};

// Инициализация
async function init() {
    try {
        await invoke('init_app');
        await loadPeers();
        await updateStatus();
    } catch (error) {
        console.error('Failed to initialize:', error);
    }

    setupEventListeners();
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
    try {
        const messages = await invoke('get_messages', { peerAddress });
        state.messages = messages;
        renderMessages();
    } catch (error) {
        console.error('Failed to load messages:', error);
    }
}

// Рендеринг сообщений
function renderMessages() {
    elements.messages.innerHTML = '';

    state.messages.forEach(msg => {
        const messageEl = createMessageElement(msg);
        elements.messages.appendChild(messageEl);
    });

    scrollToBottom();
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
        // Своё сообщение
        div.innerHTML = `
            <div class="message-text">${escapeHtml(msg.text)}</div>
            <div class="message-meta">
                <span class="read-status">${msg.is_read ? '✓✓' : '✓'}</span>
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

    // Кнопка копирования
    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-btn';
    copyBtn.innerHTML = '📋';
    copyBtn.title = 'Копировать';
    copyBtn.onclick = () => copyToClipboard(msg.text);

    div.addEventListener('mouseenter', () => copyBtn.style.display = 'inline-block');
    div.addEventListener('mouseleave', () => copyBtn.style.display = 'none');
    div.appendChild(copyBtn);

    return div;
}

// Отправка сообщения
async function sendMessage() {
    const text = elements.messageInput.value.trim();
    if (!text || !state.currentPeer) return;

    try {
        await invoke('send_message', {
            peerAddress: state.currentPeer,
            text: text,
        });

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
        console.error('Failed to send message:', error);
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
    elements.userName.textContent = name || 'Не подключен';
    elements.userAddress.textContent = address ? `:${address}` : '--';
}

// Прокрутка вниз
function scrollToBottom() {
    elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;
}

// Копирование в буфер
async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
    } catch (error) {
        console.error('Failed to copy:', error);
    }
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
    });

    // Отмена подключения
    elements.cancelConnect.addEventListener('click', () => {
        elements.connectDialog.close();
    });

    // Подтверждение подключения
    elements.confirmConnect.addEventListener('click', async () => {
        const port = elements.portInput.value.trim();
        const name = elements.nameInput.value.trim() || state.myName;
        const ip = elements.ipInput.value.trim();

        if (!port) {
            alert('Укажите порт');
            return;
        }

        try {
            await invoke('start_server', { port, name });

            state.myPort = port;
            state.myName = name;

            // Обновляем профиль пользователя
            updateUserProfile(name, port);

            if (ip) {
                state.currentPeer = ip;
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
}

// Обновление кнопки отправки
function updateSendButton() {
    const hasText = elements.messageInput.value.trim().length > 0;
    elements.sendBtn.disabled = !hasText || !state.connected;
}

// Запуск
init();
