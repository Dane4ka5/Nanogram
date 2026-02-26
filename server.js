const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const server = http.createServer((req, res) => {
    let filePath = '.' + req.url;
    if (filePath === './') {
        filePath = './index.html';
    }

    const extname = path.extname(filePath);
    let contentType = 'text/html';
    if (extname === '.css') contentType = 'text/css';
    if (extname === '.js') contentType = 'text/javascript';
    
    fs.readFile(filePath, (error, content) => {
        if (error) {
            res.writeHead(404);
            res.end('Файл не найден');
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        }
    });
});

const wss = new WebSocket.Server({ server });

// ==============================================
// ХРАНИЛИЩА ДАННЫХ
// ==============================================
const users = new Map(); // socket -> {username, email}
let messages = {}; // история сообщений
let userDatabase = {}; // база пользователей

// Канал NANOGRAM
let channels = {
    'NANOGRAM': {
        name: 'NANOGRAM',
        description: 'Официальный канал обновлений',
        subscribers: [],
        posts: [
            {
                id: 1,
                text: '🎉 Nanogram запущен! Новая эра безопасности',
                date: new Date().toISOString(),
                views: 0
            },
            {
                id: 2,
                text: '📧 Техподдержка: support@nanogram.ru (пишите сюда)',
                date: new Date().toISOString(),
                views: 0
            }
        ]
    }
};

// Загружаем данные
try {
    const data = fs.readFileSync('./data.json', 'utf8');
    const saved = JSON.parse(data);
    messages = saved.messages || {};
    channels = saved.channels || channels;
    userDatabase = saved.users || {};
    console.log('📂 Данные загружены');
} catch (e) {
    console.log('📂 Создаю новые файлы');
    saveData();
}

function saveData() {
    fs.writeFileSync('./data.json', JSON.stringify({
        messages,
        channels,
        users: userDatabase
    }, null, 2));
    console.log('💾 Данные сохранены');
}

// ==============================================
// ОБРАБОТКА ПОДКЛЮЧЕНИЙ
// ==============================================
wss.on('connection', (ws) => {
    console.log('🔌 Новое подключение');

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            console.log('📩 Получено:', data.type);

            // ===== РЕГИСТРАЦИЯ =====
            if (data.type === 'register') {
                const username = data.username;
                const email = data.email;
                
                // Проверяем, есть ли уже такой пользователь
                let existingUser = null;
                for (let [key, value] of Object.entries(userDatabase)) {
                    if (value.username === username) {
                        existingUser = value;
                        break;
                    }
                }
                
                if (existingUser) {
                    // Вход существующего пользователя
                    console.log(`👋 Вход: ${username} (${email})`);
                    ws.send(JSON.stringify({
                        type: 'login_success',
                        username: username,
                        email: email,
                        message: 'Добро пожаловать назад!'
                    }));
                } else {
                    // Регистрация нового
                    userDatabase[email] = {
                        username: username,
                        registered: new Date().toISOString(),
                        lastSeen: new Date().toISOString()
                    };
                    saveData();
                    console.log(`👤 Новый пользователь: ${username} (${email})`);
                    
                    ws.send(JSON.stringify({
                        type: 'register_success',
                        username: username,
                        email: email,
                        message: 'Регистрация успешна!'
                    }));
                }
                
                users.set(ws, { username, email });
                
                // Отправляем историю сообщений
                const userMessages = {};
                for (let [chatId, msgs] of Object.entries(messages)) {
                    if (chatId.includes(username)) {
                        userMessages[chatId] = msgs;
                    }
                }
                
                ws.send(JSON.stringify({
                    type: 'history',
                    history: userMessages
                }));
                
                // Отправляем каналы
                ws.send(JSON.stringify({
                    type: 'channels',
                    channels: channels
                }));
                
                broadcastUserList();
            }

            // ===== ПОДПИСКА НА КАНАЛ =====
            if (data.type === 'subscribe_channel') {
                const channelId = data.channelId;
                const username = users.get(ws)?.username;
                
                if (channels[channelId] && username) {
                    if (!channels[channelId].subscribers.includes(username)) {
                        channels[channelId].subscribers.push(username);
                        saveData();
                        console.log(`📢 ${username} подписался на канал ${channelId}`);
                    }
                }
            }

            // ===== НОВЫЙ ПОСТ (ТОЛЬКО Dane4ka5) =====
            if (data.type === 'new_post') {
                const channelId = data.channelId;
                const postText = data.text;
                const username = users.get(ws)?.username;
                
                if (username === 'Dane4ka5' && channels[channelId]) {
                    const newPost = {
                        id: channels[channelId].posts.length + 1,
                        text: postText,
                        date: new Date().toISOString(),
                        views: 0
                    };
                    
                    channels[channelId].posts.push(newPost);
                    saveData();
                    
                    console.log(`📢 Новый пост в канале ${channelId}: ${postText}`);
                    
                    broadcastToChannel(channelId, {
                        type: 'new_post',
                        channelId: channelId,
                        post: newPost
                    });
                }
            }

            // ===== ОТПРАВКА СООБЩЕНИЯ =====
            if (data.type === 'message') {
                const from = data.from;
                const to = data.to;
                const encryptedText = data.text;
                const time = data.time;
                
                const chatKey = [from, to].sort().join('_');
                
                if (!messages[chatKey]) {
                    messages[chatKey] = [];
                }
                
                messages[chatKey].push({
                    from: from,
                    text: encryptedText,
                    time: time,
                    timestamp: Date.now()
                });
                
                if (messages[chatKey].length > 100) {
                    messages[chatKey] = messages[chatKey].slice(-100);
                }
                
                saveData();
                
                wss.clients.forEach(client => {
                    const userData = users.get(client);
                    if (userData && userData.username === to) {
                        client.send(JSON.stringify({
                            type: 'message',
                            from: from,
                            text: encryptedText,
                            time: time
                        }));
                    }
                });
                
                ws.send(JSON.stringify({
                    type: 'message_delivered',
                    to: to,
                    time: time
                }));
            }
            
        } catch (e) {
            console.error('❌ Ошибка обработки:', e);
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
});

// ==============================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ==============================================
function broadcastUserList() {
    const userList = Array.from(users.values()).map(u => u.username);
    const message = JSON.stringify({
        type: 'user_list',
        users: userList
    });
    
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
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

// ==============================================
// ЗАПУСК СЕРВЕРА
// ==============================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log('\n' + '='.repeat(50));
    console.log('🚀 Nanogram запущен!');
    console.log('='.repeat(50));
    console.log(`📡 Порт: ${PORT}`);
    console.log('\n' + '╔'.repeat(50));
    console.log('║     🚀 НОВАЯ ЭРА БЕЗОПАСНОСТИ');
    console.log('║');
    console.log('║  ✓ Регистрация и вход');
    console.log('║  ✓ Шифрование AES-256');
    console.log('║  ✓ Канал NANOGRAM');
    console.log('║  ✓ 152-ФЗ Политика конфиденциальности');
    console.log('║');
    console.log('║  "Безопасность должна быть');
    console.log('║   доступной для всех"');
    console.log('║         © Nanogram 2024');
    console.log('╚' + '═'.repeat(49));
    console.log('\n📧 Техподдержка: support@nanogram.ru');
    console.log('📱 Локальный доступ: http://localhost:' + PORT);
    console.log('🌍 Внешний доступ: https://minegram.onrender.com\n');
});