const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Создаем HTTP сервер
const server = http.createServer((req, res) => {
    // Определяем какой файл нужен
    let filePath = '.' + req.url;
    if (filePath === './') {
        filePath = './index.html';
    }

    const extname = path.extname(filePath);
    let contentType = 'text/html';
    
    // Читаем файл
    fs.readFile(filePath, (error, content) => {
        if (error) {
            // Если файл не найден
            res.writeHead(404);
            res.end('Файл не найден');
        } else {
            // Отправляем файл
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        }
    });
});

// Создаем WebSocket сервер на базе HTTP
const wss = new WebSocket.Server({ server });

// Хранилище для онлайн пользователей
const users = new Map();

wss.on('connection', (ws) => {
    console.log('Новый пользователь подключился');

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Получено:', data);

            if (data.type === 'register') {
                const username = data.username;
                users.set(ws, username);
                broadcastUserList();
                
                ws.send(JSON.stringify({
                    type: 'registered',
                    username: username
                }));
            }
        } catch (e) {
            console.log('Ошибка обработки сообщения:', e);
        }
    });

    ws.on('close', () => {
        console.log('Пользователь отключился');
        users.delete(ws);
        broadcastUserList();
    });
});

function broadcastUserList() {
    const userList = Array.from(users.values());
    const message = JSON.stringify({
        type: 'user_list',
        users: userList
    });
    
    users.forEach((_, client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`🚀 Сервер запущен!`);
    console.log(`📡 Слушаю порт: ${PORT}`);
    console.log(`💡 Открой в браузере: http://localhost:${PORT}`);
});