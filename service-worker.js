const CACHE_NAME = 'mr-rodolfo-static-v1';
const ASSETS = ['/favicon.ico','/icon-192.png','/icon-512.png'];
self.addEventListener('install', event => {event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));self.skipWaiting();});
self.addEventListener('activate', event => {event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))));self.clients.claim();});
self.addEventListener('fetch', event => {
 const request=event.request;
 if(request.method!=='GET'||new URL(request.url).origin!==self.location.origin)return;
 if(!ASSETS.includes(new URL(request.url).pathname))return;
 event.respondWith(caches.match(request).then(cached=>cached||fetch(request)));
});
