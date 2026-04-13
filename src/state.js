/**
 * @file Состояние приложения и DOM элементы
 * @module State
 */

'use strict';

import { CONFIG } from './utils/helpers.js';

export const elements = {
    status: document.getElementById('status'), statusIndicator: document.getElementById('statusIndicator'),
    statusText: document.getElementById('statusText'), connectionStatus: document.getElementById('connectionStatus'),
    statusLatency: document.getElementById('statusLatency'), userName: document.getElementById('userName'),
    userAddress: document.getElementById('userAddress'), userAvatar: document.getElementById('userAvatar'),
    profileMenuContainer: document.getElementById('profileMenuContainer'),
    profileAvatarBtn: document.getElementById('profileAvatarBtn'),
    profileContextMenu: document.getElementById('profileContextMenu'),
    profileMenuAvatar: document.getElementById('profileMenuAvatar'),
    profileMenuName: document.getElementById('profileMenuName'),
    menuProfile: document.getElementById('menuProfile'), menuSettings: document.getElementById('menuSettings'),
    menuLogout: document.getElementById('menuLogout'), menuChangeServer: document.getElementById('menuChangeServer'),
    appSettingsDialog: document.getElementById('appSettingsDialog'), closeAppSettings: document.getElementById('closeAppSettings'),
    saveAppSettings: document.getElementById('saveAppSettings'), resetAppSettings: document.getElementById('resetAppSettings'),
    clearCacheBtn: document.getElementById('clearCacheBtn'), exportDataBtn: document.getElementById('exportDataBtn'),
    settingFontSize: document.getElementById('settingFontSize'), fontSizeValue: document.getElementById('fontSizeValue'),
    settingTheme: document.getElementById('settingTheme'), userProfileHeader: document.getElementById('userProfileHeader'),
    chatTitle: document.getElementById('chatTitle'), chatTitleText: document.getElementById('chatTitleText'),
    sendBtn: document.getElementById('sendBtn'), attachBtn: document.getElementById('attachBtn'),
    fileInput: document.getElementById('fileInput'), attachedFiles: document.getElementById('attachedFiles'),
    messageInput: document.getElementById('messageInput'), inputArea: document.getElementById('inputArea'),
    messages: document.getElementById('messages'), messagesContainer: document.getElementById('messagesContainer'),
    chatScrollContainer: document.getElementById('chatScrollContainer'), peersList: document.getElementById('peersList'),
    connectDialog: document.getElementById('connectDialog'), settingsDialog: document.getElementById('settingsDialog'),
    userNameInput: document.getElementById('userNameInput'), serverStatus: document.getElementById('serverStatus'),
    confirmConnect: document.getElementById('confirmConnect'), cancelSettings: document.getElementById('cancelSettings'),
    saveSettings: document.getElementById('saveSettings'), deleteProfileBtn: document.getElementById('deleteProfileBtn'), settingsNameInput: document.getElementById('settingsNameInput'),
    settingsAvatarInput: document.getElementById('settingsAvatarInput'),
    loadMoreBtn: document.getElementById('loadMoreBtn'), loadMoreContainer: document.getElementById('loadMoreContainer'),
    serverSelectorDialog: document.getElementById('serverSelectorDialog'), serverList: document.getElementById('serverList'),
    manualServerInput: document.getElementById('manualServerInput'), confirmManualServer: document.getElementById('confirmManualServer'),
    cancelServerSelector: document.getElementById('cancelServerSelector'), refreshServersBtn: document.getElementById('refreshServersBtn'),
    changeServerBtn: document.getElementById('changeServerBtn'), selectedServerInfo: document.getElementById('selectedServerInfo'),
    peerSearchInput: document.getElementById('peerSearchInput'), chatSettingsBtn: document.getElementById('chatSettingsBtn'),
    chatSettingsMenu: document.getElementById('chatSettingsMenu'), settingLanguage: document.getElementById('settingLanguage'),
};

export const state = {
    connected: false, serverUrl: null, selectedServer: null, user: null,
    messages: [], peers: [], currentPeer: null, filteredMessages: [],
    onlineUsers: new Set(), lastMessageId: null, hasMoreMessages: true,
    isLoadingMessages: false, lastRequestedBeforeId: null, currentPeerBeforeId: null,
    discoveredServers: [], isDiscovering: false, peerSearchQuery: '',
    lastMessageTimes: {},
};

let serverClient = null;
export let attachedFiles = [];
export let userSettings = { name: '', avatar: CONFIG.AVATAR_DEFAULT };
export let loadPeersTimer = null;

export function setServerClient(client) { serverClient = client; }
export function getServerClient() { return serverClient; }
export function setAttachedFiles(files) { attachedFiles = files; }
export function setUserSettings(settings) { userSettings = settings; }
