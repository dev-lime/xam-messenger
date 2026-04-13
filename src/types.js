/**
 * @file JSDoc type definitions для всего проекта
 * @module Types
 */

/**
 * @typedef {Object} User
 * @property {string} id - UUID пользователя
 * @property {string} name - Имя пользователя
 * @property {string} [avatar='👤'] - Эмодзи-аватар
 */

/**
 * @typedef {Object} FileData
 * @property {string} name - Имя файла
 * @property {number} size - Размер в байтах
 * @property {string} path - Путь/ID файла
 */

/**
 * @typedef {Object} ChatMessage
 * @property {string} id - UUID сообщения
 * @property {string} sender_id - ID отправителя
 * @property {string} sender_name - Имя отправителя
 * @property {string} text - Текст сообщения
 * @property {number} timestamp - Unix timestamp (секунды)
 * @property {number} delivery_status - 0=sent, 1=delivered, 2=read
 * @property {string|null} recipient_id - ID получателя (null для групповых)
 * @property {FileData[]} files - Массив файлов
 */

/**
 * @typedef {Object} ServerInfo
 * @property {string} ip - IP адрес сервера
 * @property {number} port - Порт
 * @property {string} wsUrl - WebSocket URL (ws://ip:port/ws)
 * @property {string} httpUrl - HTTP API URL (http://ip:port/api/v1)
 * @property {string} source - Источник обнаружения (mdns|cache|scan|manual)
 * @property {string} [hostname] - mDNS hostname
 */

/**
 * @typedef {Object} CachedServer
 * @property {string} ip - IP адрес
 * @property {number} port - Порт
 * @property {number} lastSeen - Timestamp последнего обнаружения
 * @property {string} source - Источник
 */

/**
 * @typedef {Object} Peer
 * @property {string} id - ID пользователя
 * @property {string} name - Имя
 * @property {string} [avatar='👤'] - Аватар
 * @property {boolean} [online] - Статус онлайн
 */

/**
 * @typedef {Object} AppState
 * @property {boolean} connected - Подключён ли к серверу
 * @property {string|null} serverUrl - Текущий URL сервера
 * @property {ServerInfo|null} selectedServer - Выбранный сервер
 * @property {User|null} user - Текущий пользователь
 * @property {ChatMessage[]} messages - Все сообщения
 * @property {Peer[]} peers - Список контактов
 * @property {string|null} currentPeer - ID текущего собеседника
 * @property {ChatMessage[]} filteredMessages - Отфильтрованные сообщения для текущего чата
 * @property {Set<string>} onlineUsers - IDs пользователей онлайн
 * @property {string|null} lastMessageId - ID последнего загруженного сообщения
 * @property {boolean} hasMoreMessages - Есть ли ещё сообщения для загрузки
 * @property {boolean} isLoadingMessages - Загружаются ли сообщения
 * @property {string|null} lastRequestedBeforeId - ID последнего запроса пагинации
 * @property {string|null} currentPeerBeforeId - Точка пагинации для текущего чата
 * @property {ServerInfo[]} discoveredServers - Обнаруженные серверы
 * @property {boolean} isDiscovering - Идёт ли обнаружение серверов
 * @property {string} peerSearchQuery - Поисковый запрос контактов
 * @property {Object<string, number>} lastMessageTimes - Время последнего сообщения для каждого контакта
 */

/**
 * @typedef {Object} UIElements
 * @property {HTMLElement|null} status
 * @property {HTMLElement|null} statusIndicator
 * @property {HTMLElement|null} statusText
 * @property {HTMLElement|null} connectionStatus
 * @property {HTMLElement|null} statusLatency
 * @property {HTMLElement|null} userName
 * @property {HTMLElement|null} userAddress
 * @property {HTMLElement|null} userAvatar
 * @property {HTMLElement|null} profileMenuContainer
 * @property {HTMLElement|null} profileAvatarBtn
 * @property {HTMLElement|null} profileContextMenu
 * @property {HTMLElement|null} profileMenuAvatar
 * @property {HTMLElement|null} profileMenuName
 * @property {HTMLElement|null} menuProfile
 * @property {HTMLElement|null} menuSettings
 * @property {HTMLElement|null} menuLogout
 * @property {HTMLElement|null} menuChangeServer
 * @property {HTMLElement|null} appSettingsDialog
 * @property {HTMLElement|null} closeAppSettings
 * @property {HTMLElement|null} saveAppSettings
 * @property {HTMLElement|null} resetAppSettings
 * @property {HTMLElement|null} clearCacheBtn
 * @property {HTMLElement|null} exportDataBtn
 * @property {HTMLElement|null} settingFontSize
 * @property {HTMLElement|null} fontSizeValue
 * @property {HTMLElement|null} settingTheme
 * @property {HTMLElement|null} userProfileHeader
 * @property {HTMLElement|null} chatTitle
 * @property {HTMLElement|null} chatTitleText
 * @property {HTMLElement|null} sendBtn
 * @property {HTMLElement|null} attachBtn
 * @property {HTMLElement|null} fileInput
 * @property {HTMLElement|null} attachedFiles
 * @property {HTMLElement|null} messageInput
 * @property {HTMLElement|null} inputArea
 * @property {HTMLElement|null} messages
 * @property {HTMLElement|null} messagesContainer
 * @property {HTMLElement|null} chatScrollContainer
 * @property {HTMLElement|null} peersList
 * @property {HTMLElement|null} connectDialog
 * @property {HTMLElement|null} settingsDialog
 * @property {HTMLElement|null} userNameInput
 * @property {HTMLElement|null} serverStatus
 * @property {HTMLElement|null} confirmConnect
 * @property {HTMLElement|null} cancelSettings
 * @property {HTMLElement|null} saveSettings
 * @property {HTMLElement|null} deleteProfileBtn
 * @property {HTMLElement|null} settingsNameInput
 * @property {HTMLElement|null} settingsAvatarInput
 * @property {HTMLElement|null} loadMoreBtn
 * @property {HTMLElement|null} loadMoreContainer
 * @property {HTMLElement|null} serverSelectorDialog
 * @property {HTMLElement|null} serverList
 * @property {HTMLElement|null} manualServerInput
 * @property {HTMLElement|null} confirmManualServer
 * @property {HTMLElement|null} cancelServerSelector
 * @property {HTMLElement|null} refreshServersBtn
 * @property {HTMLElement|null} changeServerBtn
 * @property {HTMLElement|null} selectedServerInfo
 * @property {HTMLElement|null} peerSearchInput
 * @property {HTMLElement|null} chatSettingsBtn
 * @property {HTMLElement|null} chatSettingsMenu
 * @property {HTMLElement|null} settingLanguage
 */

/**
 * @typedef {Object} UserSettings
 * @property {string} name - Имя пользователя
 * @property {string} avatar - Эмодзи-аватар
 */

/**
 * @typedef {Object} AppSettings
 * @property {boolean} [soundNotifications=true] - Звуковые уведомления
 * @property {boolean} [desktopNotifications=true] - Всплывающие уведомления
 * @property {string} [fontSize='14'] - Размер шрифта
 * @property {boolean} [showAvatars=true] - Показывать аватары
 * @property {boolean} [showTimestamps=true] - Показывать время
 * @property {string} [theme='light'] - Тема оформления
 * @property {boolean} [autoDownload=true] - Автозагрузка файлов
 * @property {string} [language='ru'] - Язык интерфейса
 */

/**
 * @typedef {Object} ClientConfig
 * @property {number} maxFileSize - Максимальный размер файла (байты)
 * @property {number} localMessageTtl - TTL локального сообщения (секунды)
 * @property {string} avatarDefault - Аватар по умолчанию
 * @property {string} defaultLanguage - Язык по умолчанию
 * @property {Object} storageKeys - Ключи localStorage
 * @property {Object} wsConfig - Настройки WebSocket
 * @property {Object} scanConfig - Настройки сканирования сети
 * @property {Object} uiConfig - Настройки UI
 */

/**
 * @typedef {Object} DeliveryStatus
 * @property {0} SENT - Сервер принял
 * @property {1} DELIVERED - Клиент получил
 * @property {2} READ - Клиент прочитал
 */

/**
 * @typedef {Object} StatusIcons
 * @property {'🕐'} SENT - Иконка "отправлено"
 * @property {'✓'} DELIVERED - Иконка "доставлено"
 * @property {'✓✓'} READ - Иконка "прочитано"
 */
