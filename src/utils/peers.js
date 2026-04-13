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
		// Вызываем selectPeer из actions — будет зарегистрирован в app.js
		window._selectPeer && window._selectPeer(peer.id, peer.name);
	});

	item.querySelector('.peer-menu-btn').addEventListener('click', (e) => {
		e.stopPropagation();
		window._openPeerMenu && window._openPeerMenu(e, peer.id, peer.name);
	});

	return item;
}

function escapeHtml(text) {
	return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
