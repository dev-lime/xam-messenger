# API Документация XAM Messenger

**Версия API:** v1  
**Базовый URL:** `http://<server>:8080/api/v1`  
**WebSocket URL:** `ws://<server>:8080/ws`

---

## Содержание

- [HTTP API](#http-api)
  - [POST /api/v1/register](#post-apiv1register)
  - [GET /api/v1/users](#get-apiv1users)
  - [GET /api/v1/messages](#get-apiv1messages)
  - [GET /api/v1/online](#get-apiv1online)
  - [POST /api/v1/files](#post-apiv1files)
  - [GET /api/v1/files/download](#get-apiv1filesdownload)
- [WebSocket API](#websocket-api)
  - [Клиент → Сервер](#клиент--сервер)
  - [Сервер → Клиент](#сервер--клиент)
- [Коды ошибок](#коды-ошибок)

---

## HTTP API

Все HTTP эндпоинты возвращают JSON в формате:

**Успех:**
```json
{
  "success": true,
  "data": { ... }
}
```

**Ошибка:**
```json
{
  "success": false,
  "error": "Описание ошибки"
}
```

---

### POST /api/v1/register

Регистрация нового пользователя.

**Request:**
```http
POST /api/v1/register HTTP/1.1
Content-Type: application/json

{
  "name": "Артём",
  "avatar": "👤"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Артём",
    "avatar": "👤"
  }
}
```

**Response (400 Bad Request):**
```json
{
  "success": false,
  "error": "Empty name"
}
```

**Параметры:**

| Поле | Тип | Обязательное | Описание |
|------|-----|--------------|----------|
| `name` | string | да | Имя пользователя |
| `avatar` | string | нет | Аватар (эмодзи), по умолчанию "👤" |

---

### GET /api/v1/users

Получение списка всех зарегистрированных пользователей.

**Request:**
```http
GET /api/v1/users HTTP/1.1
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "Артём",
      "avatar": "👤"
    },
    {
      "id": "660e8400-e29b-41d4-a716-446655440001",
      "name": "Мария",
      "avatar": "👩"
    }
  ]
}
```

---

### GET /api/v1/messages

Получение истории сообщений с пагинацией.

**Query Parameters:**

| Параметр | Тип | По умолчанию | Описание |
|----------|-----|--------------|----------|
| `limit` | integer | 50 | Количество сообщений (макс. 200) |
| `before_id` | string | null | ID сообщения для пагинации |
| `chat_peer_id` | string | null | ID пользователя для фильтрации чата |

**Request:**
```http
GET /api/v1/messages?limit=50&before_id=c6cb1fec-...&chat_peer_id=user-uuid HTTP/1.1
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": "msg-001",
      "sender_id": "550e8400-e29b-41d4-a716-446655440000",
      "sender_name": "Артём",
      "text": "Привет!",
      "timestamp": 1699000000,
      "delivery_status": 1,
      "recipient_id": null,
      "files": []
    }
  ],
  "before_id": "c6cb1fec-...",
  "next_before_id": "msg-001",
  "has_more": true
}
```

**Поля сообщения:**

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | string | Уникальный ID сообщения (UUID) |
| `sender_id` | string | ID отправителя |
| `sender_name` | string | Имя отправителя |
| `text` | string | Текст сообщения |
| `timestamp` | integer | Unix timestamp (секунды) |
| `delivery_status` | integer | 0=отправка, 1=отправлено, 2=прочитано |
| `recipient_id` | string\|null | ID получателя (null для всех) |
| `files` | array | Массив файлов |

---

### GET /api/v1/online

Получение списка пользователей онлайн.

**Request:**
```http
GET /api/v1/online HTTP/1.1
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": [
    "550e8400-e29b-41d4-a716-446655440000",
    "660e8400-e29b-41d4-a716-446655440001"
  ]
}
```

---

### POST /api/v1/files

Загрузка файла на сервер.

**Request (multipart/form-data):**
```http
POST /api/v1/files HTTP/1.1
Content-Type: multipart/form-data; boundary=----WebKitFormBoundary

------WebKitFormBoundary
Content-Disposition: form-data; name="file"; filename="document.pdf"
Content-Type: application/pdf

<binary data>
------WebKitFormBoundary--
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "file-uuid",
    "name": "document.pdf",
    "size": 102400,
    "path": "file-uuid_document.pdf"
  }
}
```

**Response (400 Bad Request):**
```json
{
  "success": false,
  "error": "No file uploaded"
}
```

**Лимиты:**
- Максимальный размер файла: 100MB (настраивается через `MAX_FILE_SIZE`)
- Поддерживаемые типы: любые

---

### GET /api/v1/files/download

Скачивание файла.

**Query Parameters:**

| Параметр | Тип | Обязательный | Описание |
|----------|-----|--------------|----------|
| `path` | string | да | ID файла (не полный путь) |

**Request:**
```http
GET /api/v1/files/download?path=file-uuid HTTP/1.1
```

**Response (200 OK):**
```http
HTTP/1.1 200 OK
Content-Type: application/octet-stream
Content-Disposition: attachment; filename="file.pdf"

<binary data>
```

**Response (404 Not Found):**
```json
{
  "success": false,
  "error": "File not found"
}
```

---

## WebSocket API

**URL подключения:** `ws://<server>:8080/ws`

Все сообщения передаются в формате JSON.

---

### Клиент → Сервер

#### register

Регистрация пользователя.

```json
{
  "type": "register",
  "name": "Артём",
  "text": "👤"
}
```

**Поля:**

| Поле | Тип | Обязательное | Описание |
|------|-----|--------------|----------|
| `type` | string | да | Всегда `"register"` |
| `name` | string | да | Имя пользователя |
| `text` | string | нет | Аватар (эмодзи), по умолчанию "👤" |

---

#### message

Отправка сообщения.

```json
{
  "type": "message",
  "text": "Привет!",
  "recipient_id": "550e8400-e29b-41d4-a716-446655440000",
  "files": [
    {
      "name": "doc.pdf",
      "size": 1024,
      "path": "file-uuid"
    }
  ]
}
```

**Поля:**

| Поле | Тип | Обязательное | Описание |
|------|-----|--------------|----------|
| `type` | string | да | Всегда `"message"` |
| `text` | string | нет | Текст сообщения |
| `recipient_id` | string | нет | ID получателя (null для всех) |
| `files` | array | нет | Массив файлов |

---

#### ack

Подтверждение прочтения.

```json
{
  "type": "ack",
  "message_id": "msg-uuid",
  "status": "read"
}
```

**Поля:**

| Поле | Тип | Обязательное | Описание |
|------|-----|--------------|----------|
| `type` | string | да | Всегда `"ack"` |
| `message_id` | string | да | ID сообщения |
| `status` | string | да | `"read"` или `"delivered"` |

---

#### get_messages

Запрос истории сообщений.

```json
{
  "type": "get_messages",
  "limit": 50,
  "before_id": "c6cb1fec-..."
}
```

**Поля:**

| Поле | Тип | Обязательное | Описание |
|------|-----|--------------|----------|
| `type` | string | да | Всегда `"get_messages"` |
| `limit` | integer | нет | Количество (по умолчанию 50, макс. 200) |
| `before_id` | string | нет | ID для пагинации |

---

#### update_profile

Обновление профиля.

```json
{
  "type": "update_profile",
  "text": "😎"
}
```

**Поля:**

| Поле | Тип | Обязательное | Описание |
|------|-----|--------------|----------|
| `type` | string | да | Всегда `"update_profile"` |
| `text` | string | да | Новый аватар |

---

### Сервер → Клиент

#### registered

Регистрация успешна.

```json
{
  "type": "registered",
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Артём",
    "avatar": "👤"
  }
}
```

---

#### message

Новое сообщение.

```json
{
  "type": "message",
  "message": {
    "id": "msg-uuid",
    "sender_id": "550e8400-e29b-41d4-a716-446655440000",
    "sender_name": "Артём",
    "text": "Привет!",
    "timestamp": 1699000000,
    "delivery_status": 1,
    "recipient_id": null,
    "files": []
  }
}
```

---

#### ack

Подтверждение.

```json
{
  "type": "ack",
  "message_id": "msg-uuid",
  "status": "read",
  "sender_id": "660e8400-e29b-41d4-a716-446655440001"
}
```

---

#### messages

История сообщений.

```json
{
  "type": "messages",
  "messages": [...],
  "before_id": "c6cb1fec-...",
  "next_before_id": "msg-001",
  "limit": 50,
  "has_more": true
}
```

---

#### user_online

Пользователь онлайн/офлайн.

```json
{
  "type": "user_online",
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "online": true
}
```

---

#### user_updated

Профиль обновлён.

```json
{
  "type": "user_updated",
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "avatar": "😎"
}
```

---

## Коды ошибок

| Код | Описание |
|-----|----------|
| `400 Bad Request` | Ошибка валидации входных данных |
| `404 Not Found` | Ресурс не найден |
| `500 Internal Server Error` | Внутренняя ошибка сервера |

**Примеры ошибок:**

| Сообщение | Причина |
|-----------|---------|
| `Empty name` | Пустое имя пользователя |
| `No file uploaded` | Файл не был загружен |
| `File not found` | Файл не найден |
| `Database lock error` | Ошибка блокировки БД |
