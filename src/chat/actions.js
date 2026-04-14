/**
 * @file Действия чата — отправка, удаление, выбор пира
 * @module Chat/Actions
 */

'use strict';

import { DELIVERY_STATUS } from '../utils/helpers.js';
import { t } from '../i18n.js';
import { success, error as showError } from '../toast.js';
import { state, elements, attachedFiles, getServerClient } from '../state.js';
import { filterMessagesForCurrentChat, hasMoreMessagesForCurrentPeer } from './pagination.js';
import { renderPeers } from '../utils/peers.js';
import { renderMessages, renderEmptyChatState } from '../utils/messages.js';
import { clearMessageInput } from '../utils/files.js';

/**
 * Отправка сообщения
 */
export async function sendMessage() {
    const text = elements.messageInput.value.trim();
    const filesToSend = [...attachedFiles];
    if (!text && filesToSend.length === 0) return;
    if (!state.connected) { showError(t('noConnection')); return; }

    // Создаём локальные сообщения (каждый файл — отдельное сообщение, текст — отдельное)
    const localMessages = [];
    for (const file of filesToSend) {
        localMessages.push({
            id: `local_${Date.now()}_file_${file.name}`,
            sender_id: state.user.id, sender_name: state.user.name,
            text: `📎 ${file.name}`, timestamp: Date.now() / 1000,
            delivery_status: DELIVERY_STATUS.SENT,
            files: [{ name: file.name, size: file.size, path: '' }],
            recipient_id: state.currentPeer,
        });
    }
    if (text) {
        localMessages.push({
            id: `local_${Date.now()}_text`,
            sender_id: state.user.id, sender_name: state.user.name,
            text, timestamp: Date.now() / 1000, delivery_status: DELIVERY_STATUS.SENT,
            files: [],
            recipient_id: state.currentPeer,
        });
    }

    if (filesToSend.length > 0) {
        getServerClient().sendMessageWithFiles(text, filesToSend, state.currentPeer)
            .catch(e => console.error('❌ Ошибка отправки файлов:', e));
    } else if (text) {
        getServerClient().sendMessage(text, state.currentPeer);
    }

    // Добавляем все локальные сообщения
    for (const msg of localMessages) {
        state.messages.push(msg);
        if (state.currentPeer) state.filteredMessages.push(msg);
    }
    if (state.currentPeer) {
        renderMessages(true);
    } else { renderMessages(); }

    clearMessageInput();
}

/**
 * Выбор контакта
 */
export function selectPeer(userId) {
    state.currentPeer = userId;
    state.lastRequestedBeforeId = null;
    state.currentPeerBeforeId = null;
    state.hasMoreMessages = true;

    if (elements.chatSettingsBtn) elements.chatSettingsBtn.style.display = 'flex';
    if (elements.chatSettingsMenu) elements.chatSettingsMenu.style.display = 'none';

    document.querySelectorAll('.peer-item').forEach(item => {
        item.classList.toggle('active', item.dataset.userId === userId);
    });

    filterMessagesForCurrentChat();
    renderMessages(true);
    if (hasMoreMessagesForCurrentPeer()) {
        elements.loadMoreContainer.style.display = 'flex';
        elements.loadMoreBtn.disabled = false;
        elements.loadMoreBtn.textContent = t('loadOlder');
    } else {
        elements.loadMoreContainer.style.display = 'none';
    }

    // ACK для непрочитанных
    state.messages.filter(m => m.sender_id === userId && m.delivery_status < DELIVERY_STATUS.READ)
        .forEach(m => {
            getServerClient().sendAck(m.id, 'read');
            m.delivery_status = DELIVERY_STATUS.READ;
        });
    renderMessages(true);

    // Сброс бейджа
    const peerEl = document.querySelector(`.peer-item[data-user-id="${userId}"]`);
    if (peerEl) { const badge = peerEl.querySelector('.unread-badge'); if (badge) badge.remove(); }
}

/**
 * Удаление чата
 */
export async function deleteChatWithPeer(peerId, peerName) {
    if (!confirm(t('deleteChatConfirm', peerName))) return;
    try {
        await getServerClient().deleteChat(peerId);
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
        }
        renderPeers();
        success(t('chatDeleted', peerName));
    } catch (error) {
        showError(`${t('deleteChatError')}: ${error.message}`);
    }
}

/**
 * Загрузка старых сообщений
 */
export async function loadMoreMessages() {
    if (!state.currentPeer || state.isLoadingMessages || !state.hasMoreMessages) return;
    const beforeId = state.currentPeerBeforeId;
    if (!beforeId) return;

    state.isLoadingMessages = true;
    state.lastRequestedBeforeId = beforeId;
    if (elements.loadMoreBtn) { elements.loadMoreBtn.disabled = true; elements.loadMoreBtn.textContent = t('loading'); }
    getServerClient().getMessages(50, beforeId, state.currentPeer);
}
