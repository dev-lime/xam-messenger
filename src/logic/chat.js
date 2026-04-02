/**
 * @file Логика чата - фильтрация и обработка сообщений
 * @module Logic/Chat
 */

'use strict';

import { DELIVERY_STATUS } from '../utils/helpers.js';

/**
 * Проверка: сообщение в текущем чате
 */
function isMessageInCurrentChat(msg, currentPeer, user) {
    // Сообщения без recipient_id — это сообщения для всех (общие)
    // Показываем их только в чате с отправителем
    if (!msg.recipient_id) {
        return msg.sender_id === currentPeer;
    }

    // Сообщения с получателем показываем только в соответствующем чате
    return (
        (msg.sender_id === user?.id && msg.recipient_id === currentPeer) ||
		(msg.sender_id === currentPeer && msg.recipient_id === user?.id)
    );
}

/**
 * Фильтрация сообщений для текущего чата
 * @param {Array} messages - Все сообщения
 * @param {string|null} currentPeer - ID текущего собеседника
 * @param {Object|null} user - Текущий пользователь
 * @returns {Array} Отфильтрованные сообщения
 */
export function filterMessagesForChat(messages, currentPeer, user) {
    if (!currentPeer) return [];
    return messages.filter(msg => isMessageInCurrentChat(msg, currentPeer, user));
}

/**
 * Проверка возможности загрузки старых сообщений
 * @param {Object} state - Состояние приложения
 * @returns {boolean} true если есть возможность загрузки
 */
export function hasMoreMessagesForCurrentPeer(state) {
    if (!state.currentPeer) return false;
    if (!state.hasMoreMessages) return false;
    if (state.isLoadingMessages) return false;

    // Кнопка показывается только если есть ID для пагинации
    return !!state.currentPeerBeforeId;
}

/**
 * Поиск локального сообщения по тексту и времени
 * @param {Array} messages - Все сообщения
 * @param {Object} msg - Новое сообщение для поиска
 * @param {string} userId - ID текущего пользователя
 * @param {number} ttl - Время жизни локального сообщения (секунды)
 * @returns {number} Индекс локального сообщения или -1
 */
export function findLocalMessageIndex(messages, msg, userId, ttl = 10) {
    return messages.findIndex(
        (m) =>
            m.id.startsWith('local_') &&
			m.sender_id === userId &&
			m.text === msg.text &&
			Math.abs(m.timestamp - msg.timestamp) < ttl
    );
}

/**
 * Проверка сообщения на дубликат
 * @param {Array} messages - Все сообщения
 * @param {Object} msg - Сообщение для проверки
 * @returns {boolean} true если дубликат найден
 */
export function isDuplicateMessage(messages, msg) {
    return messages.some((m) => m.id === msg.id);
}

/**
 * Проверка: является ли сообщение локальным
 * @param {Object} msg - Сообщение
 * @returns {boolean} true если сообщение локальное
 */
export function isLocalMessage(msg) {
    return msg.id.startsWith('local_');
}

/**
 * Создание локального сообщения
 * @param {string} text - Текст сообщения
 * @param {string} userId - ID пользователя
 * @param {string} userName - Имя пользователя
 * @param {Array} files - Файлы
 * @param {string|null} recipientId - ID получателя
 * @returns {Object} Локальное сообщение
 */
export function createLocalMessage(text, userId, userName, files = [], recipientId = null) {
    return {
        id: `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        sender_id: userId,
        sender_name: userName,
        text,
        timestamp: Date.now() / 1000,
        delivery_status: DELIVERY_STATUS.SENT,
        recipient_id: recipientId,
        files,
    };
}

/**
 * Обновление локального сообщения реальным
 * @param {Object} localMsg - Локальное сообщение
 * @param {Object} realMsg - Реальное сообщение от сервера
 * @returns {Object} Обновлённое сообщение
 */
export function updateMessageWithReal(localMsg, realMsg) {
    return {
        ...realMsg,
        delivery_status: localMsg.delivery_status, // Сохраняем статус локального
    };
}

/**
 * Определение статуса доставки для нового сообщения
 * @param {boolean} isMine - true если сообщение от текущего пользователя
 * @param {string|null} currentPeer - ID текущего собеседника
 * @param {string} senderId - ID отправителя
 * @returns {number} Статус доставки (0=отправлено, 1=доставлено, 2=прочитано)
 */
export function getDeliveryStatusForNewMessage(isMine, currentPeer, senderId) {
    // Если это наше сообщение в открытом чате с получателем — сразу READ
    if (isMine && currentPeer && senderId === currentPeer) {
        return DELIVERY_STATUS.READ;
    }
    // Если наше сообщение — DELIVERED
    if (isMine) {
        return DELIVERY_STATUS.DELIVERED;
    }
    // Если сообщение от текущего пира в открытом чате — READ
    if (currentPeer && senderId === currentPeer) {
        return DELIVERY_STATUS.READ;
    }
    return DELIVERY_STATUS.DELIVERED;
}

// Экспорт для CommonJS (Jest)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        isMessageInCurrentChat,
        filterMessagesForChat,
        hasMoreMessagesForCurrentPeer,
        findLocalMessageIndex,
        isDuplicateMessage,
        isLocalMessage,
        createLocalMessage,
        updateMessageWithReal,
        getDeliveryStatusForNewMessage,
    };
}
