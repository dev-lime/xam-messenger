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
        // Типичные адреса в локальной сети
        const localIPs = [
            '192.168.1.100', '192.168.0.100',
            '192.168.1.1', '192.168.0.1',
        ];
        localIPs.forEach(ip => {
            this.serverCandidates.push(`ws://${ip}:8080/ws`);
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
                
                this.ws.onclose = () => {
                    console.log('🔌 Отключено от сервера');
                    this.attemptReconnect();
                };
                
                this.ws.onerror = (error) => {
                    console.error('❌ Ошибка WebSocket:', error);
                    reject(error);
                };
                
                this.ws.onmessage = (event) => {
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
        console.log('📩 Получено от сервера:', data);
        
        switch (data.type) {
            case 'registered':
                this.user = data.user;
                console.log('✅ Зарегистрирован:', this.user);
                break;
                
            case 'message':
                // Новое сообщение от другого клиента
                this.notifyHandlers('message', data);
                break;
                
            case 'ack':
                // Обновление статуса доставки
                this.notifyHandlers('ack', data);
                break;
                
            case 'messages':
                // История сообщений
                this.notifyHandlers('messages', data.messages);
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
    sendMessage(text) {
        this.send({
            type: 'message',
            text,
            files: [],
        });
    }

    // Отправка файла
    async sendFile(file) {
        // Загружаем файл на сервер
        const response = await fetch(`${this.httpUrl}/files`, {
            method: 'POST',
            body: file,
        });
        
        const result = await response.json();
        
        if (result.success) {
            // Отправляем сообщение с файлом
            this.send({
                type: 'message',
                text: `📎 Файл: ${file.name}`,
                files: [{
                    name: file.name,
                    size: file.size,
                    path: result.data.path,
                }],
            });
        }
    }

    // Подтверждение прочтения
    sendAck(messageId, status = 'read') {
        this.send({
            type: 'ack',
            message_id: messageId,
            status,
        });
    }

    // Загрузка истории сообщений
    getMessages(limit = 100) {
        this.send({
            type: 'get_messages',
            limit,
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
