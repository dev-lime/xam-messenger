/**
 * @file Пагинация и фильтрация сообщений
 * @module Chat/Pagination
 */

'use strict';

import { DELIVERY_STATUS } from '../utils/helpers.js';
import { state, elements } from '../state.js';

/**
 * Проверка: сообщение в текущем чате
 */
function isMessageInCurrentChat(msg) {
    if (!msg.recipient_id) return msg.sender_id === state.currentPeer;
    return (msg.sender_id === state.user?.id && msg.recipient_id === state.currentPeer) ||
        (msg.sender_id === state.currentPeer && msg.recipient_id === state.user?.id);
}

/**
 * Фильтрация сообщений для текущего чата
 */
export function filterMessagesForCurrentChat() {
    if (!state.currentPeer) { state.filteredMessages = []; return; }
    state.filteredMessages = state.messages.filter(msg => isMessageInCurrentChat(msg));
}

/**
 * Проверка возможности загрузки старых сообщений
 */
export function hasMoreMessagesForCurrentPeer() {
    if (!state.currentPeer) return false;
    if (!state.hasMoreMessages) return false;
    if (state.isLoadingMessages) return false;
    return !!state.currentPeerBeforeId;
}
