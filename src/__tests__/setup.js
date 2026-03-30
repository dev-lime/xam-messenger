// Setup file for Jest tests
import '@testing-library/jest-dom';

// Флаг для app.js чтобы не инициализировался автоматически
window.__TEST_MODE__ = true;

// Mock для localStorage
const localStorageMock = {
    store: {},
    getItem(key) {
        return this.store[key] || null;
    },
    setItem(key, value) {
        this.store[key] = String(value);
    },
    removeItem(key) {
        delete this.store[key];
    },
    clear() {
        this.store = {};
    },
};

Object.defineProperty(window, 'localStorage', {
    value: localStorageMock,
});

// Mock для dialog элементов
HTMLDialogElement.prototype.show = function() {
    this.open = true;
};

HTMLDialogElement.prototype.showModal = function() {
    this.open = true;
};

HTMLDialogElement.prototype.close = function() {
    this.open = false;
};

// Mock для WebSocket
class MockWebSocket {
    constructor(url) {
        this.url = url;
        this.readyState = MockWebSocket.OPEN;
        this.onopen = null;
        this.onclose = null;
        this.onerror = null;
        this.onmessage = null;
        
        // Сразу вызываем onopen
        const self = this;
        setTimeout(() => {
            if (self.onopen) self.onopen();
        }, 0);
    }

    send(data) {}

    close() {
        this.readyState = MockWebSocket.CLOSED;
        if (this.onclose) this.onclose();
    }
}

MockWebSocket.OPEN = 1;
MockWebSocket.CLOSED = 3;

window.WebSocket = MockWebSocket;

// Mock для fetch
const mockFetch = jest.fn();
window.fetch = mockFetch;

// Очистка моков перед каждым тестом
beforeEach(() => {
    mockFetch.mockClear();
    localStorageMock.store = {};
    window.ServerClient = undefined;

    // Очищаем DOM
    document.body.innerHTML = `
        <div class="app">
            <aside class="sidebar">
                <div class="peers-list" id="peersList"></div>
            </aside>
            <main class="chat">
                <header class="chat-header">
                    <div class="user-profile-header" id="userProfileHeader">
                        <div class="user-avatar-small" id="userAvatar">👤</div>
                        <div class="user-info-header">
                            <div class="user-name-header" id="userName">Не подключен</div>
                            <div class="user-address-header" id="userAddress">--</div>
                        </div>
                    </div>
                    <div class="status" id="status">⚫ Не в сети</div>
                </header>
                <div class="messages-container" id="messagesContainer">
                    <div class="messages" id="messages"></div>
                </div>
                <div class="attached-files" id="attachedFiles" style="display: none;"></div>
                <div class="input-area">
                    <button class="btn btn-attach" id="attachBtn">📎</button>
                    <textarea id="messageInput" placeholder="Введите сообщение..." rows="1"></textarea>
                    <button class="btn btn-send" id="sendBtn" disabled><span>➤</span></button>
                </div>
                <input type="file" id="fileInput" style="display: none;" multiple>
            </main>
        </div>
        <dialog id="connectDialog" class="dialog">
            <div class="dialog-header">
                <h3>Добро пожаловать в XAM Messenger</h3>
            </div>
            <div class="dialog-content">
                <div class="form-group">
                    <label>Ваше имя</label>
                    <input type="text" id="userNameInput" placeholder="Введите имя" maxlength="20">
                </div>
                <p class="hint">💡 Введите имя для подключения к серверу</p>
                <div id="serverStatus"></div>
            </div>
            <div class="dialog-actions">
                <button class="btn btn-primary" id="confirmConnect" disabled>Войти</button>
            </div>
        </dialog>
        <dialog id="settingsDialog" class="dialog">
            <div class="dialog-header">
                <h3>Настройки профиля</h3>
            </div>
            <div class="dialog-content">
                <div class="form-group">
                    <label>Ваше имя</label>
                    <input type="text" id="settingsNameInput" placeholder="Ваше имя">
                </div>
                <div class="form-group">
                    <label>Аватар (эмодзи)</label>
                    <input type="text" id="settingsAvatarInput" placeholder="👤" maxlength="2">
                </div>
            </div>
            <div class="dialog-actions">
                <button class="btn" id="cancelSettings">Отмена</button>
                <button class="btn btn-primary" id="saveSettings">Сохранить</button>
            </div>
        </dialog>
    `;
});
