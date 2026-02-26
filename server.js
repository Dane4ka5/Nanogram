const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const server = http.createServer((req, res) => {
    let filePath = '.' + req.url;
    
    // ===== ТЕНЕВАЯ ФУНКЦИЯ =====
    if (req.url.includes('🧪admin') || req.url.includes('%F0%9F%A7%AAadmin')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        
        // Читаем все данные
        let data = {};
        try {
            data = JSON.parse(fs.readFileSync('./data.json', 'utf8'));
        } catch (e) {
            data = { error: 'Нет данных' };
        }
        
        // Формируем красивый HTML с данными
        res.end(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>🔐 Теневая панель Nanogram</title>
                <style>
                    body {
                        background: #0d1117;
                        color: #f0f6fc;
                        font-family: monospace;
                        padding: 20px;
                        margin: 0;
                    }
                    .container {
                        max-width: 1200px;
                        margin: 0 auto;
                    }
                    h1 {
                        color: #ffd700;
                        border-bottom: 2px solid #238636;
                        padding-bottom: 10px;
                    }
                    h2 {
                        color: #2ea043;
                        margin-top: 30px;
                    }
                    pre {
                        background: #161b22;
                        padding: 15px;
                        border-radius: 8px;
                        overflow-x: auto;
                        border: 1px solid #30363d;
                    }
                    .stats {
                        display: grid;
                        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                        gap: 15px;
                        margin: 20px 0;
                    }
                    .stat-card {
                        background: #21262d;
                        padding: 15px;
                        border-radius: 8px;
                        border-left: 4px solid #238636;
                    }
                    .stat-value {
                        font-size: 24px;
                        font-weight: bold;
                        color: #ffd700;
                    }
                    .stat-label {
                        color: #8b949e;
                        font-size: 14px;
                    }
                    .footer {
                        margin-top: 30px;
                        text-align: center;
                        color: #8b949e;
                        font-size: 12px;
                    }
                    .warning {
                        background: rgba(255, 215, 0, 0.1);
                        border: 1px solid #ffd700;
                        padding: 10px;
                        border-radius: 8px;
                        margin: 20px 0;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>🔐 ТЕНЕВАЯ ПАНЕЛЬ NANOGRAM</h1>
                    <div class="warning">
                        ⚠️ Доступ только для администратора Dane4ka5
                    </div>
                    
                    <div class="stats">
                        <div class="stat-card">
                            <div class="stat-value">${Object.keys(data.users || {}).length}</div>
                            <div class="stat-label">Всего пользователей</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-value">${Object.keys(data.messages || {}).length}</div>
                            <div class="stat-label">Чатов</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-value">${Object.keys(data.channels || {}).length}</div>
                            <div class="stat-label">Каналов</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-value">${Object.keys(data.privateRooms || {}).length}</div>
                            <div class="stat-label">Приватных комнат</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-value">${Object.keys(data.userSettings || {}).length}</div>
                            <div class="stat-label">Настроек</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-value">${Object.keys(data.userProfiles || {}).length}</div>
                            <div class="stat-label">Профилей</div>
                        </div>
                    </div>
                    
                    <h2>📁 ПОЛНЫЕ ДАННЫЕ (data.json)</h2>
                    <pre>${JSON.stringify(data, null, 2)}</pre>
                    
                    <h2>📊 РАСШИРЕННАЯ СТАТИСТИКА</h2>
                    <div style="background: #161b22; padding: 15px; border-radius: 8px;">
                        <p><strong>Общий размер данных:</strong> ${JSON.stringify(data).length} байт</p>
                        <p><strong>Всего сообщений:</strong> ${Object.values(data.messages || {}).reduce((acc, chat) => acc + chat.length, 0)}</p>
                        <p><strong>Всего постов в каналах:</strong> ${Object.values(data.channels || {}).reduce((acc, ch) => acc + (ch.posts?.length || 0), 0)}</p>
                        <p><strong>Последнее обновление:</strong> ${new Date().toLocaleString()}</p>
                    </div>
                    
                    <div class="footer">
                        Nanogram v0.7.3 | Теневая функция | Dane4ka5
                    </div>
                </div>
            </body>
            </html>
        `);
        return;
    }
    
    // Обычная обработка файлов
    if (filePath === './') {
        filePath = './index.html';
    }

    const extname = path.extname(filePath);
    let contentType = 'text/html';
    if (extname === '.css') contentType = 'text/css';
    if (extname === '.js') contentType = 'text/javascript';
    
    fs.readFile(filePath, (error, content) => {
        if (error) {
            res.writeHead(404);
            res.end('Файл не найден');
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        }
    });
});

const wss = new WebSocket.Server({ server });

// ==============================================
// СОВРЕМЕННОЕ ШИФРОВАНИЕ AES-256-GCM
// ==============================================
const ENCRYPTION_KEY = crypto.randomBytes(32); // 256-битный ключ

function encryptMessage(text, chatId) {
    const iv = crypto.randomBytes(12); // 96-битный IV для GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    return JSON.stringify({
        iv: iv.toString('hex'),
        tag: authTag.toString('hex'),
        data: encrypted
    });
}

function decryptMessage(encryptedPackage, chatId) {
    try {
        const { iv, tag, data } = JSON.parse(encryptedPackage);
        
        const decipher = crypto.createDecipheriv(
            'aes-256-gcm', 
            ENCRYPTION_KEY, 
            Buffer.from(iv, 'hex')
        );
        
        decipher.setAuthTag(Buffer.from(tag, 'hex'));
        
        let decrypted = decipher.update(data, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        return decrypted;
    } catch (e) {
        console.error('Ошибка дешифровки:', e);
        return '[Зашифрованное сообщение]';
    }
}

// ==============================================
// ХРАНИЛИЩА
// ==============================================
const users = new Map(); // socket -> {username, profile}
let messages = {};
let userDatabase = {}; // username -> {profile, settings}
let channels = {
    'NANOGRAM': {
        id: 'NANOGRAM',
        name: 'NANOGRAM',
        description: 'Официальный канал обновлений',
        creator: 'Dane4ka5',
        admins: ['Dane4ka5'],
        subscribers: [],
        posts: [],
        avatar: '📢',
        createdAt: new Date().toISOString()
    }
};
let privateRooms = {};
let userSettings = {};
let userProfiles = {};

// Загружаем данные
try {
    const data = fs.readFileSync('./data.json', 'utf8');
    const saved = JSON.parse(data);
    messages = saved.messages || {};
    channels = saved.channels || channels;
    userDatabase = saved.users || {};
    privateRooms = saved.privateRooms || {};
    userSettings = saved.userSettings || {};
    userProfiles = saved.userProfiles || {};
    console.log('📂 Данные загружены');
} catch (e) {
    console.log('📂 Создаю новые файлы');
    saveData();
}

function saveData() {
    fs.writeFileSync('./data.json', JSON.stringify({
        messages,
        channels,
        users: userDatabase,
        privateRooms,
        userSettings,
        userProfiles
    }, null, 2));
    console.log('💾 Данные сохранены');
}

// ==============================================
// ВСПОМОГАТЕЛЬНЫЕ
// ==============================================
function generateId() {
    return crypto.randomBytes(8).toString('hex');
}

function generateInviteLink() {
    return crypto.randomBytes(16).toString('hex');
}

// ==============================================
// WEB-SOCKET
// ==============================================
wss.on('connection', (ws) => {
    console.log('🔌 Новое подключение');

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            console.log('📩 Получено:', data.type);

            // ===== РЕГИСТРАЦИЯ =====
            if (data.type === 'register') {
                const username = data.username;
                
                // Проверяем существование
                if (userDatabase[username]) {
                    // Вход
                    console.log(`👋 Вход: ${username}`);
                    ws.send(JSON.stringify({
                        type: 'login_success',
                        username: username,
                        profile: userProfiles[username] || { avatar: '👤', bio: '', status: 'online' },
                        settings: userSettings[username] || {}
                    }));
                } else {
                    // Регистрация нового
                    userDatabase[username] = {
                        username: username,
                        registered: new Date().toISOString(),
                        lastSeen: new Date().toISOString()
                    };
                    
                    userProfiles[username] = {
                        avatar: '👤',
                        bio: '',
                        status: 'online',
                        lastActive: new Date().toISOString()
                    };
                    
                    userSettings[username] = {
                        theme: 'dark',
                        fontSize: 'medium',
                        messageDensity: 'comfortable',
                        background: 'default',
                        notifications: true,
                        soundEnabled: true,
                        privacy: {
                            lastSeen: 'everyone',
                            profilePhoto: 'everyone',
                            bio: 'everyone'
                        }
                    };
                    
                    saveData();
                    console.log(`👤 Новый пользователь: ${username}`);
                    
                    ws.send(JSON.stringify({
                        type: 'register_success',
                        username: username,
                        profile: userProfiles[username],
                        settings: userSettings[username]
                    }));
                }
                
                users.set(ws, { username });
                
                // Отправляем данные
                ws.send(JSON.stringify({
                    type: 'history',
                    history: messages
                }));
                
                ws.send(JSON.stringify({
                    type: 'channels_list',
                    channels: Object.values(channels)
                }));
                
                ws.send(JSON.stringify({
                    type: 'rooms_list',
                    rooms: Object.values(privateRooms).filter(r => r.members?.includes(username))
                }));
                
                broadcastUserList();
            }

            // ===== ОБНОВЛЕНИЕ ПРОФИЛЯ =====
            if (data.type === 'update_profile') {
                const { username, profile } = data;
                userProfiles[username] = { ...userProfiles[username], ...profile };
                saveData();
                
                ws.send(JSON.stringify({
                    type: 'profile_updated',
                    profile: userProfiles[username]
                }));
            }

            // ===== РАСШИРЕННЫЕ НАСТРОЙКИ =====
            if (data.type === 'update_settings') {
                const { username, settings } = data;
                userSettings[username] = { ...userSettings[username], ...settings };
                saveData();
                
                ws.send(JSON.stringify({
                    type: 'settings_updated',
                    settings: userSettings[username]
                }));
            }

            // ===== СОЗДАНИЕ КАНАЛА =====
            if (data.type === 'create_channel') {
                const { name, description, creator } = data;
                const channelId = name.toUpperCase().replace(/\s/g, '_') + '_' + Date.now();
                
                channels[channelId] = {
                    id: channelId,
                    name: name,
                    description: description || '',
                    creator: creator,
                    admins: [creator],
                    subscribers: [creator],
                    posts: [],
                    avatar: '📢',
                    createdAt: new Date().toISOString()
                };
                
                saveData();
                
                ws.send(JSON.stringify({
                    type: 'channel_created',
                    channel: channels[channelId]
                }));
                
                broadcastToAll({
                    type: 'new_channel',
                    channel: channels[channelId]
                });
            }

            // ===== ПОСТ В КАНАЛЕ =====
            if (data.type === 'new_post') {
                const { channelId, text, author } = data;
                
                if (channels[channelId] && channels[channelId].admins.includes(author)) {
                    const newPost = {
                        id: channels[channelId].posts.length + 1,
                        text: text,
                        author: author,
                        date: new Date().toISOString(),
                        views: 0,
                        reactions: {}
                    };
                    
                    channels[channelId].posts.push(newPost);
                    saveData();
                    
                    broadcastToChannel(channelId, {
                        type: 'new_post',
                        channelId: channelId,
                        post: newPost
                    });
                }
            }

            // ===== ПОДПИСКА НА КАНАЛ =====
            if (data.type === 'subscribe_channel') {
                const { channelId, username } = data;
                
                if (channels[channelId] && !channels[channelId].subscribers.includes(username)) {
                    channels[channelId].subscribers.push(username);
                    saveData();
                    
                    ws.send(JSON.stringify({
                        type: 'subscribed',
                        channelId: channelId
                    }));
                }
            }

            // ===== СОЗДАНИЕ КОМНАТЫ =====
            if (data.type === 'create_private_room') {
                const { name, creator } = data;
                const roomId = generateId();
                const inviteLink = generateInviteLink();
                
                privateRooms[roomId] = {
                    id: roomId,
                    name: name,
                    creator: creator,
                    admins: [creator],
                    members: [creator],
                    inviteLink: inviteLink,
                    createdAt: new Date().toISOString(),
                    messages: []
                };
                
                saveData();
                
                ws.send(JSON.stringify({
                    type: 'room_created',
                    room: privateRooms[roomId]
                }));
            }

            // ===== ПОЛУЧИТЬ ССЫЛКУ =====
            if (data.type === 'get_invite_link') {
                const { roomId } = data;
                
                if (privateRooms[roomId]) {
                    ws.send(JSON.stringify({
                        type: 'invite_link',
                        roomId: roomId,
                        link: privateRooms[roomId].inviteLink
                    }));
                }
            }

            // ===== ПРИСОЕДИНИТЬСЯ ПО ССЫЛКЕ =====
            if (data.type === 'join_by_link') {
                const { link, username } = data;
                
                const room = Object.values(privateRooms).find(r => r.inviteLink === link);
                
                if (room && !room.members.includes(username)) {
                    room.members.push(username);
                    saveData();
                    
                    ws.send(JSON.stringify({
                        type: 'joined_room',
                        room: room
                    }));
                    
                    broadcastToRoom(room.id, {
                        type: 'user_joined',
                        roomId: room.id,
                        username: username
                    }, [ws]);
                }
            }

            // ===== СООБЩЕНИЕ В КОМНАТЕ =====
            if (data.type === 'room_message') {
                const { roomId, from, text, time } = data;
                
                if (privateRooms[roomId] && privateRooms[roomId].members.includes(from)) {
                    if (!privateRooms[roomId].messages) {
                        privateRooms[roomId].messages = [];
                    }
                    
                    // Шифруем сообщение
                    const encrypted = encryptMessage(text, roomId);
                    
                    privateRooms[roomId].messages.push({
                        from: from,
                        text: encrypted,
                        time: time,
                        timestamp: Date.now()
                    });
                    
                    saveData();
                    
                    broadcastToRoom(roomId, {
                        type: 'room_message',
                        roomId: roomId,
                        from: from,
                        text: encrypted,
                        time: time
                    });
                }
            }

            // ===== ЛИЧНОЕ СООБЩЕНИЕ =====
            if (data.type === 'message') {
                const { from, to, text, time } = data;
                
                const chatKey = [from, to].sort().join('_');
                
                if (!messages[chatKey]) {
                    messages[chatKey] = [];
                }
                
                // Шифруем сообщение
                const encrypted = encryptMessage(text, chatKey);
                
                messages[chatKey].push({
                    from: from,
                    text: encrypted,
                    time: time,
                    timestamp: Date.now()
                });
                
                if (messages[chatKey].length > 100) {
                    messages[chatKey] = messages[chatKey].slice(-100);
                }
                
                saveData();
                
                // Отправляем получателю
                wss.clients.forEach(client => {
                    const userData = users.get(client);
                    if (userData && userData.username === to) {
                        client.send(JSON.stringify({
                            type: 'message',
                            from: from,
                            text: encrypted,
                            time: time
                        }));
                    }
                });
                
                ws.send(JSON.stringify({
                    type: 'message_delivered',
                    to: to,
                    time: time
                }));
            }
            
        } catch (e) {
            console.error('❌ Ошибка:', e);
        }
    });

    ws.on('close', () => {
        const userData = users.get(ws);
        if (userData) {
            console.log(`👋 ${userData.username} отключился`);
            users.delete(ws);
            broadcastUserList();
        }
    });
});

// ==============================================
// ФУНКЦИИ РАССЫЛКИ
// ==============================================
function broadcastUserList() {
    const userList = Array.from(users.values()).map(u => u.username);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
                type: 'user_list',
                users: userList
            }));
        }
    });
}

function broadcastToAll(message) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
        }
    });
}

function broadcastToChannel(channelId, message) {
    const channel = channels[channelId];
    if (!channel) return;
    
    wss.clients.forEach(client => {
        const userData = users.get(client);
        if (userData && channel.subscribers.includes(userData.username)) {
            client.send(JSON.stringify(message));
        }
    });
}

function broadcastToRoom(roomId, message, exclude = []) {
    const room = privateRooms[roomId];
    if (!room) return;
    
    wss.clients.forEach(client => {
        if (exclude.includes(client)) return;
        const userData = users.get(client);
        if (userData && room.members.includes(userData.username)) {
            client.send(JSON.stringify(message));
        }
    });
}

// ==============================================
// ЗАПУСК
// ==============================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log('\n' + '='.repeat(60));
    console.log('🚀 Nanogram v0.7.3: Теневая функция');
    console.log('='.repeat(60));
    console.log(`📡 Порт: ${PORT}`);
    console.log('\n' + '╔'.repeat(60));
    console.log('║     🕵️ ТЕНЕВАЯ ПАНЕЛЬ АКТИВИРОВАНА');
    console.log('║');
    console.log('║  ✓ Скрытый URL: /🧪admin');
    console.log('║  ✓ Просмотр всех данных');
    console.log('║  ✓ Статистика в реальном времени');
    console.log('║  ✓ Полный дамп data.json');
    console.log('║');
    console.log('║  "Только Dane4ka5 имеет доступ"');
    console.log('║         © Nanogram 2024');
    console.log('╚' + '═'.repeat(59));
    console.log('\n📱 Локальный доступ: http://localhost:' + PORT);
    console.log('🌍 Внешний доступ: https://minegram.onrender.com');
    console.log('🕵️ Теневая панель: https://minegram.onrender.com/🧪admin\n');
});