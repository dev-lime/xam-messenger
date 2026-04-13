/**
 * @file XAM Messenger — Точка входа (orchestrator)
 * @module App
 */

'use strict';

import { elements, state, userSettings, setUserSettings, setServerClient } from './state.js';
import { loadUserSettings, saveUserSettings, loadSession, clearSession } from './storage.js';
import { loadLanguage, t } from './i18n.js';
import { requestPermission as requestNotifPermission } from './notifications.js';
import { getServerClient } from './state.js';
import { setupEventListeners, initAppSettings } from './events/setup.js';
import { wsToHttpUrl, extractIpFromWsUrl } from './discovery.js';
import { renderPeers } from './utils/peers.js';
import { renderMessages } from './utils/messages.js';
import { handleNewMessage, handleAck, handleMessages, handleUserOnline, handleUserUpdated, handleChatDeleted } from './chat/handlers.js';
import { selectPeer, deleteChatWithPeer, sendMessage, loadMoreMessages } from './chat/actions.js';
import { filterMessagesForCurrentChat, hasMoreMessagesForCurrentPeer } from './chat/pagination.js';
import { connectToServer, openServerSelector, discoverServers, refreshServerList } from './dialogs/server.js';
import { ServerClient } from './server-client.js';
import { CONFIG } from './utils/helpers.js';

// ============================================================================
// Глобальные функции для inline handlers
// ============================================================================
window._selectPeer = selectPeer;
window._openFile = async (fp, fn) => {
    try {
        const sc = getServerClient();
        const url = fp.startsWith('http') ? fp : `${sc.httpUrl}/files/download?file_id=${encodeURIComponent(fp)}`;
        const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const blob = await r.blob(); const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = fn; document.body.appendChild(a); a.click();
        URL.revokeObjectURL(a.href); document.body.removeChild(a);
    } catch (e) { alert(`Ошибка: ${e.message}`); }
};
window._downloadFile = window._openFile;
window._connectToServer = async (wsUrl) => {
    const s = state.discoveredServers.find(s => s.wsUrl === wsUrl);
    state.selectedServer = s || { wsUrl, httpUrl: wsToHttpUrl(wsUrl), ip: extractIpFromWsUrl(wsUrl), port: 8080 };
    if (elements.serverSelectorDialog) elements.serverSelectorDialog.close();
    if (elements.selectedServerInfo) { elements.selectedServerInfo.textContent = `📡 ${state.selectedServer.ip}:${state.selectedServer.port}`; elements.selectedServerInfo.style.color = 'var(--success)'; }
    elements.connectDialog.showModal();
    elements.userNameInput.value = userSettings?.name || '';
    elements.userNameInput.focus();
};
window._openPeerMenu = (e, peerId, peerName) => {
    document.querySelectorAll('.peer-context-menu.open').forEach(m => m.classList.remove('open'));
    let menu = document.querySelector(`.peer-context-menu[data-user-id="${peerId}"]`);
    if (!menu) {
        menu = document.createElement('div'); menu.className = 'peer-context-menu'; menu.dataset.userId = peerId;
        menu.innerHTML = `<div class="peer-menu-info"><div class="peer-menu-id">ID: ${peerId}</div></div>
			<div class="profile-menu-divider"></div>
			<button class="profile-menu-item" data-action="delete-chat">
				<svg class="menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
				<span>Удалить чат</span></button>`;
        menu.addEventListener('click', ev => {
            const btn = ev.target.closest('[data-action]');
            if (btn && btn.dataset.action === 'delete-chat') deleteChatWithPeer(peerId, peerName);
            closePeerMenu(peerId);
        });
        const peerEl = document.querySelector(`.peer-item[data-user-id="${peerId}"]`);
        if (peerEl) peerEl.appendChild(menu);
    }
    menu.classList.add('open');
};
function closePeerMenu(peerId) {
    const m = document.querySelector(`.peer-context-menu[data-user-id="${peerId}"]`);
    if (m) m.classList.remove('open');
}
document.addEventListener('click', e => {
    const open = document.querySelector('.peer-context-menu.open');
    if (open && !open.contains(e.target)) closePeerMenu(open.dataset.userId);
});

// ============================================================================
// Экспорт для тестов
// ============================================================================
export {
    init, loadUserSettings, saveUserSettings, connectToServer, discoverServers,
    openServerSelector, refreshServerList, handleNewMessage, handleAck, handleMessages,
    handleUserOnline, handleUserUpdated, selectPeer, renderPeers, loadPeers, sendMessage,
    renderMessages, filterMessagesForCurrentChat, isMessageInCurrentChat,
    updateLoadMoreButton, loadMoreMessages,
};

// Re-export для CommonJS тестов
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        init, loadUserSettings, saveUserSettings, connectToServer, discoverServers,
        openServerSelector, refreshServerList, handleNewMessage, handleAck, handleMessages,
        handleUserOnline, handleUserUpdated, selectPeer, renderPeers, loadPeers, sendMessage,
        renderMessages, filterMessagesForCurrentChat, isMessageInCurrentChat,
        updateLoadMoreButton, loadMoreMessages,
    };
}

// ============================================================================
// Инициализация
// ============================================================================

function loadPeers() {
    // Stub — delegating to existing implementation
}

function isMessageInCurrentChat(msg) {
    if (!msg.recipient_id) return msg.sender_id === state.currentPeer;
    return (msg.sender_id === state.user?.id && msg.recipient_id === state.currentPeer) ||
		(msg.sender_id === state.currentPeer && msg.recipient_id === state.user?.id);
}

function updateLoadMoreButton() {
    if (!elements.loadMoreBtn || !elements.loadMoreContainer) return;
    const shouldShow = hasMoreMessagesForCurrentPeer();
    elements.loadMoreContainer.style.display = shouldShow ? 'flex' : 'none';
    if (elements.loadMoreBtn) {
        elements.loadMoreBtn.disabled = state.isLoadingMessages || !shouldShow;
        elements.loadMoreBtn.textContent = state.isLoadingMessages ? t('loading') : t('loadOlder');
    }
}

async function init() {
    const sc = new ServerClient();
    setServerClient(sc);

    sc.on('message', handleNewMessage);
    sc.on('ack', handleAck);
    sc.on('messages', handleMessages);
    sc.on('user_online', handleUserOnline);
    sc.on('user_updated', handleUserUpdated);
    sc.on('connection_lost', () => {
        state.connected = false;
        clearSession();
    });
    sc.on('chat_deleted', handleChatDeleted);

    loadLanguage();
    requestNotifPermission();
    loadUserSettings(userSettings);
    setUserSettings(loadUserSettings(userSettings));

    // Загружаем и применяем настройки приложения
    initAppSettings();

    if (elements.userAvatar) elements.userAvatar.textContent = userSettings?.avatar || CONFIG.AVATAR_DEFAULT;
    if (elements.profileMenuAvatar) elements.profileMenuAvatar.textContent = userSettings?.avatar || CONFIG.AVATAR_DEFAULT;

    setupEventListeners();

    const session = loadSession();
    if (session) {
        state.selectedServer = session.server;
        elements.userNameInput.value = session.user.name;
        if (elements.serverStatus) elements.serverStatus.innerHTML = `<span style="color:var(--warning);">${t('restoringSession')}</span>`;
        await connectToServer();
    } else {
        setTimeout(openServerSelector, 300);
    }
}

// Запуск
if (typeof window !== 'undefined' && !window.__TEST_MODE__) {
    init();
}
