/**
 * @file Настройка всех обработчиков событий
 * @module Events/Setup
 */

'use strict';

import { elements, state, userSettings } from '../state.js';
import { getServerClient } from '../state.js';
import { t, setLanguage } from '../i18n.js';
import { success } from '../toast.js';
import { openServerSelector, connectToServer, refreshServerList } from '../dialogs/server.js';
import { openProfileMenu, closeProfileMenu, saveSettings, openSettingsDialog, logout } from '../dialogs/profile.js';
import { selectPeer, deleteChatWithPeer, sendMessage, loadMoreMessages } from '../chat/actions.js';
import { handleFileSelect, renderAttachedFiles, updateSendButton, clearMessageInput } from '../utils/files.js';
import { CONFIG } from '../utils/helpers.js';

/**
 * Настройка всех обработчиков
 */
export function setupEventListeners() {
    // Статус подключения
    if (elements.connectionStatus) {
        elements.connectionStatus.addEventListener('click', async () => {
            if (state.connected) { showLatency(); return; }
            if (localStorage.getItem(CONFIG.STORAGE_KEYS.SESSION_USER) && localStorage.getItem(CONFIG.STORAGE_KEYS.SESSION_SERVER)) {
                try {
                    const user = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.SESSION_USER));
                    const server = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.SESSION_SERVER));
                    state.selectedServer = server;
                    elements.userNameInput.value = user.name;
                    if (elements.serverStatus) elements.serverStatus.innerHTML = '<span style="color:var(--warning);">🔄 Переподключение...</span>';
                    await connectToServer();
                } catch { openServerSelector(); }
            } else { openServerSelector(); }
        });
    }

    // Диалог подключения
    elements.confirmConnect.addEventListener('click', connectToServer);
    elements.userNameInput.addEventListener('keydown', e => { if (e.key === 'Enter') connectToServer(); });
    elements.userNameInput.addEventListener('input', () => { if (elements.confirmConnect) elements.confirmConnect.disabled = !elements.userNameInput.value.trim(); });

    // Смена сервера
    if (elements.changeServerBtn) elements.changeServerBtn.addEventListener('click', () => { elements.connectDialog.close(); openServerSelector(); });

    // Отправка
    elements.sendBtn.addEventListener('click', sendMessage);
    elements.messageInput.addEventListener('input', updateSendButton);
    elements.messageInput.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });

    // Файлы
    elements.attachBtn.addEventListener('click', () => elements.fileInput.click());
    elements.fileInput.addEventListener('change', handleFileSelect);

    // Поиск контактов
    let searchTimer;
    if (elements.peerSearchInput) {
        elements.peerSearchInput.addEventListener('input', e => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => { state.peerSearchQuery = e.target.value.trim(); import('../utils/peers.js').then(m => m.renderPeers()); }, 150);
        });
    }

    // Floating кнопка настроек чата
    if (elements.chatSettingsBtn) {
        elements.chatSettingsBtn.addEventListener('click', e => {
            e.stopPropagation();
            if (elements.chatSettingsMenu) elements.chatSettingsMenu.style.display = elements.chatSettingsMenu.style.display !== 'none' ? 'none' : 'flex';
        });
    }

    // Закрытие меню
    document.addEventListener('click', e => {
        if (elements.chatSettingsMenu && !elements.chatSettingsMenu.contains(e.target) &&
            elements.chatSettingsBtn && !elements.chatSettingsBtn.contains(e.target)) {
            elements.chatSettingsMenu.style.display = 'none';
        }
        if (elements.profileContextMenu && elements.profileMenuContainer && !elements.profileMenuContainer.contains(e.target)) {
            closeProfileMenu();
        }
    });

    // Меню настроек чата
    if (elements.chatSettingsMenu) {
        elements.chatSettingsMenu.addEventListener('click', e => {
            const btn = e.target.closest('[data-action]');
            if (btn && btn.dataset.action === 'delete-chat' && state.currentPeer) {
                const peer = state.peers.find(p => p.id === state.currentPeer);
                if (peer) deleteChatWithPeer(state.currentPeer, peer.name);
            }
            elements.chatSettingsMenu.style.display = 'none';
        });
    }

    // Профиль
    if (elements.profileAvatarBtn) elements.profileAvatarBtn.addEventListener('click', e => { e.stopPropagation(); openProfileMenu(); });
    if (elements.menuProfile) elements.menuProfile.addEventListener('click', () => { openSettingsDialog(); closeProfileMenu(); });
    if (elements.menuSettings) elements.menuSettings.addEventListener('click', () => { if (!state.connected) { alert('Подключитесь к серверу'); } else { elements.appSettingsDialog.showModal(); } closeProfileMenu(); });
    if (elements.menuLogout) elements.menuLogout.addEventListener('click', logout);
    if (elements.menuChangeServer) elements.menuChangeServer.addEventListener('click', () => { if (state.connected) { getServerClient().disconnect(); state.connected = false; state.user = null; state.selectedServer = null; state.peers = []; state.messages = []; state.filteredMessages = []; state.currentPeer = null; clearSession(); } openServerSelector(); closeProfileMenu(); });

    // Настройки приложения
    if (elements.closeAppSettings) elements.closeAppSettings.addEventListener('click', () => elements.appSettingsDialog.close());
    if (elements.saveAppSettings) elements.saveAppSettings.addEventListener('click', () => { elements.appSettingsDialog.close(); });
    if (elements.resetAppSettings) elements.resetAppSettings.addEventListener('click', () => { elements.appSettingsDialog.close(); });
    if (elements.settingFontSize && elements.fontSizeValue) elements.settingFontSize.addEventListener('input', () => { elements.fontSizeValue.textContent = `${elements.settingFontSize.value}px`; });

    // Язык
    if (elements.settingLanguage) elements.settingLanguage.addEventListener('change', e => { setLanguage(e.target.value); success(`Language: ${e.target.value === 'ru' ? 'Русский' : 'English'}`); });

    // Диалог настроек профиля
    elements.cancelSettings.addEventListener('click', () => elements.settingsDialog.close());
    elements.saveSettings.addEventListener('click', saveSettings);

    // Серверы
    if (elements.refreshServersBtn) elements.refreshServersBtn.addEventListener('click', refreshServerList);
    if (elements.confirmManualServer) elements.confirmManualServer.addEventListener('click', connectToManualServer);
    if (elements.cancelServerSelector) elements.cancelServerSelector.addEventListener('click', () => elements.serverSelectorDialog.close());
    if (elements.manualServerInput) elements.manualServerInput.addEventListener('keydown', e => { if (e.key === 'Enter') connectToManualServer(); });

    // Пагинация
    if (elements.loadMoreBtn) elements.loadMoreBtn.addEventListener('click', loadMoreMessages);

    // Drag'n'drop
    initDragAndDrop();

    // Глобальные функции для inline onclick
    window._selectPeer = selectPeer;
    window._openFile = openFile;
    window._downloadFile = downloadFile;
}

/**
 * Задержка сервера
 */
async function showLatency() {
    if (!state.connected || !state.selectedServer) return;
    const latencyEl = elements.statusLatency;
    const statusEl = elements.connectionStatus;
    if (statusEl.classList.contains('pinging')) return;
    statusEl.classList.add('pinging');
    latencyEl.textContent = '⏳ ...';
    latencyEl.className = 'status-latency visible';
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        await fetch(`${state.selectedServer.httpUrl}/users`, { method: 'GET', signal: controller.signal });
        clearTimeout(timer);
        latencyEl.textContent = `⏱ ${Math.round(performance.now() - latencyEl.dataset.start || 0)} мс`;
    } catch { latencyEl.textContent = '❌ Нет ответа'; }
    setTimeout(() => { latencyEl.classList.remove('visible'); latencyEl.classList.add('hiding'); setTimeout(() => { statusEl.classList.remove('pinging'); latencyEl.className = 'status-latency'; }, 400); }, 2000);
}

/**
 * Подключение к серверу вручную
 */
async function connectToManualServer() {
    const address = elements.manualServerInput?.value.trim();
    if (!address) { alert('Введите адрес сервера'); return; }
    let wsUrl = address;
    if (!wsUrl.startsWith('ws://') && !wsUrl.startsWith('wss://')) wsUrl = `ws://${address}`;
    try {
        const parsed = new URL(wsUrl);
        const ip = parsed.hostname;
        const port = parsed.port ? parseInt(parsed.port) : 8080;
        const httpUrl = `http://${ip}:${port}`;
        if (!parsed.pathname.endsWith('/ws')) wsUrl = `ws://${ip}:${port}/ws`;
        state.selectedServer = { wsUrl, httpUrl, ip, port, source: 'manual' };
        if (window.__TAURI__?.core?.invoke || window.__TAURI__?.invoke) {
            const fn = window.__TAURI__.core?.invoke || window.__TAURI__.invoke;
            fn('cache_server', { ip, port, source: 'manual' }).catch(console.warn);
        }
        if (elements.serverSelectorDialog) elements.serverSelectorDialog.close();
        if (elements.selectedServerInfo) { elements.selectedServerInfo.textContent = `📡 ${ip}:${port}`; elements.selectedServerInfo.style.color = 'var(--success)'; }
        elements.connectDialog.showModal();
        elements.userNameInput.value = userSettings?.name || '';
        elements.userNameInput.focus();
        if (elements.confirmConnect) elements.confirmConnect.disabled = !elements.userNameInput.value.trim();
    } catch (e) { alert(`Неверный формат: ${e.message}`); }
}

/**
 * Drag'n'drop
 */
function initDragAndDrop() {
    const dropZone = elements.inputArea;
    dropZone.addEventListener('dragenter', e => { e.preventDefault(); e.stopPropagation(); dropZone.classList.add('drag-over'); }, false);
    dropZone.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; dropZone.classList.add('drag-over'); }, false);
    dropZone.addEventListener('dragleave', e => { e.preventDefault(); e.stopPropagation(); if (e.target === dropZone) dropZone.classList.remove('drag-over'); }, false);
    dropZone.addEventListener('drop', e => {
        e.preventDefault(); e.stopPropagation(); dropZone.classList.remove('drag-over');
        if (e.dataTransfer?.files?.length > 0) {
            Array.from(e.dataTransfer.files).forEach(file => {
                if (file.size <= CONFIG.MAX_FILE_SIZE) {
                    // TODO: integrate with attachedFiles
                }
            });
        }
    }, false);
}

/**
 * Открытие/скачивание файла
 */
async function openFile(filepath, filename) {
    if (!filepath) { alert('Путь к файлу не указан'); return; }
    try {
        const sc = getServerClient();
        const url = filepath.startsWith('http') ? filepath : `${sc.httpUrl}/files/download?file_id=${encodeURIComponent(filepath)}`;
        const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const blob = await r.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = filename;
        document.body.appendChild(a); a.click();
        URL.revokeObjectURL(a.href); document.body.removeChild(a);
    } catch (error) { alert(`Ошибка: ${error.message}`); }
}

async function downloadFile(filepath, filename) {
    openFile(filepath, filename);
}

function clearSession() {
    localStorage.removeItem(CONFIG.STORAGE_KEYS.SESSION_USER);
    localStorage.removeItem(CONFIG.STORAGE_KEYS.SESSION_SERVER);
}
