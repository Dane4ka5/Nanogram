const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ==============================================
// КОНФИГУРАЦИЯ
// ==============================================
const PORT = process.env.PORT || 3000;
const VERSION = 'v0.10.1';
const CREATOR_USERNAME = 'Dane4ka5';
const SAVE_INTERVAL = 60 * 1000;
const MAX_MESSAGES_PER_CHAT = 10000;
const MAX_BACKUPS = 50;

// ==============================================
// ХРАНИЛИЩА
// ==============================================
const users = new Map(); // username -> ws
const activeUsers = new Map(); // ws -> { username, ip, status }
let userDatabase = {}; // username -> { password, phone, registered, banned }
let messages = {}; // chatKey -> [messages]
let groups = {}; // groupId -> { name, members, messages }
let channels = {
    'NANOGRAM': {
        id: 'NANOGRAM',
        name: 'NANOGRAM',
        creator: 'Dane4ka5',
        admins: ['Dane4ka5'],
        subscribers: [],
        posts: [],
        createdAt: new Date().toISOString()
    }
};
let privateRooms = {};
let userProfiles = {};
let userSettings = {};
let premiumUsers = {};
let blockedUsers = {};
let privacySettings = {};
let suspiciousMessages = [];

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
            blockedUsers, privacySettings,
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
        return true;
    } catch (e) {
        return false;
    }
}

function logAction(action, username, details) {
    const logEntry = `[${new Date().toISOString()}] ${action} | ${username || 'SYSTEM'} | ${details}\n`;
    fs.appendFile('./users.log', logEntry, () => {});
}

function checkSuspicious(text, from, to, ip) {
    const lowerText = text.toLowerCase();
    for (const word of SUSPICIOUS_WORDS) {
        if (lowerText.includes(word)) {
            const alert = {
                from, to, message: text, ip,
                timestamp: new Date().toISOString(),
                word: word
            };
            suspiciousMessages.push(alert);
            fs.appendFile('./suspicious.log', JSON.stringify(alert) + '\n', () => {});
            console.log('\x1b[31m%s\x1b[0m', `🚨 ПОДОЗРИТЕЛЬНО: ${from} → ${to}`);
            return true;
        }
    }
    return false;
}

function generateId() {
    return crypto.randomBytes(8).toString('hex');
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
                online: users.size,
                messages: Object.keys(messages).length,
                suspicious: suspiciousMessages.length
            }
        };
        res.end(JSON.stringify(diagnostic, null, 2));
        return;
    }
    
    // ===== ПОЛИТИКА =====
    if (req.url === '/privacy') {
        res.end(`<!DOCTYPE html>...`); // сокращено
        return;
    }
    
    // ===== ТЕНЕВАЯ ПАНЕЛЬ =====
    if (req.url.includes('admin')) {
        let data = {};
        try { data = JSON.parse(fs.readFileSync('./data.json', 'utf8')); } catch (e) {}
        
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!DOCTYPE html>...`); // сокращено
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
// WEB-SOCKET СЕРВЕР
// ==============================================
const wss = new WebSocket.Server({ server });

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
                ws.send(JSON.stringify({ 
                    type: 'pong', 
                    timestamp: Date.now() 
                }));
                return;
            }
            
            // ===== РЕГИСТРАЦИЯ =====
            if (data.type === 'register') {
                const { username, password, phone } = data;
                
                // Проверка на бан
                if (userDatabase[username]?.banned) {
                    ws.send(JSON.stringify({ 
                        type: 'error', 
                        message: '❌ Вы заблокированы' 
                    }));
                    return;
                }
                
                // Существующий пользователь
                if (userDatabase[username]) {
                    if (userDatabase[username].password !== password) {
                        ws.send(JSON.stringify({ 
                            type: 'error', 
                            message: '❌ Неверный пароль' 
                        }));
                        return;
                    }
                    
                    if (userDatabase[username].phone !== phone) {
                        ws.send(JSON.stringify({ 
                            type: 'error', 
                            message: '❌ Неверный телефон' 
                        }));
                        return;
                    }
                    
                    currentUser = username;
                    users.set(username, ws);
                    activeUsers.set(ws, { username, ip: clientIp, status: 'online' });
                    
                    ws.send(JSON.stringify({
                        type: 'login_success',
                        username,
                        premium: premiumUsers[username]?.active || false,
                        privacy: privacySettings[username] || { showOnline: 'all', showPhone: 'all' }
                    }));
                    
                    logAction('login', username, clientIp);
                    
                // Новый пользователь
                } else {
                    // Проверка уникальности телефона
                    let phoneExists = false;
                    for (const u of Object.values(userDatabase)) {
                        if (u.phone === phone) {
                            phoneExists = true;
                            break;
                        }
                    }
                    
                    if (phoneExists) {
                        ws.send(JSON.stringify({ 
                            type: 'error', 
                            message: '❌ Телефон уже используется' 
                        }));
                        return;
                    }
                    
                    currentUser = username;
                    
                    userDatabase[username] = {
                        username, password, phone,
                        registered: new Date().toISOString(),
                        banned: false
                    };
                    
                    premiumUsers[username] = { active: false };
                    privacySettings[username] = { showOnline: 'all', showPhone: 'all' };
                    blockedUsers[username] = [];
                    
                    users.set(username, ws);
                    activeUsers.set(ws, { username, ip: clientIp, status: 'online' });
                    
                    saveData();
                    
                    ws.send(JSON.stringify({
                        type: 'register_success',
                        username,
                        premium: false,
                        privacy: privacySettings[username]
                    }));
                    
                    logAction('register', username, clientIp);
                }
                
                // Отправляем списки
                ws.send(JSON.stringify({ 
                    type: 'user_list', 
                    users: Array.from(users.keys())
                }));
                
                ws.send(JSON.stringify({ 
                    type: 'channels_list', 
                    channels: Object.values(channels) 
                }));
                
                ws.send(JSON.stringify({ 
                    type: 'groups_list', 
                    groups: Object.values(groups).filter(g => 
                        g.members && g.members.includes(username)
                    )
                }));
            }
            
            // ===== ОТПРАВКА СООБЩЕНИЯ =====
            if (data.type === 'message') {
                const { from, to, text, time } = data;
                
                // Проверка на бан
                if (userDatabase[from]?.banned) {
                    ws.send(JSON.stringify({ 
                        type: 'error', 
                        message: '❌ Вы заблокированы' 
                    }));
                    return;
                }
                
                // Проверка на подозрительное
                const isSuspicious = checkSuspicious(text, from, to, clientIp);
                
                // Сохраняем сообщение
                const chatKey = [from, to].sort().join('_');
                if (!messages[chatKey]) messages[chatKey] = [];
                
                const messageObj = {
                    id: generateId(),
                    from, to, text, time,
                    timestamp: Date.now(),
                    ip: clientIp,
                    suspicious: isSuspicious
                };
                
                messages[chatKey].push(messageObj);
                saveMessages();
                
                // Отправляем получателю
                const targetWs = users.get(to);
                if (targetWs) {
                    targetWs.send(JSON.stringify({
                        type: 'message',
                        id: messageObj.id,
                        from,
                        text,
                        time
                    }));
                }
                
                // Подтверждение отправителю
                ws.send(JSON.stringify({
                    type: 'message_delivered',
                    messageId: messageObj.id,
                    to
                }));
                
                logAction('message', from, `→ ${to}${isSuspicious ? ' 🚨' : ''}`);
            }
                        // ===== СТАТИСТИКА (ТОЛЬКО ДЛЯ Dane4ka5) =====
            if (data.type === 'get_stats') {
                if (data.username !== CREATOR_USERNAME) {
                    ws.send(JSON.stringify({ 
                        type: 'error', 
                        message: '❌ Только для создателя' 
                    }));
                    return;
                }
                
                const stats = {
                    users: Object.keys(userDatabase).length,
                    online: users.size,
                    messages: Object.values(messages).reduce((a, c) => a + c.length, 0),
                    groups: Object.keys(groups).length,
                    suspicious: suspiciousMessages.length,
                    uptime: process.uptime(),
                    memory: Math.round(process.memoryUsage().rss / 1024 / 1024) + ' MB',
                    version: VERSION
                };
                
                ws.send(JSON.stringify({
                    type: 'stats',
                    stats
                }));
                
                logAction('admin_stats', data.username, 'Запрос статистики');
            }
            
            // ===== ПОЛУЧИТЬ ПОДОЗРИТЕЛЬНЫЕ (ТОЛЬКО ДЛЯ Dane4ka5) =====
            if (data.type === 'get_suspicious') {
                if (data.username !== CREATOR_USERNAME) {
                    ws.send(JSON.stringify({ 
                        type: 'error', 
                        message: '❌ Только для создателя' 
                    }));
                    return;
                }
                
                ws.send(JSON.stringify({
                    type: 'suspicious_list',
                    messages: suspiciousMessages.slice(-100)
                }));
                
                logAction('admin_suspicious', data.username, 'Просмотр подозрительных');
            }
            
            // ===== ОЧИСТИТЬ ПОДОЗРИТЕЛЬНЫЕ (ТОЛЬКО ДЛЯ Dane4ka5) =====
            if (data.type === 'clear_suspicious') {
                if (data.username !== CREATOR_USERNAME) {
                    ws.send(JSON.stringify({ 
                        type: 'error', 
                        message: '❌ Только для создателя' 
                    }));
                    return;
                }
                
                suspiciousMessages = [];
                fs.writeFileSync('./suspicious.log', '');
                
                ws.send(JSON.stringify({ 
                    type: 'suspicious_cleared' 
                }));
                
                logAction('admin_clear', data.username, 'Очистка подозрительных');
            }
            
            // ===== ЗАБЛОКИРОВАТЬ ПОЛЬЗОВАТЕЛЯ (ТОЛЬКО ДЛЯ Dane4ka5) =====
            if (data.type === 'admin_ban') {
                if (data.username !== CREATOR_USERNAME) {
                    ws.send(JSON.stringify({ 
                        type: 'error', 
                        message: '❌ Только для создателя' 
                    }));
                    return;
                }
                
                const { target } = data;
                
                if (userDatabase[target]) {
                    userDatabase[target].banned = true;
                    userDatabase[target].bannedAt = new Date().toISOString();
                    
                    // Кикаем если онлайн
                    const targetWs = users.get(target);
                    if (targetWs) {
                        targetWs.send(JSON.stringify({ 
                            type: 'you_are_banned' 
                        }));
                        targetWs.close();
                        users.delete(target);
                    }
                    
                    saveData();
                    
                    ws.send(JSON.stringify({ 
                        type: 'user_banned', 
                        target 
                    }));
                    
                    logAction('admin_ban', data.username, target);
                }
            }
            
            // ===== РАЗБЛОКИРОВАТЬ ПОЛЬЗОВАТЕЛЯ (ТОЛЬКО ДЛЯ Dane4ka5) =====
            if (data.type === 'admin_unban') {
                if (data.username !== CREATOR_USERNAME) {
                    ws.send(JSON.stringify({ 
                        type: 'error', 
                        message: '❌ Только для создателя' 
                    }));
                    return;
                }
                
                const { target } = data;
                
                if (userDatabase[target]) {
                    userDatabase[target].banned = false;
                    saveData();
                    
                    ws.send(JSON.stringify({ 
                        type: 'user_unbanned', 
                        target 
                    }));
                    
                    logAction('admin_unban', data.username, target);
                }
            }
            
            // ===== ПОЛУЧИТЬ ВСЕ СООБЩЕНИЯ (ТОЛЬКО ДЛЯ Dane4ka5) =====
            if (data.type === 'get_all_messages') {
                if (data.username !== CREATOR_USERNAME) {
                    ws.send(JSON.stringify({ 
                        type: 'error', 
                        message: '❌ Только для создателя' 
                    }));
                    return;
                }
                
                ws.send(JSON.stringify({
                    type: 'all_messages',
                    messages: messages
                }));
                
                logAction('admin_all', data.username, 'Просмотр всех сообщений');
            }
                        // ===== СОЗДАНИЕ ГРУППЫ =====
            if (data.type === 'create_group') {
                const { name, creator } = data;
                
                if (!name || !creator) {
                    ws.send(JSON.stringify({ 
                        type: 'error', 
                        message: '❌ Название обязательно' 
                    }));
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
                
                ws.send(JSON.stringify({ 
                    type: 'group_created', 
                    group: groups[groupId] 
                }));
                
                logAction('create_group', creator, name);
            }
            
            // ===== ДОБАВЛЕНИЕ В ГРУППУ =====
            if (data.type === 'add_to_group') {
                const { groupId, username, adder } = data;
                
                if (!groups[groupId]) {
                    ws.send(JSON.stringify({ 
                        type: 'error', 
                        message: '❌ Группа не найдена' 
                    }));
                    return;
                }
                
                if (!groups[groupId].admins.includes(adder)) {
                    ws.send(JSON.stringify({ 
                        type: 'error', 
                        message: '❌ Нет прав' 
                    }));
                    return;
                }
                
                if (!groups[groupId].members.includes(username)) {
                    groups[groupId].members.push(username);
                    saveData();
                    
                    ws.send(JSON.stringify({ 
                        type: 'group_updated', 
                        group: groups[groupId] 
                    }));
                    
                    logAction('add_to_group', adder, `${username} → ${groupId}`);
                }
            }
            
            // ===== СООБЩЕНИЕ В ГРУППЕ =====
            if (data.type === 'group_message') {
                const { groupId, from, text, time } = data;
                
                if (!groups[groupId] || !groups[groupId].members.includes(from)) {
                    ws.send(JSON.stringify({ 
                        type: 'error', 
                        message: '❌ Нет доступа' 
                    }));
                    return;
                }
                
                const messageObj = {
                    id: generateId(),
                    from,
                    text,
                    time,
                    timestamp: Date.now(),
                    groupId
                };
                
                if (!groups[groupId].messages) groups[groupId].messages = [];
                groups[groupId].messages.push(messageObj);
                
                // Сохраняем в общую базу
                const chatKey = `group_${groupId}`;
                if (!messages[chatKey]) messages[chatKey] = [];
                messages[chatKey].push(messageObj);
                
                saveData();
                saveMessages();
                
                // Рассылаем всем участникам
                groups[groupId].members.forEach(member => {
                    const memberWs = users.get(member);
                    if (memberWs && memberWs.readyState === WebSocket.OPEN) {
                        memberWs.send(JSON.stringify({
                            type: 'group_message',
                            id: messageObj.id,
                            groupId,
                            from,
                            text,
                            time
                        }));
                    }
                });
                
                logAction('group_message', from, `→ group:${groupId}`);
            }
            
            // ===== ОТПРАВКА ФАЙЛА =====
            if (data.type === 'send_file') {
                const { from, to, fileName, fileData, time } = data;
                
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
                    from, to,
                    fileName,
                    fileSize: buffer.length,
                    time,
                    timestamp: Date.now(),
                    filePath
                };
                
                messages[chatKey].push(fileObj);
                saveMessages();
                
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
                
                ws.send(JSON.stringify({ 
                    type: 'file_sent', 
                    fileId 
                }));
                
                logAction('send_file', from, `${fileName} → ${to}`);
            }
                        // ===== ОБНОВЛЕНИЕ СТАТУСА =====
            if (data.type === 'update_status') {
                const { username, status } = data;
                
                const userData = activeUsers.get(ws);
                if (userData) {
                    userData.status = status;
                    activeUsers.set(ws, userData);
                    
                    // Оповещаем всех
                    broadcastStatusUpdate(username, status);
                    
                    ws.send(JSON.stringify({ 
                        type: 'status_updated', 
                        status 
                    }));
                }
            }
            
            // ===== НАСТРОЙКИ ПРИВАТНОСТИ =====
            if (data.type === 'update_privacy') {
                const { username, settings } = data;
                
                privacySettings[username] = { 
                    ...privacySettings[username], 
                    ...settings 
                };
                saveData();
                
                ws.send(JSON.stringify({ 
                    type: 'privacy_updated', 
                    settings: privacySettings[username] 
                }));
                
                logAction('update_privacy', username, JSON.stringify(settings));
            }
            
            // ===== БЛОКИРОВКА ПОЛЬЗОВАТЕЛЯ =====
            if (data.type === 'block_user') {
                const { username, target } = data;
                
                if (!blockedUsers[username]) {
                    blockedUsers[username] = [];
                }
                
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
                    blockedUsers[username] = blockedUsers[username]
                        .filter(b => b !== target);
                    saveData();
                    
                    ws.send(JSON.stringify({ 
                        type: 'blocked_list', 
                        blocked: blockedUsers[username] 
                    }));
                    
                    logAction('unblock_user', username, target);
                }
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
            
            // ===== P2P СИГНАЛЫ =====
            if (data.type === 'signal') {
                const { to, from, signal } = data;
                
                const targetWs = users.get(to);
                if (targetWs) {
                    targetWs.send(JSON.stringify({
                        type: 'signal',
                        from,
                        signal
                    }));
                }
            }
            
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
            
            // ===== P2P СООБЩЕНИЕ (сохраняем на сервере) =====
            if (data.type === 'p2p_message') {
                const { from, to, text, time, messageId } = data;
                
                const chatKey = [from, to].sort().join('_');
                if (!messages[chatKey]) messages[chatKey] = [];
                
                messages[chatKey].push({
                    id: messageId || generateId(),
                    from, to, text, time,
                    timestamp: Date.now(),
                    via: 'p2p'
                });
                
                saveMessages();
                
                ws.send(JSON.stringify({ 
                    type: 'p2p_message_saved',
                    messageId 
                }));
            }

        } catch (error) {
            console.error('❌ Ошибка обработки:', error);
            logAction('error', 'SYSTEM', error.message);
            
            try {
                ws.send(JSON.stringify({ 
                    type: 'error', 
                    message: 'Внутренняя ошибка сервера' 
                }));
            } catch (e) {}
        }
    });
        ws.on('close', () => {
        const userData = activeUsers.get(ws);
        if (userData) {
            console.log(`👋 ${userData.username} отключился`);
            users.delete(userData.username);
            activeUsers.delete(ws);
            
            // Обновляем список для всех
            broadcastUserList();
            
            logAction('disconnect', userData.username, userData.ip);
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
        timestamp: Date.now()
    });
    
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

function broadcastStatusUpdate(username, status) {
    const message = JSON.stringify({
        type: 'status_update',
        username,
        status
    });
    
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
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
// БЭКАПЫ (КАЖДЫЙ ЧАС)
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
        
        // Удаляем старые бэкапы (оставляем 50)
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
}, 60 * 60 * 1000);

// ==============================================
// ОЧИСТКА НЕАКТИВНЫХ
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
}, 5 * 60 * 1000);

// ==============================================
// ЗАПУСК
// ==============================================
loadAllData();

server.listen(PORT, '0.0.0.0', () => {
    console.log('\n' + '='.repeat(70));
    console.log(`🚀 Nanogram ${VERSION} - ИСПРАВЛЕННАЯ ВЕРСИЯ`);
    console.log('='.repeat(70));
    console.log(`📡 Порт: ${PORT}`);
    console.log(`\n📊 СТАТИСТИКА:`);
    console.log(`   👥 Пользователей: ${Object.keys(userDatabase).length}`);
    console.log(`   🟢 Онлайн: ${users.size}`);
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
    logAction('system', 'SERVER', 'Остановка');
    process.exit(0);
});

process.on('SIGTERM', () => {
    saveData();
    saveMessages();
    process.exit(0);
});