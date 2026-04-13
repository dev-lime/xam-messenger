/**
 * @file Диалоги: профиль, настройки, выход
 * @module Dialogs/Profile
 */

'use strict';

import { t } from '../i18n.js';
import { success, showError } from '../toast.js';
import { state, elements, userSettings, setUserSettings } from '../state.js';
import { getServerClient } from '../state.js';
import { saveUserSettings, clearSession } from '../storage.js';
import { CONFIG } from '../utils/helpers.js';

/**
 * Открытие диалога настроек
 */
export function openSettingsDialog() {
    elements.settingsNameInput.value = state.user?.name || '';
    elements.settingsAvatarInput.value = userSettings?.avatar || CONFIG.AVATAR_DEFAULT;
    elements.settingsDialog.showModal();
}

/**
 * Сохранение настроек
 */
export function saveSettings() {
    const name = elements.settingsNameInput.value.trim();
    const avatar = elements.settingsAvatarInput.value.trim() || CONFIG.AVATAR_DEFAULT;

    if (!name) { showError(t('enterNameError')); return; }
    if (name.length > 50) { showError(t('nameTooLong')); return; }
    if (!state.user) { showError(t('notConnectedError')); return; }

    state.user.name = name;
    setUserSettings({ name, avatar });
    saveUserSettings();
    updateUserProfile(name, 'В сети');

    if (state.connected) {
        getServerClient().updateProfile(name, avatar);
        console.log(t('profileUpdated', name, avatar));
    }
    success(t('profileUpdated', name, avatar));
    elements.settingsDialog.close();
}

/**
 * Обновление профиля в UI
 */
function updateUserProfile(name, status) {
    if (elements.profileMenuName) elements.profileMenuName.textContent = name || t('notConnected');
    if (elements.profileMenuAvatar) elements.profileMenuAvatar.textContent = userSettings?.avatar || CONFIG.AVATAR_DEFAULT;
    if (elements.userAvatar) elements.userAvatar.textContent = userSettings?.avatar || CONFIG.AVATAR_DEFAULT;
    if (elements.userName) elements.userName.textContent = name || t('notConnected');
    if (elements.userAddress) elements.userAddress.textContent = status || '--';
}

/**
 * Открытие меню профиля
 */
export function openProfileMenu() {
    if (elements.profileContextMenu) elements.profileContextMenu.classList.add('open');
    if (elements.profileMenuContainer) elements.profileMenuContainer.classList.add('open');
}

/**
 * Закрытие меню профиля
 */
export function closeProfileMenu() {
    if (elements.profileContextMenu) elements.profileContextMenu.classList.remove('open');
    if (elements.profileMenuContainer) elements.profileMenuContainer.classList.remove('open');
}

/**
 * Выход из аккаунта
 */
export function logout() {
    if (state.connected) getServerClient().disconnect();
    state.connected = false; state.user = null; state.selectedServer = null;
    state.peers = []; state.messages = []; state.filteredMessages = []; state.currentPeer = null;
    clearSession();
    location.reload();
}
