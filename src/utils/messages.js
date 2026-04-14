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
        // Проверка на ошибку отправки
        const hasError = msg.delivery_status === -1;
        if (hasError) {
            div.classList.add('message-error');
            div.title = msg.send_error || 'Ошибка отправки';
        }

        const statusIcon = hasError ? '❗' :
            msg.delivery_status === DELIVERY_STATUS.READ ? STATUS_ICONS.READ :
                msg.delivery_status === DELIVERY_STATUS.DELIVERED ? STATUS_ICONS.DELIVERED : STATUS_ICONS.SENT;
        const statusTitle = hasError ? (msg.send_error || 'Ошибка отправки') :
            msg.delivery_status === DELIVERY_STATUS.READ ? 'Прочитано' :
                msg.delivery_status === DELIVERY_STATUS.DELIVERED ? 'Доставлено' : 'Отправлено';
        const filesHtml = msg.files?.length ? createFilesHtml(msg.files) : '';
        div.innerHTML = `
            ${msg.text ? `<div class="message-text">${escapeHtml(msg.text)}</div>` : ''}
            ${filesHtml ? `<div class="message-files">${filesHtml}</div>` : ''}
            <div class="message-meta">
                <span class="read-status${hasError ? ' status-error' : ''}" title="${statusTitle}">${statusIcon}</span>
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
                        <span class="download-icon">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M12 5v14M5 12l7 7 7-7"/>
                            </svg>
                        </span>
                        <span class="progress-ring" style="display:none;">
                            <svg width="18" height="18" viewBox="0 0 24 24">
                                <circle class="progress-ring-bg" cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" opacity="0.2"/>
                                <circle class="progress-ring-circle" cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"
                                    stroke-dasharray="56.55" stroke-dashoffset="56.55" stroke-linecap="round"
                                    transform="rotate(-90 12 12)"/>
                            </svg>
                        </span>
                        <span class="downloaded-icon" style="display:none;">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#34c759" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                                <circle cx="12" cy="12" r="10" stroke-width="2"/>
                                <path d="M8 12l3 3 5-5"/>
                            </svg>
                        </span>
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
 * Открытие/скачивание файла с прогрессом
 */
async function openFile(filepath, filename) {
    if (!filepath) { showError(t('filePathNotSpecified')); return; }
    try {
        const sc = getServerClient();
        const url = filepath.startsWith('http') ? filepath : `${sc.httpUrl}/files/download?file_id=${encodeURIComponent(filepath)}`;

        // Находим кнопку для этого файла
        const btn = document.querySelector(`.file-download-btn[data-filepath="${filepath}"]`);
        const downloadIcon = btn?.querySelector('.download-icon');
        const progressRing = btn?.querySelector('.progress-ring');
        const progressCircle = btn?.querySelector('.progress-ring-circle');
        const downloadedIcon = btn?.querySelector('.downloaded-icon');

        // Показываем прогресс-кольцо
        if (downloadIcon && progressRing) {
            downloadIcon.style.display = 'none';
            progressRing.style.display = 'inline';
        }

        // Fetch с чтением stream для прогресса
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const contentLength = response.headers.get('content-length');
        const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;

        if (totalBytes > 0 && progressCircle) {
            // Читаем stream чанками для отображения прогресса
            const reader = response.body.getReader();
            const chunks = [];
            let receivedBytes = 0;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
                receivedBytes += value.length;

                // Обновляем круговой прогресс
                const circumference = 56.55; // 2 * PI * 9
                const progress = receivedBytes / totalBytes;
                const offset = circumference * (1 - progress);
                progressCircle.style.strokeDashoffset = offset;
            }

            // Собираем blob из чанков
            const blob = new Blob(chunks);
            downloadAndOpenBlob(blob, filename);

            // Показываем галочку
            if (progressRing && downloadedIcon) {
                progressRing.style.display = 'none';
                downloadedIcon.style.display = 'inline';
            }
        } else {
            // Нет content-length — скачиваем как обычно
            const blob = await response.blob();
            downloadAndOpenBlob(blob, filename);

            // Показываем галочку
            if (progressRing && downloadedIcon) {
                progressRing.style.display = 'none';
                downloadedIcon.style.display = 'inline';
            }
        }
    } catch (error) {
        // Возвращаем иконку скачивания при ошибке
        const btn = document.querySelector(`.file-download-btn[data-filepath="${filepath}"]`);
        const downloadIcon = btn?.querySelector('.download-icon');
        const progressRing = btn?.querySelector('.progress-ring');
        if (downloadIcon && progressRing) {
            progressRing.style.display = 'none';
            downloadIcon.style.display = 'inline';
        }
        showError(t('fileOpenError', error.message));
    }
}

/**
 * Скачивание и открытие blob
 */
function downloadAndOpenBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(url);
    document.body.removeChild(a);
}

/**
 * Скачивание файла
 */
async function downloadFile(filepath, filename) {
    openFile(filepath, filename);
}

/**
 * Добавить одно сообщение в конец (оптимизация — без полной перерисовки)
 * @param {Object} msg - Сообщение
 */
export function appendMessage(msg) {
    if (!elements.messages || !elements.messagesContainer) return;
    const scrollContainer = elements.messagesContainer;
    const isScrolledToBottom = scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight < 50;

    // Добавляем разделитель даты если нужно
    const msgDate = new Date(msg.timestamp * 1000).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    const lastSeparator = elements.messages.querySelector('.message-date-separator:last-of-type');
    if (!lastSeparator || lastSeparator.textContent !== msgDate) {
        const separators = elements.messages.querySelectorAll('.message-date-separator');
        const lastSep = separators[separators.length - 1];
        if (!lastSep || lastSep.textContent !== msgDate) {
            const sep = document.createElement('div');
            sep.className = 'message-date-separator';
            sep.textContent = msgDate;
            elements.messages.appendChild(sep);
        }
    }

    elements.messages.appendChild(createMessageElement(msg));

    if (isScrolledToBottom) scrollToBottom();
}

/**
 * Вставить старые сообщения в начало (для пагинации)
 * @param {Object[]} msgs - Массив сообщений (от старых к новым)
 * @returns {boolean} Были ли вставлены сообщения
 */
export function prependMessages(msgs) {
    if (!elements.messages || !elements.messagesContainer || msgs.length === 0) return false;
    const scrollContainer = elements.messagesContainer;
    const oldScrollHeight = scrollContainer.scrollHeight;

    // Создаём фрагмент для.batch вставки
    const fragment = document.createDocumentFragment();
    let lastDate = null;

    // Идём с конца чтобы правильно определить разделители дат
    const reversed = [...msgs].reverse();
    for (const msg of reversed) {
        const msgDate = new Date(msg.timestamp * 1000).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
        if (lastDate !== msgDate) {
            const sep = document.createElement('div');
            sep.className = 'message-date-separator';
            sep.textContent = msgDate;
            fragment.appendChild(sep);
            lastDate = msgDate;
        }
        fragment.appendChild(createMessageElement(msg));
    }

    // Вставляем после loadMoreContainer
    const loadMoreEl = elements.loadMoreContainer;
    if (loadMoreEl && loadMoreEl.parentNode === elements.messages) {
        // Вставляем после кнопки загрузки
        const firstMsg = elements.messages.querySelector('.message, .message-date-separator');
        if (firstMsg) {
            elements.messages.insertBefore(fragment, firstMsg);
        } else {
            elements.messages.appendChild(fragment);
        }
    } else {
        elements.messages.prepend(fragment);
    }

    // Сохраняем позицию прокрутки
    const newScrollHeight = scrollContainer.scrollHeight;
    scrollContainer.scrollTop = newScrollHeight - oldScrollHeight;

    return true;
}
