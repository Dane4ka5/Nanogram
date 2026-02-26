const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

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
// НАСТРОЙКА ЯНДЕКС ПОЧТЫ (ТВОИ ДАННЫЕ)
// ==============================================
const transporter = nodemailer.createTransport({
    host: 'smtp.yandex.ru',
    port: 465,
    secure: true,
    auth: {
        user: 'nanogram.ru@yandex.ru',
        pass: 'tjwrprmukhyycnxs' // Пароль приложения
    }
});

// Проверка подключения к почте
transporter.verify(function(error, success) {
    if (error) {
        console.log('❌ Ошибка подключения к Яндекс Почте:');
        console.log(error);
    } else {
        console.log('✅ Подключение к Яндекс Почте успешно!');
    }
});

// ==============================================
// ХРАНИЛИЩА ДАННЫХ
// ==============================================
const users = new Map(); // socket -> {username, email}
const emailCodes = new Map(); // email -> {code, timestamp}
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
                text: '📧 Вход через Яндекс Почту работает!',
                date: new Date().toISOString(),
                views: 0
            }
        ]
    }
};

// Загрузка сохранённых данных
try {
    const data = fs.readFileSync('./data.json', 'utf8');
    const saved = JSON.parse(data);
    messages = saved.messages || {};
    channels = saved.channels || channels;
    userDatabase = saved.users || {};
    console.log('📂 Данные загружены');
} catch (e) {
    console.log('📂 Создаю новые файлы данных');
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
// ФУНКЦИЯ ОТПРАВКИ КОДА НА ПОЧТУ
// ==============================================
async function sendEmailCode(email, code) {
    console.log(`📧 Попытка отправки кода ${code} на ${email}`);
    
    const mailOptions = {
        from: 'nanogram.ru@yandex.ru',
        to: email,
        subject: '🔐 Код входа в Nanogram',
        html: `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        background: #1a1b1e;
                        margin: 0;
                        padding: 20px;
                    }
                    .container {
                        max-width: 600px;
                        margin: 0 auto;
                        background: rgba(32, 33, 36, 0.95);
                        border-radius: 20px;
                        padding: 30px;
                        border: 1px solid rgba(255, 255, 255, 0.1);
                    }
                    .header {
                        text-align: center;
                        margin-bottom: 30px;
                    }
                    .header h1 {
                        color: #a5b6ff;
                        font-size: 32px;
                        margin: 0;
                    }
                    .code-box {
                        background: rgba(90, 110, 200, 0.2);
                        border-radius: 15px;
                        padding: 30px;
                        text-align: center;
                        margin: 20px 0;
                        border: 2px solid #5c6bc0;
                    }
                    .code {
                        font-size: 48px;
                        font-weight: bold;
                        color: #ffd700;
                        letter-spacing: 5px;
                        font-family: monospace;
                    }
                    .info {
                        color: #b0b3b8;
                        font-size: 14px;
                        line-height: 1.6;
                        margin: 20px 0;
                    }
                    .footer {
                        text-align: center;
                        margin-top: 30px;
                        padding-top: 20px;
                        border-top: 1px solid rgba(255,255,255,0.1);
                        color: #7a6b9a;
                        font-size: 12px;
                    }
                    .warning {
                        background: rgba(255, 215, 0, 0.1);
                        border-left: 4px solid #ffd700;
                        padding: 10px 15px;
                        margin: 20px 0;
                        color: #ffd700;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>🧪 Nanogram</h1>
                    </div>
                    
                    <div class="warning">
                        ⚡ Никому не сообщайте этот код!
                    </div>
                    
                    <div class="code-box">
                        <div style="color: #e4e6eb; margin-bottom: 10px;">Ваш код для входа:</div>
                        <div class="code">${code}</div>
                    </div>
                    
                    <div class="info">
                        <p>🔐 Код действителен в течение 5 минут.</p>
                        <p>📱 Если вы не запрашивали код, просто проигнорируйте это письмо.</p>
                    </div>
                    
                    <div class="footer">
                        <p>🚀 НОВАЯ ЭРА БЕЗОПАСНОСТИ</p>
                        <p>✓ Шифрование AES-256 ✓ Защита персональных данных</p>
                        <p>© Nanogram 2024</p>
                    </div>
                </div>
            </body>
            </html>
        `
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log(`✅ Код успешно отправлен на ${email}`);
        console.log(`📨 ID письма: ${info.messageId}`);
        
        // Дублируем код в консоль для теста
        console.log('╔════════════════════════════════════════╗');
        console.log('║     🔐 КОД ДЛЯ ВХОДА (ТЕСТ)          ║');
        console.log('╠════════════════════════════════════════╣');
        console.log(`║  Email: ${email.padEnd(28)} ║`);
        console.log(`║  Код:   ${code.padEnd(28)} ║`);
        console.log('╚════════════════════════════════════════╝');
        
        return true;
    } catch (error) {
        console.log('❌ Ошибка отправки:');
        console.log(error);
        return false;
    }
}

// ==============================================
// WEB-SOCKET ОБРАБОТЧИКИ
// ==============================================
wss.on('connection', (ws) => {
    console.log('🔌 Новое подключение');

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            console.log('📩 Получено:', data.type);

            // ===== ЗАПРОС КОДА =====
            if (data.type === 'request_code') {
                const email = data.email;
                
                // Генерация 6-значного кода
                const code = Math.floor(100000 + Math.random() * 900000).toString();
                
                // Сохраняем код с временной меткой
                emailCodes.set(email, {
                    code: code,
                    timestamp: Date.now()
                });
                
                console.log(`🔐 Сгенерирован код ${code} для ${email}`);
                
                // Отправляем код на почту
                const sent = await sendEmailCode(email, code);
                
                ws.send(JSON.stringify({
                    type: 'code_sent',
                    email: email,
                    success: sent,
                    message: sent ? 'Код отправлен на почту' : 'Ошибка отправки'
                }));
            }

            // ===== ПРОВЕРКА КОДА =====
            if (data.type === 'verify_code') {
                const email = data.email;
                const inputCode = data.code;
                const username = data.username;
                const stored = emailCodes.get(email);
                
                // Проверяем существование кода
                if (!stored) {
                    ws.send(JSON.stringify({
                        type: 'verify_result',
                        success: false,
                        error: 'Код не найден. Запросите новый код.'
                    }));
                    return;
                }
                
                // Проверяем срок действия (5 минут)
                if (Date.now() - stored.timestamp > 5 * 60 * 1000) {
                    emailCodes.delete(email);
                    ws.send(JSON.stringify({
                        type: 'verify_result',
                        success: false,
                        error: 'Код истёк. Запросите новый код.'
                    }));
                    return;
                }
                
                // Проверяем код
                if (stored.code === inputCode) {
                    emailCodes.delete(email);
                    
                    // Сохраняем пользователя если новый
                    if (!userDatabase[email]) {
                        userDatabase[email] = {
                            username: username,
                            registered: new Date().toISOString(),
                            lastSeen: new Date().toISOString()
                        };
                        saveData();
                        console.log(`👤 Новый пользователь: ${username} (${email})`);
                    } else {
                        userDatabase[email].lastSeen = new Date().toISOString();
                        saveData();
                        console.log(`👋 Возвращается: ${username} (${email})`);
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
                        error: 'Неверный код. Попробуйте снова.'
                    }));
                }
            }

            // ===== РЕГИСТРАЦИЯ/ВХОД =====
            if (data.type === 'register') {
                const username = data.username;
                const email = data.email;
                
                users.set(ws, { username, email });
                
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
                    
                    // Рассылаем подписчикам
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
                
                // Ограничим историю до 100 сообщений
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
    console.log(`📧 Почта: nanogram.ru@yandex.ru`);
    console.log(`🔐 Статус почты: ${transporter.isIdle ? 'Активна' : 'Проверка...'}`);
    console.log('\n' + '╔'.repeat(50));
    console.log('║     🚀 НОВАЯ ЭРА БЕЗОПАСНОСТИ');
    console.log('║');
    console.log('║  ✓ Вход через Яндекс Почту');
    console.log('║  ✓ Шифрование AES-256');
    console.log('║  ✓ Канал NANOGRAM');
    console.log('║  ✓ 152-ФЗ Политика конфиденциальности');
    console.log('║');
    console.log('║  "Безопасность должна быть');
    console.log('║   доступной для всех"');
    console.log('║         © Nanogram 2024');
    console.log('╚' + '═'.repeat(49));
    console.log('\n📱 Локальный доступ: http://localhost:' + PORT);
    console.log('🌍 Внешний доступ: https://minegram.onrender.com\n');
});