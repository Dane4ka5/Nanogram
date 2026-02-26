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

// Хранилища
const users = new Map(); // socket -> {username, phone}
let messages = {}; // история сообщений
let channels = {
    'NANOGRAM': {  // Важно! То же название, что в HTML
        name: 'NANOGRAM',
        description: 'Официальный канал обновлений',
        subscribers: [],
        posts: [
            {
                id: 1,
                text: '🎉 Nanogram запущен! 300+ пользователей ждут релиз',
                date: new Date().toISOString(),
                views: 0
            },
            {
                id: 2,
                text: '🔐 Добавлено шифрование AES-256',
                date: new Date().toISOString(),
                views: 0
            },
            {
                id: 3,
                text: '📱 Вход по SMS и политика конфиденциальности (152-ФЗ)',
                date: new Date().toISOString(),
                views: 0
            }
        ]
    }
};

// Коды для SMS (временное хранение)
const smsCodes = new Map(); // phone -> code

// Загружаем сохранённые данные
try {
    const data = fs.readFileSync('./data.json', 'utf8');
    const saved = JSON.parse(data);
    messages = saved.messages || {};
    channels = saved.channels || channels;
    console.log('📂 Данные загружены');
} catch (e) {
    console.log('📂 Создаю новые файлы данных');
    // Сохраняем начальные данные
    saveData();
}

function saveData() {
    fs.writeFileSync('./data.json', JSON.stringify({
        messages,
        channels
    }, null, 2));
    console.log('💾 Данные сохранены');
}

wss.on('connection', (ws) => {
    console.log('🔌 Новое подключение');

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('📩 Получено:', data.type);

            if (data.type === 'register') {
                const username = data.username;
                const phone = data.phone;
                
                users.set(ws, { username, phone });
                
                // Отправляем подтверждение
                ws.send(JSON.stringify({
                    type: 'registered',
                    username: username
                }));
                
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
                saveData();
            }

            if (data.type === 'request_sms') {
                const phone = data.phone;
                const code = Math.floor(100000 + Math.random() * 900000);
                smsCodes.set(phone, code);
                
                console.log(`📱 SMS код для ${phone}: ${code}`);
                
                ws.send(JSON.stringify({
                    type: 'sms_sent',
                    phone: phone
                }));
            }

            if (data.type === 'verify_sms') {
                const phone = data.phone;
                const code = data.code;
                
                if (smsCodes.get(phone) === parseInt(code)) {
                    ws.send(JSON.stringify({
                        type: 'sms_verified',
                        success: true
                    }));
                } else {
                    ws.send(JSON.stringify({
                        type: 'sms_verified',
                        success: false
                    }));
                }
            }

            if (data.type === 'subscribe_channel') {
                const channelId = data.channelId;
                const username = users.get(ws).username;
                
                if (channels[channelId]) {
                    if (!channels[channelId].subscribers.includes(username)) {
                        channels[channelId].subscribers.push(username);
                        saveData();
                    }
                    
                    ws.send(JSON.stringify({
                        type: 'subscribed',
                        channelId: channelId
                    }));
                }
            }

            if (data.type === 'new_post') {
                const channelId = data.channelId;
                const postText = data.text;
                const username = users.get(ws).username;
                
                // Только Dane4ka5 может создавать посты
                if (username === 'Dane4ka5' && channels[channelId]) {
                    const newPost = {
                        id: channels[channelId].posts.length + 1,
                        text: postText,
                        date: new Date().toISOString(),
                        views: 0
                    };
                    
                    channels[channelId].posts.push(newPost);
                    saveData();
                    
                    // Рассылаем всем подписчикам
                    broadcastToChannel(channelId, {
                        type: 'new_post',
                        channelId: channelId,
                        post: newPost
                    });
                    
                    console.log(`📢 Новый пост в канале ${channelId}: ${postText}`);
                }
            }

            if (data.type === 'message') {
                const from = data.from;
                const to = data.to;
                const encryptedText = data.text; // уже зашифровано на клиенте
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
                
                // Ограничим историю до 100 сообщений на чат
                if (messages[chatKey].length > 100) {
                    messages[chatKey] = messages[chatKey].slice(-100);
                }
                
                saveData();
                
                // Отправляем получателю
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
                
                // Подтверждение отправителю
                ws.send(JSON.stringify({
                    type: 'message_delivered',
                    to: to,
                    text: encryptedText,
                    time: time
                }));
            }
            
        } catch (e) {
            console.error('❌ Ошибка:', e);
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Nanogram запущен на порту ${PORT}`);
    console.log(`📢 Канал NANOGRAM активен (админ: Dane4ka5)`);
    console.log(`🔐 Поддержка шифрования AES-256`);
    console.log(`📱 SMS-верификация готова`);
    console.log(`📜 Политика конфиденциальности 152-ФЗ`);
});