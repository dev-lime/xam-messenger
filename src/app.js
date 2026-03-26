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
    attachedFiles: document.getElementById('attachedFiles'),
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

// Прикреплённые файлы
let attachedFiles = [];

// Получить иконку файла по расширению
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

// Форматировать размер файла
function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// Отобразить прикреплённые файлы
function renderAttachedFiles() {
    elements.attachedFiles.innerHTML = '';
    
    attachedFiles.forEach((file, index) => {
        const fileEl = document.createElement('div');
        fileEl.className = 'attached-file';
        fileEl.title = `Открыть: ${file.name} (${formatFileSize(file.size)})`;
        fileEl.innerHTML = `
            <span class="attached-file-icon">${getFileIcon(file.name)}</span>
            <span class="attached-file-name">${file.name}</span>
            <button class="attached-file-remove" onclick="removeAttachedFile(event, ${index})" title="Удалить">×</button>
        `;
        
        // Клик по файлу - открыть
        fileEl.addEventListener('click', (e) => {
            if (!e.target.classList.contains('attached-file-remove')) {
                openFile(file);
            }
        });
        
        elements.attachedFiles.appendChild(fileEl);
    });
    
    // Показываем/скрываем панель файлов
    elements.attachedFiles.style.display = attachedFiles.length > 0 ? 'flex' : 'none';
}

// Открыть файл
function openFile(file) {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
}

// Добавить файл
function addAttachedFile(file) {
    // Максимум 10 файлов, максимум 25MB каждый
    if (attachedFiles.length >= 10) {
        alert('Максимум 10 файлов');
        return false;
    }
    if (file.size > 25 * 1024 * 1024) {
        alert(`Файл "${file.name}" слишком большой (макс. 25MB)`);
        return false;
    }
    
    attachedFiles.push(file);
    renderAttachedFiles();
    return true;
}

// Удалить файл
function removeAttachedFile(event, index) {
    event.stopPropagation(); // Не открывать файл при удалении
    attachedFiles.splice(index, 1);
    renderAttachedFiles();
}

// Сделать функции глобальными
window.removeAttachedFile = removeAttachedFile;

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
        
        // Отправляем READ ACK для непрочитанных сообщений (✓ → ✓✓)
        const unreadIds = messages
            .filter(m => !m.is_mine && m.delivery_status < 2)
            .map(m => m.id);
        
        if (unreadIds.length > 0) {
            console.log('📤 Отправка READ ACK (прочитано) для', unreadIds.length, 'сообщений');
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
        let statusIcon = '🕐';
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
    const filesToSend = [...attachedFiles];

    if ((!text && filesToSend.length === 0) || !peerAddress) {
        console.log('❌ Не отправлено: text=', !!text, 'files=', filesToSend.length, 'peerAddress=', peerAddress);
        return;
    }

    console.log('📤 Отправка сообщения:', { text, files: filesToSend.length, peerAddress });

    try {
        // Отправляем текст сообщения
        if (text) {
            const sent = await invoke('send_message', {
                peerAddress: peerAddress,
                text: text,
            });
            
            if (!sent) {
                console.log('⚠️ Сообщение не отправлено (нет подключения)');
                // Всё равно добавляем в локальный чат
            } else {
                console.log('✅ Сообщение отправлено');
            }
        }

        // Отправляем файлы
        for (const file of filesToSend) {
            console.log('📁 Отправка файла:', file.name, formatFileSize(file.size));
            
            // Читаем файл как base64
            const base64 = await readFileAsBase64(file);
            
            try {
                await invoke('send_file_base64', {
                    peerAddress: peerAddress,
                    fileName: file.name,
                    fileData: base64,
                });
                console.log('✅ Файл отправлен:', file.name);
            } catch (fileError) {
                console.error('❌ Ошибка отправки файла:', fileError);
            }
        }

        // Перезагружаем сообщения чтобы получить актуальный статус
        const messages = await invoke('get_messages', { peerAddress });
        state.messages = messages;
        renderMessages();

        // Очищаем
        elements.messageInput.value = '';
        attachedFiles = [];
        renderAttachedFiles();
        updateSendButton();
    } catch (error) {
        console.error('❌ Ошибка отправки:', error);
        alert('Ошибка отправки: ' + error);
    }
}

// Прочитать файл как base64
function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// Обновление статуса
async function updateStatus() {
    try {
        const status = await invoke('get_connection_status');
        state.connected = status.connected;
        state.myPort = status.my_port;
        state.myName = status.my_name;
        
        // Сохраняем peer_address если он есть
        if (status.peer_address) {
            state.peerAddress = status.peer_address;
        }
        
        // Используем сохранённый peer_address для отображения
        updateStatusDisplay(status.connected, state.peerAddress);
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
    // Показываем данные текущего пользователя
    const displayName = userSettings.name || name || 'Не подключен';
    const avatar = userSettings.avatar || '👤';

    elements.userName.textContent = displayName;
    // address - это наш порт для входящих подключений
    elements.userAddress.textContent = address ? `Порт ${address}` : '--';
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

    // Прикрепление файла
    elements.attachBtn.addEventListener('click', () => {
        elements.fileInput.click();
    });

    elements.fileInput.addEventListener('change', (e) => {
        const files = Array.from(e.target.files);
        files.forEach(file => addAttachedFile(file));
        elements.fileInput.value = '';
    });

    // Периодическое обновление статуса
    setInterval(updateStatus, 5000);
}

// Обновление кнопки отправки
function updateSendButton() {
    const hasText = elements.messageInput.value.trim().length > 0;
    const hasFiles = attachedFiles.length > 0;
    elements.sendBtn.disabled = (!hasText && !hasFiles) || !state.connected;
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
            
            // Устанавливаем peer_address если не установлен
            if (!state.peerAddress) {
                state.peerAddress = state.currentPeer;
                await invoke('set_peer_address', { peerAddress: state.currentPeer });
            }
            
            // Отправляем READ ACK для новых сообщений (✓ → ✓✓)
            const newMessages = messages.slice(state.messages.length);
            const newIds = newMessages.filter(m => !m.is_mine).map(m => m.id);
            
            if (newIds.length > 0) {
                console.log('📤 Отправка READ ACK (прочитано) для', newIds.length, 'сообщений');
                await invoke('mark_read', { peerAddress: state.currentPeer, messageIds: newIds });
                await invoke('send_ack', { peerAddress: state.currentPeer, messageIds: newIds });
                
                // Обновляем статус локально
                newIds.forEach(id => {
                    const msg = messages.find(m => m.id === id);
                    if (msg) msg.delivery_status = 2; // ✓✓
                });
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
