const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

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

// НАСТРОЙКА ЯНДЕКС ПОЧТЫ (ТВОИ ДАННЫЕ)
const transporter = nodemailer.createTransport({
    host: 'smtp.yandex.ru',
    port: 465,
    secure: true,
    auth: {
        user: 'nanogram.ru@yandex.ru',
        pass: 'tjwrprmukhyycnxs' // Пароль приложения (правильный!)
    }
});

// Хранилища
const users = new Map(); // socket -> {username, email}
const emailCodes = new Map(); // email -> {code, timestamp}
let messages = {};
let userDatabase = {};

// Канал NANOGRAM
let channels = {
    'NANOGRAM': {
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
                text: '📧 Вход через Яндекс Почту работает!',
                date: new Date().toISOString(),
                views: 0
            },
            {
                id: 3,
                text: '🔐 Шифрование AES-256 активно',
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

// Отправка кода на почту
async function sendEmailCode(email, code) {
    const mailOptions = {
        from: 'nanogram.ru@yandex.ru',
        to: email,
        subject: '🔐 Код входа в Nanogram',
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #1a1b1e; color: #e4e6eb; border-radius: 10px;">
                <h1 style="color: #a5b6ff;">🧪 Nanogram</h1>
                <p>Ваш код для входа:</p>
                <div style="font-size: 32px; font-weight: bold; color: #ffd700; text-align: center; padding: 20px; background: rgba(255,255,255,0.1); border-radius: 10px;">
                    ${code}
                </div>
                <p>Код действителен 5 минут.</p>
                <p style="color: #b0b3b8; font-size: 12px;">Если вы не запрашивали код, просто проигнорируйте это письмо.</p>
            </div>
        `
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log(`📧 Код отправлен на ${email}`);
        return true;
    } catch (error) {
        console.error('❌ Ошибка отправки:', error);
        return false;
    }
}

wss.on('connection', (ws) => {
    console.log('🔌 Новое подключение');

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            console.log('📩 Получено:', data.type);

            // Запрос кода
            if (data.type === 'request_code') {
                const email = data.email;
                const code = Math.floor(100000 + Math.random() * 900000).toString();
                
                emailCodes.set(email, {
                    code: code,
                    timestamp: Date.now()
                });
                
                const sent = await sendEmailCode(email, code);
                
                ws.send(JSON.stringify({
                    type: 'code_sent',
                    email: email,
                    success: sent
                }));
            }

            // Проверка кода
            if (data.type === 'verify_code') {
                const email = data.email;
                const inputCode = data.code;
                const username = data.username;
                const stored = emailCodes.get(email);
                
                if (!stored) {
                    ws.send(JSON.stringify({
                        type: 'verify_result',
                        success: false,
                        error: 'Код не найден'
                    }));
                    return;
                }
                
                if (Date.now() - stored.timestamp > 5 * 60 * 1000) {
                    emailCodes.delete(email);
                    ws.send(JSON.stringify({
                        type: 'verify_result',
                        success: false,
                        error: 'Код истёк'
                    }));
                    return;
                }
                
                if (stored.code === inputCode) {
                    emailCodes.delete(email);
                    
                    if (!userDatabase[email]) {
                        userDatabase[email] = {
                            username: username,
                            registered: new Date().toISOString()
                        };
                        saveData();
                    }
                    
                    ws.send(JSON.stringify({
                        type: 'verify_result',
                        success: true,
                        email: email,
                        username: userDatabase[email].username
                    }));
                } else {
                    ws.send(JSON.stringify({
                        type: 'verify_result',
                        success: false,
                        error: 'Неверный код'
                    }));
                }
            }

            // Регистрация
            if (data.type === 'register') {
                const username = data.username;
                const email = data.email;
                
                users.set(ws, { username, email });
                
                ws.send(JSON.stringify({
                    type: 'registered',
                    username: username
                }));
                
                // Отправляем историю
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
                
                ws.send(JSON.stringify({
                    type: 'channels',
                    channels: channels
                }));
                
                broadcastUserList();
            }

            // Подписка на канал
            if (data.type === 'subscribe_channel') {
                const channelId = data.channelId;
                const username = users.get(ws)?.username;
                
                if (channels[channelId] && username) {
                    if (!channels[channelId].subscribers.includes(username)) {
                        channels[channelId].subscribers.push(username);
                        saveData();
                    }
                }
            }

            // Новый пост (только Dane4ka5)
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
                    
                    broadcastToChannel(channelId, {
                        type: 'new_post',
                        channelId: channelId,
                        post: newPost
                    });
                }
            }

            // Отправка сообщения
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
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
                type: 'user_list',
                users: userList
            }));
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
    console.log(`📧 Почта: nanogram.ru@yandex.ru (работает!)`);
    console.log(`📢 Канал NANOGRAM для Dane4ka5`);
    console.log(`🔐 Шифрование AES-256`);
});