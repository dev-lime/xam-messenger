// Модуль для работы с сервером (WebSocket + HTTP)

class ServerClient {
    constructor() {
        this.ws = null;
        this.user = null;
        this.messageHandlers = [];
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.serverUrl = null;
        this.httpUrl = null;
        
        // Список серверов для проверки
        this.serverCandidates = [
            'ws://localhost:8080/ws',
            'ws://127.0.0.1:8080/ws',
        ];
        
        // Добавляем локальные IP для поиска в сети
        this.addLocalNetworkServers();
    }
    
    // Добавляем серверы локальной сети
    addLocalNetworkServers() {
        // Сканируем типичные подсети
        const subnets = [
            '192.168.1.',
            '192.168.0.',
            '192.168.88.',
            '10.0.0.',
            '10.0.1.',
        ];
        
        // Для каждой подсети добавляем адреса 1-10 и 100-110
        subnets.forEach(subnet => {
            for (let i = 1; i <= 10; i++) {
                this.serverCandidates.push(`ws://${subnet}${i}:8080/ws`);
            }
            for (let i = 100; i <= 110; i++) {
                this.serverCandidates.push(`ws://${subnet}${i}:8080/ws`);
            }
        });
    }
    
    // Автоматическое обнаружение сервера
    async discoverServer() {
        console.log('🔍 Поиск сервера...');

        for (const url of this.serverCandidates) {
            try {
                const found = await this.tryConnect(url, 1000);
                if (found) {
                    console.log('✅ Сервер найден:', url);
                    return url;
                }
            } catch (e) {
                // Пробуем следующий
            }
        }
        
        throw new Error('Сервер не найден. Убедитесь, что сервер запущен.');
    }
    
    // Попытка подключения к конкретному серверу
    async tryConnect(url, timeout = 1000) {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(url);
            const timer = setTimeout(() => {
                ws.close();
                resolve(false); // Не выбрасываем ошибку, просто false
            }, timeout);
            
            ws.onopen = () => {
                clearTimeout(timer);
                ws.close(); // Закрываем тестовое соединение
                resolve(true); // Сервер найден
            };
            
            ws.onerror = () => {
                clearTimeout(timer);
                resolve(false); // Не выбрасываем ошибку
            };
        });
    }

    // Подключение к серверу
    async connect(serverUrl = null) {
        // Если URL не передан, находим сервер
        const url = serverUrl || await this.discoverServer();

        this.serverUrl = url;
        this.httpUrl = url.replace('ws://', 'http://').replace('/ws', '/api');

        console.log('🔌 Подключение к', url);

        return new Promise((resolve, reject) => {
            try {
                this.ws = new WebSocket(url);

                this.ws.onopen = () => {
                    console.log('✅ Подключено к серверу');
                    this.reconnectAttempts = 0;
                    resolve();
                };

                this.ws.onclose = (event) => {
                    console.log('🔌 Отключено от сервера:', event.code, event.reason);
                    this.attemptReconnect();
                };

                this.ws.onerror = (error) => {
                    console.error('❌ Ошибка WebSocket:', error);
                    reject(error);
                };

                this.ws.onmessage = (event) => {
                    console.log('📩 WebSocket message received:', event.data.substring(0, 200));
                    this.handleMessage(JSON.parse(event.data));
                };
            } catch (error) {
                reject(error);
            }
        });
    }

    // Попытка переподключения
    attemptReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            console.log(`🔄 Попытка переподключения ${this.reconnectAttempts}/${this.maxReconnectAttempts}...`);
            setTimeout(() => this.connect(), 2000);
        } else {
            console.error('❌ Превышено количество попыток переподключения');
        }
    }

    // Обработка входящих сообщений
    handleMessage(data) {
        switch (data.type) {
            case 'registered':
                this.user = data.user;
                break;

            case 'message':
                // Новое сообщение от другого клиента
                console.log('📨 Message:', {
                    id: data.message?.id,
                    text: data.message?.text,
                    files: data.message?.files,
                    filesCount: data.message?.files?.length
                });
                this.notifyHandlers('message', data.message);
                break;

            case 'ack':
                console.log('📨 ACK received:', data);
                this.notifyHandlers('ack', data);
                break;

            case 'messages':
                this.notifyHandlers('messages', data.messages);
                break;

            case 'user_online':
                this.notifyHandlers('user_online', data);
                break;
        }
    }

    // Подписка на события
    on(event, handler) {
        this.messageHandlers.push({ event, handler });
    }

    // Уведомление подписчиков
    notifyHandlers(event, data) {
        this.messageHandlers
            .filter(h => h.event === event)
            .forEach(h => h.handler(data));
    }

    // Регистрация пользователя
    async register(name) {
        const response = await fetch(`${this.httpUrl}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
        });

        const result = await response.json();

        if (result.success) {
            this.user = result.data;

            // Отправляем регистрацию через WebSocket
            this.send({ type: 'register', name });
            
            return result.data;
        } else {
            throw new Error(result.error);
        }
    }

    // Отправка сообщения
    send(message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        } else {
            console.error('❌ Нет подключения к серверу');
        }
    }

    // Отправка текстового сообщения
    sendMessage(text, recipientId = null) {
        this.send({
            type: 'message',
            text,
            files: [],
            recipient_id: recipientId,
        });
    }

    // Отправка сообщения с файлами
    sendMessageWithFiles(text, files, recipientId = null) {
        const message = {
            type: 'message',
            text,
            files,
            recipient_id: recipientId,
        };
        console.log('📤 WebSocket send:', JSON.stringify(message, null, 2));
        console.log('🔌 WebSocket state:', this.ws?.readyState, 'OPEN=', WebSocket.OPEN);
        
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            try {
                this.ws.send(JSON.stringify(message));
                console.log('✅ Файлы отправлены в WebSocket');
            } catch (error) {
                console.error('❌ Ошибка отправки в WebSocket:', error);
            }
        } else {
            console.error('❌ WebSocket не готов! readyState=', this.ws?.readyState);
        }
    }

    // Загрузка файла (возвращает информацию о файле)
    async uploadFile(file) {
        // Создаём FormData для multipart/form-data
        const formData = new FormData();
        formData.append('file', file);

        // Загружаем файл на сервер
        const response = await fetch(`${this.httpUrl}/files`, {
            method: 'POST',
            body: formData,
        });

        const result = await response.json();

        if (result.success) {
            return {
                name: file.name,
                size: file.size,
                path: result.data.path,
            };
        } else {
            throw new Error(result.error || 'Failed to upload file');
        }
    }

    // Отправка файла (устаревший метод, используется uploadFile)
    async sendFile(file, recipientId = null) {
        const fileData = await this.uploadFile(file);
        
        // Отправляем сообщение с файлом через WebSocket
        this.send({
            type: 'message',
            text: `📎 Файл: ${file.name}`,
            files: [fileData],
            recipient_id: recipientId,
        });
        return true;
    }

    // Подтверждение прочтения
    sendAck(messageId, status = 'read') {
        this.send({
            type: 'ack',
            message_id: messageId,
            status,
        });
    }

    // Загрузка истории сообщений с пагинацией
    getMessages(limit = 50, offset = 0) {
        this.send({
            type: 'get_messages',
            limit,
            text: offset.toString(), // Используем text поле для offset
        });
    }

    // Получение списка пользователей
    async getUsers() {
        const response = await fetch(`${this.httpUrl}/users`);
        const result = await response.json();
        return result.data || [];
    }

    // Отключение
    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
}

// Экспортируем глобально для использования в app.js
window.ServerClient = ServerClient;
