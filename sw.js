// sw.js — Service Worker для Nanogram
const CACHE_NAME = 'nanogram-v1';

self.addEventListener('install', event => {
    console.log('✅ Service Worker установлен');
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return cache.addAll([
                '/',
                '/index.html',
                '/manifest.json',
                '/icons/icon-72x72.png',
                '/icons/icon-96x96.png',
                '/icons/icon-128x128.png',
                '/icons/icon-144x144.png',
                '/icons/icon-152x152.png',
                '/icons/icon-192x192.png',
                '/icons/icon-384x384.png',
                '/icons/icon-512x512.png',
                '/sounds/msg.mp3'
            ]);
        })
    );
});

self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request).then(response => {
            return response || fetch(event.request);
        })
    );
});

self.addEventListener('activate', event => {
    console.log('✅ Service Worker активирован');
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
            );
        })
    );
});