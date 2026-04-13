/**
 * @file Рендеринг сообщений
 * @module Utils/Messages
 */

'use strict';

import { escapeHtml, getFileIcon, formatFileSize, STATUS_ICONS, DELIVERY_STATUS } from '../utils/helpers.js';
import { state, elements, getServerClient } from '../state.js';
import { t } from '../i18n.js';
import { error as showError } from '../toast.js';

/**
 * Рендеринг сообщений
 */
export function renderMessages(useFiltered = false, preserveScroll = false) {
    if (!elements.messages) return;
    const scrollContainer = elements.chatScrollContainer || elements.messagesContainer;
    let oldScrollHeight, oldScrollTop;
    if (preserveScroll) { oldScrollHeight = scrollContainer.scrollHeight; oldScrollTop = scrollContainer.scrollTop; }

    elements.messages.innerHTML = '';

    if (!state.currentPeer) { renderEmptyChatState(); return; }
    showMessageInput();

    const msgs = useFiltered && state.filteredMessages ? state.filteredMessages : state.messages;
    if (msgs.length === 0) {
        elements.messages.innerHTML = '<p style="text-align:center;color:var(--text-tertiary);padding:20px;">Нет сообщений</p>';
        return;
    }

    let lastDate = null;
    msgs.forEach(msg => {
        const msgDate = new Date(msg.timestamp * 1000).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
        if (lastDate !== msgDate) {
            const sep = document.createElement('div');
            sep.className = 'message-date-separator';
            sep.textContent = msgDate;
            elements.messages.appendChild(sep);
            lastDate = msgDate;
        }
        elements.messages.appendChild(createMessageElement(msg));
    });

    if (preserveScroll && oldScrollHeight !== undefined) {
        scrollContainer.scrollTop = oldScrollTop + (scrollContainer.scrollHeight - oldScrollHeight);
    } else { scrollToBottom(); }
}

/**
 * Пустое состояние чата
 */
export function renderEmptyChatState() {
    if (!elements.messages) return;
    elements.messages.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--text-tertiary);text-align:center;padding:40px;">
            <div style="font-size:18px;margin-bottom:10px;">Выберите чат</div>
            <div style="font-size:14px;">Выберите контакт из списка слева чтобы начать общение</div>
        </div>`;
    if (elements.chatSettingsBtn) elements.chatSettingsBtn.style.display = 'none';
}

/**
 * Создание элемента сообщения
 */
function createMessageElement(msg) {
    const div = document.createElement('div');
    const isMine = msg.sender_id === state.user?.id;
    div.className = `message ${isMine ? 'mine' : 'theirs'}`;
    const time = new Date(msg.timestamp * 1000).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

    if (isMine) {
        const statusIcon = msg.delivery_status === DELIVERY_STATUS.READ ? STATUS_ICONS.READ :
            msg.delivery_status === DELIVERY_STATUS.DELIVERED ? STATUS_ICONS.DELIVERED : STATUS_ICONS.SENT;
        const statusTitle = msg.delivery_status === DELIVERY_STATUS.READ ? 'Прочитано' :
            msg.delivery_status === DELIVERY_STATUS.DELIVERED ? 'Доставлено' : 'Отправлено';
        const filesHtml = msg.files?.length ? createFilesHtml(msg.files) : '';
        div.innerHTML = `
            ${msg.text ? `<div class="message-text">${escapeHtml(msg.text)}</div>` : ''}
            ${filesHtml ? `<div class="message-files">${filesHtml}</div>` : ''}
            <div class="message-meta">
                <span class="read-status" title="${statusTitle}">${statusIcon}</span>
                <span>${time}</span>
            </div>`;
    } else {
        const filesHtml = msg.files?.length ? createFilesHtml(msg.files) : '';
        div.innerHTML = `
            <div class="message-sender">👤 ${escapeHtml(msg.sender_name)}</div>
            ${msg.text ? `<div class="message-text">${escapeHtml(msg.text)}</div>` : ''}
            ${filesHtml ? `<div class="message-files">${filesHtml}</div>` : ''}
            <div class="message-meta">${time}</div>`;
    }
    return div;
}

/**
 * HTML для файлов
 */
function createFilesHtml(files) {
    return files.map(f => {
        const icon = getFileIcon(f.name);
        const size = formatFileSize(f.size);
        const name = escapeHtml(f.name);
        const pathAttr = escapeHtml(f.path || '');
        return `<div class="file-item" data-filepath="${pathAttr}" data-filename="${name}">
            <span class="file-icon">${icon}</span>
            <span class="file-info">
                <span class="file-name-row">
                    <span class="file-name">${name}</span>
                    <button class="file-download-btn" data-filepath="${pathAttr}" data-filename="${name}" type="button">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                            <path d="M12 5v14M5 12l7 7 7-7"/>
                        </svg>
                    </button>
                </span>
                <span class="file-size">${size}</span>
            </span>
        </div>`;
    }).join('');
}

/**
 * Показать панель ввода
 */
function showMessageInput() {
    if (elements.messageInput) elements.messageInput.closest('.input-area').style.display = 'flex';
}

/**
 * Прокрутка вниз
 */
export function scrollToBottom() {
    const container = elements.chatScrollContainer || elements.messagesContainer;
    container.scrollTop = container.scrollHeight;
}

/**
 * Настройка event delegation для кликов по файлам в сообщениях
 * Вызывать после renderMessages() или один раз при инициализации
 */
export function setupFileDelegation() {
    if (!elements.messages) return;

    elements.messages.addEventListener('click', (e) => {
        // Клик по file-item (открытие файла)
        const fileItem = e.target.closest('.file-item');
        if (fileItem) {
            const filepath = fileItem.dataset.filepath;
            const filename = fileItem.dataset.filename;
            if (filepath && filename) {
                e.preventDefault();
                openFile(filepath, filename);
            }
            return;
        }

        // Клик по кнопке скачивания
        const downloadBtn = e.target.closest('.file-download-btn');
        if (downloadBtn) {
            const filepath = downloadBtn.dataset.filepath;
            const filename = downloadBtn.dataset.filename;
            if (filepath && filename) {
                e.preventDefault();
                e.stopPropagation();
                downloadFile(filepath, filename);
            }
        }
    });
}

/**
 * Открытие/скачивание файла
 */
async function openFile(filepath, filename) {
    if (!filepath) { showError(t('filePathNotSpecified')); return; }
    try {
        const sc = getServerClient();
        const url = filepath.startsWith('http') ? filepath : `${sc.httpUrl}/files/download?file_id=${encodeURIComponent(filepath)}`;
        const r = await fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const blob = await r.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        URL.revokeObjectURL(a.href);
        document.body.removeChild(a);
    } catch (error) {
        showError(t('fileOpenError', error.message));
    }
}

/**
 * Скачивание файла
 */
async function downloadFile(filepath, filename) {
    openFile(filepath, filename);
}
