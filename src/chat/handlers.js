/**
 * @file Обработчики событий от сервера
 * @module Chat/Handlers
 */

'use strict';

import { DELIVERY_STATUS, CONFIG } from '../utils/helpers.js';
import { filterMessagesForCurrentChat } from './pagination.js';
import { renderPeers } from '../utils/peers.js';
import { renderMessages, renderEmptyChatState } from '../utils/messages.js';
import { sendNotification } from '../notifications.js';
import { t } from '../i18n.js';
import { state, elements, getServerClient } from '../state.js';

/**
 * Обработка нового сообщения
 */
export function handleNewMessage(msg) {
    console.log('📩 Новое сообщение:', { id: msg.id, text: msg.text, filesCount: msg.files?.length });
    const isMine = msg.sender_id === state.user?.id;

    // Обновляем время последнего сообщения для сортировки
    const otherUserId = isMine ? msg.recipient_id : msg.sender_id;
    if (otherUserId) {
        state.lastMessageTimes[otherUserId] = msg.timestamp;
        if (!state.currentPeer || state.currentPeer !== otherUserId) renderPeers();
    }

    // Desktop notification
    if (!isMine && (!state.currentPeer || state.currentPeer !== msg.sender_id)) {
        const peer = state.peers.find(p => p.id === msg.sender_id);
        const senderName = peer ? peer.name : msg.sender_name;
        const preview = msg.text || (msg.files?.length ? '📎 Файл' : '');
        sendNotification(senderName, preview);
    }

    // Дубликаты
    if (state.messages.some(m => m.id === msg.id)) return;

    // Замена локального сообщения
    if (isMine) {
        const localIndex = findLocalMessage(msg);
        if (localIndex !== -1) {
            msg.delivery_status = state.messages[localIndex].delivery_status;
            state.messages[localIndex] = msg;
            // Заменяем в filteredMessages
            const filteredIndex = state.filteredMessages.findIndex(
                m => m.id.startsWith('local_') &&
                    m.text === msg.text &&
                    m.sender_id === msg.sender_id
            );
            if (filteredIndex !== -1) state.filteredMessages[filteredIndex] = msg;
            renderMessages(state.currentPeer !== null);
            return;
        }
    }

    state.messages.push(msg);
    if (state.currentPeer && isMessageInCurrentChat(msg)) {
        state.filteredMessages.push(msg);
        renderMessages(true);
        if (!isMine) {
            getServerClient().sendAck(msg.id, 'read');
            msg.delivery_status = DELIVERY_STATUS.READ;
        }
    } else {
        renderMessages(!!state.currentPeer);
        if (!isMine) updateUnreadBadge(msg.sender_id);
    }

    if (!isMine && !state.peers.some(p => p.id === msg.sender_id)) {
        getServerClient().getUsers().then(users => {
            state.peers = users.filter(u => u.id !== state.user?.id);
            renderPeers();
        }).catch(() => {});
    }
}

/**
 * Проверка: сообщение в текущем чате
 */
function isMessageInCurrentChat(msg) {
    if (!msg.recipient_id) return msg.sender_id === state.currentPeer;
    return (msg.sender_id === state.user?.id && msg.recipient_id === state.currentPeer) ||
        (msg.sender_id === state.currentPeer && msg.recipient_id === state.user?.id);
}

/**
 * Обновление бейджа непрочитанных
 */
function updateUnreadBadge(peerId) {
    const peerElement = document.querySelector(`.peer-item[data-user-id="${peerId}"]`);
    if (!peerElement) return;
    const unreadCount = state.messages.filter(m => m.sender_id === peerId && m.delivery_status < DELIVERY_STATUS.READ).length;
    let badge = peerElement.querySelector('.unread-badge');
    if (unreadCount > 0) {
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'unread-badge';
            const menuBtn = peerElement.querySelector('.peer-menu-btn');
            peerElement.insertBefore(badge, menuBtn);
        }
        badge.textContent = unreadCount;
    } else if (badge) {
        badge.remove();
    }
}

/**
 * Поиск локального сообщения по тексту и времени
 */
function findLocalMessage(msg) {
    return state.messages.findIndex(m => {
        if (!m.id.startsWith('local_') || m.sender_id !== state.user?.id) return false;
        if (Math.abs(m.timestamp - msg.timestamp) >= CONFIG.LOCAL_MESSAGE_TTL) return false;
        // Текстовое совпадение (оба пустых = совпадение)
        if (m.text === msg.text) return true;
        // Fallback для файлов: один получатель, совпадение по именам файлов
        if (m.recipient_id === msg.recipient_id &&
            m.files?.length > 0 && msg.files?.length > 0 &&
            m.files.length === msg.files.length) {
            return m.files.every((f, i) => f.name === msg.files[i]?.name);
        }
        return false;
    });
}

/**
 * Обработка ACK
 */
export function handleAck(data) {
    console.log('📨 ACK:', data);
    if (data.sender_id === state.user?.id) return;

    const msg = state.messages.find(m => m.id === data.message_id);
    if (msg) {
        msg.delivery_status = data.status === 'read' ? DELIVERY_STATUS.READ : DELIVERY_STATUS.DELIVERED;
        const filteredMsg = state.filteredMessages.find(m => m.id === msg.id || m.id.startsWith('local_'));
        if (filteredMsg) { filteredMsg.delivery_status = msg.delivery_status; filteredMsg.id = msg.id; }
        renderMessages(!!state.currentPeer);

        const messageElements = elements.messages.querySelectorAll('.message.mine');
        if (messageElements.length > 0) {
            const statusEl = messageElements[messageElements.length - 1].querySelector('.read-status');
            if (statusEl) {
                statusEl.classList.add('status-changed');
                setTimeout(() => statusEl.classList.remove('status-changed'), 400);
            }
        }
    }
}

/**
 * Обработка истории сообщений
 */
export function handleMessages(data) {
    const messages = Array.isArray(data) ? data : data.messages;
    const nextBeforeId = data.next_before_id || data.nextBeforeId || null;
    const hasMore = data.has_more !== undefined ? data.has_more : messages.length >= 50;
    const beforeId = data.before_id || data.beforeId || null;

    if (!beforeId) {
        state.messages = messages;
        state.currentPeerBeforeId = nextBeforeId;
        state.lastMessageId = nextBeforeId;
    } else {
        if (beforeId === state.lastRequestedBeforeId) {
            state.hasMoreMessages = false;
            state.currentPeerBeforeId = null;
            state.lastRequestedBeforeId = null;
            state.isLoadingMessages = false;
            updateLoadMoreButton();
            return;
        }
        state.messages = [...messages, ...state.messages];
        state.currentPeerBeforeId = nextBeforeId;
    }

    state.hasMoreMessages = hasMore;
    state.isLoadingMessages = false;

    if (state.currentPeer) {
        filterMessagesForCurrentChat();
        renderMessages(true);
        if (beforeId && state.filteredMessages.length === 0 && state.hasMoreMessages && nextBeforeId) {
            state.lastRequestedBeforeId = nextBeforeId;
            state.isLoadingMessages = true;
            updateLoadMoreButton();
            getServerClient().getMessages(50, nextBeforeId, state.currentPeer);
            return;
        }
    } else {
        renderMessages();
    }
    updateLoadMoreButton();
}

/**
 * Обработка user_online
 */
export function handleUserOnline(data) {
    if (data.online) state.onlineUsers.add(data.user_id);
    else state.onlineUsers.delete(data.user_id);
    if (state.connected) {
        getServerClient().getUsers().then(users => {
            state.peers = users.filter(u => u.id !== state.user?.id);
            renderPeers();
        }).catch(() => {});
    } else { renderPeers(); }
}

/**
 * Обработка user_updated
 */
export function handleUserUpdated(data) {
    console.log(`👤 Пользователь ${data.user_id} обновил аватар: ${data.avatar}`);
    const peer = state.peers.find(p => p.id === data.user_id);
    if (peer) { peer.avatar = data.avatar; renderPeers(); }
    if (data.user_id === state.user?.id) {
        state.user.avatar = data.avatar;
        const saved = JSON.parse(localStorage.getItem('xam-user-settings') || '{}');
        saved.avatar = data.avatar;
        localStorage.setItem('xam-user-settings', JSON.stringify(saved));
    }
}

/**
 * Обработка chat_deleted
 */
export function handleChatDeleted(data) {
    console.log('🗑️ Чат удалён:', data);
    const peerId = data.peer_id;
    state.messages = state.messages.filter(m =>
        !((m.sender_id === state.user?.id && m.recipient_id === peerId) ||
          (m.sender_id === peerId && m.recipient_id === state.user?.id))
    );
    if (state.currentPeer === peerId) {
        state.currentPeer = null;
        state.filteredMessages = [];
        state.currentPeerBeforeId = null;
        state.hasMoreMessages = true;
        renderEmptyChatState();
    } else if (state.currentPeer) {
        filterMessagesForCurrentChat();
        renderMessages(true);
    }
    renderPeers();
}

function updateLoadMoreButton() {
    if (!elements.loadMoreBtn || !elements.loadMoreContainer) return;
    const shouldShow = state.currentPeer && state.hasMoreMessages && !state.isLoadingMessages && state.currentPeerBeforeId;
    elements.loadMoreContainer.style.display = shouldShow ? 'flex' : 'none';
    if (elements.loadMoreBtn) {
        elements.loadMoreBtn.disabled = state.isLoadingMessages || !shouldShow;
        elements.loadMoreBtn.textContent = state.isLoadingMessages ? t('loading') : t('loadOlder');
    }
}
