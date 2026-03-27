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

    setupEventListeners();

    // Показываем диалог подключения
    setTimeout(() => {
        elements.connectDialog.showModal();
        elements.userNameInput.focus();
    }, 300);
}

// Обработка нового сообщения
function handleNewMessage(msg) {
    console.log('📩 Новое сообщение:', msg);

    const isForMe = msg.recipient_id === state.user?.id || !msg.recipient_id;
    const isMine = msg.sender_id === state.user?.id;

    // Проверяем дубликаты
    const exists = state.messages.some(m => m.id === msg.id);
    if (exists) return;

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
        }
    } else {
        renderMessages();
    }

    // Обновляем список пользователей
    if (!isMine) {
        const existingPeer = state.peers.find(p => p.id === msg.sender_id);
        if (!existingPeer) {
            loadPeers();
        }

        // Отправляем READ ACK
        console.log('📤 READ ACK для', msg.id);
        serverClient.sendAck(msg.id, 'read');
        msg.delivery_status = 2;

        // Обновляем статус в списках
        const existingMsg = state.messages.find(m => m.id === msg.id);
        if (existingMsg) {
            existingMsg.delivery_status = 2;
            const existingFiltered = state.filteredMessages?.find(m => m.id === msg.id);
            if (existingFiltered) {
                existingFiltered.delivery_status = 2;
            }
            renderMessages(!!state.currentPeer);
        }
    }
}

// Обработка ACK
function handleAck(data) {
    console.log('📨 ACK:', data);
    const msg = state.messages.find(m => m.id === data.message_id);
    if (msg) {
        msg.delivery_status = data.status === 'read' ? 2 : 1;
        const filteredMsg = state.filteredMessages?.find(m => m.id === data.message_id);
        if (filteredMsg) {
            filteredMsg.delivery_status = msg.delivery_status;
        }
        renderMessages(!!state.currentPeer);
    }
}

// Обработка истории сообщений
function handleMessages(messages) {
    console.log('📚 История:', messages.length, 'сообщений');
    state.messages = messages;

    // Фильтруем для текущего чата
    if (state.currentPeer) {
        state.filteredMessages = messages.filter(m => {
            return (m.sender_id === state.user?.id && m.recipient_id === state.currentPeer) ||
                   (m.sender_id === state.currentPeer && (m.recipient_id === state.user?.id || !m.recipient_id));
        });
        renderMessages(true);
    } else {
        renderMessages();
    }
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

        console.log('✅ Подключен:', user.name, user.id);

        // Обновляем UI
        updateUserProfile(user.name, 'В сети');
        updateStatusDisplay(true, 'В сети');

        // Загружаем историю и пользователей
        serverClient.getMessages(1000);
        await loadPeers();

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

    if (text) {
        console.log('📤 Отправка сообщения:', text);
        serverClient.sendMessage(text, state.currentPeer);

        // Добавляем локально
        state.messages.push({
            id: 'local_' + Date.now(),
            sender_id: state.user.id,
            sender_name: state.user.name,
            text,
            timestamp: Date.now() / 1000,
            delivery_status: 0,
            files: [],
            recipient_id: state.currentPeer,
        });

        if (state.currentPeer) {
            state.filteredMessages.push(state.messages[state.messages.length - 1]);
            renderMessages(true);
        } else {
            renderMessages();
        }
    }

    // Отправка файлов
    for (const file of filesToSend) {
        try {
            console.log('📁 Отправка файла:', file.name);
            await serverClient.sendFile(file, state.currentPeer);
        } catch (error) {
            console.error('❌ Ошибка отправки файла:', error);
        }
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

        item.innerHTML = `
            <span class="peer-icon">👤</span>
            <div class="peer-info">
                <div class="peer-name">${escapeHtml(peer.name)}</div>
                <div class="peer-address">ID: ${peer.id.slice(0, 8)}</div>
            </div>
            <span class="peer-time">🟢</span>
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
    loadMessagesForPeer(userId);
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
                <div class="file-item" data-filename="${escapeHtml(f.name)}" data-filesize="${f.size}">
                    <span class="file-icon">${getFileIcon(f.name)}</span>
                    <span class="file-name">${escapeHtml(f.name)}</span>
                    <span class="file-size">${formatFileSize(f.size)}</span>
                </div>
            `).join('');

            div.innerHTML = `
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
                <div class="file-item" data-filename="${escapeHtml(f.name)}" data-filesize="${f.size}">
                    <span class="file-icon">${getFileIcon(f.name)}</span>
                    <span class="file-name">${escapeHtml(f.name)}</span>
                    <span class="file-size">${formatFileSize(f.size)}</span>
                </div>
            `).join('');

            div.innerHTML = `
                <div class="message-sender">👤 ${escapeHtml(msg.sender_name)}</div>
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
            if (file.size > 25 * 1024 * 1024) {
                alert(`Файл "${file.name}" слишком большой (макс. 25MB)`);
                return;
            }
            attachedFiles.push(file);
        });
        elements.fileInput.value = '';
        renderAttachedFiles();
        updateSendButton();
    });

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
