const CACHE='hp-fitness-rpg-v3.26.0';
const ASSETS=[
  './',
  './index.html?v=3.26.0',
  './styles.css?v=3.26.0',
  './app.js?v=3.26.0',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './levels.json',
  './collectibles.json',
  './reward-events.json',
  './identity-rules.json',
  './game-config.json',
  './habit-config.json'
];

self.addEventListener('install',event=>{
  event.waitUntil(
    caches.open(CACHE)
      .then(cache=>cache.addAll(ASSETS))
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.map(key=>key===CACHE?null:caches.delete(key))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;

  event.respondWith(
    fetch(event.request,{cache:'no-store'})
      .then(response=>{
        const copy=response.clone();
        caches.open(CACHE).then(cache=>cache.put(event.request,copy));
        return response;
      })
      .catch(()=>caches.match(event.request)
        .then(cached=>cached||caches.match('./index.html?v=3.26.0')))
  );
});
