/**
 * @file Настройка всех обработчиков событий
 * @module Events/Setup
 */

'use strict';

import { elements, state, userSettings } from '../state.js';
import { t, setLanguage } from '../i18n.js';
import { success } from '../toast.js';
import { openServerSelector, connectToServer, refreshServerList } from '../dialogs/server.js';
import { openProfileMenu, closeProfileMenu, saveSettings, openSettingsDialog, logout } from '../dialogs/profile.js';
import { selectPeer, deleteChatWithPeer, sendMessage, loadMoreMessages } from '../chat/actions.js';
import { handleFileSelect, updateSendButton } from '../utils/files.js';
import { CONFIG } from '../utils/helpers.js';
import { saveAppSettings, loadAppSettings } from '../settings.js';
import { storage } from '../storage.js';

/**
 * Настройка всех обработчиков
 */
export function setupEventListeners() {
    // Статус подключения
    if (elements.connectionStatus) {
        elements.connectionStatus.addEventListener('click', async () => {
            if (state.connected) { showLatency(); return; }
            if (storage.get(CONFIG.STORAGE_KEYS.SESSION_USER) && storage.get(CONFIG.STORAGE_KEYS.SESSION_SERVER)) {
                try {
                    const user = storage.getJson(CONFIG.STORAGE_KEYS.SESSION_USER);
                    const server = storage.getJson(CONFIG.STORAGE_KEYS.SESSION_SERVER);
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
    if (elements.menuSettings) elements.menuSettings.addEventListener('click', () => { if (!state.connected) { alert(t('connectToServerAlert')); } else { elements.appSettingsDialog.showModal(); } closeProfileMenu(); });
    if (elements.menuLogout) elements.menuLogout.addEventListener('click', logout);
    if (elements.menuChangeServer) elements.menuChangeServer.addEventListener('click', () => { if (state.connected) { getServerClient().disconnect(); state.connected = false; state.user = null; state.selectedServer = null; state.peers = []; state.messages = []; state.filteredMessages = []; state.currentPeer = null; clearSession(); } openServerSelector(); closeProfileMenu(); });

    // Настройки приложения
    if (elements.closeAppSettings) elements.closeAppSettings.addEventListener('click', () => elements.appSettingsDialog.close());
    if (elements.saveAppSettings) elements.saveAppSettings.addEventListener('click', () => {
        const appSettings = collectAppSettings();
        saveAppSettings(appSettings);
        applyAppSettings(appSettings);
        elements.appSettingsDialog.close();
        success(t('done'));
    });
    if (elements.resetAppSettings) elements.resetAppSettings.addEventListener('click', () => {
        storage.remove(CONFIG.STORAGE_KEYS.APP_SETTINGS);
        elements.appSettingsDialog.close();
    });
    if (elements.settingFontSize && elements.fontSizeValue) elements.settingFontSize.addEventListener('input', () => { elements.fontSizeValue.textContent = `${elements.settingFontSize.value}px`; });

    // Язык
    if (elements.settingLanguage) elements.settingLanguage.addEventListener('change', e => { setLanguage(e.target.value); success(`Language: ${e.target.value === 'ru' ? t('languageNameRu') : t('languageNameEn')}`); });

    // Диалог настроек профиля
    elements.cancelSettings.addEventListener('click', () => elements.settingsDialog.close());
    elements.saveSettings.addEventListener('click', saveSettings);
    // TODO: Реализовать удаление профиля (пока заглушка)
    if (elements.deleteProfileBtn) {
        elements.deleteProfileBtn.addEventListener('click', () => {
            // Пока не реализовано — просто показываем confirm
            if (confirm(t('deleteProfileConfirm'))) {
                alert('Функция удаления профиля ещё не реализована.');
            }
        });
    }

    // Серверы
    if (elements.refreshServersBtn) elements.refreshServersBtn.addEventListener('click', refreshServerList);
    if (elements.confirmManualServer) elements.confirmManualServer.addEventListener('click', connectToManualServer);
    if (elements.cancelServerSelector) elements.cancelServerSelector.addEventListener('click', () => elements.serverSelectorDialog.close());
    if (elements.manualServerInput) elements.manualServerInput.addEventListener('keydown', e => { if (e.key === 'Enter') connectToManualServer(); });

    // Пагинация
    if (elements.loadMoreBtn) elements.loadMoreBtn.addEventListener('click', loadMoreMessages);

    // Drag'n'drop
    initDragAndDrop();

    // Глобальные функции для inline onclick (больше не нужны — используем event delegation)
    // window._selectPeer, window._openFile, window._downloadFile удалены
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
        latencyEl.textContent = `⏱ ${t('latencyMs', Math.round(performance.now() - latencyEl.dataset.start || 0))}`;
    } catch { latencyEl.textContent = t('noResponse'); }
    setTimeout(() => { latencyEl.classList.remove('visible'); latencyEl.classList.add('hiding'); setTimeout(() => { statusEl.classList.remove('pinging'); latencyEl.className = 'status-latency'; }, 400); }, 2000);
}

/**
 * Подключение к серверу вручную
 * Поддерживаемые форматы:
 * - IP: 192.168.1.100, 192.168.1.100:8080
 * - HTTP URL: http://192.168.1.100:8080, http://myserver.local:8080
 * - WS URL: ws://192.168.1.100:8080/ws, wss://server.example.com/ws
 * - mDNS hostname: XAM Messenger._xam-messenger._tcp.local
 * - Домен: myserver.local, server.example.com
 */
async function connectToManualServer() {
    const address = elements.manualServerInput?.value.trim();
    if (!address) { alert(t('enterServerAddress')); return; }

    let wsUrl = address;

    // Определяем тип адреса
    const isWsUrl = address.startsWith('ws://') || address.startsWith('wss://');
    const isHttpUrl = address.startsWith('http://') || address.startsWith('https://');
    const isMdnsPattern = /_xam-messenger|\.local/.test(address); // mDNS или .local домен

    if (!isWsUrl && !isHttpUrl) {
        // Нет префикса — добавляем ws://
        wsUrl = `ws://${address}`;
    }

    try {
        const parsed = new URL(wsUrl);
        const hostname = parsed.hostname;
        const port = parsed.port ? parseInt(parsed.port) : 8080;

        // Определяем httpUrl из wsUrl
        let httpUrl;
        if (isHttpUrl) {
            httpUrl = address.replace(/:\/\/.*$/, `://${hostname}:${port}`);
        } else {
            httpUrl = `http://${hostname}:${port}`;
        }

        // Убеждаемся что pathname оканчивается на /ws
        if (!parsed.pathname.endsWith('/ws')) {
            wsUrl = `${parsed.protocol}//${hostname}:${port}/ws`;
        }

        state.selectedServer = { wsUrl, httpUrl, ip: hostname, port, source: 'manual', hostname: isMdnsPattern ? hostname : null };

        if (window.__TAURI__?.core?.invoke || window.__TAURI__?.invoke) {
            const fn = window.__TAURI__.core?.invoke || window.__TAURI__.invoke;
            fn('cache_server', { ip: hostname, port, source: 'manual' }).catch(console.warn);
        }

        if (elements.serverSelectorDialog) elements.serverSelectorDialog.close();
        if (elements.selectedServerInfo) {
            elements.selectedServerInfo.textContent = `📡 ${hostname}:${port}`;
            elements.selectedServerInfo.style.color = 'var(--success)';
        }
        elements.connectDialog.showModal();
        elements.userNameInput.value = userSettings?.name || '';
        elements.userNameInput.focus();
        if (elements.confirmConnect) elements.confirmConnect.disabled = !elements.userNameInput.value.trim();
    } catch (e) { alert(t('invalidUrlFormat', e.message)); }
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

function clearSession() {
    storage.remove(CONFIG.STORAGE_KEYS.SESSION_USER);
    storage.remove(CONFIG.STORAGE_KEYS.SESSION_SERVER);
}

/**
 * Собрать текущие настройки приложения из UI
 */
function collectAppSettings() {
    return {
        soundNotifications: elements.soundNotifications?.checked ?? true,
        desktopNotifications: elements.desktopNotifications?.checked ?? true,
        fontSize: elements.settingFontSize?.value ?? '14',
        showAvatars: elements.showAvatars?.checked ?? true,
        showTimestamps: elements.showTimestamps?.checked ?? true,
        theme: elements.settingTheme?.value ?? 'light',
        autoDownload: elements.autoDownload?.checked ?? false,
        language: elements.settingLanguage?.value ?? 'ru',
    };
}

/**
 * Применить настройки приложения к UI
 */
export function applyAppSettings(settings) {
    if (elements.soundNotifications) elements.soundNotifications.checked = settings.soundNotifications ?? true;
    if (elements.desktopNotifications) elements.desktopNotifications.checked = settings.desktopNotifications ?? true;
    if (elements.settingFontSize) {
        elements.settingFontSize.value = settings.fontSize ?? '14';
        if (elements.fontSizeValue) elements.fontSizeValue.textContent = `${settings.fontSize ?? '14'}px`;
    }
    if (elements.showAvatars) elements.showAvatars.checked = settings.showAvatars ?? true;
    if (elements.showTimestamps) elements.showTimestamps.checked = settings.showTimestamps ?? true;
    if (elements.settingTheme) elements.settingTheme.value = settings.theme ?? 'light';
    if (elements.autoDownload) elements.autoDownload.checked = settings.autoDownload ?? false;
    if (elements.settingLanguage) elements.settingLanguage.value = settings.language ?? 'ru';

    // Применяем языкку
    if (settings.language) setLanguage(settings.language);

    // Применяем размер шрифта к body
    if (settings.fontSize) {
        document.body.style.fontSize = `${settings.fontSize}px`;
    }

    // Применяем тему
    if (settings.theme === 'dark') {
        document.documentElement.classList.add('dark-theme');
    } else {
        document.documentElement.classList.remove('dark-theme');
    }
}

/**
 * Загрузка настроек приложения при инициализации
 */
export function initAppSettings() {
    const saved = loadAppSettings();
    if (Object.keys(saved).length > 0) {
        applyAppSettings(saved);
    }
}
