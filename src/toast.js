/**
 * @file Toast-уведомления (замена alert)
 * @module Toast
 */

'use strict';

const TOAST_DURATION = 3500;

const TOAST_ICONS = {
	info: 'ℹ️',
	success: '✅',
	warning: '⚠️',
	error: '❌',
};

/**
 * Показать toast-уведомление
 * @param {string} message - Текст уведомления
 * @param {'info'|'success'|'warning'|'error'} [type='info'] - Тип
 * @param {number} [duration=3500] - Время показа (мс)
 */
export function showToast(message, type = 'info', duration = TOAST_DURATION) {
	let container = document.getElementById('toastContainer');

	if (!container) {
		container = document.createElement('div');
		container.id = 'toastContainer';
		container.className = 'toast-container';
		document.body.appendChild(container);
	}

	const toast = document.createElement('div');
	toast.className = `toast toast-${type}`;
	toast.innerHTML = `
		<span class="toast-icon">${TOAST_ICONS[type] || TOAST_ICONS.info}</span>
		<span class="toast-message">${message}</span>
		<button class="toast-close" aria-label="Закрыть">&times;</button>
	`;

	container.appendChild(toast);

	// Анимация появления
	requestAnimationFrame(() => toast.classList.add('toast-show'));

	// Закрытие по кнопке
	const closeBtn = toast.querySelector('.toast-close');
	closeBtn.addEventListener('click', () => removeToast(toast));

	// Автозакрытие
	setTimeout(() => removeToast(toast), duration);
}

function removeToast(toast) {
	if (!toast || toast.classList.contains('toast-hide')) return;
	toast.classList.add('toast-hide');
	toast.addEventListener('animationend', () => toast.remove(), { once: true });
	// Fallback если анимация не сработала
	setTimeout(() => toast.remove(), 500);
}

/**
 * Утилиты для быстрой замены alert()
 */
export function info(msg)    { showToast(msg, 'info'); }
export function success(msg) { showToast(msg, 'success'); }
export function warning(msg) { showToast(msg, 'warning'); }
export function error(msg)   { showToast(msg, 'error'); }
