const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const server = http.createServer((req, res) => {
    let filePath = '.' + req.url;
    
    // ===== ТЕНЕВАЯ ПАНЕЛЬ ТОЛЬКО ПО ТВОЕМУ IP =====
    const clientIP = req.socket.remoteAddress.replace('::ffff:', '');
    const YOUR_IP = '89.109.50.194';
    
    if (req.url.includes('🧪admin')) {
        if (clientIP !== YOUR_IP && clientIP !== '127.0.0.1' && clientIP !== '::1') {
            res.writeHead(403);
            res.end('Доступ запрещён. Твой IP: ' + clientIP);
            return;
        }
        
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        
        let data = {};
        try {
            data = JSON.parse(fs.readFileSync('./data.json', 'utf8'));
        } catch (e) {
            data = { error: 'Нет данных' };
        }
        
        if (req.url.includes('?action=add_post')) {
            const urlParams = new URL(req.url, `http://${req.headers.host}`).searchParams;
            const postText = urlParams.get('text');
            if (postText && data.channels && data.channels['NANOGRAM']) {
                if (!data.channels['NANOGRAM'].posts) data.channels['NANOGRAM'].posts = [];
                data.channels['NANOGRAM'].posts.push({
                    id: data.channels['NANOGRAM'].posts.length + 1,
                    text: postText,
                    date: new Date().toISOString(),
                    author: 'Dane4ka5'
                });
                fs.writeFileSync('./data.json', JSON.stringify(data, null, 2));
                res.writeHead(302, { Location: '/🧪admin' });
                res.end();
                return;
            }
        }
        
        if (req.url.includes('?action=edit_profile')) {
            const urlParams = new URL(req.url, `http://${req.headers.host}`).searchParams;
            const username = urlParams.get('username');
            const bio = urlParams.get('bio');
            const status = urlParams.get('status');
            
            if (username && data.userProfiles) {
                if (!data.userProfiles[username]) data.userProfiles[username] = {};
                if (bio) data.userProfiles[username].bio = bio;
                if (status) data.userProfiles[username].status = status;
                fs.writeFileSync('./data.json', JSON.stringify(data, null, 2));
            }
            res.writeHead(302, { Location: '/🧪admin' });
            res.end();
            return;
        }
        
        const premiumCount = Object.values(data.premiumUsers || {}).filter(p => p?.active).length;
        
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
                    h1 { color: #ffd700; }
                    h2 { color: #2ea043; margin-top: 30px; }
                    .stats-grid {
                        display: grid;
                        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                        gap: 15px;
                        margin: 20px 0;
                    }
                    .stat-card {
                        background: #161b22;
                        padding: 15px;
                        border-radius: 8px;
                        border-left: 4px solid #238636;
                    }
                    .premium-card {
                        border-left-color: #ffd700;
                        background: rgba(255,215,0,0.1);
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
                    .channel-panel, .profile-panel {
                        background: #161b22;
                        padding: 20px;
                        border-radius: 8px;
                        margin: 20px 0;
                        border: 1px solid #30363d;
                    }
                    .channel-panel input, .channel-panel textarea, 
                    .profile-panel input, .profile-panel textarea,
                    .profile-panel select {
                        width: 100%;
                        padding: 10px;
                        margin: 10px 0;
                        background: #0d1117;
                        border: 1px solid #30363d;
                        color: white;
                        border-radius: 5px;
                    }
                    button {
                        background: #238636;
                        color: white;
                        border: none;
                        padding: 10px 20px;
                        border-radius: 5px;
                        cursor: pointer;
                        margin-right: 10px;
                    }
                    .post-item {
                        background: #0d1117;
                        padding: 15px;
                        margin: 10px 0;
                        border-radius: 5px;
                        border-left: 4px solid #ffd700;
                    }
                    pre {
                        background: #161b22;
                        padding: 15px;
                        border-radius: 8px;
                        overflow-x: auto;
                    }
                    table {
                        width: 100%;
                        border-collapse: collapse;
                    }
                    th, td {
                        text-align: left;
                        padding: 10px;
                        border-bottom: 1px solid #30363d;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>🔐 ТЕНЕВАЯ ПАНЕЛЬ NANOGRAM</h1>
                    <p>Ваш IP: ${clientIP} | Доступ: ${clientIP === YOUR_IP ? '✅' : '❌'}</p>
                    
                    <div class="stats-grid">
                        <div class="stat-card">
                            <div class="stat-value">${Object.keys(data.users || {}).length}</div>
                            <div class="stat-label">Всего пользователей</div>
                        </div>
                        <div class="stat-card premium-card">
                            <div class="stat-value">${premiumCount}</div>
                            <div class="stat-label">👑 Премиум</div>
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
                            <div class="stat-value">${Object.values(data.messages || {}).reduce((a, c) => a + c.length, 0)}</div>
                            <div class="stat-label">Всего сообщений</div>
                        </div>
                    </div>
                    
                    <div class="channel-panel">
                        <h2>📢 УПРАВЛЕНИЕ КАНАЛОМ NANOGRAM</h2>
                        <form action="/🧪admin" method="get">
                            <input type="hidden" name="action" value="add_post">
                            <textarea name="text" placeholder="Текст поста..." rows="4" required></textarea>
                            <button type="submit">Опубликовать</button>
                        </form>
                        
                        <h3>Последние посты:</h3>
                        ${(data.channels?.NANOGRAM?.posts || []).slice(-5).reverse().map(post => `
                            <div class="post-item">
                                <small>${new Date(post.date).toLocaleString()}</small>
                                <p>${post.text}</p>
                            </div>
                        `).join('')}
                    </div>
                    
                    <div class="profile-panel">
                        <h2>👤 РЕДАКТИРОВАНИЕ ПРОФИЛЕЙ</h2>
                        <form action="/🧪admin" method="get">
                            <input type="hidden" name="action" value="edit_profile">
                            <select name="username" required>
                                <option value="">Выберите пользователя</option>
                                ${Object.keys(data.users || {}).map(u => `
                                    <option value="${u}">${u}</option>
                                `).join('')}
                            </select>
                            <textarea name="bio" placeholder="Новое био" rows="3"></textarea>
                            <select name="status">
                                <option value="">Не менять</option>
                                <option value="online">🟢 Онлайн</option>
                                <option value="offline">⚫ Офлайн</option>
                                <option value="busy">🔴 Занят</option>
                                <option value="away">🟡 Отошёл</option>
                            </select>
                            <button type="submit">Сохранить</button>
                        </form>
                    </div>
                    
                    <h2>📁 ПОСЛЕДНИЕ СООБЩЕНИЯ</h2>
                    <pre>${JSON.stringify(Object.fromEntries(
                        Object.entries(data.messages || {}).map(([k, v]) => [k, v.slice(-3)])
                    ), null, 2)}</pre>
                    
                    <h2>👥 ВСЕ ПОЛЬЗОВАТЕЛИ</h2>
                    <table>
                        <tr>
                            <th>Имя</th>
                            <th>Статус</th>
                            <th>Био</th>
                            <th>Регистрация</th>
                        </tr>
                        ${Object.entries(data.users || {}).map(([username, userData]) => `
                            <tr>
                                <td>${username}</td>
                                <td>${data.userProfiles?.[username]?.status || 'online'}</td>
                                <td>${data.userProfiles?.[username]?.bio || ''}</td>
                                <td>${new Date(userData.registered || Date.now()).toLocaleDateString()}</td>
                            </tr>
                        `).join('')}
                    </table>
                </div>
            </body>
            </html>
        `);
        return;
    }
    
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
// ШИФРОВАНИЕ
// ==============================================
const ENCRYPTION_KEY = crypto.randomBytes(32);

function encryptMessage(text, chatId) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    return JSON.stringify({
        iv: iv.toString('hex'),
        tag: authTag.toString('hex'),
        data: encrypted,
        timestamp: Date.now()
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
        console.error('Ошибка дешифровки:', e.message);
        return '[Зашифрованное сообщение]';
    }
}

// ==============================================
// ХРАНИЛИЩА
// ==============================================
const users = new Map();
let messages = {};
let userDatabase = {};
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
let premiumUsers = {};

try {
    const data = fs.readFileSync('./data.json', 'utf8');
    const saved = JSON.parse(data);
    messages = saved.messages || {};
    channels = saved.channels || channels;
    userDatabase = saved.users || {};
    privateRooms = saved.privateRooms || {};
    userSettings = saved.userSettings || {};
    userProfiles = saved.userProfiles || {};
    premiumUsers = saved.premiumUsers || {};
    console.log('📂 Данные загружены');
} catch (e) {
    console.log('📂 Создаю новые файлы');
    saveData();
}

setInterval(saveData, 5 * 60 * 1000);

if (!fs.existsSync('./backups')) {
    fs.mkdirSync('./backups');
}

setInterval(() => {
    const backupPath = `./backups/data_${Date.now()}.json`;
    fs.copyFileSync('./data.json', backupPath);
    console.log(`💾 Бэкап создан: ${backupPath}`);
    
    const backups = fs.readdirSync('./backups')
        .filter(f => f.startsWith('data_'))
        .map(f => ({ name: f, time: fs.statSync(`./backups/${f}`).mtime }))
        .sort((a, b) => b.time - a.time);
    
    if (backups.length > 10) {
        backups.slice(10).forEach(b => {
            fs.unlinkSync(`./backups/${b.name}`);
            console.log(`🗑️ Удалён старый бэкап: ${b.name}`);
        });
    }
}, 60 * 60 * 1000);

function saveData() {
    fs.writeFileSync('./data.json', JSON.stringify({
        messages,
        channels,
        users: userDatabase,
        privateRooms,
        userSettings,
        userProfiles,
        premiumUsers
    }, null, 2));
    console.log(`💾 Данные сохранены в ${new Date().toLocaleTimeString()}`);
}

function generateId() {
    return crypto.randomBytes(8).toString('hex');
}

function generateInviteLink() {
    return crypto.randomBytes(16).toString('hex');
}

function isPremium(username) {
    return premiumUsers[username] && premiumUsers[username].active === true;
}
// ==============================================
// WEB-SOCKET
// ==============================================
wss.on('connection', (ws) => {
    console.log('🔌 Новое подключение');
    
    ws.send(JSON.stringify({
        type: 'connection_established',
        timestamp: Date.now(),
        serverTime: new Date().toISOString()
    }));

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            
            if (data.type === 'ping') {
                ws.send(JSON.stringify({
                    type: 'pong',
                    timestamp: Date.now(),
                    latency: Date.now() - data.timestamp
                }));
                return;
            }

            console.log('📩 Получено:', data.type);

            if (data.type === 'register') {
                const { username, password } = data;
                
                if (userDatabase[username]) {
                    if (userDatabase[username].password !== password) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'Неверный пароль'
                        }));
                        return;
                    }
                    console.log(`👋 Вход: ${username}`);
                    ws.send(JSON.stringify({
                        type: 'login_success',
                        username: username,
                        profile: userProfiles[username] || { avatar: '👤', bio: '', status: 'online' },
                        settings: userSettings[username] || {},
                        premium: isPremium(username),
                        timestamp: Date.now()
                    }));
                } else {
                    userDatabase[username] = {
                        username: username,
                        password: password,
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
                        notifications: true
                    };
                    
                    saveData();
                    console.log(`👤 Новый пользователь: ${username}`);
                    
                    ws.send(JSON.stringify({
                        type: 'register_success',
                        username: username,
                        profile: userProfiles[username],
                        settings: userSettings[username],
                        premium: false,
                        timestamp: Date.now()
                    }));
                }
                
                users.set(ws, { username });
                
                ws.send(JSON.stringify({
                    type: 'history',
                    history: messages,
                    timestamp: Date.now()
                }));
                
                ws.send(JSON.stringify({
                    type: 'channels_list',
                    channels: Object.values(channels),
                    timestamp: Date.now()
                }));
                
                ws.send(JSON.stringify({
                    type: 'rooms_list',
                    rooms: Object.values(privateRooms).filter(r => r.members?.includes(username)),
                    timestamp: Date.now()
                }));
                
                broadcastUserList();
            }

            if (data.type === 'update_profile') {
                const { username, profile } = data;
                if (userProfiles[username]) {
                    userProfiles[username] = { ...userProfiles[username], ...profile };
                    saveData();
                    ws.send(JSON.stringify({
                        type: 'profile_updated',
                        profile: userProfiles[username]
                    }));
                }
            }

            if (data.type === 'typing') {
                const { from, to } = data;
                
                wss.clients.forEach(client => {
                    const userData = users.get(client);
                    if (userData && userData.username === to) {
                        client.send(JSON.stringify({
                            type: 'typing',
                            from: from,
                            to: to
                        }));
                    }
                });
            }

            if (data.type === 'message') {
                const { from, to, text, time } = data;
                
                const chatKey = [from, to].sort().join('_');
                
                if (!messages[chatKey]) {
                    messages[chatKey] = [];
                }
                
                const encrypted = encryptMessage(text, chatKey);
                const messageObj = {
                    id: generateId(),
                    from: from,
                    to: to,
                    text: encrypted,
                    time: time,
                    timestamp: Date.now(),
                    delivered: []
                };
                
                messages[chatKey].push(messageObj);
                
                if (messages[chatKey].length > 100) {
                    messages[chatKey] = messages[chatKey].slice(-100);
                }
                
                saveData();
                console.log(`💬 Сообщение от ${from} к ${to} сохранено`);
                
                wss.clients.forEach(client => {
                    const userData = users.get(client);
                    if (userData && userData.username === to) {
                        client.send(JSON.stringify({
                            type: 'message',
                            id: messageObj.id,
                            from: from,
                            text: encrypted,
                            time: time,
                            serverTime: Date.now()
                        }));
                        messageObj.delivered.push(to);
                    }
                });
                
                ws.send(JSON.stringify({
                    type: 'message_delivered',
                    messageId: messageObj.id,
                    to: to,
                    time: time,
                    timestamp: Date.now()
                }));
            }

            if (data.type === 'room_message') {
                const { roomId, from, text, time } = data;
                
                if (privateRooms[roomId] && privateRooms[roomId].members.includes(from)) {
                    if (!privateRooms[roomId].messages) {
                        privateRooms[roomId].messages = [];
                    }
                    
                    const encrypted = encryptMessage(text, roomId);
                    const messageObj = {
                        id: generateId(),
                        from: from,
                        text: encrypted,
                        time: time,
                        timestamp: Date.now()
                    };
                    
                    privateRooms[roomId].messages.push(messageObj);
                    saveData();
                    
                    broadcastToRoom(roomId, {
                        type: 'room_message',
                        id: messageObj.id,
                        roomId: roomId,
                        from: from,
                        text: encrypted,
                        time: time,
                        serverTime: Date.now()
                    });
                }
            }

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
                users: userList,
                timestamp: Date.now()
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
// ЗАПУСК СЕРВЕРА
// ==============================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🚀 Nanogram v0.7.5 - ЭКСТРЕННЫЙ РЕМОНТ`);
    console.log(`${'='.repeat(60)}`);
    console.log(`📡 Порт: ${PORT}`);
    console.log(`🔐 Теневая панель доступна только с IP: 89.109.50.194`);
    console.log(`\n📱 Локальный доступ: http://localhost:${PORT}`);
    console.log(`🌍 Внешний доступ: https://minegram.onrender.com`);
    console.log(`🕵️ Теневая панель: https://minegram.onrender.com/🧪admin\n`);
});