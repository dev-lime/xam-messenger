/**
 * @file Desktop Notifications API
 * @module Notifications
 */

'use strict';

let permissionGranted = false;

/**
 * Запросить разрешение на уведомления
 */
export async function requestPermission() {
    if (!('Notification' in window)) {
        console.warn('🔔 Desktop notifications не поддерживаются');
        return false;
    }

    if (Notification.permission === 'granted') {
        permissionGranted = true;
        return true;
    }

    if (Notification.permission !== 'denied') {
        const result = await Notification.requestPermission();
        permissionGranted = result === 'granted';
        return permissionGranted;
    }

    return false;
}

/**
 * Показать desktop-уведомление
 * @param {string} title - Заголовок
 * @param {string} body - Текст
 * @param {string} [icon] - Иконка
 */
export function sendNotification(title, body, icon = null) {
    if (!permissionGranted || Notification.permission !== 'granted') return;

    try {
        const options = { body };
        if (icon) options.icon = icon;
        new Notification(title, options);
    } catch (e) {
        console.warn('🔔 Ошибка отправки уведомления:', e);
    }
}

/**
 * Проверить разрешены ли уведомления
 */
export function isEnabled() {
    return permissionGranted && Notification.permission === 'granted';
}
