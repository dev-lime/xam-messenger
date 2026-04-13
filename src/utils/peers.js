/**
 * @file Рендеринг контактов (поиск, сортировка)
 * @module Utils/Peers
 */

'use strict';

import { t } from '../i18n.js';
import { state, elements } from '../state.js';

/**
 * Рендеринг контактов
 */
export function renderPeers() {
    if (!elements.peersList) return;
    elements.peersList.innerHTML = '';

    if (!state.connected) {
        elements.peersList.innerHTML = `<p style="padding:20px;color:var(--text-tertiary);text-align:center;">${t('notConnectedPeers')}</p>`;
        return;
    }
    if (state.peers.length === 0) {
        elements.peersList.innerHTML = `<p style="padding:20px;color:var(--text-tertiary);text-align:center;">${t('noUsers')}</p>`;
        return;
    }

    let filteredPeers = state.peers;
    if (state.peerSearchQuery) {
        const q = state.peerSearchQuery.toLowerCase();
        filteredPeers = state.peers.filter(p => p.name.toLowerCase().includes(q));
    }

    filteredPeers.sort((a, b) => {
        const ta = state.lastMessageTimes[a.id] || 0;
        const tb = state.lastMessageTimes[b.id] || 0;
        if (ta !== tb) return tb - ta;
        return a.name.localeCompare(b.name);
    });

    if (filteredPeers.length === 0) {
        elements.peersList.innerHTML = '<p style="padding:20px;color:var(--text-tertiary);text-align:center;">🔍 Ничего не найдено</p>';
        return;
    }

    filteredPeers.forEach((peer, i) => {
        const item = createPeerElement(peer);
        item.style.animationDelay = `${i * 50}ms`;
        item.classList.add('animate-in');
        elements.peersList.appendChild(item);
    });
}

/**
 * Создание элемента контакта
 */
function createPeerElement(peer) {
    const item = document.createElement('div');
    item.className = `peer-item ${state.currentPeer === peer.id ? 'active' : ''}`;
    item.dataset.userId = peer.id;
    item.dataset.userName = peer.name;

    const isOnline = state.onlineUsers.has(peer.id);
    const avatar = peer.avatar || '👤';
    const unreadCount = state.messages.filter(m => m.sender_id === peer.id && m.delivery_status < 2).length;
    const unreadBadge = unreadCount > 0 ? `<span class="unread-badge">${unreadCount}</span>` : '';

    item.innerHTML = `
        <span class="peer-icon">${avatar}</span>
        <div class="peer-info">
            <div class="peer-name">${escapeHtml(peer.name)}</div>
            <div class="peer-status ${isOnline ? 'online' : 'offline'}">${isOnline ? t('online') : t('offline')}</div>
        </div>
        ${unreadBadge}
        <button class="peer-menu-btn" title="Меню">
            <svg class="menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/>
            </svg>
        </button>
    `;

    item.addEventListener('click', (e) => {
        if (e.target.closest('.peer-menu-btn')) return;
        e.stopPropagation();
        import('../chat/actions.js').then(m => m.selectPeer(peer.id));
    });

    item.querySelector('.peer-menu-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        openPeerMenu(e, peer.id, peer.name);
    });

    return item;
}

function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Открытие контекстного меню контакта
 */
function openPeerMenu(e, peerId, peerName) {
    document.querySelectorAll('.peer-context-menu.open').forEach(m => m.classList.remove('open'));
    let menu = document.querySelector(`.peer-context-menu[data-user-id="${peerId}"]`);
    if (!menu) {
        menu = document.createElement('div');
        menu.className = 'peer-context-menu';
        menu.dataset.userId = peerId;
        menu.innerHTML = `<div class="peer-menu-info"><div class="peer-menu-id">ID: ${peerId}</div></div>
			<div class="profile-menu-divider"></div>
			<button class="profile-menu-item" data-action="delete-chat">
				<svg class="menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
				<span>Удалить чат</span></button>`;
        menu.addEventListener('click', (ev) => {
            const btn = ev.target.closest('[data-action]');
            if (btn && btn.dataset.action === 'delete-chat') {
                import('../chat/actions.js').then(m => m.deleteChatWithPeer(peerId, peerName));
            }
            closePeerMenu(peerId);
        });
        const peerEl = document.querySelector(`.peer-item[data-user-id="${peerId}"]`);
        if (peerEl) peerEl.appendChild(menu);
    }
    menu.classList.add('open');
}

/**
 * Закрытие контекстного меню контакта
 */
function closePeerMenu(peerId) {
    const menu = document.querySelector(`.peer-context-menu[data-user-id="${peerId}"]`);
    if (menu) menu.classList.remove('open');
}

/**
 * Глобальный обработчик для закрытия меню при клике вне его
 */
document.addEventListener('click', (e) => {
    const openMenu = document.querySelector('.peer-context-menu.open');
    if (openMenu && !openMenu.contains(e.target)) {
        closePeerMenu(openMenu.dataset.userId);
    }
});
