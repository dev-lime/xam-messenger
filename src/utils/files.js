/**
 * @file Работа с файлами
 * @module Utils/Files
 */

'use strict';

import { getFileIcon, CONFIG } from '../utils/helpers.js';
import { t } from '../i18n.js';
import { error as showError } from '../toast.js';
import { state, elements, attachedFiles, setAttachedFiles, getServerClient } from '../state.js';

/**
 * Обработка выбора файлов
 */
export function handleFileSelect(e) {
    const files = Array.from(e.target.files);
    files.forEach(file => {
        if (file.size > CONFIG.MAX_FILE_SIZE) { showError(t('fileTooBig', file.name)); return; }
        if (!attachedFiles.some(f => f.name === file.name && f.size === file.size)) attachedFiles.push(file);
    });
    elements.fileInput.value = '';
    renderAttachedFiles();
    updateSendButton();
}

/**
 * Рендеринг прикреплённых файлов
 */
export function renderAttachedFiles() {
    elements.attachedFiles.innerHTML = '';
    attachedFiles.forEach((file, index) => {
        const el = document.createElement('div');
        el.className = 'attached-file';
        el.innerHTML = `<span class="attached-file-icon">${getFileIcon(file.name)}</span>
            <span class="attached-file-name">${file.name}</span>
            <button class="attached-file-remove" data-index="${index}">×</button>`;
        el.querySelector('.attached-file-remove').addEventListener('click', (e) => {
            e.stopPropagation();
            el.classList.add('animate-out');
            el.addEventListener('animationend', () => {
                attachedFiles.splice(index, 1);
                renderAttachedFiles();
                updateSendButton();
            }, { once: true });
        });
        elements.attachedFiles.appendChild(el);
    });
    elements.attachedFiles.style.display = attachedFiles.length > 0 ? 'flex' : 'none';
    elements.messageInput.parentElement.classList.toggle('no-border', attachedFiles.length > 0);
}

/**
 * Очистка поля ввода
 */
export function clearMessageInput() {
    elements.messageInput.value = '';
    setAttachedFiles([]);
    renderAttachedFiles();
    updateSendButton();
}

/**
 * Обновление кнопки отправки
 */
export function updateSendButton() {
    const hasText = elements.messageInput.value.trim().length > 0;
    const hasFiles = attachedFiles.length > 0;
    elements.sendBtn.disabled = (!hasText && !hasFiles) || !state.connected;
}

/**
 * Открытие файла — скачивание с прогрессом
 */
export async function openFile(filepath, filename) {
    if (!filepath) { showError(t('filePathNotSpecified')); return; }
    try {
        const httpUrl = getServerClient().httpUrl;
        const fileUrl = filepath.startsWith('http') ? filepath :
            `${httpUrl}/files/download?file_id=${encodeURIComponent(filepath)}`;

        // Находим кнопку для этого файла
        const btn = document.querySelector(`.file-download-btn[data-filepath="${filepath}"]`);
        const downloadIcon = btn?.querySelector('.download-icon');
        const progressRing = btn?.querySelector('.progress-ring');
        const progressCircle = btn?.querySelector('.progress-ring-circle');
        const downloadedIcon = btn?.querySelector('.downloaded-icon');

        if (downloadIcon && progressRing) {
            downloadIcon.style.display = 'none';
            progressRing.style.display = 'inline';
        }

        const response = await fetch(fileUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const contentLength = response.headers.get('content-length');
        const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;

        if (totalBytes > 0 && progressCircle) {
            const reader = response.body.getReader();
            const chunks = [];
            let receivedBytes = 0;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
                receivedBytes += value.length;

                const circumference = 56.55;
                const progress = receivedBytes / totalBytes;
                const offset = circumference * (1 - progress);
                progressCircle.style.strokeDashoffset = offset;
            }

            const blob = new Blob(chunks);
            downloadAndOpenBlob(blob, filename);

            if (progressRing && downloadedIcon) {
                progressRing.style.display = 'none';
                downloadedIcon.style.display = 'inline';
            }
        } else {
            const blob = await response.blob();
            downloadAndOpenBlob(blob, filename);

            if (progressRing && downloadedIcon) {
                progressRing.style.display = 'none';
                downloadedIcon.style.display = 'inline';
            }
        }
    } catch (error) {
        const btn = document.querySelector(`.file-download-btn[data-filepath="${filepath}"]`);
        const downloadIcon = btn?.querySelector('.download-icon');
        const progressRing = btn?.querySelector('.progress-ring');
        if (downloadIcon && progressRing) {
            progressRing.style.display = 'none';
            downloadIcon.style.display = 'inline';
        }
        showError(t('fileDownloadError', error.message));
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
export async function downloadFile(filepath, filename) {
    openFile(filepath, filename);
}
