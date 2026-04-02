/**
 * @file Функции рендеринга для UI
 * @module UI/Renderers
 */

'use strict';

import { escapeHtml, getFileIcon, formatFileSize, STATUS_ICONS } from '../utils/helpers.js';

/**
 * Создание HTML для списка файлов
 * @param {Array} files - Массив файлов
 * @returns {string} HTML строка
 */
function createFilesHtml(files) {
    if (!files || files.length === 0) return '';

    return files.map(file => {
        const icon = getFileIcon(file.name);
        const size = formatFileSize(file.size);
        const safeName = escapeHtml(file.name);
        return `
			<div class="attached-file-item" data-file-path="${file.path}">
				<span class="file-icon">${icon}</span>
				<span class="file-name">${safeName}</span>
				<span class="file-size">${size}</span>
			</div>
		`.trim();
    }).join('');
}

/**
 * Получение иконки статуса доставки
 * @param {number} status - Статус доставки (0, 1, 2)
 * @returns {string} Эмодзи статуса
 */
function getStatusIcon(status) {
    switch (status) {
    case 0: return STATUS_ICONS.SENDING;
    case 1: return STATUS_ICONS.SENT;
    case 2: return STATUS_ICONS.READ;
    default: return STATUS_ICONS.PENDING;
    }
}

/**
 * Получение текстового описания статуса
 * @param {number} status - Статус доставки
 * @returns {string} Описание статуса
 */
function getStatusTitle(status) {
    switch (status) {
    case 0: return 'Отправляется...';
    case 1: return 'Отправлено';
    case 2: return 'Прочитано';
    default: return 'Неизвестно';
    }
}

/**
 * Форматирование времени сообщения
 * @param {number} timestamp - Unix timestamp (секунды)
 * @returns {string} Отформатированное время (HH:MM)
 */
function formatMessageTime(timestamp) {
    const date = new Date(timestamp * 1000);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}

/**
 * Создание HTML для сообщения от текущего пользователя
 * @param {Object} msg - Сообщение
 * @param {string} time - Отформатированное время
 * @returns {string} HTML строка
 */
function createMineMessageHtml(msg, time) {
    const statusIcon = getStatusIcon(msg.delivery_status);
    const statusTitle = getStatusTitle(msg.delivery_status);
    const filesHtml = createFilesHtml(msg.files);
    const safeText = escapeHtml(msg.text);

    return `
		<div class="message mine" data-message-id="${msg.id}">
			<div class="message-content">
				${safeText ? `<div class="message-text">${safeText}</div>` : ''}
				${filesHtml ? `<div class="message-files">${filesHtml}</div>` : ''}
				<div class="message-meta">
					<span class="message-time">${time}</span>
					<span class="message-status" title="${statusTitle}">${statusIcon}</span>
				</div>
			</div>
		</div>
	`.trim();
}

/**
 * Создание HTML для сообщения от другого пользователя
 * @param {Object} msg - Сообщение
 * @param {string} time - Отформатированное время
 * @returns {string} HTML строка
 */
function createTheirsMessageHtml(msg, time) {
    const filesHtml = createFilesHtml(msg.files);
    const safeText = escapeHtml(msg.text);
    const safeSender = escapeHtml(msg.sender_name);

    return `
		<div class="message theirs" data-message-id="${msg.id}">
			<div class="message-sender">${safeSender}</div>
			<div class="message-content">
				${safeText ? `<div class="message-text">${safeText}</div>` : ''}
				${filesHtml ? `<div class="message-files">${filesHtml}</div>` : ''}
				<div class="message-meta">
					<span class="message-time">${time}</span>
				</div>
			</div>
		</div>
	`.trim();
}

/**
 * Создание HTML для элемента контакта
 * @param {Object} peer - Контакт
 * @param {string} lastMessage - Последнее сообщение
 * @param {string} lastMessageTime - Время последнего сообщения
 * @param {boolean} isOnline - Онлайн ли контакт
 * @returns {string} HTML строка
 */
function createPeerElementHtml(peer, lastMessage = '', lastMessageTime = '', isOnline = false) {
    const safeName = escapeHtml(peer.name);
    const safeLastMessage = escapeHtml(lastMessage);
    const onlineClass = isOnline ? 'online' : 'offline';
    const avatar = peer.avatar || '👤';

    return `
		<div class="peer-item ${onlineClass}" data-user-id="${peer.id}">
			<div class="peer-avatar">${avatar}</div>
			<div class="peer-info">
				<div class="peer-name">${safeName}</div>
				<div class="peer-last-message">
					${safeLastMessage}
					${lastMessageTime ? `<span class="peer-time">${lastMessageTime}</span>` : ''}
				</div>
			</div>
			<div class="peer-status-indicator ${onlineClass}"></div>
		</div>
	`.trim();
}

/**
 * Создание HTML для пустого состояния чата
 * @returns {string} HTML строка
 */
function createEmptyChatHtml() {
    return `
		<div class="empty-chat">
			<div class="empty-chat-icon">💬</div>
			<div class="empty-chat-text">Выберите контакт для начала общения</div>
		</div>
	`.trim();
}

/**
 * Создание HTML для прикрепленных файлов в форме ввода
 * @param {Array} files - Массив файлов
 * @returns {string} HTML строка
 */
function createAttachedFilesHtml(files) {
    if (!files || files.length === 0) return '';

    return files.map((file, index) => {
        const icon = getFileIcon(file.name);
        const size = formatFileSize(file.size);
        const safeName = escapeHtml(file.name);
        return `
			<div class="attached-file-preview" data-index="${index}">
				<span class="file-icon">${icon}</span>
				<span class="file-name">${safeName}</span>
				<span class="file-size">${size}</span>
				<button class="remove-file-btn" data-index="${index}" title="Удалить файл">✕</button>
			</div>
		`.trim();
    }).join('');
}

// Экспорт для CommonJS (Jest)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        createFilesHtml,
        getStatusIcon,
        getStatusTitle,
        formatMessageTime,
        createMineMessageHtml,
        createTheirsMessageHtml,
        createPeerElementHtml,
        createEmptyChatHtml,
        createAttachedFilesHtml,
    };
}
