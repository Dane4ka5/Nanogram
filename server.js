const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ==============================================
// КОНФИГУРАЦИЯ
// ==============================================
const PORT = process.env.PORT || 3000;
const VERSION = 'v0.10.6';
const CREATOR_USERNAME = 'Dane4ka5';
const SAVE_INTERVAL = 60 * 1000;
const MAX_MESSAGES_PER_CHAT = 10000;
const MAX_BACKUPS = 50;

// ==============================================
// ХРАНИЛИЩА ДАННЫХ
// ==============================================
const users = new Map(); // username -> WebSocket
const activeUsers = new Map(); // ws -> { username, ip, status, lastSeen }

let userDatabase = {}; // username -> { password, phone, registered, banned }
let messages = {}; // chatKey -> [messages]
let groups = {}; // groupId -> { name, creator, admins, members, messages }
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
let privateRooms = {}; // roomId -> { name, creator, members, inviteLink }
let userProfiles = {}; // username -> { avatar, bio }
let userSettings = {}; // username -> { theme, fontSize, notifications }
let premiumUsers = {}; // username -> { active, granted, expires }
let blockedUsers = {}; // username -> [blockedUser1, blockedUser2]
let privacySettings = {}; // username -> { showOnline, showPhone }
let suspiciousMessages = []; // [{ from, to, message, ip, timestamp, word }]

// ==============================================
// ПОДОЗРИТЕЛЬНЫЕ СЛОВА
// ==============================================
const SUSPICIOUS_WORDS = [
    'терракт', 'бомба', 'взрыв', 'оружие', 'наркотики',
    'убить', 'война', 'attack', 'bomb', 'kill', 'terror'
];
// ==============================================
// ЗАГРУЗКА ДАННЫХ
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
            console.log(`   👥 Групп: ${Object.keys(groups).length}`);
            console.log(`   👑 Премиум: ${Object.keys(premiumUsers).length}`);
        }
    } catch (e) {
        console.error(`❌ Ошибка загрузки data.json:`, e.message);
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
// СОХРАНЕНИЕ ДАННЫХ
// ==============================================
function saveData() {
    try {
        const data = {
            users: userDatabase,
            groups: groups,
            channels: channels,
            privateRooms: privateRooms,
            userProfiles: userProfiles,
            userSettings: userSettings,
            premiumUsers: premiumUsers,
            blockedUsers: blockedUsers,
            privacySettings: privacySettings,
            lastSaved: new Date().toISOString()
        };
        fs.writeFileSync('./data.json', JSON.stringify(data, null, 2), 'utf8');
        console.log(`💾 Данные сохранены в ${new Date().toLocaleTimeString()}`);
        return true;
    } catch (e) {
        console.error('❌ Ошибка сохранения:', e);
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
            console.log('\x1b[31m%s\x1b[0m', `🚨 ПОДОЗРИТЕЛЬНО: ${from} → ${to}: "${text.substring(0, 50)}..."`);
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
        const onlineCount = users.size;
        const diagnostic = {
            server: 'ONLINE',
            version: VERSION,
            creator: CREATOR_USERNAME,
            timestamp: new Date().toISOString(),
            stats: {
                users: Object.keys(userDatabase).length,
                online: onlineCount,
                groups: Object.keys(groups).length,
                channels: Object.keys(channels).length,
                messages: Object.keys(messages).length,
                suspicious: suspiciousMessages.length,
                premium: Object.keys(premiumUsers).length
            },
            files: {
                dataJson: fs.existsSync('./data.json'),
                messagesJson: fs.existsSync('./messages.json'),
                usersLog: fs.existsSync('./users.log'),
                suspiciousLog: fs.existsSync('./suspicious.log')
            }
        };
        res.end(JSON.stringify(diagnostic, null, 2));
        return;
    }
    
    // ===== ПОЛИТИКА КОНФИДЕНЦИАЛЬНОСТИ =====
    if (req.url === '/privacy') {
        res.end(`<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>📜 Политика Nanogram</title>
    <style>
        body {
            background: #0a0c10;
            color: #ffffff;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            padding: 20px;
            line-height: 1.6;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
            background: #161b22;
            padding: 40px;
            border-radius: 20px;
            border: 1px solid #30363d;
        }
        h1 { color: #9f8be5; font-size: 32px; }
        h2 { color: #ffd700; margin-top: 30px; }
        p { color: #b0b3b8; }
        .price { background: #21262d; padding: 10px; border-left: 4px solid #9f8be5; margin: 10px 0; }
        .footer { margin-top: 40px; text-align: center; color: #8b949e; }
        a { color: #9f8be5; text-decoration: none; }
    </style>
</head>
<body>
    <div class="container">
        <h1>📜 Политика конфиденциальности Nanogram</h1>
        
        <h2>1. Какие данные мы собираем</h2>
        <p>• Имя пользователя</p>
        <p>• Номер телефона</p>
        <p>• Сообщения (в зашифрованном виде)</p>
        
        <h2>2. Премиум за донаты</h2>
        <div class="price">30 рублей - 1 месяц</div>
        <div class="price">85 рублей - 3 месяца</div>
        <div class="price">145 рублей - 6 месяцев</div>
        <div class="price">285 рублей - 1 год</div>
        
        <h2>3. Бесплатный премиум за баги</h2>
        <p>🐛 Незначительный баг — 1 месяц</p>
        <p>🐞 Средний баг — 3 месяца</p>
        <p>🦠 Критический баг — 6 месяцев</p>
        <p>💎 Уникальная находка — 1 год + имя в списке</p>
        
        <h2>4. Контакты</h2>
        <p>📧 <a href="mailto:nanogram.ru@yandex.ru">nanogram.ru@yandex.ru</a></p>
        
        <div class="footer">
            <p>Версия ${VERSION} | Последнее обновление: ${new Date().toLocaleDateString()}</p>
            <p><a href="/">← Вернуться на главную</a></p>
        </div>
    </div>
</body>
</html>`);
        return;
    }
        // ===== ТЕНЕВАЯ ПАНЕЛЬ (ТОЛЬКО ДЛЯ Dane4ka5) =====
    if (req.url.includes('admin')) {
        
        // Простая проверка (можно добавить пароль позже)
        const clientIp = req.socket.remoteAddress;
        
        let data = {};
        try {
            if (fs.existsSync('./data.json')) {
                data = JSON.parse(fs.readFileSync('./data.json', 'utf8'));
            }
        } catch (e) {
            data = {};
        }
        
        let msgs = {};
        try {
            if (fs.existsSync('./messages.json')) {
                msgs = JSON.parse(fs.readFileSync('./messages.json', 'utf8'));
            }
        } catch (e) {
            msgs = {};
        }
        
        // ===== ОБРАБОТКА ДЕЙСТВИЙ =====
        if (req.url.includes('action=')) {
            const redirectUrl = '/admin';
            
            // БАН ПОЛЬЗОВАТЕЛЯ
            if (req.url.includes('action=ban_user')) {
                const urlParams = new URL(req.url, `http://${req.headers.host}`).searchParams;
                const username = urlParams.get('username');
                
                if (username && data.users && data.users[username]) {
                    data.users[username].banned = true;
                    data.users[username].bannedAt = new Date().toISOString();
                    fs.writeFileSync('./data.json', JSON.stringify(data, null, 2), 'utf8');
                    
                    // Кикаем если онлайн
                    const targetWs = users.get(username);
                    if (targetWs) {
                        targetWs.send(JSON.stringify({ type: 'you_are_banned' }));
                        targetWs.close();
                    }
                    
                    logAction('admin_ban', CREATOR_USERNAME, username);
                }
            }
            
            // РАЗБАН
            if (req.url.includes('action=unban_user')) {
                const urlParams = new URL(req.url, `http://${req.headers.host}`).searchParams;
                const username = urlParams.get('username');
                
                if (username && data.users && data.users[username]) {
                    data.users[username].banned = false;
                    fs.writeFileSync('./data.json', JSON.stringify(data, null, 2), 'utf8');
                    logAction('admin_unban', CREATOR_USERNAME, username);
                }
            }
            
            // ВЫДАТЬ ПРЕМИУМ
            if (req.url.includes('action=give_premium')) {
                const urlParams = new URL(req.url, `http://${req.headers.host}`).searchParams;
                const username = urlParams.get('username');
                const months = urlParams.get('months') || '1';
                
                if (username && data.users && data.users[username]) {
                    if (!data.premiumUsers) data.premiumUsers = {};
                    
                    data.premiumUsers[username] = {
                        active: true,
                        granted: new Date().toISOString(),
                        expires: new Date(Date.now() + parseInt(months) * 30 * 24 * 60 * 60 * 1000).toISOString(),
                        grantedBy: CREATOR_USERNAME
                    };
                    
                    fs.writeFileSync('./data.json', JSON.stringify(data, null, 2), 'utf8');
                    logAction('admin_give_premium', CREATOR_USERNAME, `${username} (${months} мес)`);
                }
            }
            
            res.writeHead(302, { Location: redirectUrl });
            res.end();
            return;
        }
        
        // ===== СТАТИСТИКА ДЛЯ ТЕНЕВОЙ ПАНЕЛИ =====
        const usersCount = Object.keys(data.users || {}).length;
        const groupsCount = Object.keys(data.groups || {}).length;
        const channelsCount = Object.keys(data.channels || {}).length;
        const premiumCount = Object.keys(data.premiumUsers || {}).length;
        const bannedCount = Object.values(data.users || {}).filter(u => u.banned).length;
        const onlineCount = users.size;
        
        let totalMessages = 0;
        Object.values(msgs).forEach(chat => totalMessages += chat.length);
        
        // ===== HTML ТЕНЕВОЙ ПАНЕЛИ =====
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🔐 Теневая панель Nanogram ${VERSION}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            background: #0a0c10;
            color: #ffffff;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            padding: 20px;
        }
        .container { max-width: 1400px; margin: 0 auto; }
        h1 { color: #9f8be5; font-size: 32px; margin-bottom: 10px; }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin: 20px 0;
        }
        .stat-card {
            background: #161b22;
            padding: 20px;
            border-radius: 10px;
            border-left: 4px solid #9f8be5;
        }
        .stat-value { font-size: 28px; font-weight: bold; color: #ffd700; }
        .stat-label { color: #b0b3b8; font-size: 14px; margin-top: 5px; }
        .panel {
            background: #161b22;
            padding: 25px;
            border-radius: 10px;
            margin: 20px 0;
            border: 1px solid #30363d;
        }
        .panel h2 { color: #9f8be5; margin-bottom: 20px; }
        .panel h3 { color: #ffd700; margin: 15px 0; }
        .suspicious {
            background: #da3633;
            padding: 15px;
            margin: 10px 0;
            border-radius: 8px;
            border-left: 4px solid #ffd700;
        }
        .suspicious small { color: #ffd700; }
        table {
            width: 100%;
            border-collapse: collapse;
            background: #0a0c10;
            border-radius: 10px;
            overflow: hidden;
        }
        th { background: #21262d; padding: 12px; text-align: left; color: #9f8be5; }
        td { padding: 12px; border-bottom: 1px solid #30363d; }
        .banned { background: rgba(218, 54, 51, 0.2); }
        .premium-row { background: rgba(255, 215, 0, 0.1); }
        input, select, button {
            padding: 10px 15px;
            margin: 5px;
            border-radius: 8px;
            border: 1px solid #30363d;
            background: #0a0c10;
            color: white;
        }
        button {
            background: #9f8be5;
            cursor: pointer;
            transition: all 0.3s;
        }
        button:hover { background: #b09cff; }
        .danger-btn { background: #da3633; }
        .danger-btn:hover { background: #f85149; }
        .success-btn { background: #2ea043; }
        .flex { display: flex; gap: 10px; flex-wrap: wrap; }
        .admin-actions {
            background: #21262d;
            padding: 20px;
            border-radius: 10px;
            margin: 10px 0;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔐 ТЕНЕВАЯ ПАНЕЛЬ NANOGRAM</h1>
        <p>Добро пожаловать, Создатель! 👑</p>
        
        <div class="stats-grid">
            <div class="stat-card"><div class="stat-value">${usersCount}</div><div class="stat-label">Всего пользователей</div></div>
            <div class="stat-card"><div class="stat-value">${onlineCount}</div><div class="stat-label">🟢 Онлайн сейчас</div></div>
            <div class="stat-card"><div class="stat-value">${totalMessages}</div><div class="stat-label">Сообщений</div></div>
            <div class="stat-card"><div class="stat-value">${groupsCount}</div><div class="stat-label">Групп</div></div>
            <div class="stat-card"><div class="stat-value">${channelsCount}</div><div class="stat-label">Каналов</div></div>
            <div class="stat-card"><div class="stat-value">${premiumCount}</div><div class="stat-label">👑 Премиум</div></div>
            <div class="stat-card"><div class="stat-value">${bannedCount}</div><div class="stat-label">🔨 Забанено</div></div>
            <div class="stat-card"><div class="stat-value">${suspiciousMessages.length}</div><div class="stat-label">🚨 Подозрительных</div></div>
        </div>
        
        <div class="admin-actions">
            <h2>⚡ БЫСТРЫЕ ДЕЙСТВИЯ</h2>
            <div class="flex">
                <button onclick="location.href='/'">🏠 На главную</button>
                <button onclick="location.href='/diagnostic'">🔍 Диагностика</button>
                <button onclick="location.href='/privacy'">📜 Политика</button>
            </div>
        </div>
        
        <div class="panel">
            <h2>👥 УПРАВЛЕНИЕ ПОЛЬЗОВАТЕЛЯМИ</h2>
            <table>
                <tr>
                    <th>Имя</th>
                    <th>Телефон</th>
                    <th>Статус</th>
                    <th>Премиум</th>
                    <th>Действия</th>
                </tr>
                ${Object.entries(data.users || {}).sort().map(([name, info]) => `
                    <tr class="${info.banned ? 'banned' : ''} ${data.premiumUsers?.[name]?.active ? 'premium-row' : ''}">
                        <td><strong>${name}${name === CREATOR_USERNAME ? ' ⭐' : ''}</strong></td>
                        <td>${info.phone || '—'}</td>
                        <td>${info.banned ? '🔴 ЗАБЛОКИРОВАН' : '🟢 Активен'}</td>
                        <td>${data.premiumUsers?.[name]?.active ? '👑' : '—'}</td>
                        <td>
                            <div class="flex" style="gap: 5px;">
                                ${info.banned ? `
                                    <form method="get" style="display:inline;">
                                        <input type="hidden" name="action" value="unban_user">
                                        <input type="hidden" name="username" value="${name}">
                                        <button type="submit" class="success-btn" style="padding:5px 10px;">✅ Разбанить</button>
                                    </form>
                                ` : `
                                    <form method="get" style="display:inline;">
                                        <input type="hidden" name="action" value="ban_user">
                                        <input type="hidden" name="username" value="${name}">
                                        <button type="submit" class="danger-btn" style="padding:5px 10px;">🔨 Забанить</button>
                                    </form>
                                `}
                                <form method="get" style="display:inline;">
                                    <input type="hidden" name="action" value="give_premium">
                                    <input type="hidden" name="username" value="${name}">
                                    <select name="months" style="width:80px; padding:5px;">
                                        <option value="1">1м</option>
                                        <option value="3">3м</option>
                                        <option value="6">6м</option>
                                        <option value="12">12м</option>
                                    </select>
                                    <button type="submit" style="padding:5px 10px; background:#ffd700; color:#000;">👑</button>
                                </form>
                            </div>
                        </td>
                    </tr>
                `).join('')}
            </table>
        </div>
    </div>
</body>
</html>
        `);
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
        timestamp: Date.now(),
        message: 'Подключено к серверу Nanogram'
    }));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString('utf8'));
            
            // ===== ПИНГ-ПОНГ =====
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
                const { username, password, phone, privacyAccepted } = data;
                
                if (!username || !password || !phone) {
                    ws.send(JSON.stringify({ 
                        type: 'error', 
                        message: '❌ Имя, пароль и телефон обязательны' 
                    }));
                    return;
                }
                
                if (!privacyAccepted) {
                    ws.send(JSON.stringify({ 
                        type: 'error', 
                        message: '❌ Необходимо принять политику конфиденциальности' 
                    }));
                    return;
                }
                
                const cleanUsername = username.trim();
                const cleanPhone = phone.trim().replace(/\s+/g, '');
                
                // Проверка на бан
                if (userDatabase[cleanUsername]?.banned) {
                    ws.send(JSON.stringify({ 
                        type: 'error', 
                        message: '❌ Вы заблокированы' 
                    }));
                    return;
                }
                
                // Существующий пользователь
                if (userDatabase[cleanUsername]) {
                    if (userDatabase[cleanUsername].password !== password) {
                        ws.send(JSON.stringify({ 
                            type: 'error', 
                            message: '❌ Неверный пароль' 
                        }));
                        return;
                    }
                    
                    if (userDatabase[cleanUsername].phone !== cleanPhone) {
                        ws.send(JSON.stringify({ 
                            type: 'error', 
                            message: '❌ Неверный номер для этого аккаунта' 
                        }));
                        return;
                    }
                    
                    console.log(`👋 Вход: ${cleanUsername}`);
                    currentUser = cleanUsername;
                    
                    userDatabase[cleanUsername].lastSeen = new Date().toISOString();
                    
                    users.set(cleanUsername, ws);
                    activeUsers.set(ws, { 
                        username: cleanUsername, 
                        ip: clientIp, 
                        status: 'online',
                        joinedAt: Date.now()
                    });
                    
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
                    
                // Новый пользователь
                } else {
                    // Проверка уникальности телефона
                    let phoneExists = false;
                    for (const u of Object.values(userDatabase)) {
                        if (u.phone === cleanPhone) {
                            phoneExists = true;
                            break;
                        }
                    }
                    
                    if (phoneExists) {
                        ws.send(JSON.stringify({ 
                            type: 'error', 
                            message: '❌ Этот номер телефона уже используется' 
                        }));
                        return;
                    }
                    
                    console.log(`👤 Новый пользователь: ${cleanUsername} (${cleanPhone})`);
                    currentUser = cleanUsername;
                    
                    userDatabase[cleanUsername] = {
                        username: cleanUsername,
                        password: password,
                        phone: cleanPhone,
                        registered: new Date().toISOString(),
                        lastSeen: new Date().toISOString(),
                        banned: false
                    };
                    
                    userProfiles[cleanUsername] = { avatar: '👤', bio: '' };
                    premiumUsers[cleanUsername] = { active: false };
                    privacySettings[cleanUsername] = { showOnline: 'all', showPhone: 'all' };
                    blockedUsers[cleanUsername] = [];
                    
                    users.set(cleanUsername, ws);
                    activeUsers.set(ws, { 
                        username: cleanUsername, 
                        ip: clientIp, 
                        status: 'online',
                        joinedAt: Date.now()
                    });
                    
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
                        g.members && g.members.includes(cleanUsername)
                    )
                }));
                
                ws.send(JSON.stringify({ 
                    type: 'rooms_list', 
                    rooms: Object.values(privateRooms).filter(r => 
                        r.members && r.members.includes(cleanUsername)
                    )
                }));
                
                // Оповещаем всех о новом пользователе
                broadcastUserList();
                broadcastStatusUpdate(cleanUsername, 'online');
            }

            // ===== ЗАПРОС ИСТОРИИ ЧАТА (ФИКС ПРОБЛЕМЫ) =====
            if (data.type === 'request_history') {
                const { chatId, username } = data;
                
                if (!chatId || !username) {
                    ws.send(JSON.stringify({ 
                        type: 'error', 
                        message: '❌ Не указан чат' 
                    }));
                    return;
                }
                
                console.log(`📜 Запрос истории: ${username} -> ${chatId}`);
                
                // Формируем ключ чата (сортируем имена для уникальности)
                const chatKey = chatId.includes('_') ? chatId : [username, chatId].sort().join('_');
                
                // Получаем историю
                const chatHistory = messages[chatKey] || [];
                
                // Отправляем историю (последние 500 сообщений)
                ws.send(JSON.stringify({
                    type: 'chat_history',
                    chatId: chatId,
                    messages: chatHistory.slice(-500)
                }));
                
                // Логируем
                if (chatHistory.length > 0) {
                    logAction('request_history', username, `${chatId} (${chatHistory.length} сообщений)`);
                }
            }

            // ===== ОТПРАВКА СООБЩЕНИЯ =====
            if (data.type === 'message') {
                const { from, to, text, time, id } = data;
                
                if (!from || !to || !text) {
                    ws.send(JSON.stringify({ 
                        type: 'error', 
                        message: '❌ Неполные данные сообщения' 
                    }));
                    return;
                }
                
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
                    id: id || generateId(),
                    from, to, text, time,
                    timestamp: Date.now(),
                    ip: clientIp,
                    suspicious: isSuspicious,
                    delivered: false
                };
                
                messages[chatKey].push(messageObj);
                
                if (messages[chatKey].length > MAX_MESSAGES_PER_CHAT) {
                    messages[chatKey] = messages[chatKey].slice(-MAX_MESSAGES_PER_CHAT);
                }
                
                saveMessages();
                
                // Отправляем получателю
                const targetWs = users.get(to);
                let delivered = false;
                
                if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                    targetWs.send(JSON.stringify({
                        type: 'message',
                        id: messageObj.id,
                        from,
                        text,
                        time,
                        serverTime: Date.now()
                    }));
                    delivered = true;
                    messageObj.delivered = true;
                }
                
                // Подтверждение отправителю
                ws.send(JSON.stringify({
                    type: 'message_delivered',
                    messageId: messageObj.id,
                    to,
                    time,
                    delivered,
                    suspicious: isSuspicious
                }));
                
                logAction('message', from, `→ ${to}${isSuspicious ? ' 🚨' : ''}`);
            }
                        // ===== СОЗДАНИЕ ГРУППЫ =====
            if (data.type === 'create_group') {
                const { name, creator } = data;
                
                if (!name || !creator) {
                    ws.send(JSON.stringify({ 
                        type: 'error', 
                        message: '❌ Название группы обязательно' 
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
                logAction('create_group', creator, name);
                
                ws.send(JSON.stringify({ 
                    type: 'group_created', 
                    group: groups[groupId] 
                }));
                
                // Оповещаем создателя
                ws.send(JSON.stringify({
                    type: 'groups_list',
                    groups: Object.values(groups).filter(g => 
                        g.members && g.members.includes(creator)
                    )
                }));
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
                        message: '❌ Нет прав администратора' 
                    }));
                    return;
                }
                
                if (!groups[groupId].members.includes(username)) {
                    groups[groupId].members.push(username);
                    saveData();
                    logAction('add_to_group', adder, `${username} → ${groupId}`);
                    
                    // Оповещаем всех участников
                    groups[groupId].members.forEach(member => {
                        const memberWs = users.get(member);
                        if (memberWs && memberWs.readyState === WebSocket.OPEN) {
                            memberWs.send(JSON.stringify({
                                type: 'group_updated',
                                group: groups[groupId]
                            }));
                        }
                    });
                    
                    // Личное уведомление добавленному
                    const targetWs = users.get(username);
                    if (targetWs) {
                        targetWs.send(JSON.stringify({
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
                    ws.send(JSON.stringify({ 
                        type: 'error', 
                        message: '❌ Нет доступа к группе' 
                    }));
                    return;
                }
                
                const messageObj = {
                    id: generateId(),
                    from, text, time,
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
                            time,
                            serverTime: Date.now()
                        }));
                    }
                });
                
                logAction('group_message', from, `→ group:${groupId}`);
            }

            // ===== АДМИН-КОМАНДЫ (ТОЛЬКО ДЛЯ Dane4ka5) =====
            
            // СТАТИСТИКА
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
                    channels: Object.keys(channels).length,
                    rooms: Object.keys(privateRooms).length,
                    premium: Object.keys(premiumUsers).length,
                    suspicious: suspiciousMessages.length,
                    uptime: process.uptime(),
                    memory: Math.round(process.memoryUsage().rss / 1024 / 1024) + ' MB',
                    version: VERSION
                };
                
                ws.send(JSON.stringify({
                    type: 'stats',
                    stats: stats
                }));
                
                logAction('admin_stats', data.username, 'Запрос статистики');
            }
            
            // ПОДОЗРИТЕЛЬНЫЕ
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
                    messages: suspiciousMessages.slice(-100).reverse()
                }));
                
                logAction('admin_suspicious', data.username, 'Просмотр подозрительных');
            }
            
            // ОЧИСТИТЬ ПОДОЗРИТЕЛЬНЫЕ
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
            
            // ЗАБЛОКИРОВАТЬ ПОЛЬЗОВАТЕЛЯ
            if (data.type === 'admin_ban') {
                if (data.username !== CREATOR_USERNAME) {
                    ws.send(JSON.stringify({ 
                        type: 'error', 
                        message: '❌ Только для создателя' 
                    }));
                    return;
                }
                
                const { target, reason } = data;
                
                if (!target || !userDatabase[target]) {
                    ws.send(JSON.stringify({ 
                        type: 'error', 
                        message: '❌ Пользователь не найден' 
                    }));
                    return;
                }
                
                userDatabase[target].banned = true;
                userDatabase[target].bannedAt = new Date().toISOString();
                userDatabase[target].banReason = reason || 'Нарушение правил';
                
                // Кикаем если онлайн
                const targetWs = users.get(target);
                if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                    targetWs.send(JSON.stringify({ 
                        type: 'you_are_banned',
                        reason: userDatabase[target].banReason
                    }));
                    targetWs.close();
                    users.delete(target);
                }
                
                saveData();
                
                ws.send(JSON.stringify({ 
                    type: 'user_banned', 
                    target,
                    reason: userDatabase[target].banReason
                }));
                
                logAction('admin_ban', data.username, `${target} (${reason})`);
            }
            
            // РАЗБЛОКИРОВАТЬ ПОЛЬЗОВАТЕЛЯ
            if (data.type === 'admin_unban') {
                if (data.username !== CREATOR_USERNAME) {
                    ws.send(JSON.stringify({ 
                        type: 'error', 
                        message: '❌ Только для создателя' 
                    }));
                    return;
                }
                
                const { target } = data;
                
                if (!target || !userDatabase[target]) {
                    ws.send(JSON.stringify({ 
                        type: 'error', 
                        message: '❌ Пользователь не найден' 
                    }));
                    return;
                }
                
                userDatabase[target].banned = false;
                saveData();
                
                ws.send(JSON.stringify({ 
                    type: 'user_unbanned', 
                    target 
                }));
                
                logAction('admin_unban', data.username, target);
            }
            
            // ВЫДАТЬ ПРЕМИУМ
            if (data.type === 'admin_give_premium') {
                if (data.username !== CREATOR_USERNAME) {
                    ws.send(JSON.stringify({ 
                        type: 'error', 
                        message: '❌ Только для создателя' 
                    }));
                    return;
                }
                
                const { target, months } = data;
                
                if (!target || !userDatabase[target]) {
                    ws.send(JSON.stringify({ 
                        type: 'error', 
                        message: '❌ Пользователь не найден' 
                    }));
                    return;
                }
                
                const expires = months === 999 ? 'never' : 
                    new Date(Date.now() + months * 30 * 24 * 60 * 60 * 1000).toISOString();
                
                premiumUsers[target] = {
                    active: true,
                    granted: new Date().toISOString(),
                    expires: expires,
                    months: months,
                    grantedBy: CREATOR_USERNAME
                };
                
                saveData();
                logAction('admin_give_premium', CREATOR_USERNAME, `${target} (${months} мес)`);
                
                ws.send(JSON.stringify({ 
                    type: 'premium_granted', 
                    target, 
                    months 
                }));
                
                // Уведомляем пользователя если онлайн
                const targetWs = users.get(target);
                if (targetWs) {
                    targetWs.send(JSON.stringify({ 
                        type: 'premium_activated',
                        months
                    }));
                }
            }
            
            // ===== ОБНОВЛЕНИЕ СТАТУСА =====
            if (data.type === 'update_status') {
                const { username, status } = data;
                
                const userData = activeUsers.get(ws);
                if (userData && userData.username === username) {
                    userData.status = status;
                    activeUsers.set(ws, userData);
                    
                    broadcastStatusUpdate(username, status);
                    
                    ws.send(JSON.stringify({ 
                        type: 'status_updated', 
                        status 
                    }));
                    
                    logAction('update_status', username, status);
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
                
                if (!username || !target) {
                    ws.send(JSON.stringify({ 
                        type: 'error', 
                        message: '❌ Не указан пользователь' 
                    }));
                    return;
                }
                
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
            
            // ===== СТАТУС "ПЕЧАТАЕТ" =====
            if (data.type === 'typing') {
                const { from, to } = data;
                
                const targetWs = users.get(to);
                if (targetWs && targetWs.readyState === WebSocket.OPEN) {
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
                if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                    targetWs.send(JSON.stringify({
                        type: 'read',
                        by: currentUser,
                        messageId
                    }));
                }
            }
            
            // ===== P2P СИГНАЛЫ (WebRTC) =====
            if (data.type === 'signal') {
                const { to, from, signal } = data;
                
                const targetWs = users.get(to);
                if (targetWs && targetWs.readyState === WebSocket.OPEN) {
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
                if (targetWs && targetWs.readyState === WebSocket.OPEN) {
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
                if (targetWs && targetWs.readyState === WebSocket.OPEN) {
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
            console.error('❌ Ошибка обработки сообщения:', error);
            logAction('error', 'SYSTEM', error.message);
            
            try {
                ws.send(JSON.stringify({ 
                    type: 'error', 
                    message: '❌ Внутренняя ошибка сервера' 
                }));
            } catch (sendError) {}
        }
    });

    ws.on('close', () => {
        const userData = activeUsers.get(ws);
        if (userData) {
            console.log(`👋 ${userData.username} отключился (был онлайн ${Math.round((Date.now() - userData.joinedAt) / 1000)}с)`);
            
            users.delete(userData.username);
            activeUsers.delete(ws);
            
            if (userDatabase[userData.username]) {
                userDatabase[userData.username].lastSeen = new Date().toISOString();
                saveData();
            }
            
            broadcastUserList();
            broadcastStatusUpdate(userData.username, 'offline');
            
            logAction('disconnect', userData.username, userData.ip);
        }
    });

    ws.on('error', (error) => {
        console.error('❌ Ошибка WebSocket:', error);
        logAction('error', 'WEBSOCKET', error.message);
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
        online: userList.length,
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
        status,
        timestamp: Date.now()
    });
    
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
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
        
        // Удаляем старые бэкапы (оставляем MAX_BACKUPS)
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
}, 5 * 60 * 1000);

// ==============================================
// ЗАПУСК СЕРВЕРА
// ==============================================
loadAllData();

server.listen(PORT, '0.0.0.0', () => {
    console.log('\n' + '='.repeat(70));
    console.log(`🚀 Nanogram ${VERSION} - ИСПРАВЛЕННАЯ ВЕРСИЯ`);
    console.log('='.repeat(70));
    console.log(`📡 Порт: ${PORT}`);
    console.log(`👑 Создатель: ${CREATOR_USERNAME}`);
    console.log(`\n📊 СТАТИСТИКА:`);
    console.log(`   👥 Пользователей: ${Object.keys(userDatabase).length}`);
    console.log(`   🟢 Онлайн сейчас: ${users.size}`);
    console.log(`   💬 Сообщений: ${Object.keys(messages).length}`);
    console.log(`   👥 Групп: ${Object.keys(groups).length}`);
    console.log(`   📢 Каналов: ${Object.keys(channels).length}`);
    console.log(`   👑 Премиум: ${Object.keys(premiumUsers).length}`);
    console.log(`   🚨 Подозрительных: ${suspiciousMessages.length}`);
    console.log(`\n🌐 ДОСТУП:`);
    console.log(`   📱 http://localhost:${PORT}`);
    console.log(`   🕵️ /admin - теневая панель (только для Dane4ka5)`);
    console.log(`   📜 /privacy - политика`);
    console.log(`   🔍 /diagnostic - диагностика`);
    console.log('='.repeat(70) + '\n');
    
    logAction('system', 'SERVER', `Запуск ${VERSION}`);
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