/**
 * @file Диалоги: выбор сервера, подключение
 * @module Dialogs/Server
 */

'use strict';

import { t } from '../i18n.js';
import { error as showError } from '../toast.js';
import { state, elements, userSettings } from '../state.js';
import { getServerClient } from '../state.js';
import { saveSession } from '../settings.js';
import { discoverAllServers, wsToHttpUrl, extractIpFromWsUrl, pingServer } from '../discovery.js';
import { renderPeers } from '../utils/peers.js';

/**
 * Обнаружение серверов
 */
export async function discoverServers() {
    if (state.isDiscovering) return false;
    state.isDiscovering = true;
    updateServerStatus('🔍 Поиск серверов...', 'warning');
    try {
        const servers = await discoverAllServers();
        state.discoveredServers = servers;
        if (servers.length === 0) { updateServerStatus(t('noServers'), 'error'); state.isDiscovering = false; return false; }
        updateServerStatus(t('serversFound', servers.length), 'success');
        state.isDiscovering = false;
        return true;
    } catch (error) {
        console.error('❌ Ошибка обнаружения:', error);
        updateServerStatus(t('connectionError'), 'error');
        state.isDiscovering = false;
        return false;
    }
}

/**
 * Открытие диалога выбора сервера
 */
export async function openServerSelector() {
    if (!elements.serverSelectorDialog) return;
    if (elements.serverList) elements.serverList.innerHTML = '<div style="padding:20px;text-align:center;">🔍 Поиск серверов...</div>';
    elements.serverSelectorDialog.showModal();
    await refreshServerList();
}

/**
 * Обновление списка серверов
 */
export async function refreshServerList() {
    if (!elements.serverList) return;
    state.isDiscovering = true;
    renderServerList([]);
    try {
        const servers = await discoverAllServers();
        state.discoveredServers = servers;
        if (servers.length === 0) { renderServerList([]); return; }

        // Сначала показываем все серверы со статусом "pending" (только что найдены)
        const pendingServers = servers.map(s => ({ ...s, online: null })); // null = unknown
        renderServerList(pendingServers);

        // Затем пингуем каждый сервер и обновляем статус
        const withStatus = await Promise.all(servers.map(async s => {
            const online = await pingServer(s.httpUrl, 3000);
            return { ...s, online };
        }));
        renderServerList(withStatus);
    } catch (error) {
        console.error('❌ Ошибка:', error);
        elements.serverList.innerHTML = '<div style="padding:20px;text-align:center;color:var(--error);">❌ Ошибка</div>';
    }
    state.isDiscovering = false;
}

/**
 * Рендеринг списка серверов
 */
function renderServerList(servers) {
    if (!elements.serverList) return;
    if (servers.length === 0) {
        elements.serverList.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-tertiary);">
            <div style="font-size:18px;margin-bottom:10px;">📡</div><div>${t('serverListEmpty')}</div>
            <div style="font-size:12px;margin-top:10px;">${t('serverListHint')}</div></div>`;
        return;
    }
    const icons = { mdns: '📢', cache: '📦', scan: '🔍', manual: '✏️' };
    const names = { mdns: t('sourceMdns'), cache: t('sourceCache'), scan: t('sourceScan'), manual: t('sourceManual') };
    elements.serverList.innerHTML = servers.map(s => {
        const statusCls = s.online === null ? 'pending' : (s.online ? 'online' : 'offline');
        const statusText = s.online === null ? '⏳ Проверка...' : (s.online ? t('onlineText') : t('offlineText'));
        return `<div class="server-item ${statusCls}" data-ws-url="${s.wsUrl}">
            <div class="server-status-indicator ${statusCls}"></div>
            <div class="server-info"><div class="server-address">${s.ip}:${s.port}</div>
            <div class="server-source">${icons[s.source] || '📡'} ${names[s.source] || s.source}${s.hostname ? `<br><small style="color:var(--text-tertiary);">${s.hostname}</small>` : ''}</div></div>
            <div class="server-status-text ${statusCls}">${statusText}</div>
            <button class="server-connect-btn" data-ws-url="${s.wsUrl}" type="button">${t('connect')}</button></div>`;
    }).join('');

    // Event delegation для кнопок подключения
    elements.serverList.querySelectorAll('.server-connect-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const wsUrl = btn.dataset.wsUrl;
            handleServerConnect(wsUrl);
        });
    });
}

/**
 * Обработка выбора сервера из списка
 */
function handleServerConnect(wsUrl) {
    const server = state.discoveredServers.find(s => s.wsUrl === wsUrl);
    state.selectedServer = server || { wsUrl, httpUrl: wsToHttpUrl(wsUrl), ip: extractIpFromWsUrl(wsUrl) || '', port: 8080 };
    if (elements.serverSelectorDialog) elements.serverSelectorDialog.close();
    updateSelectedServerInfo(state.selectedServer);
    elements.connectDialog.showModal();
    elements.userNameInput.value = userSettings?.name || '';
    elements.userNameInput.focus();
    if (elements.confirmConnect) elements.confirmConnect.disabled = !elements.userNameInput?.value.trim();
}

/**
 * Подключение к серверу
 */
export async function connectToServer() {
    const name = elements.userNameInput.value.trim();
    const avatar = userSettings?.avatar || '👤';
    if (!name) { showError(t('enterNameError')); return; }
    if (!state.selectedServer) { showError(t('selectServerFirst')); return; }

    try {
        elements.serverStatus.innerHTML = `<span style="color:var(--warning);">${t('connecting')}</span>`;
        elements.confirmConnect.disabled = true;

        const sc = getServerClient();
        await sc.connectToServer(state.selectedServer.wsUrl);
        const user = await sc.register(name, avatar);

        state.user = user; state.connected = true; state.serverUrl = state.selectedServer.wsUrl;
        saveSession(user, state.selectedServer);

        // Обновляем индикатор статуса подключения
        if (elements.statusIndicator) {
            elements.statusIndicator.classList.remove('offline');
            elements.statusIndicator.classList.add('online');
        }

        updateUserProfile(user.name, 'В сети');
        if (elements.statusText) elements.statusText.textContent = 'В сети';
        if (elements.serverStatus) elements.serverStatus.innerHTML = `<span style="color:var(--success);">${t('connected')}</span>`;

        if (!state.lastMessageId && state.messages.length === 0) {
            state.isLoadingMessages = true;
            sc.getMessages(50, null, state.currentPeer);
        } else { state.isLoadingMessages = false; }

        await sc.getUsers().then(users => { state.peers = users.filter(u => u.id !== user.id); });
        renderPeers();
        setTimeout(renderPeers, 500);

        setTimeout(() => elements.connectDialog.close(), 500);
    } catch (error) {
        console.error('❌ Ошибка подключения:', error);
        elements.serverStatus.innerHTML = `<span style="color:var(--error);">❌ ${t('connectionError')}<br><small>${t('serverCheckRunning')}</small></span>`;
        elements.confirmConnect.disabled = false;
    }
}

function updateUserProfile(name, status) {
    if (elements.profileMenuName) elements.profileMenuName.textContent = name || t('notConnected');
    if (elements.userName) elements.userName.textContent = name || t('notConnected');
    if (elements.userAddress) elements.userAddress.textContent = status || '--';
}

function updateServerStatus(msg, type) {
    if (!elements.serverStatus) return;
    const colors = { info: 'var(--text-secondary)', success: 'var(--success)', warning: 'var(--warning)', error: 'var(--error)' };
    elements.serverStatus.innerHTML = `<span style="color:${colors[type]};">${msg}</span>`;
}

function updateSelectedServerInfo(server) {
    if (!elements.selectedServerInfo) return;
    const address = server.ip ? `${server.ip}:${server.port}` : server.wsUrl;
    elements.selectedServerInfo.textContent = `📡 ${address}`;
    elements.selectedServerInfo.style.color = 'var(--success)';
}
