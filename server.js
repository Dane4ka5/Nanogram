const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const VERSION = 'v0.13.2';
const CREATOR_USERNAME = 'Dane4ka5';
const CONSOLE_PASSWORD = '14883482GG';  // твой пароль для входа в консоль

const SAVE_INTERVAL = 60 * 1000;
const MAX_MESSAGES_PER_CHAT = 10000;
const MAX_BACKUPS = 50;

const users = new Map();
const activeUsers = new Map();

let userDatabase = {};
let messages = {};
let groups = {};
let channels = {
    'NEXORA': {
        id: 'NEXORA',
        name: 'NEXORA',
        creator: 'Dane4ka5',
        admins: ['Dane4ka5'],
        subscribers: [],
        posts: [],
        avatar: '🧪',
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

const SUSPICIOUS_WORDS = [
    'терракт', 'бомба', 'взрыв', 'оружие', 'наркотики',
    'убить', 'война', 'attack', 'bomb', 'kill', 'terror'
];

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
            const alert = { from, to, message: text, ip, timestamp: new Date().toISOString(), word: word };
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

const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    
    if (req.url === '/diagnostic') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        const diagnostic = {
            server: 'ONLINE', version: VERSION, creator: CREATOR_USERNAME,
            timestamp: new Date().toISOString(),
            stats: {
                users: Object.keys(userDatabase).length,
                online: users.size,
                groups: Object.keys(groups).length,
                channels: Object.keys(channels).length,
                messages: Object.keys(messages).length,
                suspicious: suspiciousMessages.length,
                premium: Object.keys(premiumUsers).length
            },
            files: { dataJson: fs.existsSync('./data.json'), messagesJson: fs.existsSync('./messages.json') }
        };
        res.end(JSON.stringify(diagnostic, null, 2));
        return;
    }
    
    if (req.url === '/privacy') {
        res.end(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Политика Nexora</title><style>body{background:#0a0c10;color:#fff;font-family:sans-serif;padding:20px;}.container{max-width:800px;margin:0 auto;background:#161b22;padding:40px;border-radius:20px;}h1{color:#9f8be5;}h2{color:#ffd700;}</style></head><body><div class="container"><h1>📜 Политика конфиденциальности Nexora</h1><h2>1. Какие данные мы собираем</h2><p>• Имя пользователя</p><p>• Номер телефона</p><p>• Сообщения (в зашифрованном виде)</p><h2>2. Контакты поддержки</h2><p>📧 support@nexora.ru</p><div class="footer"><p>Версия ${VERSION}</p><a href="/">← На главную</a></div></div></body></html>`);
        return;
    }
    
    // ========== КОНСОЛЬ С ПАРОЛЕМ ==========
    if (req.url === '/console') {
        res.end(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>Nexora Console 🔐</title>
                <style>
                    body{background:#0a0c10;color:#0f0;font-family:monospace;padding:20px;}
                    #login, #console{max-width:600px;margin:50px auto;}
                    input,button{background:#111;color:#0f0;border:1px solid #0f0;padding:10px;margin:5px;width:100%;}
                    #output{height:400px;overflow:auto;background:#000;padding:10px;margin-bottom:10px;white-space:pre-wrap;}
                </style>
            </head>
            <body>
                <div id="login">
                    <h2>🔐 Вход в консоль</h2>
                    <input type="password" id="pwd" placeholder="Пароль">
                    <button onclick="checkPassword()">Войти</button>
                    <div id="loginError" style="color:#f00;"></div>
                </div>
                <div id="console" style="display:none;">
                    <h1>🔧 NEXORA CONSOLE</h1>
                    <div id="output"></div>
                    <input type="text" id="cmd" placeholder="> введите команду...">
                </div>
                <script>
                    function checkPassword() {
                        const pwd = document.getElementById('pwd').value;
                        fetch('/console-auth', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ password: pwd })
                        }).then(res => res.json()).then(data => {
                            if (data.ok) {
                                document.getElementById('login').style.display = 'none';
                                document.getElementById('console').style.display = 'block';
                                initConsole();
                            } else {
                                document.getElementById('loginError').innerText = '❌ Неверный пароль';
                            }
                        });
                    }
                    function initConsole() {
                        const output = document.getElementById('output');
                        const input = document.getElementById('cmd');
                        function addLog(msg) { output.innerHTML += '<div>> ' + msg + '</div>'; output.scrollTop = output.scrollHeight; }
                        async function sendCmd() {
                            const cmd = input.value.trim();
                            if (!cmd) return;
                            addLog(cmd);
                            const res = await fetch('/exec', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ cmd })
                            });
                            const ans = await res.json();
                            addLog(ans.result);
                            input.value = '';
                        }
                        input.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendCmd(); });
                        addLog('✅ Консоль готова. Команды: /stats, /premium user months, /broadcast текст, /online, /msg user текст, /ban user, /unban user');
                    }
                </script>
            </body>
            </html>
        `);
        return;
    }
    
    if (req.url === '/console-auth' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            const { password } = JSON.parse(body);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: password === CONSOLE_PASSWORD }));
        });
        return;
    }
    
    if (req.url === '/exec' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            const { cmd } = JSON.parse(body);
            let result = '';
            if (cmd.startsWith('/stats')) {
                result = `👥 Пользователей: ${Object.keys(userDatabase).length}, 🟢 Онлайн: ${users.size}, 💬 Сообщений: ${Object.values(messages).reduce((a,c)=>a+c.length,0)}, 👑 Премиум: ${Object.keys(premiumUsers).length}`;
            } else if (cmd.startsWith('/premium')) {
                const parts = cmd.split(' ');
                if (parts.length >= 3) {
                    const user = parts[1], months = parseInt(parts[2]);
                    premiumUsers[user] = { active: true, granted: new Date().toISOString(), expires: new Date(Date.now() + months*30*24*60*60*1000).toISOString(), grantedBy: 'console' };
                    saveData();
                    result = `✅ Премиум выдан ${user} на ${months} мес.`;
                } else { result = '❌ /premium user months'; }
            } else if (cmd.startsWith('/broadcast')) {
                const text = cmd.slice(10);
                wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(JSON.stringify({ type: 'broadcast', message: text })); });
                result = `📢 Рассылка: "${text}" отправлена всем онлайн.`;
            } else if (cmd.startsWith('/online')) {
                result = `🟢 Онлайн: ${Array.from(users.keys()).join(', ') || 'никого'}`;
            } else if (cmd.startsWith('/msg')) {
                const parts = cmd.split(' ');
                if (parts.length >= 3) {
                    const user = parts[1];
                    const msgText = parts.slice(2).join(' ');
                    const target = users.get(user);
                    if (target && target.readyState === WebSocket.OPEN) {
                        target.send(JSON.stringify({ type: 'message', from: 'Console', text: msgText, time: new Date().toLocaleTimeString(), serverTime: Date.now() }));
                        result = `📨 Сообщение отправлено ${user}`;
                    } else { result = `❌ Пользователь ${user} не в сети`; }
                } else { result = '❌ /msg user текст'; }
            } else if (cmd.startsWith('/ban')) {
                const user = cmd.split(' ')[1];
                if (user && user !== CREATOR_USERNAME) {
                    result = `🚫 Функция бана в разработке (пока просто запись)`;
                } else { result = '❌ Нельзя забанить себя'; }
            } else if (cmd.startsWith('/unban')) {
                const user = cmd.split(' ')[1];
                result = `✅ Разбан для ${user} (в разработке)`;
            } else {
                result = '❌ Неизвестная команда. Доступно: /stats, /premium user months, /broadcast текст, /online, /msg user текст';
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ result }));
        });
        return;
    }
    
    let filePath = '.' + req.url;
    if (filePath === './') filePath = './index.html';
    const extname = path.extname(filePath);
    const contentTypes = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.webmanifest': 'application/manifest+json' };
    const contentType = contentTypes[extname] || 'text/plain';
    const encoding = ['.html', '.css', '.js', '.json', '.webmanifest'].includes(extname) ? 'utf8' : null;
    fs.readFile(filePath, encoding, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                fs.readFile('./index.html', 'utf8', (err2, content2) => { if (err2) { res.writeHead(404); res.end('<h1>404</h1>'); } else { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(content2); } });
            } else { res.writeHead(500); res.end('<h1>500</h1>'); }
        } else { res.writeHead(200, { 'Content-Type': contentType }); res.end(content); }
    });
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
    const clientIp = req.socket.remoteAddress?.replace('::ffff:', '') || 'unknown';
    console.log(`🔌 Новое подключение: ${clientIp}`);
    let currentUser = null;
    
    ws.send(JSON.stringify({ type: 'connection_established', version: VERSION, timestamp: Date.now(), message: 'Подключено к серверу Nexora' }));
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString('utf8'));
            if (data.type === 'ping') { ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now(), latency: Date.now() - data.timestamp })); return; }
            console.log(`📩 Получен тип: ${data.type} от ${data.username || 'unknown'}`);
            
            if (data.type === 'register') {
                const { username, password, phone, privacyAccepted } = data;
                if (!username || !password || !phone) { ws.send(JSON.stringify({ type: 'error', message: '❌ Имя, пароль и телефон обязательны' })); return; }
                if (!privacyAccepted) { ws.send(JSON.stringify({ type: 'error', message: '❌ Необходимо принять политику' })); return; }
                const cleanUsername = username.trim(), cleanPhone = phone.trim().replace(/\s+/g, '');
                
                if (userDatabase[cleanUsername]) {
                    if (userDatabase[cleanUsername].password !== password) { ws.send(JSON.stringify({ type: 'error', message: '❌ Неверный пароль' })); return; }
                    if (userDatabase[cleanUsername].phone !== cleanPhone) { ws.send(JSON.stringify({ type: 'error', message: '❌ Неверный номер' })); return; }
                    console.log(`👋 Вход: ${cleanUsername}`);
                    currentUser = cleanUsername;
                    userDatabase[cleanUsername].lastSeen = new Date().toISOString();
                    users.set(cleanUsername, ws);
                    activeUsers.set(ws, { username: cleanUsername, ip: clientIp, status: 'online', joinedAt: Date.now() });
                    saveData();
                    logAction('login', cleanUsername, clientIp);
                    ws.send(JSON.stringify({ type: 'login_success', username: cleanUsername, profile: userProfiles[cleanUsername] || {}, premium: premiumUsers[cleanUsername]?.active || false, privacy: privacySettings[cleanUsername] || {}, blocked: blockedUsers[cleanUsername] || [] }));
                } else {
                    let phoneExists = false;
                    for (const u of Object.values(userDatabase)) if (u.phone === cleanPhone) { phoneExists = true; break; }
                    if (phoneExists) { ws.send(JSON.stringify({ type: 'error', message: '❌ Этот номер уже используется' })); return; }
                    if (userDatabase[cleanUsername]) { ws.send(JSON.stringify({ type: 'error', message: '❌ Это имя уже занято' })); return; }
                    console.log(`👤 Новый пользователь: ${cleanUsername} (${cleanPhone})`);
                    currentUser = cleanUsername;
                    userDatabase[cleanUsername] = { username: cleanUsername, password: password, phone: cleanPhone, registered: new Date().toISOString(), lastSeen: new Date().toISOString() };
                    userProfiles[cleanUsername] = { avatar: '👤', bio: '' };
                    premiumUsers[cleanUsername] = { active: false };
                    privacySettings[cleanUsername] = { showOnline: 'all', showPhone: 'all' };
                    blockedUsers[cleanUsername] = [];
                    users.set(cleanUsername, ws);
                    activeUsers.set(ws, { username: cleanUsername, ip: clientIp, status: 'online', joinedAt: Date.now() });
                    saveData();
                    logAction('register', cleanUsername, clientIp);
                    ws.send(JSON.stringify({ type: 'register_success', username: cleanUsername, profile: userProfiles[cleanUsername], premium: false, privacy: privacySettings[cleanUsername], blocked: [] }));
                }
                ws.send(JSON.stringify({ type: 'user_list', users: Array.from(users.keys()) }));
                ws.send(JSON.stringify({ type: 'channels_list', channels: Object.values(channels) }));
                ws.send(JSON.stringify({ type: 'groups_list', groups: Object.values(groups).filter(g => g.members?.includes(cleanUsername)) }));
                ws.send(JSON.stringify({ type: 'rooms_list', rooms: Object.values(privateRooms).filter(r => r.members?.includes(cleanUsername)) }));
                broadcastUserList();
                broadcastStatusUpdate(cleanUsername, 'online');
            }
            
            if (data.type === 'request_history') {
                const { chatId, username } = data;
                if (!chatId || !username) return;
                const chatKey = chatId.includes('_') ? chatId : [username, chatId].sort().join('_');
                const chatHistory = messages[chatKey] || [];
                ws.send(JSON.stringify({ type: 'chat_history', chatId: chatId, messages: chatHistory.slice(-500) }));
                if (chatHistory.length > 0) logAction('request_history', username, `${chatId} (${chatHistory.length})`);
            }
            
            if (data.type === 'message') {
                const { from, to, text, time, id } = data;
                if (!from || !to || !text) { ws.send(JSON.stringify({ type: 'error', message: '❌ Неполные данные' })); return; }
                const isSuspicious = checkSuspicious(text, from, to, clientIp);
                const chatKey = [from, to].sort().join('_');
                if (!messages[chatKey]) messages[chatKey] = [];
                const messageObj = { id: id || generateId(), from, to, text, time, timestamp: Date.now(), ip: clientIp, suspicious: isSuspicious, delivered: false };
                messages[chatKey].push(messageObj);
                if (messages[chatKey].length > MAX_MESSAGES_PER_CHAT) messages[chatKey] = messages[chatKey].slice(-MAX_MESSAGES_PER_CHAT);
                saveMessages();
                const targetWs = users.get(to);
                let delivered = false;
                if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                    targetWs.send(JSON.stringify({ type: 'message', id: messageObj.id, from, text, time, serverTime: Date.now() }));
                    delivered = true;
                    messageObj.delivered = true;
                }
                ws.send(JSON.stringify({ type: 'message_delivered', messageId: messageObj.id, to, time, delivered, suspicious: isSuspicious }));
                logAction('message', from, `→ ${to}${isSuspicious ? ' 🚨' : ''}`);
            }
            
            if (data.type === 'create_group') {
                const { name, creator } = data;
                if (!name || !creator) { ws.send(JSON.stringify({ type: 'error', message: '❌ Название обязательно' })); return; }
                const groupId = 'group_' + generateId();
                groups[groupId] = { id: groupId, name, creator, admins: [creator], members: [creator], avatar: '👥', createdAt: new Date().toISOString(), messages: [] };
                saveData();
                ws.send(JSON.stringify({ type: 'group_created', group: groups[groupId] }));
                ws.send(JSON.stringify({ type: 'groups_list', groups: Object.values(groups).filter(g => g.members.includes(creator)) }));
            }
            
            if (data.type === 'add_to_group') {
                const { groupId, username, adder } = data;
                if (!groups[groupId] || !groups[groupId].admins.includes(adder)) { ws.send(JSON.stringify({ type: 'error', message: '❌ Нет прав' })); return; }
                if (!groups[groupId].members.includes(username)) {
                    groups[groupId].members.push(username);
                    saveData();
                    groups[groupId].members.forEach(m => { const mws = users.get(m); if (mws) mws.send(JSON.stringify({ type: 'group_updated', group: groups[groupId] })); });
                    const tws = users.get(username);
                    if (tws) tws.send(JSON.stringify({ type: 'added_to_group', group: groups[groupId] }));
                }
            }
            
            if (data.type === 'group_message') {
                const { groupId, from, text, time } = data;
                if (!groups[groupId] || !groups[groupId].members.includes(from)) { ws.send(JSON.stringify({ type: 'error', message: '❌ Нет доступа' })); return; }
                const msg = { id: generateId(), from, text, time, timestamp: Date.now(), groupId };
                if (!groups[groupId].messages) groups[groupId].messages = [];
                groups[groupId].messages.push(msg);
                const chatKey = `group_${groupId}`;
                if (!messages[chatKey]) messages[chatKey] = [];
                messages[chatKey].push(msg);
                saveData(); saveMessages();
                groups[groupId].members.forEach(m => { const mws = users.get(m); if (mws) mws.send(JSON.stringify({ type: 'group_message', id: msg.id, groupId, from, text, time, serverTime: Date.now() })); });
            }
            
            if (data.type === 'update_status') {
                const { username, status } = data;
                const ud = activeUsers.get(ws);
                if (ud && ud.username === username) { ud.status = status; activeUsers.set(ws, ud); broadcastStatusUpdate(username, status); ws.send(JSON.stringify({ type: 'status_updated', status })); }
            }
            
            if (data.type === 'update_privacy') {
                const { username, settings } = data;
                privacySettings[username] = { ...privacySettings[username], ...settings };
                saveData();
                ws.send(JSON.stringify({ type: 'privacy_updated', settings: privacySettings[username] }));
            }
            
            if (data.type === 'block_user') {
                const { username, target } = data;
                if (!username || !target) return;
                if (!blockedUsers[username]) blockedUsers[username] = [];
                if (!blockedUsers[username].includes(target)) { blockedUsers[username].push(target); saveData(); ws.send(JSON.stringify({ type: 'blocked_list', blocked: blockedUsers[username] })); }
            }
            
            if (data.type === 'unblock_user') {
                const { username, target } = data;
                if (blockedUsers[username]) { blockedUsers[username] = blockedUsers[username].filter(b => b !== target); saveData(); ws.send(JSON.stringify({ type: 'blocked_list', blocked: blockedUsers[username] })); }
            }
            
            if (data.type === 'typing') {
                const tws = users.get(data.to);
                if (tws) tws.send(JSON.stringify({ type: 'typing', from: data.from }));
            }
            
            if (data.type === 'signal' || data.type === 'signal_answer' || data.type === 'ice_candidate') {
                const tws = users.get(data.to);
                if (tws) tws.send(JSON.stringify({ ...data, from: data.from }));
            }
            
            if (data.type === 'p2p_message') {
                const { from, to, text, time, messageId } = data;
                const chatKey = [from, to].sort().join('_');
                if (!messages[chatKey]) messages[chatKey] = [];
                messages[chatKey].push({ id: messageId || generateId(), from, to, text, time, timestamp: Date.now(), via: 'p2p' });
                saveMessages();
                ws.send(JSON.stringify({ type: 'p2p_message_saved', messageId }));
            }
            
        } catch (error) {
            console.error('❌ Ошибка:', error);
            try { ws.send(JSON.stringify({ type: 'error', message: '❌ Внутренняя ошибка сервера' })); } catch(e) {}
        }
    });
    
    ws.on('close', () => {
        const ud = activeUsers.get(ws);
        if (ud) {
            users.delete(ud.username);
            activeUsers.delete(ws);
            if (userDatabase[ud.username]) userDatabase[ud.username].lastSeen = new Date().toISOString();
            saveData();
            broadcastUserList();
            broadcastStatusUpdate(ud.username, 'offline');
        }
    });
});

function broadcastUserList() {
    const msg = JSON.stringify({ type: 'user_list', users: Array.from(users.keys()), online: users.size, timestamp: Date.now() });
    wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
}

function broadcastStatusUpdate(username, status) {
    const msg = JSON.stringify({ type: 'status_update', username, status, timestamp: Date.now() });
    wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
}

setInterval(() => { saveData(); saveMessages(); console.log(`💾 Автосохранение ${new Date().toLocaleTimeString()}`); }, SAVE_INTERVAL);
setInterval(() => {
    try {
        if (!fs.existsSync('./backups')) fs.mkdirSync('./backups');
        const ts = Date.now();
        if (fs.existsSync('./data.json')) fs.copyFileSync('./data.json', `./backups/data_${ts}.json`);
        if (fs.existsSync('./messages.json')) fs.copyFileSync('./messages.json', `./backups/messages_${ts}.json`);
        const backups = fs.readdirSync('./backups').filter(f => f.startsWith('data_')).sort().reverse();
        if (backups.length > MAX_BACKUPS) backups.slice(MAX_BACKUPS).forEach(f => { const b = f.replace('data_', ''); ['data_', 'messages_'].forEach(p => { const file = `./backups/${p}${b}`; if (fs.existsSync(file)) fs.unlinkSync(file); }); });
    } catch(e) {}
}, 60 * 60 * 1000);
setInterval(() => { let c = 0; wss.clients.forEach(ws => { if (ws.readyState !== WebSocket.OPEN) c++; }); if (c > 0) console.log(`🧹 Очищено ${c} неактивных`); }, 5 * 60 * 1000);

loadAllData();
server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 Nexora ${VERSION}`);
    console.log(`📡 Порт: ${PORT}`);
    console.log(`👑 Создатель: ${CREATOR_USERNAME}`);
    console.log(`\n📊 СТАТИСТИКА:`);
    console.log(`   👥 Пользователей: ${Object.keys(userDatabase).length}`);
    console.log(`   🟢 Онлайн: ${users.size}`);
    console.log(`   💬 Чатов: ${Object.keys(messages).length}`);
    console.log(`   👑 Премиум: ${Object.keys(premiumUsers).length}`);
    console.log(`\n🌐 ДОСТУП:`);
    console.log(`   📱 http://localhost:${PORT}`);
    console.log(`   🔐 /console - командная строка (пароль: ${CONSOLE_PASSWORD})`);
    console.log(`   📜 /privacy - политика`);
    console.log(`   🔍 /diagnostic - диагностика`);
});

process.on('SIGINT', () => { console.log('\n📦 Сохранение...'); saveData(); saveMessages(); process.exit(0); });
process.on('uncaughtException', (err) => { console.error('❌ Ошибка:', err); saveData(); saveMessages(); });