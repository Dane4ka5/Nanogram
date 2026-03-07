const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ==============================================
// КОНФИГУРАЦИЯ
// ==============================================
const PORT = process.env.PORT || 3000;
const VERSION = 'v0.9.0';
const CREATOR_USERNAME = 'Dane4ka5';
const SAVE_INTERVAL = 60 * 1000; // Каждую минуту
const MAX_MESSAGES_PER_CHAT = 1000;
const MAX_BACKUPS = 20;

// ==============================================
// ХРАНИЛИЩА ДАННЫХ
// ==============================================
const activeUsers = new Map(); // WebSocket -> username
let userDatabase = {}; // username -> { password, phone, registered, lastSeen, privacySettings }
let messages = {}; // chatKey -> [message, ...]
let groups = {}; // groupId -> { id, name, creator, admins, members, avatar, messages, created }
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
let blockedUsers = {}; // username -> [blockedUser1, blockedUser2]
let hiddenChats = {}; // username -> [chatId1, chatId2]
let privacySettings = {}; // username -> { showPhone: 'all|contacts|none', showOnline: 'all|contacts|none' }

// ==============================================
// ЗАГРУЗКА ВСЕХ ДАННЫХ
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
            
            console.log(`✅ data.json загружен:`);
            console.log(`   👥 Пользователей: ${Object.keys(userDatabase).length}`);
            console.log(`   👥 Групп: ${Object.keys(groups).length}`);
            console.log(`   📢 Каналов: ${Object.keys(channels).length}`);
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
// СОХРАНЕНИЕ
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
            hiddenChats: hiddenChats,
            privacySettings: privacySettings,
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

// ==============================================
// БЭКАПЫ
// ==============================================
function createBackup() {
    try {
        if (!fs.existsSync('./backups')) fs.mkdirSync('./backups');
        const timestamp = Date.now();
        fs.copyFileSync('./data.json', `./backups/data_${timestamp}.json`);
        fs.copyFileSync('./messages.json', `./backups/messages_${timestamp}.json`);
        console.log(`💾 Бэкап: ${timestamp}`);
    } catch (e) {}
}

// ==============================================
// ЗАГРУЗКА ПРИ СТАРТЕ
// ==============================================
loadAllData();
setInterval(saveData, SAVE_INTERVAL);
setInterval(saveMessages, SAVE_INTERVAL);
setInterval(createBackup, 60 * 60 * 1000);

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

function isBlocked(byUser, targetUser) {
    return blockedUsers[byUser] && blockedUsers[byUser].includes(targetUser);
}

function canSeePhone(viewer, target) {
    const settings = privacySettings[target] || { showPhone: 'all' };
    if (settings.showPhone === 'all') return true;
    if (settings.showPhone === 'none') return false;
    if (settings.showPhone === 'contacts') {
        // Здесь можно добавить проверку контактов
        return true;
    }
    return true;
}

function canSeeOnline(viewer, target) {
    const settings = privacySettings[target] || { showOnline: 'all' };
    if (settings.showOnline === 'all') return true;
    if (settings.showOnline === 'none') return false;
    if (settings.showOnline === 'contacts') return true;
    return true;
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
                groups: Object.keys(groups).length,
                messages: Object.keys(messages).length,
                blocked: Object.keys(blockedUsers).length
            }
        };
        res.end(JSON.stringify(diagnostic, null, 2));
        return;
    }
    
    // ===== ПОЛИТИКА =====
    if (req.url === '/privacy') {
        res.end(`<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Политика Nanogram</title>
<style>body{background:#0d1117;color:#f0f6fc;padding:20px;}</style></head>
<body>
    <h1>📜 Политика Nanogram v${VERSION}</h1>
    <p>• Приватность: вы сами решаете, кто видит ваш номер и онлайн</p>
    <p>• Блокировки: вы можете заблокировать любого пользователя</p>
    <p>• Скрытые чаты: пароль на важные переписки</p>
    <p>• Группы: до 100 человек</p>
</body>
</html>`);
        return;
    }
        // ===== ТЕНЕВАЯ ПАНЕЛЬ (УЛУЧШЕННАЯ) =====
    if (req.url.includes('admin')) {
        
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
            
            // Бан пользователя
            if (req.url.includes('action=ban_user')) {
                const urlParams = new URL(req.url, `http://${req.headers.host}`).searchParams;
                const username = urlParams.get('username');
                
                if (username && data.users && data.users[username]) {
                    data.users[username].banned = true;
                    data.users[username].bannedAt = new Date().toISOString();
                    fs.writeFileSync('./data.json', JSON.stringify(data, null, 2), 'utf8');
                    logAction('ban_user', 'Dane4ka5', username);
                }
            }
            
            // Разбан пользователя
            if (req.url.includes('action=unban_user')) {
                const urlParams = new URL(req.url, `http://${req.headers.host}`).searchParams;
                const username = urlParams.get('username');
                
                if (username && data.users && data.users[username]) {
                    data.users[username].banned = false;
                    fs.writeFileSync('./data.json', JSON.stringify(data, null, 2), 'utf8');
                    logAction('unban_user', 'Dane4ka5', username);
                }
            }
            
            // Удаление группы
            if (req.url.includes('action=delete_group')) {
                const urlParams = new URL(req.url, `http://${req.headers.host}`).searchParams;
                const groupId = urlParams.get('groupId');
                
                if (groupId && data.groups && data.groups[groupId]) {
                    delete data.groups[groupId];
                    fs.writeFileSync('./data.json', JSON.stringify(data, null, 2), 'utf8');
                    logAction('delete_group', 'Dane4ka5', groupId);
                }
            }
            
            res.writeHead(302, { Location: redirectUrl });
            res.end();
            return;
        }
        
        // ===== СТАТИСТИКА =====
        const usersCount = Object.keys(data.users || {}).length;
        const groupsCount = Object.keys(data.groups || {}).length;
        const channelsCount = Object.keys(data.channels || {}).length;
        const premiumCount = Object.keys(data.premiumUsers || {}).length;
        const bannedCount = Object.values(data.users || {}).filter(u => u.banned).length;
        
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
        h1 { color: #ffd700; font-size: 32px; margin-bottom: 10px; }
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
        input, textarea, select {
            width: 100%;
            padding: 12px;
            margin: 10px 0;
            background: #0a0c10;
            border: 1px solid #30363d;
            color: white;
            border-radius: 6px;
        }
        button {
            background: #9f8be5;
            color: white;
            border: none;
            padding: 12px 25px;
            border-radius: 6px;
            cursor: pointer;
            margin-right: 10px;
        }
        button:hover { background: #b09cff; }
        button.danger { background: #da3633; }
        table {
            width: 100%;
            border-collapse: collapse;
            background: #0a0c10;
            border-radius: 6px;
        }
        th { background: #21262d; padding: 12px; text-align: left; color: #9f8be5; }
        td { padding: 12px; border-bottom: 1px solid #30363d; color: white; }
        .banned { background: rgba(218, 54, 51, 0.2); }
        .tabs {
            display: flex;
            gap: 10px;
            margin: 20px 0;
            flex-wrap: wrap;
        }
        .tab {
            padding: 10px 20px;
            background: #21262d;
            border: 1px solid #30363d;
            border-radius: 30px;
            cursor: pointer;
            color: #b0b3b8;
        }
        .tab.active {
            background: #9f8be5;
            color: white;
            border-color: #9f8be5;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔐 ТЕНЕВАЯ ПАНЕЛЬ NANOGRAM</h1>
        
        <div class="stats-grid">
            <div class="stat-card"><div class="stat-value">${usersCount}</div><div class="stat-label">Пользователей</div></div>
            <div class="stat-card"><div class="stat-value">${totalMessages}</div><div class="stat-label">Сообщений</div></div>
            <div class="stat-card"><div class="stat-value">${groupsCount}</div><div class="stat-label">Групп</div></div>
            <div class="stat-card"><div class="stat-value">${channelsCount}</div><div class="stat-label">Каналов</div></div>
            <div class="stat-card"><div class="stat-value">${premiumCount}</div><div class="stat-label">Премиум</div></div>
            <div class="stat-card"><div class="stat-value">${bannedCount}</div><div class="stat-label">Заблокировано</div></div>
        </div>
        
        <div class="tabs">
            <span class="tab active" onclick="showSection('users')">👥 Пользователи</span>
            <span class="tab" onclick="showSection('groups')">👥 Группы</span>
            <span class="tab" onclick="showSection('privacy')">🔒 Приватность</span>
            <span class="tab" onclick="showSection('logs')">📝 Логи</span>
        </div>
        
        <script>
            function showSection(section) {
                document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                event.target.classList.add('active');
                document.querySelectorAll('.section').forEach(s => s.style.display = 'none');
                document.getElementById('section-' + section).style.display = 'block';
            }
        </script>
        
        <!-- Секция пользователей -->
        <div id="section-users" class="section" style="display: block;">
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
                    ${Object.entries(data.users || {}).map(([name, info]) => `
                        <tr class="${info.banned ? 'banned' : ''}">
                            <td><strong>${name}</strong></td>
                            <td>${info.phone || '—'}</td>
                            <td>${info.banned ? '🔴 ЗАБЛОКИРОВАН' : '🟢 Активен'}</td>
                            <td>${data.premiumUsers?.[name]?.active ? '👑' : '—'}</td>
                            <td>
                                ${info.banned ? `
                                    <form method="get" style="display:inline;">
                                        <input type="hidden" name="action" value="unban_user">
                                        <input type="hidden" name="username" value="${name}">
                                        <button type="submit" style="background: #2ea043;">✅ Разбанить</button>
                                    </form>
                                ` : `
                                    <form method="get" style="display:inline;">
                                        <input type="hidden" name="action" value="ban_user">
                                        <input type="hidden" name="username" value="${name}">
                                        <button type="submit" class="danger">🔨 Забанить</button>
                                    </form>
                                `}
                            </td>
                        </tr>
                    `).join('')}
                </table>
            </div>
        </div>
        
        <!-- Секция групп -->
        <div id="section-groups" class="section" style="display: none;">
            <div class="panel">
                <h2>👥 УПРАВЛЕНИЕ ГРУППАМИ</h2>
                <table>
                    <tr>
                        <th>Название</th>
                        <th>Создатель</th>
                        <th>Участники</th>
                        <th>Сообщений</th>
                        <th>Действия</th>
                    </tr>
                    ${Object.entries(data.groups || {}).map(([id, group]) => `
                        <tr>
                            <td><strong>${group.name}</strong></td>
                            <td>${group.creator}</td>
                            <td>${group.members?.length || 0}</td>
                            <td>${group.messages?.length || 0}</td>
                            <td>
                                <form method="get" style="display:inline;">
                                    <input type="hidden" name="action" value="delete_group">
                                    <input type="hidden" name="groupId" value="${id}">
                                    <button type="submit" class="danger">🗑️ Удалить</button>
                                </form>
                            </td>
                        </tr>
                    `).join('')}
                </table>
            </div>
        </div>
        
        <!-- Секция приватности -->
        <div id="section-privacy" class="section" style="display: none;">
            <div class="panel">
                <h2>🔒 НАСТРОЙКИ ПРИВАТНОСТИ</h2>
                <p>Управление тем, кто что видит - в интерфейсе пользователя</p>
                <table>
                    <tr>
                        <th>Пользователь</th>
                        <th>Кто видит номер</th>
                        <th>Кто видит онлайн</th>
                    </tr>
                    ${Object.entries(data.privacySettings || {}).map(([name, settings]) => `
                        <tr>
                            <td>${name}</td>
                            <td>${settings.showPhone || 'all'}</td>
                            <td>${settings.showOnline || 'all'}</td>
                        </tr>
                    `).join('')}
                </table>
            </div>
        </div>
        
        <!-- Секция логов -->
        <div id="section-logs" class="section" style="display: none;">
            <div class="panel">
                <h2>📝 ПОСЛЕДНИЕ ЛОГИ</h2>
                <div style="background: #0a0c10; padding: 15px; border-radius: 8px; font-family: monospace; max-height: 500px; overflow-y: auto;">
                    ${(() => {
                        try {
                            const logs = fs.readFileSync('./users.log', 'utf8').split('\n').slice(-50).reverse();
                            return logs.map(log => `<div style="color: #b0b3b8; border-bottom: 1px solid #30363d; padding: 5px;">${log}</div>`).join('');
                        } catch (e) {
                            return '<p>Нет логов</p>';
                        }
                    })()}
                </div>
            </div>
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
            res.end('<h1>404</h1>');
        } else {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(content);
        }
    });
});
// ==============================================
// WEBSOCKET СЕРВЕР
// ==============================================
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    console.log(`🔌 Новое WebSocket подключение`);
    
    ws.send(JSON.stringify({
        type: 'connection_established',
        timestamp: Date.now(),
        version: VERSION
    }));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString('utf8'));
            
            if (data.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
                return;
            }

            console.log(`📩 Получен тип: ${data.type}`);

            // ===== РЕГИСТРАЦИЯ =====
            if (data.type === 'register') {
                const { username, password, phone } = data;
                
                if (!username || !password || !phone) {
                    ws.send(JSON.stringify({ type: 'error', message: '❌ Все поля обязательны' }));
                    return;
                }
                
                // Проверка на баны
                if (userDatabase[username]?.banned) {
                    ws.send(JSON.stringify({ type: 'error', message: '❌ Вы заблокированы' }));
                    return;
                }
                
                if (userDatabase[username]) {
                    if (userDatabase[username].password !== password) {
                        ws.send(JSON.stringify({ type: 'error', message: '❌ Неверный пароль' }));
                        return;
                    }
                    
                    console.log(`👋 Вход: ${username}`);
                    userDatabase[username].lastSeen = new Date().toISOString();
                    saveData();
                    
                    ws.send(JSON.stringify({
                        type: 'login_success',
                        username: username,
                        profile: userProfiles[username] || { avatar: '👤', bio: '' },
                        premium: isPremium(username),
                        privacy: privacySettings[username] || { showPhone: 'all', showOnline: 'all' },
                        blocked: blockedUsers[username] || []
                    }));
                    
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
                        ws.send(JSON.stringify({ type: 'error', message: '❌ Телефон уже используется' }));
                        return;
                    }
                    
                    console.log(`👤 Новый: ${username}`);
                    
                    userDatabase[username] = {
                        username, password, phone,
                        registered: new Date().toISOString(),
                        lastSeen: new Date().toISOString(),
                        banned: false
                    };
                    
                    userProfiles[username] = { avatar: '👤', bio: '' };
                    privacySettings[username] = { showPhone: 'all', showOnline: 'all' };
                    blockedUsers[username] = [];
                    hiddenChats[username] = [];
                    
                    saveData();
                    
                    ws.send(JSON.stringify({
                        type: 'register_success',
                        username,
                        profile: userProfiles[username],
                        premium: false,
                        privacy: privacySettings[username],
                        blocked: []
                    }));
                }
                
                activeUsers.set(ws, username);
                
                // Отправляем данные
                ws.send(JSON.stringify({ type: 'history', history: messages }));
                ws.send(JSON.stringify({ type: 'channels_list', channels: Object.values(channels) }));
                ws.send(JSON.stringify({ 
                    type: 'groups_list', 
                    groups: Object.values(groups).filter(g => g.members.includes(username))
                }));
                
                broadcastUserList();
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
                broadcastToAll({ type: 'new_group', group: groups[groupId] });
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
                    
                    ws.send(JSON.stringify({ type: 'group_updated', group: groups[groupId] }));
                    broadcastToGroup(groupId, { type: 'user_added', groupId, username });
                }
            }

            // ===== СООБЩЕНИЕ В ГРУППЕ =====
            if (data.type === 'group_message') {
                const { groupId, from, text, time } = data;
                
                if (!groups[groupId] || !groups[groupId].members.includes(from)) {
                    ws.send(JSON.stringify({ type: 'error', message: '❌ Нет доступа' }));
                    return;
                }
                
                if (!groups[groupId].messages) groups[groupId].messages = [];
                
                const messageObj = {
                    id: generateId(),
                    from: from,
                    text: text,
                    time: time,
                    timestamp: Date.now()
                };
                
                groups[groupId].messages.push(messageObj);
                saveData();
                
                broadcastToGroup(groupId, {
                    type: 'group_message',
                    id: messageObj.id,
                    groupId,
                    from,
                    text,
                    time
                });
                
                logAction('group_message', from, `В группу ${groupId}`);
            }
                        // ===== НАСТРОЙКИ ПРИВАТНОСТИ =====
            if (data.type === 'update_privacy') {
                const { username, settings } = data;
                
                if (!privacySettings[username]) privacySettings[username] = {};
                privacySettings[username] = { ...privacySettings[username], ...settings };
                saveData();
                logAction('update_privacy', username, JSON.stringify(settings));
                
                ws.send(JSON.stringify({ type: 'privacy_updated', settings: privacySettings[username] }));
            }

            // ===== БЛОКИРОВКА ПОЛЬЗОВАТЕЛЯ =====
            if (data.type === 'block_user') {
                const { username, target } = data;
                
                if (!blockedUsers[username]) blockedUsers[username] = [];
                if (!blockedUsers[username].includes(target)) {
                    blockedUsers[username].push(target);
                    saveData();
                    logAction('block_user', username, target);
                    
                    ws.send(JSON.stringify({ 
                        type: 'blocked_list', 
                        blocked: blockedUsers[username] 
                    }));
                }
            }

            // ===== РАЗБЛОКИРОВКА =====
            if (data.type === 'unblock_user') {
                const { username, target } = data;
                
                if (blockedUsers[username]) {
                    blockedUsers[username] = blockedUsers[username].filter(b => b !== target);
                    saveData();
                    logAction('unblock_user', username, target);
                    
                    ws.send(JSON.stringify({ 
                        type: 'blocked_list', 
                        blocked: blockedUsers[username] 
                    }));
                }
            }

            // ===== СКРЫТЫЙ ЧАТ =====
            if (data.type === 'hide_chat') {
                const { username, chatId, password } = data;
                
                if (!hiddenChats[username]) hiddenChats[username] = [];
                
                // Сохраняем пароль в зашифрованном виде
                const chatData = {
                    id: chatId,
                    password: crypto.createHash('sha256').update(password).digest('hex')
                };
                
                hiddenChats[username].push(chatData);
                saveData();
                logAction('hide_chat', username, chatId);
                
                ws.send(JSON.stringify({ type: 'chat_hidden', chatId }));
            }

            // ===== ОТПРАВКА ФАЙЛА =====
            if (data.type === 'send_file') {
                const { from, to, fileName, fileData, fileType, time } = data;
                
                // Сохраняем файл на сервере
                const fileId = generateId();
                const filePath = `./uploads/${fileId}_${fileName}`;
                
                if (!fs.existsSync('./uploads')) fs.mkdirSync('./uploads');
                
                const buffer = Buffer.from(fileData, 'base64');
                fs.writeFileSync(filePath, buffer);
                
                const chatKey = [from, to].sort().join('_');
                if (!messages[chatKey]) messages[chatKey] = [];
                
                messages[chatKey].push({
                    id: fileId,
                    type: 'file',
                    from,
                    to,
                    fileName,
                    filePath,
                    fileSize: buffer.length,
                    time,
                    timestamp: Date.now()
                });
                
                saveMessages();
                
                // Отправляем получателю
                wss.clients.forEach(client => {
                    const username = activeUsers.get(client);
                    if (username === to) {
                        client.send(JSON.stringify({
                            type: 'file',
                            id: fileId,
                            from,
                            fileName,
                            fileSize: buffer.length,
                            time
                        }));
                    }
                });
                
                ws.send(JSON.stringify({ type: 'file_sent', fileId }));
            }

            // ===== ГОЛОСОВОЕ СООБЩЕНИЕ =====
            if (data.type === 'voice_message') {
                const { from, to, audioData, duration, time } = data;
                
                const voiceId = generateId();
                const voicePath = `./uploads/voice_${voiceId}.ogg`;
                
                if (!fs.existsSync('./uploads')) fs.mkdirSync('./uploads');
                
                const buffer = Buffer.from(audioData, 'base64');
                fs.writeFileSync(voicePath, buffer);
                
                const chatKey = [from, to].sort().join('_');
                if (!messages[chatKey]) messages[chatKey] = [];
                
                messages[chatKey].push({
                    id: voiceId,
                    type: 'voice',
                    from,
                    to,
                    duration,
                    voicePath,
                    time,
                    timestamp: Date.now()
                });
                
                saveMessages();
                
                wss.clients.forEach(client => {
                    const username = activeUsers.get(client);
                    if (username === to) {
                        client.send(JSON.stringify({
                            type: 'voice',
                            id: voiceId,
                            from,
                            duration,
                            time
                        }));
                    }
                });
            }

            // ===== ИНТЕГРАЦИЯ С YOUTUBE =====
            if (data.type === 'share_youtube') {
                const { from, to, videoId, title, time } = data;
                
                const chatKey = [from, to].sort().join('_');
                if (!messages[chatKey]) messages[chatKey] = [];
                
                messages[chatKey].push({
                    id: generateId(),
                    type: 'youtube',
                    from,
                    to,
                    videoId,
                    title,
                    time,
                    timestamp: Date.now()
                });
                
                saveMessages();
                
                wss.clients.forEach(client => {
                    const username = activeUsers.get(client);
                    if (username === to) {
                        client.send(JSON.stringify({
                            type: 'youtube',
                            from,
                            videoId,
                            title,
                            time
                        }));
                    }
                });
            }

            // ===== СТАТУС "ПЕЧАТАЕТ" =====
            if (data.type === 'typing') {
                const { from, to } = data;
                
                wss.clients.forEach(client => {
                    const username = activeUsers.get(client);
                    if (username === to && !isBlocked(to, from)) {
                        client.send(JSON.stringify({ type: 'typing', from }));
                    }
                });
            }

            // ===== ПРОСМОТРЕНО =====
            if (data.type === 'read') {
                const { username, messageId, from } = data;
                
                wss.clients.forEach(client => {
                    const user = activeUsers.get(client);
                    if (user === from) {
                        client.send(JSON.stringify({ type: 'read', messageId, by: username }));
                    }
                });
            }
                        // ===== ЛИЧНОЕ СООБЩЕНИЕ =====
            if (data.type === 'message') {
                const { from, to, text, time } = data;
                
                if (isBlocked(to, from)) {
                    ws.send(JSON.stringify({ type: 'error', message: '❌ Вы заблокированы' }));
                    return;
                }
                
                const chatKey = [from, to].sort().join('_');
                if (!messages[chatKey]) messages[chatKey] = [];
                
                const messageObj = {
                    id: generateId(),
                    from,
                    to,
                    text,
                    time,
                    timestamp: Date.now(),
                    read: false
                };
                
                messages[chatKey].push(messageObj);
                
                if (messages[chatKey].length > MAX_MESSAGES_PER_CHAT) {
                    messages[chatKey] = messages[chatKey].slice(-MAX_MESSAGES_PER_CHAT);
                }
                
                saveMessages();
                logAction('message', from, `→ ${to}`);
                
                let delivered = false;
                wss.clients.forEach(client => {
                    const username = activeUsers.get(client);
                    if (username === to) {
                        client.send(JSON.stringify({
                            type: 'message',
                            id: messageObj.id,
                            from,
                            text,
                            time
                        }));
                        delivered = true;
                    }
                });
                
                ws.send(JSON.stringify({
                    type: 'message_delivered',
                    messageId: messageObj.id,
                    to,
                    delivered
                }));
            }
            
        } catch (e) {
            console.error('❌ Ошибка:', e);
            logAction('error', 'SYSTEM', e.message);
            ws.send(JSON.stringify({ type: 'error', message: 'Ошибка сервера' }));
        }
    });

    ws.on('close', () => {
        const username = activeUsers.get(ws);
        if (username) {
            console.log(`👋 ${username} отключился`);
            activeUsers.delete(ws);
            broadcastUserList();
        }
    });
});

// ==============================================
// ФУНКЦИИ РАССЫЛКИ
// ==============================================
function broadcastToAll(message) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
        }
    });
}

function broadcastUserList() {
    const userList = Array.from(activeUsers.values()).filter(u => {
        // Показываем только тех, кто не в бане и не скрыт
        return !userDatabase[u]?.banned;
    });
    
    broadcastToAll({ type: 'user_list', users: userList });
}

function broadcastToGroup(groupId, message) {
    const group = groups[groupId];
    if (!group) return;
    
    wss.clients.forEach(client => {
        const username = activeUsers.get(client);
        if (username && group.members.includes(username)) {
            client.send(JSON.stringify(message));
        }
    });
}

// ==============================================
// ОЧИСТКА
// ==============================================
setInterval(() => {
    let removed = 0;
    wss.clients.forEach(ws => {
        if (!activeUsers.has(ws) && ws.readyState !== WebSocket.OPEN) {
            removed++;
        }
    });
    if (removed > 0) console.log(`🧹 Очищено ${removed}`);
}, 30000);

// ==============================================
// ЗАПУСК
// ==============================================
server.listen(PORT, '0.0.0.0', () => {
    console.log('\n' + '='.repeat(70));
    console.log(`🚀 Nanogram ${VERSION} - МЕГА-ОБНОВЛЕНИЕ`);
    console.log('='.repeat(70));
    console.log(`📡 Порт: ${PORT}`);
    console.log(`\n📊 СТАТИСТИКА:`);
    console.log(`   👥 Пользователей: ${Object.keys(userDatabase).length}`);
    console.log(`   👥 Групп: ${Object.keys(groups).length}`);
    console.log(`   💬 Сообщений: ${Object.values(messages).reduce((a, c) => a + c.length, 0)}`);
    console.log(`   🔒 Заблокировано: ${Object.keys(blockedUsers).length}`);
    console.log(`\n🌐 ДОСТУП:`);
    console.log(`   📱 http://localhost:${PORT}`);
    console.log(`   🕵️ /admin - теневая панель`);
    console.log('='.repeat(70) + '\n');
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