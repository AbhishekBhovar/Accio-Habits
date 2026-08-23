const CACHE='hp-fitness-rpg-v4.4.0';
const ASSETS=['./','./index.html','./styles-v44.css','./app-v44.js','./manifest.webmanifest','./icon-192.png','./icon-512.png','./apple-touch-icon.png','./levels.json','./collectibles.json','./reward-events.json','./identity-rules.json','./game-config.json','./habit-config.json'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;const u=new URL(e.request.url);if(u.origin!==self.location.origin)return;e.respondWith(fetch(e.request,{cache:'no-store'}).then(r=>{const cp=r.clone();caches.open(CACHE).then(c=>c.put(e.request,cp));return r}).catch(()=>caches.match(e.request).then(x=>x||caches.match('./index.html'))))});
