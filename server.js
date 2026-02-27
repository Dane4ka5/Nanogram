const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const server = http.createServer((req, res) => {
    // Устанавливаем правильную кодировку для всего
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    
    let filePath = '.' + req.url;
    
    // ===== ТЕНЕВАЯ ПАНЕЛЬ =====
    const clientIP = req.socket.remoteAddress.replace('::ffff:', '');
    const YOUR_IP = '89.109.50.194';
    
    if (req.url.includes('🧪admin')) {
        if (clientIP !== YOUR_IP && clientIP !== '127.0.0.1' && clientIP !== '::1') {
            res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<h1>Доступ запрещён</h1><p>Ваш IP: ' + clientIP + '</p>');
            return;
        }
        
        let data = {};
        try {
            const rawData = fs.readFileSync('./data.json', 'utf8');
            data = JSON.parse(rawData);
        } catch (e) {
            data = { 
                error: 'Нет данных или ошибка чтения',
                users: {},
                messages: {},
                channels: { 'NANOGRAM': { posts: [] } },
                userProfiles: {}
            };
        }
        
        // Обработка добавления поста
        if (req.url.includes('action=add_post')) {
            const urlParams = new URL(req.url, `http://${req.headers.host}`).searchParams;
            const postText = urlParams.get('text');
            if (postText && postText.trim()) {
                if (!data.channels) data.channels = {};
                if (!data.channels['NANOGRAM']) {
                    data.channels['NANOGRAM'] = { 
                        id: 'NANOGRAM', 
                        name: 'NANOGRAM', 
                        posts: [] 
                    };
                }
                if (!data.channels['NANOGRAM'].posts) data.channels['NANOGRAM'].posts = [];
                
                data.channels['NANOGRAM'].posts.push({
                    id: data.channels['NANOGRAM'].posts.length + 1,
                    text: postText.trim(),
                    date: new Date().toISOString(),
                    author: 'Dane4ka5'
                });
                
                fs.writeFileSync('./data.json', JSON.stringify(data, null, 2), 'utf8');
                res.writeHead(302, { Location: '/🧪admin' });
                res.end();
                return;
            }
        }
        
        // Обработка редактирования профиля
        if (req.url.includes('action=edit_profile')) {
            const urlParams = new URL(req.url, `http://${req.headers.host}`).searchParams;
            const username = urlParams.get('username');
            const bio = urlParams.get('bio');
            const status = urlParams.get('status');
            
            if (username && data.userProfiles) {
                if (!data.userProfiles[username]) data.userProfiles[username] = {};
                if (bio && bio.trim()) data.userProfiles[username].bio = bio.trim();
                if (status && status.trim()) data.userProfiles[username].status = status;
                fs.writeFileSync('./data.json', JSON.stringify(data, null, 2), 'utf8');
            }
            res.writeHead(302, { Location: '/🧪admin' });
            res.end();
            return;
        }
        
        // Подсчёт статистики
        const usersCount = data.users ? Object.keys(data.users).length : 0;
        const messagesCount = data.messages ? Object.keys(data.messages).length : 0;
        const channelsCount = data.channels ? Object.keys(data.channels).length : 0;
        const roomsCount = data.privateRooms ? Object.keys(data.privateRooms).length : 0;
        
        let totalMessages = 0;
        if (data.messages) {
            Object.values(data.messages).forEach(chat => {
                if (Array.isArray(chat)) totalMessages += chat.length;
            });
        }
        
        // Формируем HTML
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🔐 Теневая панель Nanogram</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            background: #0d1117;
            color: #f0f6fc;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            padding: 20px;
        }
        .container { max-width: 1400px; margin: 0 auto; }
        h1 { color: #ffd700; font-size: 32px; margin-bottom: 20px; }
        h2 { color: #2ea043; margin: 25px 0 15px; font-size: 24px; }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 15px;
            margin: 20px 0;
        }
        .stat-card {
            background: #161b22;
            padding: 20px;
            border-radius: 10px;
            border-left: 4px solid #238636;
        }
        .stat-card.premium { border-left-color: #ffd700; background: rgba(255,215,0,0.1); }
        .stat-value { font-size: 28px; font-weight: bold; color: #ffd700; }
        .stat-label { color: #8b949e; font-size: 14px; margin-top: 5px; }
        .panel {
            background: #161b22;
            padding: 25px;
            border-radius: 10px;
            margin: 20px 0;
            border: 1px solid #30363d;
        }
        input, textarea, select {
            width: 100%;
            padding: 12px;
            margin: 10px 0;
            background: #0d1117;
            border: 1px solid #30363d;
            color: #f0f6fc;
            border-radius: 6px;
            font-size: 14px;
        }
        button {
            background: #238636;
            color: white;
            border: none;
            padding: 12px 25px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            margin-right: 10px;
        }
        button:hover { background: #2ea043; }
        .post-item {
            background: #0d1117;
            padding: 15px;
            margin: 10px 0;
            border-radius: 6px;
            border-left: 4px solid #ffd700;
        }
        pre {
            background: #0d1117;
            padding: 15px;
            border-radius: 6px;
            overflow-x: auto;
            font-size: 13px;
            border: 1px solid #30363d;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            background: #161b22;
            border-radius: 6px;
            overflow: hidden;
        }
        th {
            background: #21262d;
            padding: 12px;
            text-align: left;
            font-weight: 600;
        }
        td {
            padding: 12px;
            border-bottom: 1px solid #30363d;
        }
        .ip-info {
            background: #1f2a3a;
            padding: 10px 15px;
            border-radius: 6px;
            margin: 10px 0;
            border-left: 4px solid #58a6ff;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔐 ТЕНЕВАЯ ПАНЕЛЬ NANOGRAM</h1>
        
        <div class="ip-info">
            <strong>Ваш IP:</strong> ${clientIP} | 
            <strong>Доступ:</strong> ${clientIP === YOUR_IP ? '✅ РАЗРЕШЁН' : '❌ ЗАПРЕЩЁН'} |
            <strong>Разрешённый IP:</strong> ${YOUR_IP}
        </div>
        
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-value">${usersCount}</div>
                <div class="stat-label">Пользователей</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${totalMessages}</div>
                <div class="stat-label">Сообщений</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${messagesCount}</div>
                <div class="stat-label">Чатов</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${channelsCount}</div>
                <div class="stat-label">Каналов</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${roomsCount}</div>
                <div class="stat-label">Комнат</div>
            </div>
        </div>
        
        <div class="panel">
            <h2>📢 УПРАВЛЕНИЕ КАНАЛОМ NANOGRAM</h2>
            <form method="get">
                <input type="hidden" name="action" value="add_post">
                <textarea name="text" placeholder="Текст поста..." rows="4" required></textarea>
                <button type="submit">📢 Опубликовать</button>
            </form>
            
            <h3 style="margin-top: 25px;">Последние посты:</h3>
            ${(() => {
                const posts = data.channels?.NANOGRAM?.posts || [];
                return posts.slice(-5).reverse().map(post => `
                    <div class="post-item">
                        <small style="color: #8b949e">${new Date(post.date).toLocaleString()}</small>
                        <p style="margin-top: 8px">${post.text}</p>
                    </div>
                `).join('');
            })()}
        </div>
        
        <div class="panel">
            <h2>👤 РЕДАКТИРОВАНИЕ ПРОФИЛЕЙ</h2>
            <form method="get">
                <input type="hidden" name="action" value="edit_profile">
                <select name="username" required>
                    <option value="">Выберите пользователя</option>
                    ${Object.keys(data.users || {}).map(u => 
                        `<option value="${u}">${u}</option>`
                    ).join('')}
                </select>
                <textarea name="bio" placeholder="Новое био" rows="3"></textarea>
                <select name="status">
                    <option value="">Не менять</option>
                    <option value="online">🟢 Онлайн</option>
                    <option value="offline">⚫ Офлайн</option>
                    <option value="busy">🔴 Занят</option>
                    <option value="away">🟡 Отошёл</option>
                </select>
                <button type="submit">💾 Сохранить</button>
            </form>
        </div>
        
        <h2>📁 ПОСЛЕДНИЕ СООБЩЕНИЯ</h2>
        <pre>${JSON.stringify(
            Object.fromEntries(
                Object.entries(data.messages || {}).map(([k, v]) => [
                    k, 
                    Array.isArray(v) ? v.slice(-3).map(m => ({
                        from: m.from,
                        time: m.time,
                        text: m.text ? (m.text.substring(0, 50) + '...') : '...'
                    })) : []
                ])
            ), null, 2
        )}</pre>
        
        <h2>👥 ПОЛЬЗОВАТЕЛИ</h2>
        <table>
            <tr>
                <th>Имя</th>
                <th>Статус</th>
                <th>Био</th>
                <th>Регистрация</th>
            </tr>
            ${Object.entries(data.users || {}).map(([name, info]) => `
                <tr>
                    <td><strong>${name}</strong></td>
                    <td>${data.userProfiles?.[name]?.status || 'online'}</td>
                    <td>${data.userProfiles?.[name]?.bio || '—'}</td>
                    <td>${info.registered ? new Date(info.registered).toLocaleDateString() : '—'}</td>
                </tr>
            `).join('')}
        </table>
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
    let contentType = 'text/html; charset=utf-8';
    if (extname === '.css') contentType = 'text/css; charset=utf-8';
    if (extname === '.js') contentType = 'application/javascript; charset=utf-8';
    if (extname === '.json') contentType = 'application/json; charset=utf-8';
    
    fs.readFile(filePath, 'utf8', (error, content) => {
        if (error) {
            res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<h1>404 - Файл не найден</h1>');
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        }
    });
});
const wss = new WebSocket.Server({ server });

// ==============================================
// ШИФРОВАНИЕ (AES-256-GCM)
// ==============================================
const ENCRYPTION_KEY = crypto.randomBytes(32);

function encryptMessage(text) {
    try {
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
        
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        const authTag = cipher.getAuthTag();
        
        return JSON.stringify({
            iv: iv.toString('hex'),
            tag: authTag.toString('hex'),
            data: encrypted
        });
    } catch (e) {
        console.error('Ошибка шифрования:', e);
        return text;
    }
}

function decryptMessage(encryptedPackage) {
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
        return encryptedPackage; // Возвращаем как есть, если не удалось расшифровать
    }
}

// ==============================================
// ХРАНИЛИЩА ДАННЫХ
// ==============================================
const users = new Map(); // WebSocket -> { username }
let messages = {};       // chatKey -> [message, ...]
let userDatabase = {};   // username -> { password, registered, lastSeen }
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
let privateRooms = {};    // roomId -> { ... }
let userProfiles = {};    // username -> { avatar, bio, status }
let userSettings = {};    // username -> { theme, fontSize, ... }
let premiumUsers = {};    // username -> { active, tier, expires }

// ==============================================
// ЗАГРУЗКА ДАННЫХ
// ==============================================
function loadData() {
    try {
        if (fs.existsSync('./data.json')) {
            const rawData = fs.readFileSync('./data.json', 'utf8');
            const data = JSON.parse(rawData);
            
            messages = data.messages || {};
            channels = { ...channels, ...(data.channels || {}) };
            userDatabase = data.users || {};
            privateRooms = data.privateRooms || {};
            userProfiles = data.userProfiles || {};
            userSettings = data.userSettings || {};
            premiumUsers = data.premiumUsers || {};
            
            console.log('📂 Данные загружены успешно');
            console.log(`   👥 Пользователей: ${Object.keys(userDatabase).length}`);
            console.log(`   💬 Сообщений: ${Object.values(messages).reduce((a, c) => a + c.length, 0)}`);
        } else {
            console.log('📂 Файл data.json не найден, создаю новый');
            saveData();
        }
    } catch (e) {
        console.error('❌ Ошибка загрузки данных:', e);
        // Создаём резервную копию битого файла
        if (fs.existsSync('./data.json')) {
            const backupPath = `./data_backup_${Date.now()}.json`;
            fs.copyFileSync('./data.json', backupPath);
            console.log(`📦 Создана резервная копия: ${backupPath}`);
        }
        // Начинаем с чистого листа
        messages = {};
        userDatabase = {};
        privateRooms = {};
        userProfiles = {};
        userSettings = {};
        premiumUsers = {};
    }
}

// ==============================================
// СОХРАНЕНИЕ ДАННЫХ
// ==============================================
function saveData() {
    try {
        const data = {
            messages,
            channels,
            users: userDatabase,
            privateRooms,
            userProfiles,
            userSettings,
            premiumUsers,
            lastSaved: new Date().toISOString()
        };
        
        fs.writeFileSync('./data.json', JSON.stringify(data, null, 2), 'utf8');
        console.log(`💾 Данные сохранены в ${new Date().toLocaleTimeString()}`);
        return true;
    } catch (e) {
        console.error('❌ Ошибка сохранения данных:', e);
        return false;
    }
}

// Загружаем данные при старте
loadData();

// Автосохранение каждые 5 минут
setInterval(saveData, 5 * 60 * 1000);

// ==============================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ==============================================
function generateId() {
    return crypto.randomBytes(8).toString('hex');
}

function generateInviteLink() {
    return crypto.randomBytes(16).toString('hex');
}

function isPremium(username) {
    return premiumUsers[username] && premiumUsers[username].active === true;
}

function getChatKey(user1, user2) {
    return [user1, user2].sort().join('_');
}

// ==============================================
// WEB-SOCKET ОБРАБОТЧИК
// ==============================================
wss.on('connection', (ws) => {
    console.log('🔌 Новое WebSocket подключение');
    
    // Отправляем подтверждение
    ws.send(JSON.stringify({
        type: 'connection_established',
        timestamp: Date.now(),
        message: 'Подключено к серверу Nanogram'
    }));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString('utf8'));
            
            // Обработка ping
            if (data.type === 'ping') {
                ws.send(JSON.stringify({
                    type: 'pong',
                    timestamp: Date.now(),
                    latency: Date.now() - data.timestamp
                }));
                return;
            }

            console.log(`📩 Получен тип: ${data.type} от ${data.username || 'unknown'}`);

            // ===== РЕГИСТРАЦИЯ / ВХОД =====
            if (data.type === 'register') {
                const { username, password } = data;
                
                if (!username || !password) {
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Имя и пароль обязательны'
                    }));
                    return;
                }
                
                // Проверяем существующего пользователя
                if (userDatabase[username]) {
                    // Вход существующего пользователя
                    if (userDatabase[username].password !== password) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'Неверный пароль'
                        }));
                        return;
                    }
                    
                    console.log(`👋 Вход: ${username}`);
                    
                    // Обновляем lastSeen
                    userDatabase[username].lastSeen = new Date().toISOString();
                    
                    ws.send(JSON.stringify({
                        type: 'login_success',
                        username: username,
                        profile: userProfiles[username] || { 
                            avatar: '👤', 
                            bio: '', 
                            status: 'online' 
                        },
                        settings: userSettings[username] || {},
                        premium: isPremium(username),
                        timestamp: Date.now()
                    }));
                    
                } else {
                    // Регистрация нового пользователя
                    console.log(`👤 Новый пользователь: ${username}`);
                    
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
                    
                    ws.send(JSON.stringify({
                        type: 'register_success',
                        username: username,
                        profile: userProfiles[username],
                        settings: userSettings[username],
                        premium: false,
                        timestamp: Date.now()
                    }));
                }
                
                // Сохраняем пользователя в активных
                users.set(ws, { username });
                
                // Отправляем историю сообщений
                ws.send(JSON.stringify({
                    type: 'history',
                    history: messages,
                    timestamp: Date.now()
                }));
                
                // Отправляем список каналов
                ws.send(JSON.stringify({
                    type: 'channels_list',
                    channels: Object.values(channels),
                    timestamp: Date.now()
                }));
                
                // Отправляем список комнат пользователя
                const userRooms = Object.values(privateRooms).filter(
                    r => r.members && r.members.includes(username)
                );
                ws.send(JSON.stringify({
                    type: 'rooms_list',
                    rooms: userRooms,
                    timestamp: Date.now()
                }));
                
                // Сохраняем данные
                saveData();
                
                // Оповещаем всех о новом пользователе
                broadcastUserList();
            }
            
            // ===== ОБНОВЛЕНИЕ ПРОФИЛЯ =====
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
            
            // ===== ИНДИКАТОР ПЕЧАТИ =====
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
            
            // ===== ОТПРАВКА СООБЩЕНИЯ =====
            if (data.type === 'message') {
                const { from, to, text, time } = data;
                
                if (!from || !to || !text) {
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Неполные данные сообщения'
                    }));
                    return;
                }
                
                const chatKey = getChatKey(from, to);
                
                if (!messages[chatKey]) {
                    messages[chatKey] = [];
                }
                
                // Шифруем сообщение
                const encrypted = encryptMessage(text);
                
                const messageObj = {
                    id: generateId(),
                    from: from,
                    to: to,
                    text: encrypted,
                    time: time,
                    timestamp: Date.now()
                };
                
                messages[chatKey].push(messageObj);
                
                // Ограничиваем историю до 100 сообщений
                if (messages[chatKey].length > 100) {
                    messages[chatKey] = messages[chatKey].slice(-100);
                }
                
                saveData();
                
                // Отправляем сообщение получателю
                let delivered = false;
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
                        delivered = true;
                    }
                });
                
                // Подтверждение отправителю
                ws.send(JSON.stringify({
                    type: 'message_delivered',
                    messageId: messageObj.id,
                    to: to,
                    time: time,
                    delivered: delivered,
                    timestamp: Date.now()
                }));
            }
                        // ===== СООБЩЕНИЕ В КОМНАТЕ =====
            if (data.type === 'room_message') {
                const { roomId, from, text, time } = data;
                
                if (!privateRooms[roomId] || !privateRooms[roomId].members.includes(from)) {
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Нет доступа к комнате'
                    }));
                    return;
                }
                
                if (!privateRooms[roomId].messages) {
                    privateRooms[roomId].messages = [];
                }
                
                const encrypted = encryptMessage(text);
                const messageObj = {
                    id: generateId(),
                    from: from,
                    text: encrypted,
                    time: time,
                    timestamp: Date.now()
                };
                
                privateRooms[roomId].messages.push(messageObj);
                saveData();
                
                // Рассылаем всем участникам комнаты
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
            
            // ===== СОЗДАНИЕ КАНАЛА =====
            if (data.type === 'create_channel') {
                const { name, description, creator } = data;
                
                if (!name || !creator) {
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Название и создатель обязательны'
                    }));
                    return;
                }
                
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
            
            // ===== СОЗДАНИЕ ПРИВАТНОЙ КОМНАТЫ =====
            if (data.type === 'create_private_room') {
                const { name, creator } = data;
                
                if (!name || !creator) {
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Название и создатель обязательны'
                    }));
                    return;
                }
                
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
                } else {
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Комната не найдена или вы уже в ней'
                    }));
                }
            }
            
        } catch (e) {
            console.error('❌ Ошибка обработки сообщения:', e);
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Внутренняя ошибка сервера'
            }));
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

    ws.on('error', (error) => {
        console.error('❌ Ошибка WebSocket:', error);
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
// СОЗДАНИЕ ПАПКИ ДЛЯ БЭКАПОВ
// ==============================================
if (!fs.existsSync('./backups')) {
    fs.mkdirSync('./backups');
    console.log('📁 Создана папка для бэкапов');
}

// Бэкап каждый час
setInterval(() => {
    try {
        if (fs.existsSync('./data.json')) {
            const backupPath = `./backups/data_${Date.now()}.json`;
            fs.copyFileSync('./data.json', backupPath);
            console.log(`💾 Бэкап создан: ${backupPath}`);
            
            // Удаляем старые бэкапы (оставляем 10 последних)
            const backups = fs.readdirSync('./backups')
                .filter(f => f.startsWith('data_'))
                .map(f => ({ 
                    name: f, 
                    time: fs.statSync(`./backups/${f}`).mtime 
                }))
                .sort((a, b) => b.time - a.time);
            
            if (backups.length > 10) {
                backups.slice(10).forEach(b => {
                    fs.unlinkSync(`./backups/${b.name}`);
                    console.log(`🗑️ Удалён старый бэкап: ${b.name}`);
                });
            }
        }
    } catch (e) {
        console.error('❌ Ошибка создания бэкапа:', e);
    }
}, 60 * 60 * 1000);

// ==============================================
// ЗАПУСК СЕРВЕРА
// ==============================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log('\n' + '='.repeat(60));
    console.log('🚀 Nanogram v0.7.5 - ПОЛНОСТЬЮ ИСПРАВЛЕН');
    console.log('='.repeat(60));
    console.log(`📡 Порт: ${PORT}`);
    console.log(`🔐 Теневая панель: только IP 89.109.50.194`);
    console.log(`📁 Данные: ${Object.keys(userDatabase).length} пользователей`);
    console.log(`💬 Сообщений: ${Object.values(messages).reduce((a, c) => a + c.length, 0)}`);
    console.log(`\n📱 Локальный доступ: http://localhost:${PORT}`);
    console.log(`🌍 Внешний доступ: https://minegram.onrender.com`);
    console.log(`🕵️ Теневая панель: https://minegram.onrender.com/🧪admin`);
    console.log('='.repeat(60) + '\n');
});

// ==============================================
// ОБРАБОТКА ЗАВЕРШЕНИЯ
// ==============================================
process.on('SIGINT', () => {
    console.log('\n📦 Завершение работы...');
    saveData();
    process.exit();
});

process.on('SIGTERM', () => {
    console.log('\n📦 Завершение работы...');
    saveData();
    process.exit();
});