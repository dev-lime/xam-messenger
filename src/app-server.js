// XAM Messenger - Server Mode Client

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
    attachedFiles: document.getElementById('attachedFiles'),
    messageInput: document.getElementById('messageInput'),
    messages: document.getElementById('messages'),
    messagesContainer: document.getElementById('messagesContainer'),
    peersList: document.getElementById('peersList'),
    connectDialog: document.getElementById('connectDialog'),
    settingsDialog: document.getElementById('settingsDialog'),
    userNameInput: document.getElementById('userNameInput'),
    serverStatus: document.getElementById('serverStatus'),
    cancelConnect: document.getElementById('cancelConnect'),
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
};

// Прикреплённые файлы
let attachedFiles = [];

// Серверный клиент
let serverClient = null;

// Инициализация
async function init() {
    console.log('🚀 XAM Messenger (Server Mode)');
    
    // Создаём клиент
    serverClient = new ServerClient();
    
    // Подписываемся на события
    serverClient.on('message', handleNewMessage);
    serverClient.on('ack', handleAck);
    serverClient.on('messages', handleMessages);
    
    setupEventListeners();
    
    // Показываем диалог подключения
    setTimeout(() => {
        elements.connectDialog.showModal();
        elements.userNameInput.focus();
    }, 500);
}

// Обработка нового сообщения
function handleNewMessage(msg) {
    console.log('📬 Новое сообщение:', msg);
    state.messages.push(msg);
    renderMessages();
    
    // Отправляем READ_ACK
    if (msg.sender_id !== state.user?.id) {
        serverClient.sendAck(msg.id, 'read');
        msg.delivery_status = 2;
        renderMessages();
    }
}

// Обработка ACK
function handleAck(data) {
    console.log('📬 ACK:', data);
    const msg = state.messages.find(m => m.id === data.message_id);
    if (msg) {
        msg.delivery_status = data.status === 'read' ? 2 : 1;
        renderMessages();
    }
}

// Обработка истории сообщений
function handleMessages(messages) {
    console.log('📚 Загружено сообщений:', messages.length);
    state.messages = messages;
    renderMessages();
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
        
        // Подключаемся к найденному серверу
        await serverClient.connect(discoveredServerUrl);
        
        // Регистрируемся
        const user = await serverClient.register(name);
        state.user = user;
        state.connected = true;

        // Обновляем UI
        updateUserProfile(user.name, 'Сервер');
        updateStatusDisplay(true, 'Подключено');

        // Загружаем историю
        serverClient.getMessages(100);

        // Загружаем пользователей
        const users = await serverClient.getUsers();
        state.peers = users.filter(u => u.id !== user.id);
        renderPeers();

        elements.serverStatus.innerHTML = '<span style="color: var(--success);">✅ Подключено</span>';
        
        setTimeout(() => {
            elements.connectDialog.close();
        }, 500);
        
        console.log('✅ Подключено к серверу');
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

    // Отправляем текст
    if (text) {
        serverClient.sendMessage(text);
        
        // Добавляем локально для отображения
        state.messages.push({
            id: 'local_' + Date.now(),
            sender_id: state.user.id,
            sender_name: state.user.name,
            text,
            timestamp: Date.now() / 1000,
            delivery_status: 1,
            files: [],
        });
        renderMessages();
    }

    // Отправляем файлы
    for (const file of filesToSend) {
        try {
            await serverClient.sendFile(file);
        } catch (error) {
            console.error('❌ Ошибка отправки файла:', error);
        }
    }

    // Очищаем
    elements.messageInput.value = '';
    attachedFiles = [];
    renderAttachedFiles();
    updateSendButton();
}

// Рендеринг сообщений
function renderMessages() {
    elements.messages.innerHTML = '';

    if (state.messages.length === 0) {
        elements.messages.innerHTML = '<p style="text-align: center; color: var(--text-tertiary); padding: 20px;">Нет сообщений</p>';
        return;
    }

    let lastDate = null;

    state.messages.forEach(msg => {
        // Разделитель дат
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
        // Своё сообщение
        let statusIcon = '🕐';
        let statusTitle = 'Отправлено';

        if (msg.delivery_status === 1) {
            statusIcon = '✓';
            statusTitle = 'Доставлено';
        } else if (msg.delivery_status === 2) {
            statusIcon = '✓✓';
            statusTitle = 'Прочитано';
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
        // Чужое сообщение
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

// Рендеринг контактов
function renderPeers() {
    elements.peersList.innerHTML = '';

    if (state.peers.length === 0) {
        elements.peersList.innerHTML = '<p style="padding: 20px; color: var(--text-tertiary); text-align: center;">Нет других пользователей</p>';
        return;
    }

    state.peers.forEach(peer => {
        const item = document.createElement('div');
        item.className = 'peer-item';
        item.innerHTML = `
            <span class="peer-icon">👤</span>
            <div class="peer-info">
                <div class="peer-name">${escapeHtml(peer.name)}</div>
                <div class="peer-address">ID: ${peer.id.slice(0, 8)}</div>
            </div>
            <span class="peer-time">🟢</span>
        `;
        elements.peersList.appendChild(item);
    });
}

// Обновление статуса
function updateStatusDisplay(connected, server) {
    if (connected) {
        elements.status.textContent = `🟢 Подключен к ${server}`;
        elements.status.style.color = 'var(--success)';
    } else {
        elements.status.textContent = `⚫ Не подключен`;
        elements.status.style.color = 'var(--text-tertiary)';
    }
    updateSendButton();
}

// Обновление профиля
function updateUserProfile(name, server) {
    const avatar = '👤';
    elements.userName.textContent = name || 'Не подключен';
    elements.userAddress.textContent = server || '--';
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

// Получить иконку файла
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

// Отобразить прикреплённые файлы
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

// Удалить файл
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
    elements.connectBtn.addEventListener('click', () => {
        elements.connectDialog.showModal();
        elements.userNameInput.focus();
        
        // Начинаем поиск сервера сразу
        discoverServerUI();
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
        elements.settingsDialog.showModal();
    });

    elements.cancelSettings.addEventListener('click', () => {
        elements.settingsDialog.close();
    });

    elements.saveSettings.addEventListener('click', () => {
        const name = elements.settingsNameInput.value.trim();
        if (name && state.user) {
            state.user.name = name;
            updateUserProfile(name, elements.userAddress.textContent);
        }
        elements.settingsDialog.close();
    });
}

// Поиск сервера с обновлением UI
let discoveredServerUrl = null;

async function discoverServerUI() {
    elements.serverStatus.innerHTML = '<span style="color: var(--text-secondary);">🔍 Поиск сервера...</span>';
    elements.confirmConnect.disabled = true;

    const client = new ServerClient();

    try {
        discoveredServerUrl = await client.discoverServer();
        elements.serverStatus.innerHTML = '<span style="color: var(--success);">✅ Сервер найден</span>';
        elements.confirmConnect.disabled = elements.userNameInput.value.trim().length === 0;
    } catch (e) {
        elements.serverStatus.innerHTML = '<span style="color: var(--error);">❌ Сервер не найден<br><small>Запустите сервер и попробуйте снова</small></span>';
        elements.confirmConnect.disabled = false;
    }
}

// Запуск
init();
