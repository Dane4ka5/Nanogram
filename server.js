// ==============================================
// SERVER.JS — NEXORA v0.16.0 (ПОЛНОСТЬЮ РАБОЧАЯ)
// ==============================================

const WebSocket = require('ws');
const fs = require('fs');
const http = require('http');
const path = require('path');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

// ==============================================
// КОНСТАНТЫ
// ==============================================
const PORT = process.env.PORT || 3000;
const VERSION = 'v0.16.0';
const CREATOR_USERNAME = 'Dane4ka5';
const SALT_ROUNDS = 10;
const SAVE_INTERVAL = 30000; // 30 секунд
const MAX_MESSAGES_PER_CHAT = 500;

// ==============================================
// ХРАНИЛИЩА ДАННЫХ
// ==============================================
let userDatabase = {};
let messages = {};
let groups = {};
let channels = {};
let privateRooms = {};
let userProfiles = {};
let premiumUsers = {};
let privacySettings = {};
let blockedUsers = {};
let suspiciousMessages = [];
let userSessions = {};
let ipBanList = [];
let whitelist = [];

// ==============================================
// ЗАГРУЗКА ДАННЫХ
// ==============================================
function loadAllData() {
    try {
        if (fs.existsSync('./data.json')) {
            const data = JSON.parse(fs.readFileSync('./data.json', 'utf8'));
            userDatabase = data.users || {};
            groups = data.groups || {};
            channels = data.channels || {};
            privateRooms = data.rooms || {};
            userProfiles = data.profiles || {};
            premiumUsers = data.premium || {};
            privacySettings = data.privacy || {};
            blockedUsers = data.blocked || {};
            ipBanList = data.ipBanList || [];
            whitelist = data.whitelist || [];
            console.log('✅ Данные пользователей загружены');
        }
    } catch (e) {
        console.log('⚠️ Ошибка загрузки data.json:', e.message);
    }

    try {
        if (fs.existsSync('./messages.json')) {
            messages = JSON.parse(fs.readFileSync('./messages.json', 'utf8'));
            console.log('✅ Сообщения загружены');
        }
    } catch (e) {
        console.log('⚠️ Ошибка загрузки messages.json:', e.message);
    }
}

function saveData() {
    const data = {
        users: userDatabase,
        groups: groups,
        channels: channels,
        rooms: privateRooms,
        profiles: userProfiles,
        premium: premiumUsers,
        privacy: privacySettings,
        blocked: blockedUsers,
        ipBanList: ipBanList,
        whitelist: whitelist,
        lastSave: new Date().toISOString()
    };
    fs.writeFileSync('./data.json', JSON.stringify(data, null, 2));
}

function saveMessages() {
    fs.writeFileSync('./messages.json', JSON.stringify(messages, null, 2));
}

function logAction(type, username, details) {
    const log = `[${new Date().toISOString()}] ${type} | ${username} | ${details}\n`;
    fs.appendFileSync('./users.log', log);
    console.log(`📝 ${log.trim()}`);
}

function generateId() {
    return Date.now() + '-' + crypto.randomBytes(8).toString('hex');
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
            creator: CREATOR_USERNAME,
            timestamp: new Date().toISOString(),
            stats: {
                users: Object.keys(userDatabase).length,
                online: Object.keys(userSessions).length,
                groups: Object.keys(groups).length,
                messages: Object.keys(messages).length,
                suspicious: suspiciousMessages.length
            }
        };
        res.end(JSON.stringify(diagnostic, null, 2));
        return;
    }
    
    // ===== ПОЛИТИКА КОНФИДЕНЦИАЛЬНОСТИ =====
    if (req.url === '/privacy') {
        res.end(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Политика Nexora</title>
<style>body{background:#0a0c10;color:#fff;font-family:sans-serif;padding:20px;}.container{max-width:800px;margin:0 auto;background:#161b22;padding:40px;border-radius:20px;}h1{color:#9f8be5;}a{color:#9f8be5;}</style></head>
<body><div class="container"><h1>📜 Политика конфиденциальности Nexora</h1>
<p>Мы собираем только имя, телефон и сообщения (в зашифрованном виде).</p>
<p>Данные не передаются третьим лицам.</p>
<p>Вы можете запросить удаление данных в любое время.</p>
<p>Версия ${VERSION}</p>
<p><a href="/">← Вернуться</a></p></div></body></html>`);
        return;
    }
    
    // ===== АДМИН-ПАНЕЛЬ =====
    if (req.url.includes('/admin')) {
        let data = {};
        try { if (fs.existsSync('./data.json')) data = JSON.parse(fs.readFileSync('./data.json', 'utf8')); } catch(e) {}
        
        if (req.url.includes('action=')) {
            const urlParams = new URL(req.url, `http://${req.headers.host}`).searchParams;
            const action = urlParams.get('action');
            const username = urlParams.get('username');
            
            if (action === 'ban_user' && username && data.users && data.users[username]) {
                data.users[username].banned = true;
                fs.writeFileSync('./data.json', JSON.stringify(data, null, 2));
                const targetWs = userSessions[username];
                if (targetWs) { targetWs.send(JSON.stringify({ type: 'you_are_banned' })); targetWs.close(); }
                logAction('admin_ban', CREATOR_USERNAME, username);
            }
            if (action === 'unban_user' && username && data.users && data.users[username]) {
                data.users[username].banned = false;
                fs.writeFileSync('./data.json', JSON.stringify(data, null, 2));
                logAction('admin_unban', CREATOR_USERNAME, username);
            }
            res.writeHead(302, { Location: '/admin' });
            res.end();
            return;
        }
        
        const usersCount = Object.keys(data.users || {}).length;
        const onlineCount = Object.keys(userSessions).length;
        let totalMessages = 0;
        Object.values(messages).forEach(chat => totalMessages += chat.length);
        
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Админ-панель</title>
<style>*{margin:0;padding:0;box-sizing:border-box;}body{background:#0a0c10;color:#fff;font-family:sans-serif;padding:20px;}
h1{color:#9f8be5;}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:15px;margin:20px 0;}
.card{background:#161b22;padding:20px;border-radius:10px;border-left:4px solid #9f8be5;}
.val{font-size:28px;font-weight:bold;color:#ffd700;}
table{width:100%;border-collapse:collapse;background:#161b22;border-radius:10px;}
th{background:#21262d;padding:12px;text-align:left;color:#9f8be5;}
td{padding:12px;border-bottom:1px solid #30363d;}
button{padding:8px 15px;border-radius:8px;border:none;background:#9f8be5;color:#fff;cursor:pointer;}
.danger{background:#da3633;}</style></head>
<body><h1>🔐 Админ-панель Nexora</h1>
<div class="stats">
<div class="card"><div class="val">${usersCount}</div>Пользователей</div>
<div class="card"><div class="val">${onlineCount}</div>Онлайн</div>
<div class="card"><div class="val">${totalMessages}</div>Сообщений</div>
<div class="card"><div class="val">${suspiciousMessages.length}</div>Подозрительных</div>
</div>
<h2>👥 Пользователи</h2><table><tr><th>Имя</th><th>Телефон</th><th>Статус</th><th>Действия</th></tr>
${Object.entries(data.users || {}).map(([name, info]) => `
<tr${info.banned ? ' style="background:rgba(218,54,51,0.2)"' : ''}>
<td><strong>${name}${name === CREATOR_USERNAME ? ' ⭐' : ''}</strong></td>
<td>${info.phone || '—'}</td>
<td>${info.banned ? '🔴 Заблокирован' : '🟢 Активен'}</td>
<td>
    ${info.banned ? 
        `<form method="get" style="display:inline;"><input type="hidden" name="action" value="unban_user"><input type="hidden" name="username" value="${name}"><button style="background:#2ea043;">Разбанить</button></form>` :
        `<form method="get" style="display:inline;"><input type="hidden" name="action" value="ban_user"><input type="hidden" name="username" value="${name}"><button class="danger">Забанить</button></form>`
    }
</td></tr>`).join('')}</table></body></html>`);
        return;
    }
    
    // ===== ОБЫЧНЫЕ ФАЙЛЫ =====
    let filePath = '.' + req.url;
    if (filePath === './') filePath = './index.html';
    
    fs.readFile(filePath, 'utf8', (err, content) => {
        if (err) {
            res.writeHead(404);
            res.end('<h1>404 - Файл не найден</h1>');
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

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message.toString('utf8'));
            
            if (data.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
                return;
            }
            
            console.log(`📩 ${data.type} от ${data.username || 'unknown'}`);

            // ==============================================
            // РЕГИСТРАЦИЯ / ВХОД (С bcrypt)
            // ==============================================
            if (data.type === 'register') {
                const { username, password, phone, privacyAccepted } = data;
                
                if (!username || !password || !phone) {
                    ws.send(JSON.stringify({ type: 'error', message: '❌ Все поля обязательны' }));
                    return;
                }
                
                if (!privacyAccepted) {
                    ws.send(JSON.stringify({ type: 'error', message: '❌ Примите политику' }));
                    return;
                }
                
                const cleanUsername = username.trim();
                const cleanPhone = phone.trim().replace(/\s+/g, '');
                
                if (userDatabase[cleanUsername]?.banned) {
                    ws.send(JSON.stringify({ type: 'redirect_to_ban', reason: 'Аккаунт заблокирован' }));
                    return;
                }
                
                // СУЩЕСТВУЮЩИЙ ПОЛЬЗОВАТЕЛЬ
                if (userDatabase[cleanUsername]) {
                    const isPasswordValid = await bcrypt.compare(password, userDatabase[cleanUsername].password);
                    if (!isPasswordValid) {
                        ws.send(JSON.stringify({ type: 'error', message: '❌ Неверный пароль' }));
                        return;
                    }
                    if (userDatabase[cleanUsername].phone !== cleanPhone) {
                        ws.send(JSON.stringify({ type: 'error', message: '❌ Неверный номер' }));
                        return;
                    }
                    
                    console.log(`👋 Вход: ${cleanUsername}`);
                    currentUser = cleanUsername;
                    userDatabase[cleanUsername].lastSeen = new Date().toISOString();
                    userSessions[cleanUsername] = ws;
                    saveData();
                    logAction('login', cleanUsername, clientIp);
                    
                    ws.send(JSON.stringify({
                        type: 'login_success',
                        username: cleanUsername,
                        profile: userProfiles[cleanUsername] || { avatar: '👤', bio: '' },
                        premium: premiumUsers[cleanUsername]?.active || false,
                        privacy: privacySettings[cleanUsername] || { showOnline: 'all', showPhone: 'all' },
                        blocked: blockedUsers[cleanUsername] || []
                    }));
                    
                // НОВЫЙ ПОЛЬЗОВАТЕЛЬ
                } else {
                    let phoneExists = false;
                    for (const u of Object.values(userDatabase)) {
                        if (u.phone === cleanPhone) { phoneExists = true; break; }
                    }
                    if (phoneExists) {
                        ws.send(JSON.stringify({ type: 'error', message: '❌ Этот номер уже используется' }));
                        return;
                    }
                    
                    console.log(`👤 Новый: ${cleanUsername}`);
                    currentUser = cleanUsername;
                    
                    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
                    userDatabase[cleanUsername] = {
                        username: cleanUsername,
                        password: hashedPassword,
                        phone: cleanPhone,
                        registered: new Date().toISOString(),
                        lastSeen: new Date().toISOString(),
                        banned: false
                    };
                    userProfiles[cleanUsername] = { avatar: '👤', bio: '' };
                    premiumUsers[cleanUsername] = { active: false };
                    privacySettings[cleanUsername] = { showOnline: 'all', showPhone: 'all' };
                    blockedUsers[cleanUsername] = [];
                    userSessions[cleanUsername] = ws;
                    saveData();
                    logAction('register', cleanUsername, clientIp);
                    
                    ws.send(JSON.stringify({
                        type: 'register_success',
                        username: cleanUsername,
                        profile: userProfiles[cleanUsername],
                        premium: false,
                        privacy: privacySettings[cleanUsername],
                        blocked: []
                    }));
                }
                
                // Отправляем списки
                ws.send(JSON.stringify({ type: 'user_list', users: Object.keys(userSessions) }));
                ws.send(JSON.stringify({ type: 'channels_list', channels: Object.values(channels) }));
                ws.send(JSON.stringify({ 
                    type: 'groups_list', 
                    groups: Object.values(groups).filter(g => g.members?.includes(cleanUsername))
                }));
                ws.send(JSON.stringify({ 
                    type: 'rooms_list', 
                    rooms: Object.values(privateRooms).filter(r => r.members?.includes(cleanUsername))
                }));
                
                broadcastUserList();
            }

            // ==============================================
            // ЗАПРОС ИСТОРИИ
            // ==============================================
            if (data.type === 'request_history') {
                const { chatId, username } = data;
                if (!chatId || !username) {
                    ws.send(JSON.stringify({ type: 'error', message: '❌ Не указан чат' }));
                    return;
                }
                const chatKey = chatId.includes('_') ? chatId : [username, chatId].sort().join('_');
                const history = messages[chatKey] || [];
                ws.send(JSON.stringify({ type: 'chat_history', chatId, messages: history.slice(-500) }));
                logAction('request_history', username, `${chatId} (${history.length} сообщений)`);
            }

            // ==============================================
            // ОТПРАВКА СООБЩЕНИЯ
            // ==============================================
            if (data.type === 'message') {
                const { from, to, text, time, id } = data;
                if (!from || !to || !text) {
                    ws.send(JSON.stringify({ type: 'error', message: '❌ Неполные данные' }));
                    return;
                }
                if (userDatabase[from]?.banned) {
                    ws.send(JSON.stringify({ type: 'error', message: '❌ Вы заблокированы' }));
                    return;
                }
                
                const chatKey = [from, to].sort().join('_');
                if (!messages[chatKey]) messages[chatKey] = [];
                const messageObj = { id: id || generateId(), from, to, text, time, timestamp: Date.now(), delivered: false };
                messages[chatKey].push(messageObj);
                if (messages[chatKey].length > MAX_MESSAGES_PER_CHAT) {
                    messages[chatKey] = messages[chatKey].slice(-MAX_MESSAGES_PER_CHAT);
                }
                saveMessages();
                
                const targetWs = userSessions[to];
                let delivered = false;
                if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                    targetWs.send(JSON.stringify({ type: 'message', id: messageObj.id, from, text, time }));
                    delivered = true;
                }
                ws.send(JSON.stringify({ type: 'message_delivered', messageId: messageObj.id, delivered }));
                logAction('message', from, `→ ${to}`);
            }
                        // ==============================================
            // ГРУППЫ
            // ==============================================
            if (data.type === 'create_group') {
                const { name, creator } = data;
                if (!name || !creator) {
                    ws.send(JSON.stringify({ type: 'error', message: '❌ Название обязательно' }));
                    return;
                }
                const groupId = 'group_' + generateId();
                groups[groupId] = {
                    id: groupId, name, creator, admins: [creator],
                    members: [creator], avatar: '👥', createdAt: new Date().toISOString(), messages: []
                };
                saveData();
                ws.send(JSON.stringify({ type: 'group_created', group: groups[groupId] }));
                ws.send(JSON.stringify({
                    type: 'groups_list',
                    groups: Object.values(groups).filter(g => g.members?.includes(creator))
                }));
                logAction('create_group', creator, name);
            }

            if (data.type === 'group_message') {
                const { groupId, from, text, time } = data;
                if (!groups[groupId] || !groups[groupId].members.includes(from)) {
                    ws.send(JSON.stringify({ type: 'error', message: '❌ Нет доступа' }));
                    return;
                }
                const messageObj = { id: generateId(), from, text, time, timestamp: Date.now(), groupId };
                if (!groups[groupId].messages) groups[groupId].messages = [];
                groups[groupId].messages.push(messageObj);
                const chatKey = `group_${groupId}`;
                if (!messages[chatKey]) messages[chatKey] = [];
                messages[chatKey].push(messageObj);
                saveData(); saveMessages();
                groups[groupId].members.forEach(member => {
                    const memberWs = userSessions[member];
                    if (memberWs && memberWs.readyState === WebSocket.OPEN) {
                        memberWs.send(JSON.stringify({ type: 'group_message', groupId, from, text, time }));
                    }
                });
                logAction('group_message', from, `→ group:${groupId}`);
            }

            // ==============================================
            // АДМИН-КОМАНДЫ (ТОЛЬКО ДЛЯ Dane4ka5)
            // ==============================================
            if (data.type === 'get_stats' && data.username === CREATOR_USERNAME) {
                const stats = {
                    users: Object.keys(userDatabase).length,
                    online: Object.keys(userSessions).length,
                    messages: Object.values(messages).reduce((a, c) => a + c.length, 0),
                    groups: Object.keys(groups).length,
                    channels: Object.keys(channels).length,
                    premium: Object.keys(premiumUsers).length,
                    suspicious: suspiciousMessages.length,
                    version: VERSION
                };
                ws.send(JSON.stringify({ type: 'stats', stats }));
                logAction('admin_stats', data.username, 'Статистика');
            }

            if (data.type === 'get_suspicious' && data.username === CREATOR_USERNAME) {
                ws.send(JSON.stringify({ type: 'suspicious_list', messages: suspiciousMessages.slice(-100).reverse() }));
            }

            if (data.type === 'clear_suspicious' && data.username === CREATOR_USERNAME) {
                suspiciousMessages = [];
                fs.writeFileSync('./suspicious.log', '');
                ws.send(JSON.stringify({ type: 'suspicious_cleared' }));
            }

            // ==============================================
            // ДОПОЛНИТЕЛЬНО
            // ==============================================
            if (data.type === 'update_status') {
                const { username, status } = data;
                logAction('update_status', username, status);
                ws.send(JSON.stringify({ type: 'status_updated', status }));
            }

            if (data.type === 'block_user') {
                const { username, target } = data;
                if (!blockedUsers[username]) blockedUsers[username] = [];
                if (!blockedUsers[username].includes(target)) {
                    blockedUsers[username].push(target);
                    saveData();
                    ws.send(JSON.stringify({ type: 'blocked_list', blocked: blockedUsers[username] }));
                }
            }

            if (data.type === 'unblock_user') {
                const { username, target } = data;
                if (blockedUsers[username]) {
                    blockedUsers[username] = blockedUsers[username].filter(b => b !== target);
                    saveData();
                    ws.send(JSON.stringify({ type: 'blocked_list', blocked: blockedUsers[username] }));
                }
            }

            if (data.type === 'typing') {
                const { from, to } = data;
                const targetWs = userSessions[to];
                if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                    targetWs.send(JSON.stringify({ type: 'typing', from }));
                }
            }

        } catch (error) {
            console.error('❌ Ошибка:', error);
            ws.send(JSON.stringify({ type: 'error', message: 'Внутренняя ошибка' }));
        }
    });

    ws.on('close', () => {
        if (currentUser) {
            console.log(`👋 ${currentUser} отключился`);
            delete userSessions[currentUser];
            if (userDatabase[currentUser]) {
                userDatabase[currentUser].lastSeen = new Date().toISOString();
                saveData();
            }
            broadcastUserList();
            logAction('disconnect', currentUser, 'Отключение');
        }
    });
});

// ==============================================
// РАССЫЛКА
// ==============================================
function broadcastUserList() {
    const message = JSON.stringify({ type: 'user_list', users: Object.keys(userSessions), online: Object.keys(userSessions).length });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send(message);
    });
}

// ==============================================
// АВТОСОХРАНЕНИЕ
// ==============================================
setInterval(() => {
    saveData();
    saveMessages();
    console.log(`💾 Автосохранение в ${new Date().toLocaleTimeString()}`);
}, SAVE_INTERVAL);

// ==============================================
// ЗАПУСК
// ==============================================
loadAllData();

server.listen(PORT, '0.0.0.0', () => {
    console.log('\n' + '='.repeat(70));
    console.log(`🚀 Nexora ${VERSION} - ПОЛНОСТЬЮ РАБОЧАЯ ВЕРСИЯ`);
    console.log('='.repeat(70));
    console.log(`📡 Порт: ${PORT}`);
    console.log(`👑 Создатель: ${CREATOR_USERNAME}`);
    console.log(`📊 Пользователей: ${Object.keys(userDatabase).length}`);
    console.log(`🟢 Онлайн: ${Object.keys(userSessions).length}`);
    console.log(`💬 Сообщений: ${Object.values(messages).reduce((a, c) => a + c.length, 0)}`);
    console.log(`\n🌐 http://localhost:${PORT}`);
    console.log(`🕵️ /admin - админ-панель`);
    console.log('='.repeat(70) + '\n');
});

process.on('SIGINT', () => {
    saveData(); saveMessages();
    console.log('✅ Сервер остановлен');
    process.exit(0);
});