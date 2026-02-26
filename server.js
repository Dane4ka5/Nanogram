const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const server = http.createServer((req, res) => {
    let filePath = '.' + req.url;
    if (filePath === './') {
        filePath = './index.html';
    }

    fs.readFile(filePath, (error, content) => {
        if (error) {
            res.writeHead(404);
            res.end('Файл не найден');
        } else {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(content);
        }
    });
});

const wss = new WebSocket.Server({ server });

// Хранилища
const users = new Map(); // socket -> username
let messages = {}; // история сообщений

// Загружаем историю при старте
try {
    const data = fs.readFileSync('./messages.json', 'utf8');
    messages = JSON.parse(data);
    console.log('📂 История загружена из файла');
} catch (e) {
    console.log('📂 Создаю новый файл истории');
    messages = {};
}

// Функция сохранения истории
function saveMessages() {
    fs.writeFileSync('./messages.json', JSON.stringify(messages, null, 2));
    console.log('💾 История сохранена в файл');
}

wss.on('connection', (ws) => {
    console.log('🔌 Новое подключение');

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('📩 Получено:', data.type);

            if (data.type === 'register') {
                const username = data.username;
                users.set(ws, username);
                
                // Отправляем подтверждение
                ws.send(JSON.stringify({
                    type: 'registered',
                    username: username
                }));
                
                // Отправляем историю сообщений для этого пользователя
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
                
                // Обновляем список пользователей всем
                broadcastUserList();
            }

            if (data.type === 'message') {
                const from = data.from;
                const to = data.to;
                const text = data.text;
                const time = data.time;
                
                // Создаём ключ чата (сортируем имена)
                const chatKey = [from, to].sort().join('_');
                
                if (!messages[chatKey]) {
                    messages[chatKey] = [];
                }
                
                // Добавляем сообщение
                messages[chatKey].push({
                    from: from,
                    text: text,
                    time: time,
                    timestamp: Date.now()
                });
                
                // Ограничим историю до 100 сообщений на чат
                if (messages[chatKey].length > 100) {
                    messages[chatKey] = messages[chatKey].slice(-100);
                }
                
                // Сохраняем в файл
                saveMessages();
                
                // Отправляем получателю
                wss.clients.forEach(client => {
                    if (users.get(client) === to) {
                        client.send(JSON.stringify({
                            type: 'message',
                            from: from,
                            text: text,
                            time: time
                        }));
                    }
                });
                
                // Подтверждение отправителю
                ws.send(JSON.stringify({
                    type: 'message_delivered',
                    to: to,
                    text: text,
                    time: time
                }));
            }
            
        } catch (e) {
            console.error('❌ Ошибка:', e);
        }
    });

    ws.on('close', () => {
        const username = users.get(ws);
        if (username) {
            console.log(`👋 Пользователь отключился: ${username}`);
            users.delete(ws);
            broadcastUserList();
        }
    });
});

function broadcastUserList() {
    const userList = Array.from(users.values());
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`📡 История сохраняется в messages.json`);
});