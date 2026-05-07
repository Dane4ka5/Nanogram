const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const VERSION = 'v0.15.0';
const CREATOR_USERNAME = 'Dane4ka5';
const CONSOLE_PASSWORD = '14883482GG';
const SAVE_INTERVAL = 60 * 1000;
const MAX_MESSAGES_PER_CHAT = 10000;
const MAX_BACKUPS = 50;

const users = new Map();
const activeUsers = new Map();
let offlineMessages = {};

let userDatabase = {};
let messages = {};
let groups = {};
let channels = {};
let privateRooms = {};
let userProfiles = {};
let userSettings = {};
let premiumUsers = {};
let blockedUsers = {};
let privacySettings = {};
let suspiciousMessages = [];

const SUSPICIOUS_WORDS = ['терракт', 'бомба', 'взрыв', 'оружие', 'наркотики', 'убить', 'война', 'attack', 'bomb', 'kill', 'terror'];

function loadAllData() {
    console.log('\n' + '='.repeat(60));
    console.log('📂 ЗАГРУЗКА ДАННЫХ...');
    console.log('='.repeat(60));
    try {
        if (fs.existsSync('./data.json')) {
            const data = JSON.parse(fs.readFileSync('./data.json', 'utf8'));
            userDatabase = data.users || {};
            groups = data.groups || {};
            channels = data.channels || {};
            privateRooms = data.privateRooms || {};
            userProfiles = data.userProfiles || {};
            userSettings = data.userSettings || {};
            premiumUsers = data.premiumUsers || {};
            blockedUsers = data.blockedUsers || {};
            privacySettings = data.privacySettings || {};
            console.log(`✅ data.json загружен: ${Object.keys(userDatabase).length} пользователей, ${Object.keys(channels).length} каналов`);
        }
    } catch (e) { console.error('Ошибка загрузки data.json:', e.message); }
    try {
        if (fs.existsSync('./messages.json')) {
            messages = JSON.parse(fs.readFileSync('./messages.json', 'utf8'));
            console.log(`✅ messages.json загружен: ${Object.keys(messages).length} чатов`);
        }
    } catch (e) { messages = {}; }
    if (fs.existsSync('./offline.json')) {
        try { offlineMessages = JSON.parse(fs.readFileSync('./offline.json', 'utf8')); } catch(e) { offlineMessages = {}; }
    } else { offlineMessages = {}; }
    console.log('='.repeat(60) + '\n');
}

function saveData() {
    try {
        const data = { users: userDatabase, groups, channels, privateRooms, userProfiles, userSettings, premiumUsers, blockedUsers, privacySettings, lastSaved: new Date().toISOString() };
        fs.writeFileSync('./data.json', JSON.stringify(data, null, 2), 'utf8');
        console.log(`💾 Данные сохранены в ${new Date().toLocaleTimeString()}`);
        return true;
    } catch (e) { console.error('❌ Ошибка сохранения:', e); return false; }
}
function saveMessages() { try { fs.writeFileSync('./messages.json', JSON.stringify(messages, null, 2), 'utf8'); return true; } catch(e) { return false; } }
function saveOffline() { try { fs.writeFileSync('./offline.json', JSON.stringify(offlineMessages, null, 2), 'utf8'); return true; } catch(e) { return false; } }
function logAction(action, username, details) { fs.appendFile('./users.log', `[${new Date().toISOString()}] ${action} | ${username || 'SYSTEM'} | ${details}\n`, () => {}); }
function checkSuspicious(text, from, to, ip) {
    const lower = text.toLowerCase();
    for (const w of SUSPICIOUS_WORDS) if (lower.includes(w)) {
        suspiciousMessages.push({ from, to, message: text, ip, timestamp: new Date().toISOString(), word: w });
        fs.appendFile('./suspicious.log', JSON.stringify({ from, to, message: text, ip, timestamp: new Date().toISOString(), word: w }) + '\n', () => {});
        console.log(`🚨 ПОДОЗРИТЕЛЬНО: ${from} → ${to}: "${text.substring(0,50)}..."`);
        return true;
    }
    return false;
}
function generateId() { return crypto.randomBytes(8).toString('hex'); }
function sendOfflineMessages(username, ws) {
    if (offlineMessages[username]?.length) {
        ws.send(JSON.stringify({ type: 'offline_messages', messages: offlineMessages[username] }));
        delete offlineMessages[username];
        saveOffline();
    }
}

const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (req.url === '/diagnostic') {
        res.end(JSON.stringify({ server: 'ONLINE', version: VERSION, creator: CREATOR_USERNAME, stats: { users: Object.keys(userDatabase).length, online: users.size, messages: Object.values(messages).reduce((a,c)=>a+c.length,0), channels: Object.keys(channels).length } }));
        return;
    }
    if (req.url === '/privacy') {
        res.end(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Политика Nexora</title><style>body{background:#0a0c10;color:#fff;font-family:sans-serif;padding:20px;}.container{max-width:800px;margin:0 auto;background:#161b22;padding:40px;border-radius:20px;}h1{color:#9f8be5;}h2{color:#ffd700;}</style></head><body><div class="container"><h1>📜 Политика конфиденциальности Nexora</h1><h2>1. Какие данные мы собираем</h2><p>• Имя пользователя</p><p>• Номер телефона</p><p>• Сообщения (в зашифрованном виде)</p><h2>2. Контакты поддержки</h2><p>📧 support@nexora.ru</p><div class="footer"><p>Версия ${VERSION}</p><a href="/">← На главную</a></div></div></body></html>`);
        return;
    }
    if (req.url === '/console') {
        res.end(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Nexora Console</title><style>body{background:#0a0c10;color:#0f0;font-family:monospace;padding:20px;}#login,#console{max-width:600px;margin:50px auto;}input,button{background:#111;color:#0f0;border:1px solid #0f0;padding:10px;margin:5px;width:100%;}#output{height:400px;overflow:auto;background:#000;padding:10px;margin-bottom:10px;}</style></head><body><div id="login"><h2>🔐 Вход в консоль</h2><input type="password" id="pwd" placeholder="Пароль"><button onclick="checkPassword()">Войти</button><div id="loginError" style="color:#f00;"></div></div><div id="console" style="display:none;"><h1>🔧 NEXORA CONSOLE</h1><div id="output"></div><input type="text" id="cmd" placeholder="> введите команду..."></div><script>function checkPassword(){const pwd=document.getElementById('pwd').value;fetch('/console-auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pwd})}).then(res=>res.json()).then(data=>{if(data.ok){document.getElementById('login').style.display='none';document.getElementById('console').style.display='block';initConsole();}else{document.getElementById('loginError').innerText='❌ Неверный пароль';}});}function initConsole(){const output=document.getElementById('output');const input=document.getElementById('cmd');function addLog(msg){output.innerHTML+='<div>> '+msg+'</div>';output.scrollTop=output.scrollHeight;}async function sendCmd(){const cmd=input.value.trim();if(!cmd)return;addLog(cmd);const res=await fetch('/exec',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cmd})});const ans=await res.json();addLog(ans.result);input.value='';}input.addEventListener('keypress',(e)=>{if(e.key==='Enter')sendCmd();});addLog('✅ Консоль готова. Команды: /stats, /premium user months, /broadcast текст, /online, /msg user текст');}</script></body></html>`);
        return;
    }
    if (req.url === '/console-auth' && req.method === 'POST') {
        let body = ''; req.on('data', chunk => body += chunk); req.on('end', () => { const { password } = JSON.parse(body); res.end(JSON.stringify({ ok: password === CONSOLE_PASSWORD })); });
        return;
    }
    if (req.url === '/exec' && req.method === 'POST') {
        let body = ''; req.on('data', chunk => body += chunk); req.on('end', () => {
            const { cmd } = JSON.parse(body); let result = '';
            if (cmd.startsWith('/stats')) result = `👥 Пользователей: ${Object.keys(userDatabase).length}, 🟢 Онлайн: ${users.size}, 💬 Сообщений: ${Object.values(messages).reduce((a,c)=>a+c.length,0)}, 👑 Премиум: ${Object.keys(premiumUsers).length}, 📢 Каналов: ${Object.keys(channels).length}`;
            else if (cmd.startsWith('/premium')) { const parts = cmd.split(' '); if (parts.length>=3) { premiumUsers[parts[1]] = { active: true, granted: new Date().toISOString(), expires: new Date(Date.now() + parseInt(parts[2])*30*24*60*60*1000).toISOString(), grantedBy: 'console' }; saveData(); result = `✅ Премиум выдан ${parts[1]} на ${parts[2]} мес.`; } else result = '❌ /premium user months'; }
            else if (cmd.startsWith('/broadcast')) { const text = cmd.slice(10); wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(JSON.stringify({ type: 'broadcast', message: text })); }); result = `📢 Рассылка: "${text}" отправлена всем онлайн.`; }
            else if (cmd.startsWith('/online')) result = `🟢 Онлайн: ${Array.from(users.keys()).join(', ') || 'никого'}`;
            else if (cmd.startsWith('/msg')) { const parts = cmd.split(' '); if (parts.length>=3) { const target = users.get(parts[1]); if (target) target.send(JSON.stringify({ type: 'message', from: 'Console', text: parts.slice(2).join(' '), time: new Date().toLocaleTimeString() })); result = `📨 Сообщение отправлено ${parts[1]}`; } else result = '❌ /msg user текст'; }
            else result = '❌ Неизвестная команда';
            res.end(JSON.stringify({ result }));
        });
        return;
    }
    let filePath = '.' + req.url; if (filePath === './') filePath = './index.html';
    const ext = path.extname(filePath);
    const ct = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.webmanifest': 'application/manifest+json' };
    const encoding = ['.html', '.css', '.js', '.json', '.webmanifest'].includes(ext) ? 'utf8' : null;
    fs.readFile(filePath, encoding, (err, content) => { if (err) { if (err.code === 'ENOENT') fs.readFile('./index.html', 'utf8', (e, c) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(c); }); else { res.writeHead(500); res.end('500'); } } else { res.writeHead(200, { 'Content-Type': ct[ext] || 'text/plain' }); res.end(content); } });
});

const wss = new WebSocket.Server({ server });
wss.on('connection', (ws, req) => {
    const clientIp = req.socket.remoteAddress?.replace('::ffff:', '') || 'unknown';
    console.log(`🔌 Новое подключение: ${clientIp}`);
    let currentUser = null;
    ws.send(JSON.stringify({ type: 'connection_established', version: VERSION, timestamp: Date.now() }));

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message.toString('utf8'));
            if (data.type === 'ping') { ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now(), latency: Date.now() - data.timestamp })); return; }
            console.log(`📩 ${data.type} от ${data.username || data.from || 'unknown'}`);

            if (data.type === 'login') {
                let username = null;
                for (const [u, info] of Object.entries(userDatabase)) if (info.phone === data.phone && info.password === data.password) { username = u; break; }
                if (!username) { ws.send(JSON.stringify({ type: 'error', message: '❌ Неверный телефон или пароль' })); return; }
                currentUser = username;
                userDatabase[username].lastSeen = new Date().toISOString();
                users.set(username, ws);
                activeUsers.set(ws, { username, ip: clientIp, status: 'online', joinedAt: Date.now() });
                saveData();
                ws.send(JSON.stringify({ type: 'login_success', username, profile: userProfiles[username] || {}, premium: premiumUsers[username]?.active || false, privacy: privacySettings[username] || {}, blocked: blockedUsers[username] || [], contacts: userDatabase[username]?.contacts || [] }));
                sendOfflineMessages(username, ws);
                ws.send(JSON.stringify({ type: 'users_list', users: Object.keys(userDatabase) }));
                ws.send(JSON.stringify({ type: 'channels_list', channels: Object.values(channels) }));
                broadcastUserList();
                broadcastStatusUpdate(username, 'online');
            }
            else if (data.type === 'register') {
                let { username, phone, password, privacyAccepted } = data;
                if (!username || !phone || !password) { ws.send(JSON.stringify({ type: 'error', message: '❌ Заполните все поля' })); return; }
                if (!privacyAccepted) { ws.send(JSON.stringify({ type: 'error', message: '❌ Примите политику' })); return; }
                username = username.trim();
                const cleanPhone = phone.trim().replace(/\s+/g, '');
                if (!username.startsWith('@')) { ws.send(JSON.stringify({ type: 'error', message: '❌ Username должен начинаться с @' })); return; }
                const cleanUsername = username.slice(1);
                if (userDatabase[cleanUsername]) { ws.send(JSON.stringify({ type: 'error', message: '❌ Такой @username уже занят' })); return; }
                let phoneExists = false;
                for (const u of Object.values(userDatabase)) if (u.phone === cleanPhone) { phoneExists = true; break; }
                if (phoneExists) { ws.send(JSON.stringify({ type: 'error', message: '❌ Этот номер уже используется' })); return; }
                currentUser = cleanUsername;
                userDatabase[cleanUsername] = { username: cleanUsername, password, phone: cleanPhone, registered: new Date().toISOString(), lastSeen: new Date().toISOString(), contacts: [] };
                userProfiles[cleanUsername] = { avatar: '👤', bio: '' };
                premiumUsers[cleanUsername] = { active: false };
                privacySettings[cleanUsername] = { showOnline: 'all', showPhone: 'all' };
                blockedUsers[cleanUsername] = [];
                users.set(cleanUsername, ws);
                activeUsers.set(ws, { username: cleanUsername, ip: clientIp, status: 'online', joinedAt: Date.now() });
                saveData();
                ws.send(JSON.stringify({ type: 'register_success', username: cleanUsername, profile: userProfiles[cleanUsername], premium: false, privacy: privacySettings[cleanUsername], blocked: [], contacts: [] }));
                ws.send(JSON.stringify({ type: 'users_list', users: Object.keys(userDatabase) }));
                ws.send(JSON.stringify({ type: 'channels_list', channels: Object.values(channels) }));
                broadcastUserList();
                broadcastStatusUpdate(cleanUsername, 'online');
            }
            else if (data.type === 'request_history') {
                const chatKey = data.chatId.includes('_') ? data.chatId : [data.username, data.chatId].sort().join('_');
                ws.send(JSON.stringify({ type: 'chat_history', chatId: data.chatId, messages: (messages[chatKey] || []).slice(-500) }));
            }
            else if (data.type === 'request_channel_history') {
                const channel = channels[data.chatId];
                if (channel && (channel.creator === currentUser || channel.subscribers?.includes(currentUser))) {
                    ws.send(JSON.stringify({ type: 'chat_history', chatId: data.chatId, messages: (channel.posts || []).slice(-500) }));
                }
            }
            else if (data.type === 'message') {
                const { from, to, text, time, id } = data;
                if (!from || !to || !text) return;
                const isSusp = checkSuspicious(text, from, to, clientIp);
                const chatKey = [from, to].sort().join('_');
                if (!messages[chatKey]) messages[chatKey] = [];
                const msg = { id: id || generateId(), from, to, text, time, timestamp: Date.now(), ip: clientIp, suspicious: isSusp, delivered: false };
                messages[chatKey].push(msg);
                if (messages[chatKey].length > MAX_MESSAGES_PER_CHAT) messages[chatKey] = messages[chatKey].slice(-MAX_MESSAGES_PER_CHAT);
                saveMessages();
                const target = users.get(to);
                if (target) {
                    target.send(JSON.stringify({ type: 'message', id: msg.id, from, text, time, serverTime: Date.now() }));
                    msg.delivered = true;
                } else {
                    if (!offlineMessages[to]) offlineMessages[to] = [];
                    offlineMessages[to].push({ from, to, text, time, timestamp: msg.timestamp, chatId: from });
                    saveOffline();
                }
                ws.send(JSON.stringify({ type: 'message_delivered', messageId: msg.id, to, time, delivered: !!target, suspicious: isSusp }));
            }
            else if (data.type === 'channel_post') {
                const { from, to, text, time, id } = data;
                const channel = channels[to];
                if (!channel || (channel.creator !== from && !channel.admins?.includes(from))) { ws.send(JSON.stringify({ type: 'error', message: 'Нет прав на публикацию' })); return; }
                const post = { id: id || generateId(), from, text, time, timestamp: Date.now() };
                if (!channel.posts) channel.posts = [];
                channel.posts.push(post);
                if (!messages[`channel_${to}`]) messages[`channel_${to}`] = [];
                messages[`channel_${to}`].push(post);
                saveData(); saveMessages();
                (channel.subscribers || []).forEach(sub => { const subWs = users.get(sub); if (subWs) subWs.send(JSON.stringify({ type: 'channel_post', channelId: to, id: post.id, from, text, time, serverTime: Date.now() })); });
            }
            else if (data.type === 'create_channel') {
                const { name, creator } = data;
                if (!name) { ws.send(JSON.stringify({ type: 'error', message: 'Название канала обязательно' })); return; }
                const id = 'channel_' + generateId();
                channels[id] = { id, name, creator, admins: [creator], subscribers: [], avatar: '📢', createdAt: new Date().toISOString(), posts: [] };
                saveData();
                ws.send(JSON.stringify({ type: 'channel_created', channel: channels[id] }));
                broadcastChannelsList();
            }
            else if (data.type === 'subscribe_channel') {
                const { channelId, username } = data;
                if (channels[channelId] && !channels[channelId].subscribers.includes(username)) {
                    channels[channelId].subscribers.push(username);
                    saveData();
                    ws.send(JSON.stringify({ type: 'subscribed', channelId }));
                }
            }
            else if (data.type === 'create_group') {
                const { name, creator } = data;
                if (!name) return;
                const groupId = 'group_' + generateId();
                groups[groupId] = { id: groupId, name, creator, admins: [creator], members: [creator], avatar: '👥', createdAt: new Date().toISOString(), messages: [] };
                saveData();
                ws.send(JSON.stringify({ type: 'group_created', group: groups[groupId] }));
            }
            else if (data.type === 'add_to_group') {
                const { groupId, username, adder } = data;
                if (!groups[groupId] || !groups[groupId].admins.includes(adder)) { ws.send(JSON.stringify({ type: 'error', message: 'Нет прав' })); return; }
                if (!groups[groupId].members.includes(username)) {
                    groups[groupId].members.push(username);
                    saveData();
                    groups[groupId].members.forEach(m => { const mws = users.get(m); if (mws) mws.send(JSON.stringify({ type: 'group_updated', group: groups[groupId] })); });
                }
            }
            else if (data.type === 'group_message') {
                const { groupId, from, text, time } = data;
                if (!groups[groupId] || !groups[groupId].members.includes(from)) { ws.send(JSON.stringify({ type: 'error', message: 'Нет доступа' })); return; }
                const msg = { id: generateId(), from, text, time, timestamp: Date.now(), groupId };
                if (!groups[groupId].messages) groups[groupId].messages = [];
                groups[groupId].messages.push(msg);
                const chatKey = `group_${groupId}`;
                if (!messages[chatKey]) messages[chatKey] = [];
                messages[chatKey].push(msg);
                saveData(); saveMessages();
                groups[groupId].members.forEach(m => { const mws = users.get(m); if (mws) mws.send(JSON.stringify({ type: 'group_message', id: msg.id, groupId, from, text, time, serverTime: Date.now() })); });
            }
            else if (data.type === 'add_contact') {
                const { from, to } = data;
                const cleanTo = to.startsWith('@') ? to.slice(1) : to;
                if (!userDatabase[cleanTo]) { ws.send(JSON.stringify({ type: 'error', message: 'Пользователь не найден' })); return; }
                if (!userDatabase[from].contacts) userDatabase[from].contacts = [];
                if (!userDatabase[from].contacts.includes(cleanTo)) {
                    userDatabase[from].contacts.push(cleanTo);
                    saveData();
                    ws.send(JSON.stringify({ type: 'contacts_list', contacts: userDatabase[from].contacts }));
                }
            }
            else if (data.type === 'toggle_reaction') {
                const { messageId, reaction } = data;
                for (const [chatKey, chatMsgs] of Object.entries(messages)) {
                    const idx = chatMsgs.findIndex(m => m.id === messageId);
                    if (idx !== -1) {
                        const msg = chatMsgs[idx];
                        if (!msg.reactions) msg.reactions = [];
                        const existingIdx = msg.reactions.findIndex(r => r.user === currentUser);
                        if (existingIdx !== -1) {
                            if (msg.reactions[existingIdx].reaction === reaction) msg.reactions.splice(existingIdx, 1);
                            else msg.reactions[existingIdx].reaction = reaction;
                        } else msg.reactions.push({ user: currentUser, reaction });
                        messages[chatKey][idx] = msg;
                        saveMessages();
                        const participants = chatKey.split('_');
                        participants.forEach(p => { const pws = users.get(p); if (pws) pws.send(JSON.stringify({ type: 'message_reaction', messageId, chatId: chatKey, reactions: msg.reactions })); });
                        break;
                    }
                }
            }
            else if (data.type === 'call_offer' || data.type === 'call_answer' || data.type === 'ice_candidate') {
                const target = users.get(data.to);
                if (target) target.send(JSON.stringify({ ...data, from: data.from }));
            }
            else if (data.type === 'call_reject') {
                const target = users.get(data.to);
                if (target) target.send(JSON.stringify({ type: 'call_reject', from: data.from }));
            }
            else if (data.type === 'update_status') {
                const ud = activeUsers.get(ws);
                if (ud && ud.username === data.username) { ud.status = data.status; activeUsers.set(ws, ud); broadcastStatusUpdate(data.username, data.status); ws.send(JSON.stringify({ type: 'status_updated', status: data.status })); }
            }
            else if (data.type === 'block_user') {
                if (!blockedUsers[data.username]) blockedUsers[data.username] = [];
                if (!blockedUsers[data.username].includes(data.target)) { blockedUsers[data.username].push(data.target); saveData(); ws.send(JSON.stringify({ type: 'blocked_list', blocked: blockedUsers[data.username] })); }
            }
            else if (data.type === 'unblock_user') {
                if (blockedUsers[data.username]) { blockedUsers[data.username] = blockedUsers[data.username].filter(b => b !== data.target); saveData(); ws.send(JSON.stringify({ type: 'blocked_list', blocked: blockedUsers[data.username] })); }
            }
            else if (data.type === 'typing') { const t = users.get(data.to); if (t) t.send(JSON.stringify({ type: 'typing', from: data.from })); }
            else if (data.type === 'get_stats' && data.username === CREATOR_USERNAME) {
                ws.send(JSON.stringify({ type: 'stats', stats: { users: Object.keys(userDatabase).length, online: users.size, messages: Object.values(messages).reduce((a,c)=>a+c.length,0), groups: Object.keys(groups).length, channels: Object.keys(channels).length, premium: Object.keys(premiumUsers).length, suspicious: suspiciousMessages.length } }));
            }
            else if (data.type === 'get_suspicious' && data.username === CREATOR_USERNAME) {
                ws.send(JSON.stringify({ type: 'suspicious_list', messages: suspiciousMessages.slice(-100).reverse() }));
            }
            else if (data.type === 'clear_suspicious' && data.username === CREATOR_USERNAME) {
                suspiciousMessages = [];
                fs.writeFileSync('./suspicious.log', '');
                ws.send(JSON.stringify({ type: 'suspicious_cleared' }));
            }
        } catch (err) { console.error('Ошибка обработки сообщения:', err); try { ws.send(JSON.stringify({ type: 'error', message: 'Внутренняя ошибка' })); } catch(e) {} }
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

function broadcastUserList() { const msg = JSON.stringify({ type: 'user_list', users: Array.from(users.keys()), online: users.size, timestamp: Date.now() }); wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); }); }
function broadcastStatusUpdate(username, status) { const msg = JSON.stringify({ type: 'status_update', username, status, timestamp: Date.now() }); wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); }); }
function broadcastChannelsList() { const msg = JSON.stringify({ type: 'channels_list', channels: Object.values(channels) }); wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); }); }

setInterval(() => { saveData(); saveMessages(); saveOffline(); }, SAVE_INTERVAL);
setInterval(() => {
    if (!fs.existsSync('./backups')) fs.mkdirSync('./backups');
    const ts = Date.now();
    if (fs.existsSync('./data.json')) fs.copyFileSync('./data.json', `./backups/data_${ts}.json`);
    if (fs.existsSync('./messages.json')) fs.copyFileSync('./messages.json', `./backups/messages_${ts}.json`);
    if (fs.existsSync('./offline.json')) fs.copyFileSync('./offline.json', `./backups/offline_${ts}.json`);
}, 60 * 60 * 1000);
setInterval(() => { let c = 0; wss.clients.forEach(ws => { if (ws.readyState !== WebSocket.OPEN) c++; }); if (c > 0) console.log(`🧹 Очищено ${c} неактивных`); }, 5 * 60 * 1000);

loadAllData();
server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 Nexora ${VERSION} (чистая версия)`);
    console.log(`📡 Порт: ${PORT}`);
    console.log(`👑 Создатель: ${CREATOR_USERNAME}`);
    console.log(`📊 Статистика: ${Object.keys(userDatabase).length} пользователей, ${Object.keys(channels).length} каналов`);
    console.log(`🔐 /console - командная строка (пароль: ${CONSOLE_PASSWORD})`);
});
process.on('SIGINT', () => { console.log('\n📦 Сохранение...'); saveData(); saveMessages(); saveOffline(); process.exit(0); });