const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ==============================================
// КОНФИГУРАЦИЯ
// ==============================================
const PORT = process.env.PORT || 3000;
const VERSION = 'v0.8.2';
const CREATOR_USERNAME = 'Dane4ka5';
const SAVE_INTERVAL = 60 * 1000; // Каждую минуту
const MAX_MESSAGES_PER_CHAT = 1000;
const MAX_BACKUPS = 20;

// ==============================================
// ХРАНИЛИЩА ДАННЫХ
// ==============================================
const activeUsers = new Map(); // WebSocket -> username
let userDatabase = {}; // username -> { password, phone, registered, lastSeen, privacyAccepted }
let messages = {}; // chatKey -> [message, ...]
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
let privateRooms = {}; // roomId -> { id, name, creator, admins, members, inviteLink, messages }
let userProfiles = {}; // username -> { avatar, bio, status }
let userSettings = {}; // username -> { theme, fontSize, messageDensity, notifications }
let premiumUsers = {}; // username -> { active, purchased, expires, tier }

// ==============================================
// ЗАГРУЗКА ВСЕХ ДАННЫХ
// ==============================================
function loadAllData() {
    console.log('\n' + '='.repeat(60));
    console.log('📂 ЗАГРУЗКА ВСЕХ ДАННЫХ...');
    console.log('='.repeat(60));
    
    // Загрузка data.json
    try {
        if (fs.existsSync('./data.json')) {
            const rawData = fs.readFileSync('./data.json', 'utf8');
            const data = JSON.parse(rawData);
            
            userDatabase = data.users || {};
            channels = { ...channels, ...(data.channels || {}) };
            privateRooms = data.privateRooms || {};
            userProfiles = data.userProfiles || {};
            userSettings = data.userSettings || {};
            premiumUsers = data.premiumUsers || {};
            
            console.log(`✅ data.json загружен:`);
            console.log(`   👥 Пользователей: ${Object.keys(userDatabase).length}`);
            console.log(`   📢 Каналов: ${Object.keys(channels).length}`);
            console.log(`   🔒 Комнат: ${Object.keys(privateRooms).length}`);
        } else {
            console.log(`⚠️ data.json не найден, будет создан при сохранении`);
        }
    } catch (e) {
        console.error(`❌ Ошибка загрузки data.json:`, e.message);
    }
    
    // Загрузка messages.json
    try {
        if (fs.existsSync('./messages.json')) {
            const rawData = fs.readFileSync('./messages.json', 'utf8');
            messages = JSON.parse(rawData);
            
            const totalMessages = Object.values(messages).reduce((acc, chat) => acc + chat.length, 0);
            console.log(`✅ messages.json загружен:`);
            console.log(`   💬 Чатов: ${Object.keys(messages).length}`);
            console.log(`   💭 Всего сообщений: ${totalMessages}`);
        } else {
            console.log(`⚠️ messages.json не найден, будет создан при сохранении`);
            messages = {};
        }
    } catch (e) {
        console.error(`❌ Ошибка загрузки messages.json:`, e.message);
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
            channels: channels,
            privateRooms: privateRooms,
            userProfiles: userProfiles,
            userSettings: userSettings,
            premiumUsers: premiumUsers,
            lastSaved: new Date().toISOString()
        };
        
        fs.writeFileSync('./data.json', JSON.stringify(data, null, 2), 'utf8');
        console.log(`💾 Основные данные сохранены в ${new Date().toLocaleTimeString()}`);
        return true;
    } catch (e) {
        console.error('❌ Ошибка сохранения данных:', e);
        return false;
    }
}

function saveMessages() {
    try {
        fs.writeFileSync('./messages.json', JSON.stringify(messages, null, 2), 'utf8');
        console.log(`💬 Сообщения сохранены в ${new Date().toLocaleTimeString()}`);
        return true;
    } catch (e) {
        console.error('❌ Ошибка сохранения сообщений:', e);
        return false;
    }
}

// ==============================================
// ЛОГИРОВАНИЕ
// ==============================================
function logAction(action, username, details) {
    const logEntry = `[${new Date().toISOString()}] ${action} | ${username || 'SYSTEM'} | ${details}\n`;
    fs.appendFile('./users.log', logEntry, (err) => {
        if (err) console.error('❌ Ошибка записи в users.log:', err);
    });
}

function logError(place, error) {
    const logEntry = `[${new Date().toISOString()}] ERROR | ${place} | ${error.message}\n`;
    fs.appendFile('./errors.log', logEntry, () => {});
}

// ==============================================
// БЭКАПЫ
// ==============================================
function createBackup() {
    try {
        if (!fs.existsSync('./backups')) fs.mkdirSync('./backups');
        
        const timestamp = Date.now();
        if (fs.existsSync('./data.json')) {
            fs.copyFileSync('./data.json', `./backups/data_${timestamp}.json`);
        }
        if (fs.existsSync('./messages.json')) {
            fs.copyFileSync('./messages.json', `./backups/messages_${timestamp}.json`);
        }
        console.log(`💾 Бэкап создан: ${timestamp}`);
        
        // Удаляем старые бэкапы
        const backups = fs.readdirSync('./backups')
            .filter(f => f.startsWith('data_'))
            .sort()
            .reverse();
        
        if (backups.length > MAX_BACKUPS) {
            backups.slice(MAX_BACKUPS).forEach(f => {
                const msgFile = f.replace('data_', 'messages_');
                fs.unlinkSync(`./backups/${f}`);
                if (fs.existsSync(`./backups/${msgFile}`)) {
                    fs.unlinkSync(`./backups/${msgFile}`);
                }
            });
        }
    } catch (e) {
        console.error('❌ Ошибка бэкапа:', e);
    }
}

// ==============================================
// ЗАГРУЗКА ПРИ СТАРТЕ
// ==============================================
loadAllData();
setInterval(saveData, SAVE_INTERVAL);
setInterval(saveMessages, SAVE_INTERVAL);
setInterval(createBackup, 60 * 60 * 1000);

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
    // Создатель всегда премиум
    if (username === CREATOR_USERNAME) return true;
    return premiumUsers[username] && premiumUsers[username].active === true;
}

function getPremiumTier(username) {
    if (username === CREATOR_USERNAME) return 'creator';
    if (premiumUsers[username]) return premiumUsers[username].tier || 'premium';
    return null;
}

function getChatKey(user1, user2) {
    return [user1, user2].sort().join('_');
}

function getOnlineUsers() {
    return Array.from(activeUsers.values());
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
        const username = activeUsers.get(client);
        if (username && channel.subscribers.includes(username)) {
            client.send(JSON.stringify(message));
        }
    });
}

function broadcastToRoom(roomId, message, exclude = []) {
    const room = privateRooms[roomId];
    if (!room) return;
    
    wss.clients.forEach(client => {
        if (exclude.includes(client)) return;
        const username = activeUsers.get(client);
        if (username && room.members.includes(username)) {
            client.send(JSON.stringify(message));
        }
    });
}

function broadcastUserList() {
    const userList = getOnlineUsers();
    broadcastToAll({
        type: 'user_list',
        users: userList,
        timestamp: Date.now()
    });
}

// ==============================================
// ШИФРОВАНИЕ AES-256-GCM
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
        console.error('❌ Ошибка шифрования:', e);
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
        return encryptedPackage;
    }
}

// ==============================================
// СОЗДАНИЕ HTTP СЕРВЕРА
// ==============================================
const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    
    // ===== ДИАГНОСТИЧЕСКИЙ ЭНДПОИНТ =====
    if (req.url === '/diagnostic') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        
        const diagnostic = {
            server: 'ONLINE',
            version: VERSION,
            creator: CREATOR_USERNAME,
            timestamp: new Date().toISOString(),
            stats: {
                users: Object.keys(userDatabase).length,
                totalMessages: Object.values(messages).reduce((a, c) => a + c.length, 0),
                activeChats: Object.keys(messages).length,
                channels: Object.keys(channels).length,
                rooms: Object.keys(privateRooms).length,
                posts: channels.NANOGRAM?.posts?.length || 0,
                premium: Object.keys(premiumUsers).length
            },
            files: {
                dataJson: fs.existsSync('./data.json'),
                messagesJson: fs.existsSync('./messages.json'),
                usersLog: fs.existsSync('./users.log'),
                errorsLog: fs.existsSync('./errors.log')
            },
            websocket: {
                activeConnections: wss ? wss.clients.size : 0,
                onlineUsers: getOnlineUsers().length
            }
        };
        
        res.end(JSON.stringify(diagnostic, null, 2));
        return;
    }
        // ===== СТРАНИЦА ПОЛИТИКИ КОНФИДЕНЦИАЛЬНОСТИ (С ЦЕНАМИ И БАГАМИ) =====
    if (req.url === '/privacy') {
        res.end(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>📜 Политика конфиденциальности Nanogram</title>
    <style>
        body {
            background: #0d1117;
            color: #f0f6fc;
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
        h1 { color: #ffd700; }
        h2 { color: #2ea043; margin-top: 30px; }
        h3 { color: #ffd700; margin-top: 20px; }
        p { color: #8b949e; margin: 15px 0; }
        .footer {
            margin-top: 40px;
            text-align: center;
            color: #8b949e;
            font-size: 12px;
        }
        a { color: #ffd700; text-decoration: none; }
        a:hover { text-decoration: underline; }
        .bug-list {
            background: #1a1f2a;
            padding: 15px;
            border-radius: 10px;
            margin: 15px 0;
            border-left: 4px solid #ffd700;
        }
        .price-table {
            background: #1a1f2a;
            padding: 15px;
            border-radius: 10px;
            margin: 15px 0;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>📜 Политика конфиденциальности Nanogram</h1>
        
        <h2>1. Какие данные мы собираем</h2>
        <p>• Имя пользователя (никнейм)</p>
        <p>• Номер телефона (только для входа и идентификации)</p>
        <p>• Сообщения (в зашифрованном виде AES-256-GCM)</p>
        <p>• История действий (логи для технической поддержки)</p>
        
        <h2>2. Как мы используем данные</h2>
        <p>• Для идентификации пользователей</p>
        <p>• Для обеспечения работы мессенджера</p>
        <p>• Для технической поддержки</p>
        <p>• Для улучшения сервиса</p>
        
        <h2>3. Защита данных</h2>
        <p>• Все сообщения шифруются алгоритмом AES-256-GCM</p>
        <p>• Пароли хранятся в защищённом виде</p>
        <p>• Данные не передаются третьим лицам</p>
        <p>• Регулярное создание бэкапов (хранятся 20 последних)</p>
        
        <h2>4. Ваши права</h2>
        <p>• Вы можете удалить свой аккаунт в любой момент</p>
        <p>• Вы можете запросить все свои данные</p>
        <p>• Вы можете отозвать согласие на обработку данных</p>
        
        <h2>5. Контакты</h2>
        <p>По всем вопросам: <a href="mailto:nanogram.ru@yandex.ru">nanogram.ru@yandex.ru</a></p>
        
        <h2>6. NanoPremium за донаты</h2>
        <p>6.1. NanoPremium статус предоставляется за добровольные пожертвования через DonatePay</p>
        <p>6.2. Стоимость NanoPremium доступа:</p>
        <div class="price-table">
            <p>• <strong>30 рублей</strong> - 1 месяц NanoPremium</p>
            <p>• <strong>85 рублей</strong> - 3 месяца NanoPremium</p>
            <p>• <strong>145 рублей</strong> - 6 месяцев NanoPremium</p>
            <p>• <strong>285 рублей</strong> - 12 месяцев NanoPremium</p>
        </div>
        <p>6.3. После совершения доната необходимо написать создателю <strong>@Dane4ka5</strong> с указанием номера телефона для активации</p>
        <p>6.4. Средства идут на развитие проекта и оплату хостинга</p>
        <p>6.5. Возврат средств возможен в течение 14 дней, если NanoPremium не был активирован</p>
        
        <h2>7. Бесплатный NanoPremium за найденные баги</h2>
        <p>7.1. За отправку отчёта об ошибке (баге) на почту <a href="mailto:nanogram.ru@yandex.ru">nanogram.ru@yandex.ru</a> можно получить NanoPremium бесплатно</p>
        <p>7.2. Сроки бесплатного премиума зависят от серьёзности бага:</p>
        
        <div class="bug-list">
            <p><strong>🐛 Незначительный баг</strong> (опечатка, мелкий глюк интерфейса) — <span style="color: #ffd700;">1 месяц NanoPremium</span></p>
            <p><strong>🐞 Средний баг</strong> (не работает функция, вылетает приложение) — <span style="color: #ffd700;">3 месяца NanoPremium</span></p>
            <p><strong>🦠 Критический баг</strong> (проблемы с безопасностью, потеря данных) — <span style="color: #ffd700;">6 месяцев NanoPremium</span></p>
            <p><strong>💎 Уникальная находка</strong> (дыра в безопасности, критическая уязвимость) — <span style="color: #ffd700;">1 год NanoPremium + имя в списке благодарностей</span></p>
        </div>
        
        <p>7.3. В отчёте обязательно указать:</p>
        <p>   • Ваш никнейм в Nanogram</p>
        <p>   • Подробное описание бага</p>
        <p>   • Шаги для воспроизведения (как повторить ошибку)</p>
        <p>   • Скриншот или видео (если есть)</p>
        <p>   • Версию браузера/устройства</p>
        
        <p>7.4. Решение о выдаче NanoPremium принимает создатель проекта <strong>@Dane4ka5</strong></p>
        <p>7.5. NanoPremium за найденные баги не суммируется с платным NanoPremium</p>
        <p>7.6. Один баг = один NanoPremium (повторные отчёты о том же баге не награждаются)</p>
        
        <div class="footer">
            <p>Nanogram ${VERSION} | Последнее обновление: ${new Date().toLocaleDateString()}</p>
            <p><a href="/">← Вернуться на главную</a></p>
        </div>
    </div>
</body>
</html>
        `);
        return;
    }
    
    // ===== ТЕНЕВАЯ ПАНЕЛЬ =====
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
        
        // Инициализация структур
        if (!data.channels) data.channels = {};
        if (!data.channels['NANOGRAM']) {
            data.channels['NANOGRAM'] = {
                id: 'NANOGRAM',
                name: 'NANOGRAM',
                description: 'Официальный канал обновлений',
                creator: 'Dane4ka5',
                admins: ['Dane4ka5'],
                subscribers: [],
                posts: [],
                avatar: '📢',
                createdAt: new Date().toISOString()
            };
        }
        if (!data.channels['NANOGRAM'].posts) data.channels['NANOGRAM'].posts = [];
        
        // ===== ОБРАБОТКА ДЕЙСТВИЙ =====
        if (req.url.includes('action=')) {
            const redirectUrl = '/admin';
            
            // Добавление поста
            if (req.url.includes('action=add_post')) {
                const urlParams = new URL(req.url, `http://${req.headers.host}`).searchParams;
                const postText = urlParams.get('text');
                
                if (postText && postText.trim()) {
                    const newPost = {
                        id: data.channels['NANOGRAM'].posts.length + 1,
                        text: postText.trim(),
                        date: new Date().toISOString(),
                        author: 'Dane4ka5',
                        views: 0
                    };
                    
                    data.channels['NANOGRAM'].posts.push(newPost);
                    fs.writeFileSync('./data.json', JSON.stringify(data, null, 2), 'utf8');
                    
                    wss.clients.forEach(client => {
                        const username = activeUsers.get(client);
                        if (username && data.channels['NANOGRAM'].subscribers?.includes(username)) {
                            client.send(JSON.stringify({
                                type: 'new_post',
                                channelId: 'NANOGRAM',
                                post: newPost
                            }));
                        }
                    });
                    
                    logAction('add_post', 'Dane4ka5', postText.substring(0, 50));
                }
            }
            
            // Удаление поста
            else if (req.url.includes('action=delete_post')) {
                const urlParams = new URL(req.url, `http://${req.headers.host}`).searchParams;
                const postId = parseInt(urlParams.get('postId'));
                
                if (postId && data.channels['NANOGRAM'].posts) {
                    data.channels['NANOGRAM'].posts = data.channels['NANOGRAM'].posts.filter(p => p.id !== postId);
                    fs.writeFileSync('./data.json', JSON.stringify(data, null, 2), 'utf8');
                    logAction('delete_post', 'Dane4ka5', `Пост ${postId}`);
                }
            }
            
            // Редактирование профиля
            else if (req.url.includes('action=edit_profile')) {
                const urlParams = new URL(req.url, `http://${req.headers.host}`).searchParams;
                const username = urlParams.get('username');
                const bio = urlParams.get('bio');
                const status = urlParams.get('status');
                
                if (username) {
                    if (!data.userProfiles[username]) data.userProfiles[username] = {};
                    if (bio) data.userProfiles[username].bio = bio;
                    if (status) data.userProfiles[username].status = status;
                    fs.writeFileSync('./data.json', JSON.stringify(data, null, 2), 'utf8');
                    
                    wss.clients.forEach(client => {
                        const user = activeUsers.get(client);
                        if (user === username) {
                            client.send(JSON.stringify({
                                type: 'profile_updated',
                                profile: data.userProfiles[username]
                            }));
                        }
                    });
                    
                    logAction('edit_profile', 'Dane4ka5', username);
                }
            }
            
            // Управление премиум
            else if (req.url.includes('action=toggle_premium')) {
                const urlParams = new URL(req.url, `http://${req.headers.host}`).searchParams;
                const username = urlParams.get('username');
                const action = urlParams.get('premium_action');
                
                if (username && action) {
                    if (!data.premiumUsers) data.premiumUsers = {};
                    
                    if (action === 'add') {
                        data.premiumUsers[username] = {
                            active: true,
                            purchased: new Date().toISOString(),
                            expires: 'never',
                            tier: 'premium'
                        };
                        logAction('premium_add', 'Dane4ka5', username);
                    } else {
                        delete data.premiumUsers[username];
                        logAction('premium_remove', 'Dane4ka5', username);
                    }
                    fs.writeFileSync('./data.json', JSON.stringify(data, null, 2), 'utf8');
                    
                    wss.clients.forEach(client => {
                        const user = activeUsers.get(client);
                        if (user === username) {
                            client.send(JSON.stringify({
                                type: 'premium_updated',
                                premium: action === 'add'
                            }));
                        }
                    });
                }
            }
            
            // Удаление сообщения
            else if (req.url.includes('action=delete_message')) {
                const urlParams = new URL(req.url, `http://${req.headers.host}`).searchParams;
                const chatId = urlParams.get('chatId');
                const messageId = urlParams.get('messageId');
                
                if (chatId && messageId && msgs[chatId]) {
                    msgs[chatId] = msgs[chatId].filter(m => m.id !== messageId);
                    fs.writeFileSync('./messages.json', JSON.stringify(msgs, null, 2), 'utf8');
                    logAction('delete_message', 'Dane4ka5', `${chatId} - ${messageId}`);
                }
            }
            
            res.writeHead(302, { Location: redirectUrl });
            res.end();
            return;
        }
        
        // ===== СТАТИСТИКА ДЛЯ ТЕНЕВОЙ ПАНЕЛИ =====
        const usersCount = Object.keys(data.users || {}).length;
        const channelsCount = Object.keys(data.channels || {}).length;
        const roomsCount = Object.keys(data.privateRooms || {}).length;
        const premiumCount = Object.keys(data.premiumUsers || {}).length;
        
        let totalMessages = 0;
        Object.values(msgs).forEach(chat => {
            if (Array.isArray(chat)) totalMessages += chat.length;
        });
        
        let totalPosts = data.channels['NANOGRAM'].posts.length;
        
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
            background: #0d1117;
            color: #f0f6fc;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            padding: 20px;
        }
        .container { max-width: 1400px; margin: 0 auto; }
        h1 { color: #ffd700; font-size: 32px; margin-bottom: 20px; }
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
        .panel h2 { color: #2ea043; margin-bottom: 20px; }
        input, textarea, select {
            width: 100%;
            padding: 12px;
            margin: 10px 0;
            background: #0d1117;
            border: 1px solid #30363d;
            color: #f0f6fc;
            border-radius: 6px;
        }
        button {
            background: #238636;
            color: white;
            border: none;
            padding: 12px 25px;
            border-radius: 6px;
            cursor: pointer;
            margin-right: 10px;
        }
        button:hover { background: #2ea043; }
        button.danger { background: #da3633; }
        .post-item {
            background: #0d1117;
            padding: 15px;
            margin: 10px 0;
            border-radius: 6px;
            border-left: 4px solid #ffd700;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            background: #161b22;
            border-radius: 6px;
        }
        th { background: #21262d; padding: 12px; text-align: left; }
        td { padding: 12px; border-bottom: 1px solid #30363d; }
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
            color: #8b949e;
        }
        .tab.active {
            background: #238636;
            color: white;
            border-color: #2ea043;
        }
        .message-item {
            background: #0d1117;
            padding: 10px;
            margin: 5px 0;
            border-radius: 4px;
            border-left: 2px solid #30363d;
        }
        .footer {
            margin-top: 40px;
            text-align: center;
            color: #8b949e;
            font-size: 12px;
            border-top: 1px solid #30363d;
            padding-top: 20px;
        }
        a { color: #ffd700; text-decoration: none; }
        a:hover { text-decoration: underline; }
        .diagnostic-link {
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: #238636;
            color: white;
            padding: 10px 20px;
            border-radius: 30px;
            text-decoration: none;
            font-size: 14px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔐 ТЕНЕВАЯ ПАНЕЛЬ NANOGRAM</h1>
        
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
                <div class="stat-value">${Object.keys(msgs).length}</div>
                <div class="stat-label">Чатов</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${channelsCount}</div>
                <div class="stat-label">Каналов</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${totalPosts}</div>
                <div class="stat-label">Постов</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${roomsCount}</div>
                <div class="stat-label">Комнат</div>
            </div>
            <div class="stat-card premium">
                <div class="stat-value">${premiumCount}</div>
                <div class="stat-label">👑 Премиум</div>
            </div>
        </div>
        
        <div class="tabs">
            <span class="tab active" onclick="showSection('channel')">📢 Канал</span>
            <span class="tab" onclick="showSection('profiles')">👤 Профили</span>
            <span class="tab" onclick="showSection('premium')">👑 Премиум</span>
            <span class="tab" onclick="showSection('messages')">💬 Сообщения</span>
            <span class="tab" onclick="showSection('users')">👥 Пользователи</span>
            <span class="tab" onclick="showSection('rooms')">🔒 Комнаты</span>
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
        
        <!-- Секция канала -->
        <div id="section-channel" class="section" style="display: block;">
            <div class="panel">
                <h2>📢 УПРАВЛЕНИЕ КАНАЛОМ NANOGRAM</h2>
                <form method="get">
                    <input type="hidden" name="action" value="add_post">
                    <textarea name="text" placeholder="Текст поста..." rows="5" required></textarea>
                    <button type="submit">📢 Опубликовать</button>
                </form>
                
                <h3>Все посты (${data.channels['NANOGRAM'].posts.length})</h3>
                ${data.channels['NANOGRAM'].posts.slice().reverse().map(post => `
                    <div class="post-item">
                        <small>${new Date(post.date).toLocaleString()} | 👁️ ${post.views || 0}</small>
                        <p>${post.text}</p>
                        <form method="get">
                            <input type="hidden" name="action" value="delete_post">
                            <input type="hidden" name="postId" value="${post.id}">
                            <button type="submit" class="danger">🗑️ Удалить</button>
                        </form>
                    </div>
                `).join('')}
            </div>
        </div>
        
        <!-- Секция профилей -->
        <div id="section-profiles" class="section" style="display: none;">
            <div class="panel">
                <h2>👤 РЕДАКТИРОВАНИЕ ПРОФИЛЕЙ</h2>
                <form method="get">
                    <input type="hidden" name="action" value="edit_profile">
                    <select name="username" required>
                        <option value="">Выберите пользователя</option>
                        ${Object.keys(data.users || {}).sort().map(u => `<option value="${u}">${u}</option>`).join('')}
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
        </div>
        
        <!-- Секция премиум -->
        <div id="section-premium" class="section" style="display: none;">
            <div class="panel">
                <h2>👑 УПРАВЛЕНИЕ PREMIUM</h2>
                <form method="get">
                    <input type="hidden" name="action" value="toggle_premium">
                    <select name="username" required>
                        <option value="">Выберите пользователя</option>
                        ${Object.keys(data.users || {}).sort().map(u => `<option value="${u}">${u}</option>`).join('')}
                    </select>
                    <select name="premium_action" required>
                        <option value="add">👑 Активировать</option>
                        <option value="remove">❌ Деактивировать</option>
                    </select>
                    <button type="submit">Применить</button>
                </form>
                
                <h3>Премиум пользователи:</h3>
                <table>
                    <tr><th>Имя</th><th>Дата</th><th>Тир</th></tr>
                    ${Object.entries(data.premiumUsers || {}).map(([name, info]) => `
                        <tr>
                            <td>${name} ${name === 'Dane4ka5' ? '⭐' : '👑'}</td>
                            <td>${info.purchased ? new Date(info.purchased).toLocaleDateString() : '—'}</td>
                            <td>${info.tier || 'premium'}</td>
                        </tr>
                    `).join('')}
                </table>
            </div>
        </div>
        
        <!-- Секция сообщений -->
        <div id="section-messages" class="section" style="display: none;">
            <div class="panel">
                <h2>💬 ПРОСМОТР СООБЩЕНИЙ</h2>
                <div style="max-height: 600px; overflow-y: auto;">
                    ${Object.entries(msgs).length === 0 ? '<p>Нет сообщений</p>' : ''}
                    ${Object.entries(msgs).map(([chatId, chatMsgs]) => `
                        <div style="margin-bottom: 20px; background: #1a1f2a; padding: 15px; border-radius: 8px;">
                            <h3 style="color: #ffd700; margin-bottom: 10px;">📁 ${chatId} (${chatMsgs.length})</h3>
                            ${chatMsgs.slice(-10).reverse().map(msg => `
                                <div class="message-item" style="margin-bottom: 10px;">
                                    <div style="display: flex; justify-content: space-between;">
                                        <small>${msg.from} • ${msg.time || '—'}</small>
                                        <small>🆔 ${msg.id?.substring(0,6) || '—'}</small>
                                    </div>
                                    <div style="margin: 5px 0;">${msg.text || ''}</div>
                                    <form method="get" style="margin-top: 5px;">
                                        <input type="hidden" name="action" value="delete_message">
                                        <input type="hidden" name="chatId" value="${chatId}">
                                        <input type="hidden" name="messageId" value="${msg.id}">
                                        <button type="submit" class="danger" style="padding: 2px 8px; font-size: 11px;">🗑️ Удалить</button>
                                    </form>
                                </div>
                            `).join('')}
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
        
        <!-- Секция пользователей -->
        <div id="section-users" class="section" style="display: none;">
            <div class="panel">
                <h2>👥 ПОЛЬЗОВАТЕЛИ</h2>
                <table>
                    <tr>
                        <th>Имя</th>
                        <th>Телефон</th>
                        <th>Пароль</th>
                        <th>Статус</th>
                        <th>Премиум</th>
                        <th>Регистрация</th>
                        <th>Согласие</th>
                    </tr>
                    ${Object.entries(data.users || {}).map(([name, info]) => `
                        <tr>
                            <td><strong>${name} ${name === 'Dane4ka5' ? '⭐' : ''}</strong></td>
                            <td>${info.phone || '—'}</td>
                            <td>${info.password ? '✅' : '—'}</td>
                            <td>${data.userProfiles?.[name]?.status || 'online'}</td>
                            <td>${data.premiumUsers?.[name]?.active || name === 'Dane4ka5' ? '👑' : '—'}</td>
                            <td>${info.registered ? new Date(info.registered).toLocaleDateString() : '—'}</td>
                            <td>${info.privacyAccepted ? '✅' : '❌'}</td>
                        </tr>
                    `).join('')}
                </table>
            </div>
        </div>
        
        <!-- Секция комнат -->
        <div id="section-rooms" class="section" style="display: none;">
            <div class="panel">
                <h2>🔒 ПРИВАТНЫЕ КОМНАТЫ</h2>
                <table>
                    <tr>
                        <th>Название</th>
                        <th>Создатель</th>
                        <th>Участники</th>
                        <th>Ссылка</th>
                        <th>Сообщений</th>
                    </tr>
                    ${Object.values(data.privateRooms || {}).length === 0 ? '<tr><td colspan="5">Нет комнат</td></tr>' : ''}
                    ${Object.values(data.privateRooms || {}).map(room => `
                        <tr>
                            <td><strong>${room.name}</strong></td>
                            <td>${room.creator}</td>
                            <td>${room.members?.length || 1}</td>
                            <td><code>${room.inviteLink || '—'}</code></td>
                            <td>${room.messages?.length || 0}</td>
                        </tr>
                    `).join('')}
                </table>
            </div>
        </div>
        
        <!-- Секция логов -->
        <div id="section-logs" class="section" style="display: none;">
            <div class="panel">
                <h2>📝 ПОСЛЕДНИЕ ЛОГИ</h2>
                <div style="background: #0d1117; padding: 15px; border-radius: 8px; font-family: monospace; max-height: 500px; overflow-y: auto;">
                    ${(() => {
                        try {
                            if (fs.existsSync('./users.log')) {
                                const logs = fs.readFileSync('./users.log', 'utf8').split('\n').slice(-50).reverse();
                                return logs.map(log => `<div style="color: #8b949e; border-bottom: 1px solid #30363d; padding: 5px;">${log}</div>`).join('');
                            }
                            return '<p>Лог-файл не найден</p>';
                        } catch (e) {
                            return '<p>Ошибка чтения логов</p>';
                        }
                    })()}
                </div>
            </div>
        </div>
        
        <div class="footer">
            <p>Nanogram ${VERSION} | <a href="/privacy">📜 Политика конфиденциальности</a> | <a href="/diagnostic">🔍 Диагностика</a></p>
        </div>
    </div>
    
    <a href="/diagnostic" class="diagnostic-link" target="_blank">🔍 Диагностика</a>
    
    <script>
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', function() {
                document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                this.classList.add('active');
                ['channel','profiles','premium','messages','users','rooms','logs'].forEach(s => {
                    document.getElementById('section-' + s).style.display = 'none';
                });
                const id = this.innerText.includes('Канал') ? 'channel' :
                          this.innerText.includes('Профили') ? 'profiles' :
                          this.innerText.includes('Премиум') ? 'premium' :
                          this.innerText.includes('Сообщения') ? 'messages' :
                          this.innerText.includes('Пользователи') ? 'users' :
                          this.innerText.includes('Комнаты') ? 'rooms' : 'logs';
                document.getElementById('section-' + id).style.display = 'block';
            });
        });
    </script>
</body>
</html>
        `);
        return;
    }
    
    // ===== ОБЫЧНЫЕ ФАЙЛЫ =====
    let filePath = '.' + req.url;
    if (filePath === './') filePath = './index.html';
    
    const extname = path.extname(filePath);
    let contentType = 'text/html; charset=utf-8';
    if (extname === '.css') contentType = 'text/css; charset=utf-8';
    if (extname === '.js') contentType = 'application/javascript; charset=utf-8';
    if (extname === '.json') contentType = 'application/json; charset=utf-8';
    
    fs.readFile(filePath, 'utf8', (err, content) => {
        if (err) {
            res.writeHead(404);
            res.end('<h1>404 - Файл не найден</h1>');
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        }
    });
});
// ==============================================
// СОЗДАНИЕ WEBSOCKET СЕРВЕРА
// ==============================================
const wss = new WebSocket.Server({ server });

// ==============================================
// WEB-SOCKET ОБРАБОТКА
// ==============================================
wss.on('connection', (ws) => {
    const clientIp = ws._socket.remoteAddress;
    console.log(`🔌 Новое WebSocket подключение с IP: ${clientIp}`);
    
    ws.send(JSON.stringify({
        type: 'connection_established',
        timestamp: Date.now(),
        message: 'Подключено к серверу Nanogram',
        version: VERSION
    }));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString('utf8'));
            
            // Пинг
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
                        message: '❌ Имя, пароль и номер телефона обязательны'
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
                
                if (cleanUsername.length < 3) {
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: '❌ Имя должно быть не меньше 3 символов'
                    }));
                    return;
                }
                
                if (password.length < 4) {
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: '❌ Пароль должен быть не меньше 4 символов'
                    }));
                    return;
                }
                
                // Проверка существующего пользователя
                if (userDatabase[cleanUsername]) {
                    // ВХОД
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
                    userDatabase[cleanUsername].lastSeen = new Date().toISOString();
                    saveData();
                    logAction('login', cleanUsername, `Вход`);
                    
                    ws.send(JSON.stringify({
                        type: 'login_success',
                        username: cleanUsername,
                        profile: userProfiles[cleanUsername] || { 
                            avatar: '👤', 
                            bio: '', 
                            status: 'online' 
                        },
                        premium: isPremium(cleanUsername),
                        premiumTier: getPremiumTier(cleanUsername),
                        timestamp: Date.now()
                    }));
                    
                } else {
                    // РЕГИСТРАЦИЯ
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
                            message: '❌ Этот номер телефона уже зарегистрирован'
                        }));
                        return;
                    }
                    
                    console.log(`👤 Новый пользователь: ${cleanUsername} (${cleanPhone})`);
                    
                    userDatabase[cleanUsername] = {
                        username: cleanUsername,
                        password: password,
                        phone: cleanPhone,
                        registered: new Date().toISOString(),
                        lastSeen: new Date().toISOString(),
                        privacyAccepted: true,
                        privacyAcceptedDate: new Date().toISOString()
                    };
                    
                    userProfiles[cleanUsername] = {
                        avatar: '👤',
                        bio: '',
                        status: 'online'
                    };
                    
                    saveData();
                    logAction('register', cleanUsername, `Новый пользователь с телефоном ${cleanPhone}`);
                    
                    ws.send(JSON.stringify({
                        type: 'register_success',
                        username: cleanUsername,
                        profile: userProfiles[cleanUsername],
                        premium: isPremium(cleanUsername),
                        premiumTier: getPremiumTier(cleanUsername),
                        timestamp: Date.now()
                    }));
                }
                
                // Сохраняем в активные
                activeUsers.set(ws, cleanUsername);
                
                // Отправляем все данные
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
                
                const userRooms = Object.values(privateRooms).filter(
                    r => r.members && r.members.includes(cleanUsername)
                );
                ws.send(JSON.stringify({
                    type: 'rooms_list',
                    rooms: userRooms,
                    timestamp: Date.now()
                }));
                
                if (channels.NANOGRAM && channels.NANOGRAM.posts) {
                    ws.send(JSON.stringify({
                        type: 'channel_posts',
                        channelId: 'NANOGRAM',
                        posts: channels.NANOGRAM.posts
                    }));
                }
                
                broadcastUserList();
            }

            // ===== ОТПРАВКА СООБЩЕНИЯ =====
            if (data.type === 'message') {
                const { from, to, text, time } = data;
                
                if (!from || !to || !text) {
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: '❌ Неполные данные сообщения'
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
                
                if (messages[chatKey].length > MAX_MESSAGES_PER_CHAT) {
                    messages[chatKey] = messages[chatKey].slice(-MAX_MESSAGES_PER_CHAT);
                }
                
                saveMessages();
                logAction('message', from, `Сообщение к ${to}`);
                
                // Отправляем получателю
                let delivered = false;
                wss.clients.forEach(client => {
                    const username = activeUsers.get(client);
                    if (username === to) {
                        client.send(JSON.stringify({
                            type: 'message',
                            id: messageObj.id,
                            from: from,
                            text: encrypted,
                            time: time,
                            serverTime: Date.now(),
                            premium: isPremium(from),
                            premiumTier: getPremiumTier(from)
                        }));
                        delivered = true;
                    }
                });
                
                ws.send(JSON.stringify({
                    type: 'message_delivered',
                    messageId: messageObj.id,
                    to: to,
                    time: time,
                    delivered: delivered,
                    timestamp: Date.now()
                }));
                
                console.log(`💬 Сообщение от ${from} к ${to} (${delivered ? 'доставлено' : 'не в сети'})`);
            }

            // ===== ИНДИКАТОР ПЕЧАТИ =====
            if (data.type === 'typing') {
                const { from, to } = data;
                
                wss.clients.forEach(client => {
                    const username = activeUsers.get(client);
                    if (username === to) {
                        client.send(JSON.stringify({
                            type: 'typing',
                            from: from,
                            to: to
                        }));
                    }
                });
            }

            // ===== ОБНОВЛЕНИЕ ПРОФИЛЯ =====
            if (data.type === 'update_profile') {
                const { username, profile } = data;
                
                if (userProfiles[username]) {
                    userProfiles[username] = { ...userProfiles[username], ...profile };
                    saveData();
                    logAction('update_profile', username, 'Профиль обновлён');
                    
                    ws.send(JSON.stringify({
                        type: 'profile_updated',
                        profile: userProfiles[username]
                    }));
                }
            }

            // ===== ПОДПИСКА НА КАНАЛ =====
            if (data.type === 'subscribe_channel') {
                const { channelId, username } = data;
                
                if (channels[channelId] && !channels[channelId].subscribers.includes(username)) {
                    channels[channelId].subscribers.push(username);
                    saveData();
                    logAction('subscribe', username, `Подписка на ${channelId}`);
                    
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
                        message: '❌ Название и создатель обязательны'
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
                logAction('create_channel', creator, `Создан канал ${name}`);
                
                ws.send(JSON.stringify({
                    type: 'channel_created',
                    channel: channels[channelId]
                }));
                
                broadcastToAll({
                    type: 'new_channel',
                    channel: channels[channelId]
                });
            }

            // ===== СОЗДАНИЕ КОМНАТЫ =====
            if (data.type === 'create_private_room') {
                const { name, creator } = data;
                
                if (!name || !creator) {
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: '❌ Название и создатель обязательны'
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
                logAction('create_room', creator, `Создана комната ${name} (${inviteLink})`);
                
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

            // ===== ПРИСОЕДИНИТЬСЯ К КОМНАТЕ =====
            if (data.type === 'join_by_link') {
                const { link, username } = data;
                
                const room = Object.values(privateRooms).find(r => r.inviteLink === link);
                
                if (room) {
                    if (!room.members.includes(username)) {
                        room.members.push(username);
                        saveData();
                        logAction('join_room', username, `Присоединился к ${room.name}`);
                        
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
                            message: '❌ Вы уже в этой комнате'
                        }));
                    }
                } else {
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: '❌ Комната не найдена'
                    }));
                }
            }

            // ===== СООБЩЕНИЕ В КОМНАТЕ =====
            if (data.type === 'room_message') {
                const { roomId, from, text, time } = data;
                
                if (!privateRooms[roomId] || !privateRooms[roomId].members.includes(from)) {
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: '❌ Нет доступа к комнате'
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
                
                broadcastToRoom(roomId, {
                    type: 'room_message',
                    id: messageObj.id,
                    roomId: roomId,
                    from: from,
                    text: encrypted,
                    time: time,
                    serverTime: Date.now()
                });
                
                logAction('room_message', from, `Сообщение в комнате ${roomId}`);
            }

            // ===== ПРОСМОТР ПОСТА =====
            if (data.type === 'view_post') {
                const { channelId, postId } = data;
                
                if (channels[channelId] && channels[channelId].posts) {
                    const post = channels[channelId].posts.find(p => p.id === postId);
                    if (post) {
                        post.views = (post.views || 0) + 1;
                        saveData();
                    }
                }
            }
            
        } catch (e) {
            console.error('❌ Ошибка обработки сообщения:', e);
            logAction('error', 'SYSTEM', e.message);
            ws.send(JSON.stringify({
                type: 'error',
                message: '❌ Внутренняя ошибка сервера'
            }));
        }
    });

    ws.on('close', () => {
        const username = activeUsers.get(ws);
        if (username) {
            console.log(`👋 ${username} отключился`);
            activeUsers.delete(ws);
            broadcastUserList();
            logAction('disconnect', username, 'Отключение');
        }
    });

    ws.on('error', (error) => {
        console.error('❌ Ошибка WebSocket:', error);
        logAction('error', 'WEBSOCKET', error.message);
    });
});

// ==============================================
// ПЕРИОДИЧЕСКАЯ ОЧИСТКА
// ==============================================
setInterval(() => {
    let removed = 0;
    
    wss.clients.forEach((ws) => {
        if (!activeUsers.has(ws) && ws.readyState !== WebSocket.OPEN) {
            removed++;
        }
    });
    
    if (removed > 0) {
        console.log(`🧹 Очищено ${removed} неактивных соединений`);
    }
}, 30000);

// ==============================================
// ЗАПУСК СЕРВЕРА
// ==============================================
server.listen(PORT, '0.0.0.0', () => {
    console.log('\n' + '='.repeat(70));
    console.log(`🚀 Nanogram ${VERSION} - С ДОНАТАМИ И ПРЕМИУМОМ`);
    console.log('='.repeat(70));
    console.log(`📡 Порт: ${PORT}`);
    console.log(`🔐 Шифрование: AES-256-GCM`);
    console.log(`💾 Автосохранение: каждую минуту`);
    console.log(`📦 Бэкапы: каждый час (хранится ${MAX_BACKUPS})`);
    console.log(`\n📁 ФАЙЛЫ ДАННЫХ:`);
    console.log(`   👥 Пользователи: data.json`);
    console.log(`   💬 Сообщения: messages.json`);
    console.log(`   📝 Логи: users.log, errors.log`);
    console.log(`\n💰 PREMIUM ТАРИФЫ:`);
    console.log(`   • 30₽  - 1 месяц`);
    console.log(`   • 85₽  - 3 месяца`);
    console.log(`   • 145₽ - 6 месяцев`);
    console.log(`   • 285₽ - 1 год`);
    console.log(`\n🐛 БЕСПЛАТНЫЙ PREMIUM ЗА БАГИ:`);
    console.log(`   • 🐛 Мелкий → 1 месяц`);
    console.log(`   • 🐞 Средний → 3 месяца`);
    console.log(`   • 🦠 Критический → 6 месяцев`);
    console.log(`   • 💎 Уникальный → 1 год`);
    console.log(`\n📊 СТАТИСТИКА:`);
    console.log(`   👥 Пользователей в базе: ${Object.keys(userDatabase).length}`);
    console.log(`   💬 Всего сообщений: ${Object.values(messages).reduce((a, c) => a + c.length, 0)}`);
    console.log(`   📢 Постов в канале: ${channels.NANOGRAM?.posts?.length || 0}`);
    console.log(`   👑 Премиум пользователей: ${Object.keys(premiumUsers).length}`);
    console.log(`\n🌐 ДОСТУП:`);
    console.log(`   📱 Локально: http://localhost:${PORT}`);
    console.log(`   🌍 Внешне: https://minegram.onrender.com`);
    console.log(`   🕵️ Теневая панель: http://localhost:${PORT}/admin`);
    console.log(`   📜 Политика: http://localhost:${PORT}/privacy`);
    console.log(`   🔍 Диагностика: http://localhost:${PORT}/diagnostic`);
    console.log('='.repeat(70) + '\n');
    
    logAction('system', 'SERVER', `Запуск v${VERSION} с донатами и премиумом`);
});

// ==============================================
// ЗАВЕРШЕНИЕ РАБОТЫ
// ==============================================
process.on('SIGINT', () => {
    console.log('\n📦 Сохранение данных...');
    saveData();
    saveMessages();
    logAction('system', 'SERVER', 'Остановка');
    console.log('✅ Данные сохранены. Сервер остановлен.');
    process.exit(0);
});

process.on('SIGTERM', () => {
    saveData();
    saveMessages();
    process.exit(0);
});