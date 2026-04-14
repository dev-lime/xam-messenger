/**
 * @file XAM Messenger — Точка входа (orchestrator)
 * @module App
 */

'use strict';

import { elements, state, userSettings, setUserSettings, setServerClient } from './state.js';
import { loadUserSettings, saveUserSettings, loadSession, clearSession } from './settings.js';
import { loadLanguage, t } from './i18n.js';
import { requestPermission as requestNotifPermission } from './notifications.js';
import { setupEventListeners, initAppSettings } from './events/setup.js';
import { renderPeers } from './utils/peers.js';
import { renderMessages, setupFileDelegation } from './utils/messages.js';
import { handleNewMessage, handleAck, handleMessages, handleUserOnline, handleUserUpdated, handleChatDeleted, handleServerError } from './chat/handlers.js';
import { selectPeer, sendMessage, loadMoreMessages } from './chat/actions.js';
import { filterMessagesForCurrentChat, hasMoreMessagesForCurrentPeer } from './chat/pagination.js';
import { connectToServer, openServerSelector, discoverServers, refreshServerList } from './dialogs/server.js';
import { ServerClient } from './server-client.js';
import { CONFIG } from './utils/helpers.js';

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
    sc.on('error', handleServerError);
    sc.on('server_shutdown', () => {
        state.connected = false;
        clearSession();
        if (elements.connectionStatus) {
            // eslint-disable-next-line quotes
            elements.connectionStatus.innerHTML = `<span style='color:var(--warning);'>🔌 Сервер завершает работу...</span>`;
        }
        // Попытка переподключения через ServerClient
    });

    loadLanguage();
    requestNotifPermission();
    loadUserSettings(userSettings);
    setUserSettings(loadUserSettings(userSettings));

    // Загружаем и применяем настройки приложения
    initAppSettings();

    if (elements.userAvatar) elements.userAvatar.textContent = userSettings?.avatar || CONFIG.AVATAR_DEFAULT;
    if (elements.profileMenuAvatar) elements.profileMenuAvatar.textContent = userSettings?.avatar || CONFIG.AVATAR_DEFAULT;

    setupEventListeners();
    setupFileDelegation();

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
