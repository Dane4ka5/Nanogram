const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ==============================================
// КОНФИГУРАЦИЯ
// ==============================================
const PORT = process.env.PORT || 3000;
const VERSION = 'v0.9.1';
const CREATOR_USERNAME = 'Dane4ka5';
const SAVE_INTERVAL = 60 * 1000; // Каждую минуту
const MAX_MESSAGES_PER_CHAT = 1000;
const MAX_BACKUPS = 20;

// ==============================================
// ХРАНИЛИЩА ДАННЫХ
// ==============================================
const activeUsers = new Map(); // WebSocket -> { username, lastSeen, status, ip }
let userDatabase = {}; // username -> { password, phone, registered, lastSeen, privacySettings, settings }
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
let blockedUsers = {};
let hiddenChats = {};
let privacySettings = {};
let userStatuses = {}; // username -> { online: true, lastSeen: timestamp, status: 'online|away|busy' }

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
            userStatuses = data.userStatuses || {};
            
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
            userStatuses: userStatuses,
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

function canSeeStatus(viewer, target) {
    const settings = privacySettings[target] || { showOnline: 'all' };
    if (settings.showOnline === 'all') return true;
    if (settings.showOnline === 'none') return false;
    if (settings.showOnline === 'contacts') return true;
    return true;
}

function getUserStatus(username) {
    const userData = activeUsers.get(username);
    if (userData) {
        return { online: true, status: userData.status || 'online', lastSeen: Date.now() };
    }
    return { online: false, lastSeen: userDatabase[username]?.lastSeen || null };
}
// ==============================================
// HTTP СЕРВЕР
// ==============================================
const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    
    // ===== ДИАГНОСТИКА =====
    if (req.url === '/diagnostic') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        const onlineCount = Array.from(activeUsers.values()).length;
        const diagnostic = {
            server: 'ONLINE',
            version: VERSION,
            stats: {
                users: Object.keys(userDatabase).length,
                online: onlineCount,
                groups: Object.keys(groups).length,
                messages: Object.keys(messages).length,
                blocked: Object.keys(blockedUsers).length
            }
        };
        res.end(JSON.stringify(diagnostic, null, 2));
        return;
    }
    
    // ===== ВСТРОЕННАЯ ПОЛИТИКА (JSON для API) =====
    if (req.url === '/api/privacy') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        const privacyData = {
            version: VERSION,
            lastUpdated: new Date().toISOString(),
            rules: [
                {
                    title: "Какие данные собираем",
                    items: [
                        "Имя пользователя (никнейм)",
                        "Номер телефона (только для входа)",
                        "Сообщения (в зашифрованном виде AES-256-GCM)",
                        "История действий (логи)"
                    ]
                },
                {
                    title: "Премиум за донаты",
                    items: [
                        "30₽ - 1 месяц",
                        "85₽ - 3 месяца",
                        "145₽ - 6 месяцев",
                        "285₽ - 1 год"
                    ]
                },
                {
                    title: "Бесплатный премиум за баги",
                    items: [
                        "🐛 Незначительный баг - 1 месяц",
                        "🐞 Средний баг - 3 месяца",
                        "🦠 Критический баг - 6 месяцев",
                        "💎 Уникальная находка - 1 год"
                    ]
                }
            ],
            contact: "nanogram.ru@yandex.ru"
        };
        res.end(JSON.stringify(privacyData, null, 2));
        return;
    }
    
    // ===== ПОЛИТИКА (HTML) =====
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
        h1 { color: #9f8be5; font-size: 32px; margin-bottom: 20px; }
        h2 { color: #ffd700; margin-top: 30px; font-size: 24px; }
        p { color: #b0b3b8; margin: 15px 0; }
        .price {
            background: #21262d;
            padding: 15px;
            border-radius: 10px;
            margin: 10px 0;
            border-left: 4px solid #9f8be5;
        }
        .footer {
            margin-top: 40px;
            text-align: center;
            color: #8b949e;
            font-size: 14px;
        }
        a { color: #9f8be5; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <div class="container">
        <h1>📜 Политика конфиденциальности Nanogram</h1>
        
        <h2>1. Какие данные мы собираем</h2>
        <p>• Имя пользователя (никнейм)</p>
        <p>• Номер телефона (только для входа)</p>
        <p>• Сообщения (в зашифрованном виде AES-256-GCM)</p>
        <p>• История действий (логи для технической поддержки)</p>
        
        <h2>2. Премиум за донаты</h2>
        <div class="price">30 рублей - 1 месяц</div>
        <div class="price">85 рублей - 3 месяца</div>
        <div class="price">145 рублей - 6 месяцев</div>
        <div class="price">285 рублей - 1 год</div>
        
        <h2>3. Бесплатный премиум за баги</h2>
        <p>🐛 Незначительный баг (опечатка, мелкий глюк) — 1 месяц</p>
        <p>🐞 Средний баг (не работает функция) — 3 месяца</p>
        <p>🦠 Критический баг (проблемы с безопасностью) — 6 месяцев</p>
        <p>💎 Уникальная находка (дыра в безопасности) — 1 год + имя в списке</p>
        
        <h2>4. Контакты</h2>
        <p>📧 <a href="mailto:nanogram.ru@yandex.ru">nanogram.ru@yandex.ru</a></p>
        
        <div class="footer">
            <p>Версия ${VERSION} | Последнее обновление: ${new Date().toLocaleDateString()}</p>
            <p><a href="/">← Вернуться</a></p>
        </div>
    </div>
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
        const onlineCount = activeUsers.size;
        
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
        .online-badge { color: #2ea043; font-weight: bold; }
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
            <div class="stat-card"><div class="stat-value">${onlineCount}</div><div class="stat-label"><span class="online-badge">● Онлайн</span></div></div>
            <div class="stat-card"><div class="stat-value">${totalMessages}</div><div class="stat-label">Сообщений</div></div>
            <div class="stat-card"><div class="stat-value">${groupsCount}</div><div class="stat-label">Групп</div></div>
            <div class="stat-card"><div class="stat-value">${premiumCount}</div><div class="stat-label">Премиум</div></div>
            <div class="stat-card"><div class="stat-value">${bannedCount}</div><div class="stat-label">Заблокировано</div></div>
        </div>
        
        <div class="tabs">
            <span class="tab active" onclick="showSection('users')">👥 Пользователи</span>
            <span class="tab" onclick="showSection('groups')">👥 Группы</span>
            <span class="tab" onclick="showSection('privacy')">🔒 Политика</span>
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
                        <th>Статус</th>
                        <th>Премиум</th>
                        <th>Действия</th>
                    </tr>
                    ${Object.entries(data.users || {}).map(([name, info]) => `
                        <tr class="${info.banned ? 'banned' : ''}">
                            <td><strong>${name}</strong></td>
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
        
        <!-- Секция групп (аналогично) -->
        <div id="section-groups" class="section" style="display: none;">
            <div class="panel">
                <h2>👥 УПРАВЛЕНИЕ ГРУППАМИ</h2>
                <table>
                    <tr>
                        <th>Название</th>
                        <th>Создатель</th>
                        <th>Участники</th>
                        <th>Действия</th>
                    </tr>
                    ${Object.entries(data.groups || {}).map(([id, group]) => `
                        <tr>
                            <td><strong>${group.name}</strong></td>
                            <td>${group.creator}</td>
                            <td>${group.members?.length || 0}</td>
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
        
        <!-- Секция политики -->
        <div id="section-privacy" class="section" style="display: none;">
            <div class="panel">
                <h2>🔒 ПОЛИТИКА КОНФИДЕНЦИАЛЬНОСТИ</h2>
                <div style="background: #0a0c10; padding: 20px; border-radius: 10px;">
                    <h3 style="color: #9f8be5;">Премиум за донаты:</h3>
                    <p>• 30₽ - 1 месяц</p>
                    <p>• 85₽ - 3 месяца</p>
                    <p>• 145₽ - 6 месяцев</p>
                    <p>• 285₽ - 1 год</p>
                    
                    <h3 style="color: #9f8be5; margin-top: 20px;">Бесплатный премиум за баги:</h3>
                    <p>🐛 Мелкий баг - 1 месяц</p>
                    <p>🐞 Средний баг - 3 месяца</p>
                    <p>🦠 Критический баг - 6 месяцев</p>
                    <p>💎 Уникальный - 1 год</p>
                    
                    <h3 style="color: #9f8be5; margin-top: 20px;">Контакты:</h3>
                    <p>📧 nanogram.ru@yandex.ru</p>
                </div>
                <a href="/privacy" target="_blank" style="display: inline-block; margin-top: 20px; color: #9f8be5;">Открыть полную версию →</a>
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
            res.end('<h1>404 - Файл не найден</h1>');
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

wss.on('connection', (ws, req) => {
    const clientIp = req.socket.remoteAddress;
    console.log(`🔌 Новое WebSocket подключение с IP: ${clientIp}`);
    
    let currentUsername = null;
    
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

            console.log(`📩 Получен тип: ${data.type} от ${data.username || 'unknown'}`);

            // ===== РЕГИСТРАЦИЯ С ОНЛАЙН СТАТУСОМ =====
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
                    // ВХОД
                    if (userDatabase[username].password !== password) {
                        ws.send(JSON.stringify({ type: 'error', message: '❌ Неверный пароль' }));
                        return;
                    }
                    
                    console.log(`👋 Вход: ${username}`);
                    currentUsername = username;
                    
                    // Обновляем статус онлайн
                    userDatabase[username].lastSeen = new Date().toISOString();
                    userStatuses[username] = { 
                        online: true, 
                        status: 'online',
                        lastSeen: Date.now(),
                        ip: clientIp
                    };
                    
                    activeUsers.set(ws, { username, status: 'online', lastSeen: Date.now() });
                    
                    saveData();
                    
                    ws.send(JSON.stringify({
                        type: 'login_success',
                        username: username,
                        profile: userProfiles[username] || { avatar: '👤', bio: '' },
                        premium: isPremium(username),
                        privacy: privacySettings[username] || { showOnline: 'all', showPhone: 'all' },
                        blocked: blockedUsers[username] || [],
                        status: 'online'
                    }));
                    
                    // Оповещаем всех о новом онлайн статусе
                    broadcastUserStatus(username, 'online');
                    
                } else {
                    // РЕГИСТРАЦИЯ
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
                    currentUsername = username;
                    
                    userDatabase[username] = {
                        username, password, phone,
                        registered: new Date().toISOString(),
                        lastSeen: new Date().toISOString(),
                        banned: false
                    };
                    
                    userProfiles[username] = { avatar: '👤', bio: '' };
                    privacySettings[username] = { showOnline: 'all', showPhone: 'all' };
                    blockedUsers[username] = [];
                    hiddenChats[username] = [];
                    userStatuses[username] = { 
                        online: true, 
                        status: 'online',
                        lastSeen: Date.now(),
                        ip: clientIp
                    };
                    
                    activeUsers.set(ws, { username, status: 'online', lastSeen: Date.now() });
                    
                    saveData();
                    
                    ws.send(JSON.stringify({
                        type: 'register_success',
                        username,
                        profile: userProfiles[username],
                        premium: false,
                        privacy: privacySettings[username],
                        blocked: [],
                        status: 'online'
                    }));
                    
                    broadcastUserStatus(username, 'online');
                }
                
                // Отправляем данные
                ws.send(JSON.stringify({ type: 'history', history: messages }));
                ws.send(JSON.stringify({ type: 'channels_list', channels: Object.values(channels) }));
                ws.send(JSON.stringify({ 
                    type: 'groups_list', 
                    groups: Object.values(groups).filter(g => g.members.includes(username))
                }));
                
                // Отправляем список онлайн пользователей (с учётом приватности)
                const onlineList = [];
                activeUsers.forEach((value, key) => {
                    if (value.username !== username) {
                        if (canSeeStatus(username, value.username)) {
                            onlineList.push({
                                username: value.username,
                                status: value.status
                            });
                        }
                    }
                });
                ws.send(JSON.stringify({ type: 'online_list', users: onlineList }));
                
                broadcastUserList();
            }
            
            // ===== ОБНОВЛЕНИЕ СТАТУСА =====
            if (data.type === 'update_status') {
                const { username, status } = data;
                
                if (activeUsers.has(ws) && currentUsername === username) {
                    const userData = activeUsers.get(ws);
                    userData.status = status;
                    activeUsers.set(ws, userData);
                    
                    if (userStatuses[username]) {
                        userStatuses[username].status = status;
                    }
                    
                    broadcastUserStatus(username, status);
                    
                    ws.send(JSON.stringify({ 
                        type: 'status_updated', 
                        status: status 
                    }));
                }
            }
            
            // ===== ЗАПРОС СТАТУСА ПОЛЬЗОВАТЕЛЯ =====
            if (data.type === 'get_status') {
                const { username, target } = data;
                
                if (canSeeStatus(username, target)) {
                    const status = userStatuses[target];
                    ws.send(JSON.stringify({
                        type: 'user_status',
                        username: target,
                        online: status ? status.online : false,
                        status: status ? status.status : 'offline',
                        lastSeen: userDatabase[target]?.lastSeen
                    }));
                } else {
                    ws.send(JSON.stringify({
                        type: 'user_status',
                        username: target,
                        online: false,
                        status: 'hidden'
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
                
                ws.send(JSON.stringify({ 
                    type: 'privacy_updated', 
                    settings: privacySettings[username] 
                }));
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
                
                // Отправляем получателю
                let delivered = false;
                wss.clients.forEach(client => {
                    const userData = activeUsers.get(client);
                    if (userData && userData.username === to) {
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
                        // ===== ОТПРАВКА ФАЙЛА =====
            if (data.type === 'send_file') {
                const { from, to, fileName, fileData, fileType, time } = data;
                
                if (isBlocked(to, from)) {
                    ws.send(JSON.stringify({ type: 'error', message: '❌ Вы заблокированы' }));
                    return;
                }
                
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
                logAction('send_file', from, `${fileName} → ${to}`);
                
                // Отправляем получателю
                wss.clients.forEach(client => {
                    const userData = activeUsers.get(client);
                    if (userData && userData.username === to) {
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

            // ===== ИНТЕГРАЦИЯ С YOUTUBE =====
            if (data.type === 'share_youtube') {
                const { from, to, videoId, title, time } = data;
                
                if (isBlocked(to, from)) {
                    ws.send(JSON.stringify({ type: 'error', message: '❌ Вы заблокированы' }));
                    return;
                }
                
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
                    const userData = activeUsers.get(client);
                    if (userData && userData.username === to) {
                        client.send(JSON.stringify({
                            type: 'youtube',
                            from,
                            videoId,
                            title,
                            time
                        }));
                    }
                });
                
                ws.send(JSON.stringify({ type: 'youtube_shared' }));
            }

            // ===== СТАТУС "ПЕЧАТАЕТ" =====
            if (data.type === 'typing') {
                const { from, to } = data;
                
                if (isBlocked(to, from)) return;
                
                wss.clients.forEach(client => {
                    const userData = activeUsers.get(client);
                    if (userData && userData.username === to) {
                        client.send(JSON.stringify({ 
                            type: 'typing', 
                            from,
                            status: 'typing' 
                        }));
                    }
                });
            }

            // ===== ПРОСМОТРЕНО =====
            if (data.type === 'read') {
                const { username, messageId, from } = data;
                
                wss.clients.forEach(client => {
                    const userData = activeUsers.get(client);
                    if (userData && userData.username === from) {
                        client.send(JSON.stringify({ 
                            type: 'read', 
                            messageId, 
                            by: username 
                        }));
                    }
                });
            }

            // ===== ПОЛУЧИТЬ ПОЛИТИКУ =====
            if (data.type === 'get_privacy') {
                ws.send(JSON.stringify({
                    type: 'privacy_data',
                    content: {
                        donations: [
                            { price: 30, months: 1 },
                            { price: 85, months: 3 },
                            { price: 145, months: 6 },
                            { price: 285, months: 12 }
                        ],
                        bugs: [
                            { type: '🐛 Незначительный', reward: '1 месяц' },
                            { type: '🐞 Средний', reward: '3 месяца' },
                            { type: '🦠 Критический', reward: '6 месяцев' },
                            { type: '💎 Уникальный', reward: '1 год' }
                        ],
                        contact: 'nanogram.ru@yandex.ru'
                    }
                }));
            }
            
        } catch (e) {
            console.error('❌ Ошибка:', e);
            logAction('error', 'SYSTEM', e.message);
            ws.send(JSON.stringify({ 
                type: 'error', 
                message: '❌ Внутренняя ошибка сервера' 
            }));
        }
    });

    ws.on('close', () => {
        if (currentUsername) {
            console.log(`👋 ${currentUsername} отключился`);
            
            // Обновляем статус на офлайн
            if (userStatuses[currentUsername]) {
                userStatuses[currentUsername].online = false;
                userStatuses[currentUsername].lastSeen = Date.now();
            }
            
            userDatabase[currentUsername].lastSeen = new Date().toISOString();
            saveData();
            
            activeUsers.delete(ws);
            
            // Оповещаем всех об уходе
            broadcastUserStatus(currentUsername, 'offline');
            broadcastUserList();
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
function broadcastToAll(message) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
        }
    });
}

function broadcastUserList() {
    const userList = Array.from(activeUsers.values())
        .map(u => u.username)
        .filter(u => !userDatabase[u]?.banned);
    
    broadcastToAll({ 
        type: 'user_list', 
        users: userList,
        timestamp: Date.now()
    });
}

function broadcastUserStatus(username, status) {
    const userData = activeUsers.values();
    const statusData = {
        type: 'user_status_update',
        username,
        online: status !== 'offline',
        status: status,
        timestamp: Date.now()
    };
    
    wss.clients.forEach(client => {
        const viewer = activeUsers.get(client)?.username;
        if (viewer && canSeeStatus(viewer, username)) {
            client.send(JSON.stringify(statusData));
        }
    });
}

function broadcastToGroup(groupId, message) {
    const group = groups[groupId];
    if (!group) return;
    
    wss.clients.forEach(client => {
        const userData = activeUsers.get(client);
        if (userData && group.members.includes(userData.username)) {
            client.send(JSON.stringify(message));
        }
    });
}

// ==============================================
// ПЕРИОДИЧЕСКАЯ ОЧИСТКА
// ==============================================
setInterval(() => {
    let removed = 0;
    wss.clients.forEach(ws => {
        if (!activeUsers.has(ws) && ws.readyState !== WebSocket.OPEN) {
            removed++;
        }
    });
    if (removed > 0) console.log(`🧹 Очищено ${removed} неактивных`);
}, 30000);

// ==============================================
// ЗАПУСК
// ==============================================
server.listen(PORT, '0.0.0.0', () => {
    const onlineCount = activeUsers.size;
    
    console.log('\n' + '='.repeat(70));
    console.log(`🚀 Nanogram ${VERSION} - С АКТИВНОСТЬЮ И ПОЛИТИКОЙ`);
    console.log('='.repeat(70));
    console.log(`📡 Порт: ${PORT}`);
    console.log(`\n📊 СТАТИСТИКА:`);
    console.log(`   👥 Пользователей: ${Object.keys(userDatabase).length}`);
    console.log(`   🟢 Онлайн сейчас: ${onlineCount}`);
    console.log(`   👥 Групп: ${Object.keys(groups).length}`);
    console.log(`   💬 Сообщений: ${Object.values(messages).reduce((a, c) => a + c.length, 0)}`);
    console.log(`   🔒 Заблокировано: ${Object.keys(blockedUsers).length}`);
    console.log(`\n🌐 ДОСТУП:`);
    console.log(`   📱 http://localhost:${PORT}`);
    console.log(`   🕵️ /admin - теневая панель`);
    console.log(`   📜 /privacy - политика`);
    console.log(`   🔍 /diagnostic - диагностика`);
    console.log('='.repeat(70) + '\n');
    
    logAction('system', 'SERVER', `Запуск v${VERSION} с активностью`);
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