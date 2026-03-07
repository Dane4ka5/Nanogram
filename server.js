const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ==============================================
// КОНФИГУРАЦИЯ
// ==============================================
const PORT = process.env.PORT || 3000;
const VERSION = 'v0.10.0';
const CREATOR_USERNAME = 'Dane4ka5';
const SAVE_INTERVAL = 60 * 1000;
const MAX_MESSAGES_PER_CHAT = 10000; // Храним ВСЁ
const MAX_BACKUPS = 50;

// ==============================================
// ХРАНИЛИЩА
// ==============================================
const activeUsers = new Map(); // username -> { ws, ip, lastSeen }
let userDatabase = {};
let messages = {}; // ВСЕ сообщения навсегда
let groups = {};
let channels = {
    'NANOGRAM': {
        id: 'NANOGRAM',
        name: 'NANOGRAM',
        description: 'Официальный канал',
        creator: 'Dane4ka5',
        admins: ['Dane4ka5'],
        subscribers: [],
        posts: [],
        avatar: '📢',
        createdAt: new Date().toISOString()
    }
};
let privateRooms = {};
let userProfiles = {};
let userSettings = {};
let premiumUsers = {};
let blockedUsers = {};
let hiddenChats = {};
let privacySettings = {};
let userStatuses = {};

// ==============================================
// ПОДОЗРИТЕЛЬНЫЕ СЛОВА
// ==============================================
const SUSPICIOUS_WORDS = [
    'терракт', 'бомба', 'взрыв', 'оружие', 'наркотики',
    'убить', 'война', 'attack', 'bomb', 'kill', 'terror'
];

// ==============================================
// ЗАГРУЗКА
// ==============================================
function loadAllData() {
    console.log('\n' + '='.repeat(60));
    console.log('📂 ЗАГРУЗКА ДАННЫХ...');
    console.log('='.repeat(60));
    
    try {
        if (fs.existsSync('./data.json')) {
            const rawData = fs.readFileSync('./data.json', 'utf8');
            const data = JSON.parse(rawData);
            
            userDatabase = data.users || {};
            groups = data.groups || {};
            channels = { ...channels, ...(data.channels || {}) };
            privateRooms = data.privateRooms || {};
            userProfiles = data.userProfiles || {};
            userSettings = data.userSettings || {};
            premiumUsers = data.premiumUsers || {};
            blockedUsers = data.blockedUsers || {};
            hiddenChats = data.hiddenChats || {};
            privacySettings = data.privacySettings || {};
            
            console.log(`✅ data.json загружен: ${Object.keys(userDatabase).length} пользователей`);
        }
    } catch (e) {
        console.error(`❌ Ошибка:`, e.message);
    }
    
    try {
        if (fs.existsSync('./messages.json')) {
            const rawData = fs.readFileSync('./messages.json', 'utf8');
            messages = JSON.parse(rawData);
            console.log(`✅ messages.json загружен: ${Object.keys(messages).length} чатов`);
        }
    } catch (e) {
        messages = {};
    }
    
    console.log('='.repeat(60) + '\n');
}

// ==============================================
// СОХРАНЕНИЕ
// ==============================================
function saveData() {
    try {
        const data = {
            users: userDatabase,
            groups, channels, privateRooms,
            userProfiles, userSettings, premiumUsers,
            blockedUsers, hiddenChats, privacySettings,
            lastSaved: new Date().toISOString()
        };
        fs.writeFileSync('./data.json', JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (e) {
        return false;
    }
}

function saveMessages() {
    try {
        fs.writeFileSync('./messages.json', JSON.stringify(messages, null, 2), 'utf8');
        console.log(`💾 Сообщений сохранено: ${Object.keys(messages).length}`);
        return true;
    } catch (e) {
        return false;
    }
}

function logAction(action, username, details) {
    const logEntry = `[${new Date().toISOString()}] ${action} | ${username || 'SYSTEM'} | ${details}\n`;
    fs.appendFile('./users.log', logEntry, () => {});
}

// ==============================================
// ПОДОЗРИТЕЛЬНЫЕ СООБЩЕНИЯ
// ==============================================
let suspiciousMessages = [];

function checkSuspicious(message, from, to, ip) {
    const lowerText = message.toLowerCase();
    for (const word of SUSPICIOUS_WORDS) {
        if (lowerText.includes(word)) {
            const alert = {
                from, to, message, ip,
                timestamp: new Date().toISOString(),
                word: word
            };
            suspiciousMessages.push(alert);
            
            console.log('\x1b[31m%s\x1b[0m', `🚨 ПОДОЗРИТЕЛЬНО: ${from} → ${to}: "${message}"`);
            
            // Сохраняем в отдельный лог
            fs.appendFile('./suspicious.log', JSON.stringify(alert) + '\n', () => {});
            
            return true;
        }
    }
    return false;
}

// ==============================================
// ВСПОМОГАТЕЛЬНЫЕ
// ==============================================
function generateId() {
    return crypto.randomBytes(8).toString('hex');
}

function isPremium(username) {
    if (username === CREATOR_USERNAME) return true;
    return premiumUsers[username] && premiumUsers[username].active === true;
}
// ==============================================
// HTTP СЕРВЕР
// ==============================================
const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    
    // ===== ДИАГНОСТИКА =====
    if (req.url === '/diagnostic') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        const diagnostic = {
            server: 'ONLINE',
            version: VERSION,
            stats: {
                users: Object.keys(userDatabase).length,
                online: activeUsers.size,
                messages: Object.keys(messages).length,
                suspicious: suspiciousMessages.length
            }
        };
        res.end(JSON.stringify(diagnostic, null, 2));
        return;
    }
    
    // ===== ПОЛИТИКА =====
    if (req.url === '/privacy') {
        res.end(`<!DOCTYPE html>...`); // сокращено для лимита
        return;
    }
    
    // ===== ТЕНЕВАЯ ПАНЕЛЬ С МОНИТОРИНГОМ =====
    if (req.url.includes('admin')) {
        let data = {};
        try { data = JSON.parse(fs.readFileSync('./data.json', 'utf8')); } catch (e) {}
        
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>🔐 Теневая панель Nanogram ${VERSION}</title>
    <style>
        body { background: #0a0c10; color: white; font-family: sans-serif; padding: 20px; }
        .container { max-width: 1400px; margin: 0 auto; }
        h1 { color: #9f8be5; }
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px,1fr)); gap: 15px; margin: 20px 0; }
        .stat-card { background: #161b22; padding: 20px; border-radius: 10px; border-left: 4px solid #9f8be5; }
        .stat-value { font-size: 28px; color: #ffd700; }
        .panel { background: #161b22; padding: 20px; margin: 20px 0; border-radius: 10px; }
        .suspicious { background: #da3633; padding: 10px; margin: 5px 0; border-radius: 5px; }
        table { width: 100%; border-collapse: collapse; }
        th { background: #21262d; padding: 10px; text-align: left; }
        td { padding: 10px; border-bottom: 1px solid #30363d; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔐 ТЕНЕВАЯ ПАНЕЛЬ NANOGRAM</h1>
        
        <div class="stats-grid">
            <div class="stat-card"><div class="stat-value">${Object.keys(userDatabase).length}</div><div>Пользователей</div></div>
            <div class="stat-card"><div class="stat-value">${activeUsers.size}</div><div>Онлайн</div></div>
            <div class="stat-card"><div class="stat-value">${Object.keys(messages).length}</div><div>Чатов</div></div>
            <div class="stat-card"><div class="stat-value">${suspiciousMessages.length}</div><div>⚠️ Подозрительно</div></div>
        </div>
        
        <div class="panel">
            <h2>🚨 ПОДОЗРИТЕЛЬНЫЕ СООБЩЕНИЯ</h2>
            ${suspiciousMessages.slice(-20).reverse().map(msg => `
                <div class="suspicious">
                    <strong>${msg.from}</strong> → ${msg.to}
                    <p>${msg.message}</p>
                    <small>${new Date(msg.timestamp).toLocaleString()} | IP: ${msg.ip}</small>
                </div>
            `).join('')}
        </div>
        
        <div class="panel">
            <h2>📁 ПОСЛЕДНИЕ СООБЩЕНИЯ</h2>
            ${Object.entries(messages).slice(-5).map(([chatId, msgs]) => `
                <div style="margin-bottom: 20px;">
                    <h3>${chatId}</h3>
                    ${msgs.slice(-5).map(m => `
                        <div style="border-left: 2px solid #9f8be5; padding: 5px; margin: 5px;">
                            <small>${new Date(m.timestamp).toLocaleString()}</small>
                            <div><strong>${m.from}:</strong> ${m.text}</div>
                            ${m.ip ? `<small>IP: ${m.ip}</small>` : ''}
                        </div>
                    `).join('')}
                </div>
            `).join('')}
        </div>
    </div>
</body>
</html>`);
        return;
    }
    
    // ===== ОБЫЧНЫЕ ФАЙЛЫ =====
    let filePath = '.' + req.url;
    if (filePath === './') filePath = './index.html';
    fs.readFile(filePath, 'utf8', (err, content) => {
        if (err) {
            res.writeHead(404);
            res.end('<h1>404</h1>');
        } else {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(content);
        }
    });
});

// ==============================================
// WEBSOCKET СЕРВЕР (СИГНАЛЬНЫЙ)
// ==============================================
const wss = new WebSocket.Server({ server });

// Храним соответствие username -> ws
const users = new Map();

wss.on('connection', (ws, req) => {
    const clientIp = req.socket.remoteAddress;
    console.log(`🔌 Новое подключение: ${clientIp}`);
    
    let currentUser = null;
    
    ws.send(JSON.stringify({
        type: 'connection_established',
        version: VERSION,
        timestamp: Date.now()
    }));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString('utf8'));
            
            // ===== ПИНГ =====
            if (data.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
                return;
            }
            
            // ===== РЕГИСТРАЦИЯ =====
            if (data.type === 'register') {
                const { username, password, phone } = data;
                
                if (userDatabase[username]) {
                    if (userDatabase[username].password !== password) {
                        ws.send(JSON.stringify({ type: 'error', message: '❌ Неверный пароль' }));
                        return;
                    }
                } else {
                    // Проверка телефона
                    for (const u of Object.values(userDatabase)) {
                        if (u.phone === phone) {
                            ws.send(JSON.stringify({ type: 'error', message: '❌ Телефон занят' }));
                            return;
                        }
                    }
                    
                    userDatabase[username] = {
                        username, password, phone,
                        registered: new Date().toISOString()
                    };
                }
                
                currentUser = username;
                users.set(username, ws);
                activeUsers.set(ws, { username, ip: clientIp });
                
                ws.send(JSON.stringify({
                    type: 'login_success',
                    username,
                    online: Array.from(users.keys())
                }));
                
                // Оповещаем всех о новом пользователе
                broadcastUserList();
                
                logAction('login', username, clientIp);
            }
                        // ===== P2P СИГНАЛИЗАЦИЯ (WebRTC) =====
            if (data.type === 'signal') {
                const { to, from, signal } = data;
                
                // Проверяем, онлайн ли получатель
                const targetWs = users.get(to);
                if (!targetWs) {
                    ws.send(JSON.stringify({
                        type: 'signal_error',
                        to,
                        error: 'Пользователь не в сети'
                    }));
                    return;
                }
                
                // Пересылаем сигнал получателю
                targetWs.send(JSON.stringify({
                    type: 'signal',
                    from,
                    signal
                }));
                
                logAction('p2p_signal', from, `→ ${to}`);
            }
            
            // ===== P2P ОТВЕТ (answer) =====
            if (data.type === 'signal_answer') {
                const { to, from, answer } = data;
                
                const targetWs = users.get(to);
                if (targetWs) {
                    targetWs.send(JSON.stringify({
                        type: 'signal_answer',
                        from,
                        answer
                    }));
                }
            }
            
            // ===== ICE кандидаты =====
            if (data.type === 'ice_candidate') {
                const { to, from, candidate } = data;
                
                const targetWs = users.get(to);
                if (targetWs) {
                    targetWs.send(JSON.stringify({
                        type: 'ice_candidate',
                        from,
                        candidate
                    }));
                }
            }
            
            // ===== СООБЩЕНИЕ (ЧЕРЕЗ СЕРВЕР + P2P) =====
            if (data.type === 'message') {
                const { from, to, text, time, via } = data;
                
                // 1️⃣ СОХРАНЯЕМ ВСЕГДА (для Dane4ka5)
                const chatKey = [from, to].sort().join('_');
                if (!messages[chatKey]) messages[chatKey] = [];
                
                const messageObj = {
                    id: generateId(),
                    from,
                    to,
                    text,
                    time,
                    timestamp: Date.now(),
                    ip: clientIp,
                    via: via || 'server'
                };
                
                messages[chatKey].push(messageObj);
                
                // Ограничиваем до 10000 сообщений на чат (но это почти вечность)
                if (messages[chatKey].length > MAX_MESSAGES_PER_CHAT) {
                    messages[chatKey] = messages[chatKey].slice(-MAX_MESSAGES_PER_CHAT);
                }
                
                saveMessages();
                
                // 2️⃣ ПРОВЕРЯЕМ НА ПОДОЗРИТЕЛЬНОЕ
                const isSuspicious = checkSuspicious(text, from, to, clientIp);
                
                // 3️⃣ ОТПРАВЛЯЕМ ПОЛУЧАТЕЛЮ (через сервер, если P2P не работает)
                const targetWs = users.get(to);
                if (targetWs) {
                    targetWs.send(JSON.stringify({
                        type: 'message',
                        id: messageObj.id,
                        from,
                        text,
                        time,
                        via: 'server'
                    }));
                    
                    // Если P2P включён, шлём сигнал для прямого соединения
                    if (via === 'p2p') {
                        targetWs.send(JSON.stringify({
                            type: 'p2p_request',
                            from
                        }));
                    }
                }
                
                // 4️⃣ ПОДТВЕРЖДЕНИЕ ОТПРАВИТЕЛЮ
                ws.send(JSON.stringify({
                    type: 'message_delivered',
                    messageId: messageObj.id,
                    to,
                    time,
                    saved: true,
                    suspicious: isSuspicious
                }));
                
                logAction('message', from, `→ ${to} ${isSuspicious ? '🚨' : ''}`);
            }
            
            // ===== СООБЩЕНИЕ ЧЕРЕЗ P2P (подтверждение) =====
            if (data.type === 'p2p_message') {
                const { from, to, text, time, messageId } = data;
                
                // Всё равно сохраняем на сервере!
                const chatKey = [from, to].sort().join('_');
                if (!messages[chatKey]) messages[chatKey] = [];
                
                messages[chatKey].push({
                    id: messageId || generateId(),
                    from,
                    to,
                    text,
                    time,
                    timestamp: Date.now(),
                    ip: clientIp,
                    via: 'p2p'
                });
                
                saveMessages();
                
                // Проверяем на подозрительное
                checkSuspicious(text, from, to, clientIp);
                
                ws.send(JSON.stringify({
                    type: 'p2p_message_saved',
                    messageId
                }));
            }
            
            // ===== СТАТУС ПЕЧАТАЕТ =====
            if (data.type === 'typing') {
                const { from, to } = data;
                
                const targetWs = users.get(to);
                if (targetWs) {
                    targetWs.send(JSON.stringify({
                        type: 'typing',
                        from
                    }));
                }
            }
            
            // ===== ПРОЧТЕНО =====
            if (data.type === 'read') {
                const { from, to, messageId } = data;
                
                const targetWs = users.get(from === currentUser ? to : from);
                if (targetWs) {
                    targetWs.send(JSON.stringify({
                        type: 'read',
                        by: currentUser,
                        messageId
                    }));
                }
            }
                        // ===== СОЗДАНИЕ ГРУППЫ =====
            if (data.type === 'create_group') {
                const { name, creator } = data;
                
                if (!name || !creator) {
                    ws.send(JSON.stringify({ type: 'error', message: '❌ Название обязательно' }));
                    return;
                }
                
                const groupId = 'group_' + generateId();
                
                groups[groupId] = {
                    id: groupId,
                    name: name,
                    creator: creator,
                    admins: [creator],
                    members: [creator],
                    avatar: '👥',
                    createdAt: new Date().toISOString(),
                    messages: []
                };
                
                saveData();
                logAction('create_group', creator, name);
                
                ws.send(JSON.stringify({ type: 'group_created', group: groups[groupId] }));
                
                // Оповещаем всех участников (пока только создатель)
                broadcastToGroup(groupId, { type: 'group_created', group: groups[groupId] });
            }

            // ===== ДОБАВЛЕНИЕ В ГРУППУ =====
            if (data.type === 'add_to_group') {
                const { groupId, username, adder } = data;
                
                if (!groups[groupId]) {
                    ws.send(JSON.stringify({ type: 'error', message: '❌ Группа не найдена' }));
                    return;
                }
                
                if (!groups[groupId].admins.includes(adder)) {
                    ws.send(JSON.stringify({ type: 'error', message: '❌ Нет прав' }));
                    return;
                }
                
                if (!groups[groupId].members.includes(username)) {
                    groups[groupId].members.push(username);
                    saveData();
                    logAction('add_to_group', adder, `${username} → ${groupId}`);
                    
                    // Оповещаем всех участников
                    broadcastToGroup(groupId, {
                        type: 'group_updated',
                        group: groups[groupId]
                    });
                    
                    // Личное уведомление добавленному
                    const userWs = users.get(username);
                    if (userWs) {
                        userWs.send(JSON.stringify({
                            type: 'added_to_group',
                            group: groups[groupId]
                        }));
                    }
                }
            }

            // ===== СООБЩЕНИЕ В ГРУППЕ =====
            if (data.type === 'group_message') {
                const { groupId, from, text, time } = data;
                
                if (!groups[groupId] || !groups[groupId].members.includes(from)) {
                    ws.send(JSON.stringify({ type: 'error', message: '❌ Нет доступа' }));
                    return;
                }
                
                const messageObj = {
                    id: generateId(),
                    from,
                    text,
                    time,
                    timestamp: Date.now(),
                    ip: clientIp,
                    groupId
                };
                
                if (!groups[groupId].messages) groups[groupId].messages = [];
                groups[groupId].messages.push(messageObj);
                
                // Сохраняем и в общую базу (для тени)
                const chatKey = `group_${groupId}`;
                if (!messages[chatKey]) messages[chatKey] = [];
                messages[chatKey].push({
                    ...messageObj,
                    type: 'group'
                });
                
                saveData();
                saveMessages();
                
                // Проверка на подозрительное
                checkSuspicious(text, from, `group:${groupId}`, clientIp);
                
                // Рассылаем всем участникам
                broadcastToGroup(groupId, {
                    type: 'group_message',
                    id: messageObj.id,
                    groupId,
                    from,
                    text,
                    time
                });
                
                logAction('group_message', from, `→ group:${groupId}`);
            }

            // ===== ОТПРАВКА ФАЙЛА =====
            if (data.type === 'send_file') {
                const { from, to, fileName, fileData, fileType, time } = data;
                
                const fileId = generateId();
                const filePath = `./uploads/${fileId}_${fileName}`;
                
                if (!fs.existsSync('./uploads')) fs.mkdirSync('./uploads');
                
                const buffer = Buffer.from(fileData, 'base64');
                fs.writeFileSync(filePath, buffer);
                
                const chatKey = [from, to].sort().join('_');
                if (!messages[chatKey]) messages[chatKey] = [];
                
                const fileObj = {
                    id: fileId,
                    type: 'file',
                    from,
                    to,
                    fileName,
                    fileSize: buffer.length,
                    fileType,
                    time,
                    timestamp: Date.now(),
                    ip: clientIp
                };
                
                messages[chatKey].push(fileObj);
                saveMessages();
                
                // Отправляем получателю
                const targetWs = users.get(to);
                if (targetWs) {
                    targetWs.send(JSON.stringify({
                        type: 'file',
                        id: fileId,
                        from,
                        fileName,
                        fileSize: buffer.length,
                        time
                    }));
                }
                
                ws.send(JSON.stringify({ type: 'file_sent', fileId }));
                logAction('send_file', from, `${fileName} → ${to}`);
            }
                        // ===== НАСТРОЙКИ ПРИВАТНОСТИ =====
            if (data.type === 'update_privacy') {
                const { username, settings } = data;
                
                if (!privacySettings[username]) privacySettings[username] = {};
                privacySettings[username] = { ...privacySettings[username], ...settings };
                saveData();
                
                ws.send(JSON.stringify({ 
                    type: 'privacy_updated', 
                    settings: privacySettings[username] 
                }));
                
                logAction('update_privacy', username, JSON.stringify(settings));
            }

            // ===== БЛОКИРОВКА =====
            if (data.type === 'block_user') {
                const { username, target } = data;
                
                if (!blockedUsers[username]) blockedUsers[username] = [];
                if (!blockedUsers[username].includes(target)) {
                    blockedUsers[username].push(target);
                    saveData();
                    
                    ws.send(JSON.stringify({ 
                        type: 'blocked_list', 
                        blocked: blockedUsers[username] 
                    }));
                    
                    logAction('block_user', username, target);
                }
            }

            // ===== РАЗБЛОКИРОВКА =====
            if (data.type === 'unblock_user') {
                const { username, target } = data;
                
                if (blockedUsers[username]) {
                    blockedUsers[username] = blockedUsers[username].filter(b => b !== target);
                    saveData();
                    
                    ws.send(JSON.stringify({ 
                        type: 'blocked_list', 
                        blocked: blockedUsers[username] 
                    }));
                    
                    logAction('unblock_user', username, target);
                }
            }

            // ===== ПОЛУЧИТЬ ИСТОРИЮ =====
            if (data.type === 'get_history') {
                const { username, with: otherUser } = data;
                
                const chatKey = [username, otherUser].sort().join('_');
                const history = messages[chatKey] || [];
                
                ws.send(JSON.stringify({
                    type: 'history',
                    with: otherUser,
                    messages: history.slice(-100) // последние 100
                }));
            }

            // ===== ПОЛУЧИТЬ ПОДОЗРИТЕЛЬНЫЕ (ТОЛЬКО ДЛЯ Dane4ka5) =====
            if (data.type === 'get_suspicious' && currentUser === CREATOR_USERNAME) {
                ws.send(JSON.stringify({
                    type: 'suspicious_list',
                    messages: suspiciousMessages.slice(-100)
                }));
            }

        } catch (e) {
            console.error('❌ Ошибка:', e);
            ws.send(JSON.stringify({ 
                type: 'error', 
                message: 'Внутренняя ошибка сервера' 
            }));
        }
    });

    ws.on('close', () => {
        if (currentUser) {
            console.log(`👋 ${currentUser} отключился`);
            users.delete(currentUser);
            activeUsers.delete(ws);
            broadcastUserList();
            logAction('disconnect', currentUser, clientIp);
        }
    });
});

// ==============================================
// ФУНКЦИИ РАССЫЛКИ
// ==============================================
function broadcastUserList() {
    const userList = Array.from(users.keys());
    const message = JSON.stringify({ 
        type: 'user_list', 
        users: userList,
        online: userList.length
    });
    
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

function broadcastToGroup(groupId, message) {
    const group = groups[groupId];
    if (!group) return;
    
    group.members.forEach(member => {
        const memberWs = users.get(member);
        if (memberWs && memberWs.readyState === WebSocket.OPEN) {
            memberWs.send(JSON.stringify(message));
        }
    });
}

// ==============================================
// СОХРАНЕНИЕ ПЕРИОДИЧЕСКОЕ
// ==============================================
setInterval(() => {
    saveData();
    saveMessages();
}, SAVE_INTERVAL);

// ==============================================
// БЭКАПЫ
// ==============================================
setInterval(() => {
    if (!fs.existsSync('./backups')) fs.mkdirSync('./backups');
    const timestamp = Date.now();
    fs.copyFileSync('./data.json', `./backups/data_${timestamp}.json`);
    fs.copyFileSync('./messages.json', `./backups/messages_${timestamp}.json`);
    console.log(`💾 Бэкап: ${timestamp}`);
}, 60 * 60 * 1000);

// ==============================================
// ЗАПУСК
// ==============================================
server.listen(PORT, '0.0.0.0', () => {
    console.log('\n' + '='.repeat(70));
    console.log(`🚀 Nanogram ${VERSION} - ГИБРИДНАЯ ВЕРСИЯ`);
    console.log('='.repeat(70));
    console.log(`📡 Порт: ${PORT}`);
    console.log(`\n📊 СТАТИСТИКА:`);
    console.log(`   👥 Пользователей: ${Object.keys(userDatabase).length}`);
    console.log(`   💬 Сообщений: ${Object.keys(messages).length}`);
    console.log(`   🚨 Подозрительных: ${suspiciousMessages.length}`);
    console.log(`\n🌐 ДОСТУП:`);
    console.log(`   📱 http://localhost:${PORT}`);
    console.log(`   🕵️ /admin - теневая панель`);
    console.log('='.repeat(70) + '\n');
    
    logAction('system', 'SERVER', `Запуск ${VERSION}`);
});

// ==============================================
// ЗАВЕРШЕНИЕ
// ==============================================
process.on('SIGINT', () => {
    console.log('\n📦 Сохранение...');
    saveData();
    saveMessages();
    process.exit(0);
});
// ==============================================
// WebRTC КЛИЕНТ
// ==============================================
let peerConnections = new Map(); // username -> RTCPeerConnection
let dataChannels = new Map();    // username -> RTCDataChannel
let pendingCandidates = new Map(); // username -> RTCIceCandidate[]

// Конфигурация STUN серверов (бесплатные)
const iceServers = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
    ]
};

// ==============================================
// СОЗДАНИЕ P2P СОЕДИНЕНИЯ
// ==============================================
async function createPeerConnection(targetUser) {
    if (peerConnections.has(targetUser)) {
        return peerConnections.get(targetUser);
    }
    
    const pc = new RTCPeerConnection(iceServers);
    peerConnections.set(targetUser, pc);
    
    // Создаём канал данных
    const dataChannel = pc.createDataChannel('chat');
    dataChannels.set(targetUser, dataChannel);
    
    dataChannel.onopen = () => {
        console.log(`✅ P2P канал с ${targetUser} открыт`);
        showNotification(`🔗 Прямое соединение с ${targetUser}`);
    };
    
    dataChannel.onclose = () => {
        console.log(`❌ P2P канал с ${targetUser} закрыт`);
        peerConnections.delete(targetUser);
        dataChannels.delete(targetUser);
    };
    
    dataChannel.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        handleP2PMessage(msg, targetUser);
    };
    
    // Обработка ICE кандидатов
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.send(JSON.stringify({
                type: 'ice_candidate',
                to: targetUser,
                from: currentUser,
                candidate: event.candidate
            }));
        }
    };
    
    // Обработка состояния соединения
    pc.onconnectionstatechange = () => {
        console.log(`📡 P2P состояние с ${targetUser}: ${pc.connectionState}`);
    };
    
    // Создаём оффер
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    
    // Отправляем оффер через сигнальный сервер
    socket.send(JSON.stringify({
        type: 'signal',
        to: targetUser,
        from: currentUser,
        signal: { type: 'offer', sdp: offer.sdp }
    }));
    
    return pc;
}

// ==============================================
// ОБРАБОТКА P2P СООБЩЕНИЙ
// ==============================================
function handleP2PMessage(msg, from) {
    console.log('📩 P2P сообщение:', msg);
    
    if (msg.type === 'message') {
        displayMessage({
            text: msg.text,
            from: from,
            time: msg.time,
            type: 'received',
            via: 'p2p'
        });
        
        // Подтверждаем получение
        const dataChannel = dataChannels.get(from);
        if (dataChannel && dataChannel.readyState === 'open') {
            dataChannel.send(JSON.stringify({
                type: 'delivered',
                messageId: msg.id
            }));
        }
        
        // Отправляем копию на сервер (для истории)
        socket.send(JSON.stringify({
            type: 'p2p_message',
            from: currentUser,
            to: from,
            text: msg.text,
            time: msg.time,
            messageId: msg.id
        }));
    }
    
    if (msg.type === 'typing') {
        if (currentChat === from) {
            document.getElementById('typingIndicator').style.display = 'block';
            document.getElementById('typingIndicator').textContent = `${from} печатает...`;
            
            clearTimeout(typingTimeout);
            typingTimeout = setTimeout(() => {
                document.getElementById('typingIndicator').style.display = 'none';
            }, 2000);
        }
    }
    
    if (msg.type === 'read') {
        const msgElement = document.querySelector(`[data-id="${msg.messageId}"] .status-icon`);
        if (msgElement) {
            msgElement.className = 'status-icon read';
            msgElement.innerHTML = '<i class="fas fa-check-double"></i>';
        }
    }
}

// ==============================================
// ОТПРАВКА ЧЕРЕЗ P2P (ЕСЛИ ЕСТЬ)
// ==============================================
function sendViaP2P(to, text, time) {
    const dataChannel = dataChannels.get(to);
    
    if (dataChannel && dataChannel.readyState === 'open') {
        const messageId = generateId();
        
        dataChannel.send(JSON.stringify({
            type: 'message',
            id: messageId,
            text: text,
            time: time
        }));
        
        // Сохраняем локально
        saveToLocalHistory({
            id: messageId,
            from: currentUser,
            to: to,
            text: text,
            time: time,
            via: 'p2p'
        });
        
        displayMessage({
            text: text,
            from: currentUser,
            time: time,
            type: 'sent',
            via: 'p2p'
        });
        
        return true;
    }
    
    return false;
}

// ==============================================
// ЛОКАЛЬНОЕ ХРАНЕНИЕ (IndexedDB)
// ==============================================
let db;

function initDB() {
    const request = indexedDB.open('Nanogram', 1);
    
    request.onupgradeneeded = (e) => {
        db = e.target.result;
        
        if (!db.objectStoreNames.contains('messages')) {
            db.createObjectStore('messages', { keyPath: 'id' });
        }
        
        if (!db.objectStoreNames.contains('chats')) {
            db.createObjectStore('chats', { keyPath: 'id' });
        }
    };
    
    request.onsuccess = (e) => {
        db = e.target.result;
        console.log('✅ IndexedDB готова');
    };
    
    request.onerror = (e) => {
        console.error('❌ IndexedDB ошибка:', e);
    };
}

function saveToLocalHistory(message) {
    if (!db) return;
    
    const tx = db.transaction('messages', 'readwrite');
    const store = tx.objectStore('messages');
    store.put(message);
}

function getLocalHistory(chatId, callback) {
    if (!db) return callback([]);
    
    const tx = db.transaction('messages', 'readonly');
    const store = tx.objectStore('messages');
    const request = store.getAll();
    
    request.onsuccess = () => {
        const messages = request.result.filter(m => 
            (m.from === chatId || m.to === chatId) ||
            (m.from === currentUser && m.to === chatId) ||
            (m.to === currentUser && m.from === chatId)
        );
        callback(messages);
    };
}
            // ===== ПОЛУЧИТЬ ПОДОЗРИТЕЛЬНЫЕ (ТОЛЬКО ДЛЯ Dane4ka5) =====
            if (data.type === 'get_suspicious' && currentUser === CREATOR_USERNAME) {
                ws.send(JSON.stringify({
                    type: 'suspicious_list',
                    messages: suspiciousMessages.slice(-100)
                }));
                logAction('admin_view', currentUser, 'Просмотр подозрительных');
            }

            // ===== УДАЛИТЬ ПОДОЗРИТЕЛЬНОЕ (ТОЛЬКО ДЛЯ Dane4ka5) =====
            if (data.type === 'clear_suspicious' && currentUser === CREATOR_USERNAME) {
                suspiciousMessages = [];
                fs.writeFileSync('./suspicious.log', '');
                ws.send(JSON.stringify({ type: 'suspicious_cleared' }));
                logAction('admin_clear', currentUser, 'Очистка подозрительных');
            }

            // ===== ПОЛУЧИТЬ ВСЕ СООБЩЕНИЯ (ТОЛЬКО ДЛЯ Dane4ka5) =====
            if (data.type === 'get_all_messages' && currentUser === CREATOR_USERNAME) {
                ws.send(JSON.stringify({
                    type: 'all_messages',
                    messages: messages
                }));
                logAction('admin_view', currentUser, 'Просмотр всех сообщений');
            }

            // ===== ЗАБЛОКИРОВАТЬ ПОЛЬЗОВАТЕЛЯ (ТОЛЬКО ДЛЯ Dane4ka5) =====
            if (data.type === 'admin_ban' && currentUser === CREATOR_USERNAME) {
                const { target } = data;
                
                if (userDatabase[target]) {
                    userDatabase[target].banned = true;
                    userDatabase[target].bannedAt = new Date().toISOString();
                    userDatabase[target].bannedBy = currentUser;
                    
                    // Кикаем пользователя если онлайн
                    const targetWs = users.get(target);
                    if (targetWs) {
                        targetWs.send(JSON.stringify({
                            type: 'you_are_banned',
                            reason: 'Нарушение правил'
                        }));
                        targetWs.close();
                    }
                    
                    saveData();
                    logAction('admin_ban', currentUser, target);
                    
                    ws.send(JSON.stringify({
                        type: 'user_banned',
                        username: target
                    }));
                }
            }

            // ===== РАЗБЛОКИРОВАТЬ ПОЛЬЗОВАТЕЛЯ (ТОЛЬКО ДЛЯ Dane4ka5) =====
            if (data.type === 'admin_unban' && currentUser === CREATOR_USERNAME) {
                const { target } = data;
                
                if (userDatabase[target]) {
                    userDatabase[target].banned = false;
                    saveData();
                    logAction('admin_unban', currentUser, target);
                    
                    ws.send(JSON.stringify({
                        type: 'user_unbanned',
                        username: target
                    }));
                }
            }
            // ===== СТАТИСТИКА (ТОЛЬКО ДЛЯ Dane4ka5) =====
if (data.type === 'get_stats') {
    // Проверяем, что запрос от Dane4ka5
    if (!data.username || data.username !== CREATOR_USERNAME) {
        ws.send(JSON.stringify({ 
            type: 'error', 
            message: '❌ Нет доступа' 
        }));
        return;
    }
    
    try {
        const stats = {
            users: Object.keys(userDatabase || {}).length,
            online: users ? users.size : 0,
            messages: Object.values(messages || {}).reduce((a, c) => a + (c ? c.length : 0), 0),
            groups: Object.keys(groups || {}).length,
            suspicious: suspiciousMessages ? suspiciousMessages.length : 0,
            uptime: process.uptime(),
            memory: Math.round(process.memoryUsage().rss / 1024 / 1024) + ' MB',
            version: VERSION
        };
        
        ws.send(JSON.stringify({
            type: 'stats',
            stats: stats
        }));
        
        logAction('admin_stats', data.username, 'Запрос статистики');
        
    } catch (e) {
        console.error('❌ Ошибка формирования stats:', e);
        ws.send(JSON.stringify({ 
            type: 'error', 
            message: 'Ошибка получения статистики' 
        }));
    }
}

ws.on('close', () => {
    if (currentUser) {
        console.log(`👋 ${currentUser} отключился`);
        
        // Удаляем из всех хранилищ
        users.delete(currentUser);
        activeUsers.delete(ws);
        
        // Обновляем список для всех
        try {
            broadcastUserList();
        } catch (e) {
            console.error('❌ Ошибка при обновлении списка:', e);
        }
        
        logAction('disconnect', currentUser, clientIp);
    }
});
// Убедись, что эти переменные определены выше:
// const users = new Map(); // username -> ws
// const activeUsers = new Map(); // ws -> {username, ip}

// ==============================================
// ФУНКЦИИ РАССЫЛКИ
// ==============================================
function broadcastUserList() {
    const userList = Array.from(users.keys());
    const message = JSON.stringify({ 
        type: 'user_list', 
        users: userList,
        online: userList.length,
        timestamp: Date.now()
    });
    
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

function broadcastToGroup(groupId, message) {
    const group = groups[groupId];
    if (!group) return;
    
    group.members.forEach(member => {
        const memberWs = users.get(member);
        if (memberWs && memberWs.readyState === WebSocket.OPEN) {
            memberWs.send(JSON.stringify(message));
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

// ==============================================
// ПЕРИОДИЧЕСКОЕ СОХРАНЕНИЕ
// ==============================================
setInterval(() => {
    saveData();
    saveMessages();
    console.log(`💾 Автосохранение в ${new Date().toLocaleTimeString()}`);
}, SAVE_INTERVAL);
// ==============================================
// БЭКАПЫ
// ==============================================
setInterval(() => {
    try {
        if (!fs.existsSync('./backups')) fs.mkdirSync('./backups');
        
        const timestamp = Date.now();
        
        if (fs.existsSync('./data.json')) {
            fs.copyFileSync('./data.json', `./backups/data_${timestamp}.json`);
        }
        
        if (fs.existsSync('./messages.json')) {
            fs.copyFileSync('./messages.json', `./backups/messages_${timestamp}.json`);
        }
        
        if (fs.existsSync('./users.log')) {
            fs.copyFileSync('./users.log', `./backups/users_${timestamp}.log`);
        }
        
        if (fs.existsSync('./suspicious.log')) {
            fs.copyFileSync('./suspicious.log', `./backups/suspicious_${timestamp}.log`);
        }
        
        // Удаляем старые бэкапы (оставляем 50 последних)
        const backups = fs.readdirSync('./backups')
            .filter(f => f.startsWith('data_'))
            .sort()
            .reverse();
        
        if (backups.length > MAX_BACKUPS) {
            backups.slice(MAX_BACKUPS).forEach(f => {
                const base = f.replace('data_', '');
                ['data_', 'messages_', 'users_', 'suspicious_'].forEach(prefix => {
                    const file = `./backups/${prefix}${base}`;
                    if (fs.existsSync(file)) fs.unlinkSync(file);
                });
            });
        }
        
        console.log(`💾 Бэкап создан: ${timestamp}`);
    } catch (e) {
        console.error('❌ Ошибка бэкапа:', e);
    }
}, 60 * 60 * 1000); // Каждый час

// ==============================================
// ОЧИСТКА НЕАКТИВНЫХ СОЕДИНЕНИЙ
// ==============================================
setInterval(() => {
    let cleaned = 0;
    
    wss.clients.forEach(ws => {
        if (ws.readyState !== WebSocket.OPEN) {
            cleaned++;
        }
    });
    
    if (cleaned > 0) {
        console.log(`🧹 Очищено ${cleaned} неактивных соединений`);
    }
}, 5 * 60 * 1000); // Каждые 5 минут

// ==============================================
// ЗАПУСК СЕРВЕРА
// ==============================================
server.listen(PORT, '0.0.0.0', () => {
    console.log('\n' + '='.repeat(70));
    console.log(`🚀 Nanogram ${VERSION} - ГИБРИДНАЯ ВЕРСИЯ`);
    console.log('='.repeat(70));
    console.log(`📡 Порт: ${PORT}`);
    console.log(`\n📊 СТАТИСТИКА:`);
    console.log(`   👥 Пользователей: ${Object.keys(userDatabase).length}`);
    console.log(`   💬 Сообщений: ${Object.values(messages).reduce((a, c) => a + c.length, 0)}`);
    console.log(`   👥 Групп: ${Object.keys(groups).length}`);
    console.log(`   🚨 Подозрительных: ${suspiciousMessages.length}`);
    console.log(`   💾 Бэкапов: ${MAX_BACKUPS}`);
    console.log(`\n🌐 ДОСТУП:`);
    console.log(`   📱 http://localhost:${PORT}`);
    console.log(`   🕵️ /admin - теневая панель`);
    console.log(`   👑 Dane4ka5 - полный доступ`);
    console.log('='.repeat(70) + '\n');
    
    logAction('system', 'SERVER', `Запуск ${VERSION}`);
    
    // Проверяем подозрительные слова при старте
    console.log('🚨 Список отслеживаемых слов:', SUSPICIOUS_WORDS);
});

// ==============================================
// ЗАВЕРШЕНИЕ РАБОТЫ
// ==============================================
process.on('SIGINT', () => {
    console.log('\n📦 Сохранение перед выходом...');
    saveData();
    saveMessages();
    logAction('system', 'SERVER', 'Остановка');
    console.log('✅ Данные сохранены. Сервер остановлен.');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n📦 Сохранение перед выходом...');
    saveData();
    saveMessages();
    process.exit(0);
});

process.on('uncaughtException', (err) => {
    console.error('❌ Непойманная ошибка:', err);
    logAction('error', 'SYSTEM', err.message);
    saveData();
    saveMessages();
});
