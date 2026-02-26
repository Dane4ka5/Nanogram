const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const server = http.createServer((req, res) => {
    let filePath = '.' + req.url;
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
// ХРАНИЛИЩА
// ==============================================
const users = new Map(); // socket -> {username, settings}
let messages = {};
let userDatabase = {};

// Каналы (теперь могут создавать все)
let channels = {
    'NANOGRAM': {
        id: 'NANOGRAM',
        name: 'NANOGRAM',
        description: 'Официальный канал обновлений',
        creator: 'Dane4ka5',
        admins: ['Dane4ka5'],
        subscribers: [],
        posts: [],
        createdAt: new Date().toISOString(),
        avatar: '📢'
    }
};

// Приватные комнаты
let privateRooms = {};

// Настройки пользователей
let userSettings = {};

// Загружаем данные
try {
    const data = fs.readFileSync('./data.json', 'utf8');
    const saved = JSON.parse(data);
    messages = saved.messages || {};
    channels = saved.channels || channels;
    userDatabase = saved.users || {};
    privateRooms = saved.privateRooms || {};
    userSettings = saved.userSettings || {};
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
        userSettings
    }, null, 2));
}

// ==============================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ==============================================
function generateId() {
    return crypto.randomBytes(8).toString('hex');
}

function generateInviteLink() {
    return crypto.randomBytes(16).toString('hex');
}

// ==============================================
// WEB-SOCKET ОБРАБОТКА
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
                
                let existingUser = null;
                for (let [key, value] of Object.entries(userDatabase)) {
                    if (value.username === username) {
                        existingUser = value;
                        break;
                    }
                }
                
                if (existingUser) {
                    console.log(`👋 Вход: ${username}`);
                    ws.send(JSON.stringify({
                        type: 'login_success',
                        username: username,
                        settings: userSettings[username] || {}
                    }));
                } else {
                    userDatabase[username] = {
                        username: username,
                        registered: new Date().toISOString(),
                        lastSeen: new Date().toISOString()
                    };
                    userSettings[username] = {
                        fontSize: 'medium',
                        theme: 'dark',
                        messageDensity: 'comfortable',
                        background: 'default'
                    };
                    saveData();
                    console.log(`👤 Новый пользователь: ${username}`);
                    
                    ws.send(JSON.stringify({
                        type: 'register_success',
                        username: username,
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
                    rooms: Object.values(privateRooms).filter(r => r.members.includes(username))
                }));
                
                broadcastUserList();
            }

            // ===== СОЗДАНИЕ КАНАЛА =====
            if (data.type === 'create_channel') {
                const { name, description, creator } = data;
                const channelId = name.toUpperCase().replace(/\s/g, '_');
                
                if (channels[channelId]) {
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Канал с таким названием уже существует'
                    }));
                    return;
                }
                
                channels[channelId] = {
                    id: channelId,
                    name: name,
                    description: description || '',
                    creator: creator,
                    admins: [creator],
                    subscribers: [creator],
                    posts: [],
                    createdAt: new Date().toISOString(),
                    avatar: '📢'
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

            // ===== СОЗДАНИЕ ПРИВАТНОЙ КОМНАТЫ =====
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

            // ===== ПОЛУЧИТЬ ССЫЛКУ-ПРИГЛАШЕНИЕ =====
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
                    
                    privateRooms[roomId].messages.push({
                        from: from,
                        text: text,
                        time: time,
                        timestamp: Date.now()
                    });
                    
                    saveData();
                    
                    broadcastToRoom(roomId, {
                        type: 'room_message',
                        roomId: roomId,
                        from: from,
                        text: text,
                        time: time
                    });
                }
            }

            // ===== ОБНОВЛЕНИЕ НАСТРОЕК =====
            if (data.type === 'update_settings') {
                const { username, settings } = data;
                
                userSettings[username] = {
                    ...userSettings[username],
                    ...settings
                };
                
                saveData();
                
                ws.send(JSON.stringify({
                    type: 'settings_updated',
                    settings: userSettings[username]
                }));
            }

            // ===== ОБЫЧНОЕ СООБЩЕНИЕ =====
            if (data.type === 'message') {
                const { from, to, text, time } = data;
                
                const chatKey = [from, to].sort().join('_');
                
                if (!messages[chatKey]) {
                    messages[chatKey] = [];
                }
                
                messages[chatKey].push({
                    from: from,
                    text: text,
                    time: time,
                    timestamp: Date.now()
                });
                
                if (messages[chatKey].length > 100) {
                    messages[chatKey] = messages[chatKey].slice(-100);
                }
                
                saveData();
                
                wss.clients.forEach(client => {
                    const userData = users.get(client);
                    if (userData && userData.username === to) {
                        client.send(JSON.stringify({
                            type: 'message',
                            from: from,
                            text: text,
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
    console.log('🚀 Nanogram запущен!');
    console.log('='.repeat(60));
    console.log(`📡 Порт: ${PORT}`);
    console.log('\n' + '╔'.repeat(60));
    console.log('║     🚀 НОВАЯ ЭРА: КАНАЛЫ И КОМНАТЫ');
    console.log('║');
    console.log('║  ✓ Каналы для всех пользователей');
    console.log('║  ✓ Приватные комнаты по ссылкам');
    console.log('║  ✓ Настройки интерфейса');
    console.log('║  ✓ Админка каналов');
    console.log('║  ✓ Приглашения');
    console.log('║');
    console.log('║  "Безопасность должна быть');
    console.log('║   доступной для всех"');
    console.log('║         © Nanogram 2024');
    console.log('╚' + '═'.repeat(59));
    console.log('\n📱 Локальный доступ: http://localhost:' + PORT);
    console.log('🌍 Внешний доступ: https://minegram.onrender.com\n');
});