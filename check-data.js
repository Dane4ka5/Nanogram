// check-data.js
const fs = require('fs');
const path = require('path');

console.log('\n' + '='.repeat(60));
console.log('🔍 ПРОВЕРКА СОХРАНЕНИЯ ДАННЫХ NANOGRAM');
console.log('='.repeat(60));

// Проверяем существование файла
const dataPath = './data.json';
const backupPath = './backups';

if (!fs.existsSync(dataPath)) {
    console.log('❌ Файл data.json не найден!');
    process.exit(1);
}

try {
    // Статистика файла
    const stats = fs.statSync(dataPath);
    console.log(`📁 Файл: data.json`);
    console.log(`📦 Размер: ${(stats.size / 1024).toFixed(2)} KB`);
    console.log(`🕒 Последнее изменение: ${stats.mtime.toLocaleString()}`);
    
    // Читаем данные
    const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    
    console.log('\n📊 СТАТИСТИКА ДАННЫХ:');
    console.log(`👥 Пользователей: ${Object.keys(data.users || {}).length}`);
    console.log(`💬 Чатов: ${Object.keys(data.messages || {}).length}`);
    
    const totalMessages = Object.values(data.messages || {}).reduce((acc, chat) => acc + chat.length, 0);
    console.log(`📝 Всего сообщений: ${totalMessages}`);
    
    console.log(`📢 Каналов: ${Object.keys(data.channels || {}).length}`);
    
    const totalPosts = Object.values(data.channels || {}).reduce((acc, ch) => acc + (ch.posts?.length || 0), 0);
    console.log(`📰 Всего постов: ${totalPosts}`);
    
    console.log(`🔒 Приватных комнат: ${Object.keys(data.privateRooms || {}).length}`);
    console.log(`⚙️ Настроек: ${Object.keys(data.userSettings || {}).length}`);
    console.log(`🖼️ Профилей: ${Object.keys(data.userProfiles || {}).length}`);
    
    // Проверка бэкапов
    if (fs.existsSync(backupPath)) {
        const backups = fs.readdirSync(backupPath).filter(f => f.endsWith('.json'));
        console.log(`\n💾 Бэкапов: ${backups.length}`);
        if (backups.length > 0) {
            console.log('📅 Последний бэкап:', backups.sort().reverse()[0]);
        }
    } else {
        console.log('\n💾 Бэкапов пока нет');
    }
    
    // Проверка целостности
    console.log('\n🔐 ПРОВЕРКА ЦЕЛОСТНОСТИ:');
    
    let errors = [];
    
    // Проверяем пользователей
    if (data.users) {
        const userCount = Object.keys(data.users).length;
        console.log(`✅ Пользователи: ${userCount} записей`);
    } else {
        errors.push('❌ Нет данных пользователей');
    }
    
    // Проверяем сообщения
    if (data.messages) {
        console.log(`✅ Сообщения: ${totalMessages} шт`);
    } else {
        errors.push('❌ Нет сообщений');
    }
    
    if (errors.length === 0) {
        console.log('\n✅ ВСЁ ХОРОШО! Данные сохраняются корректно.');
    } else {
        console.log('\n⚠️ НАЙДЕНЫ ПРОБЛЕМЫ:');
        errors.forEach(e => console.log(e));
    }
    
    console.log('\n' + '='.repeat(60));
    
} catch (e) {
    console.log('❌ Ошибка чтения данных:', e.message);
}