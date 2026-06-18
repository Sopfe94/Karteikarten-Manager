// Service Worker v14 - Cross-Origin (Supabase etc.) nie cachen + index.html Network-First
const CACHE = 'kkm-v15';
const BASE = self.location.hostname === 'www.gross-apps.de' ? '/KM' : '';
const STATIC = [BASE+'/manifest.json', BASE+'/icon.svg', BASE+'/logo.svg'];

self.addEventListener('install', function(e){
self.skipWaiting();
e.waitUntil(
caches.open(CACHE).then(function(c){
return c.addAll(STATIC).catch(function(){});
})
);
});

self.addEventListener('activate', function(e){
e.waitUntil(
caches.keys().then(function(keys){
return Promise.all(
keys.filter(function(k){ return k !== CACHE; })
.map(function(k){ return caches.delete(k); })
);
}).then(function(){ return self.clients.claim(); })
);
});

self.addEventListener('fetch', function(e){
if(e.request.method !== 'GET') return;
var url = new URL(e.request.url);

// Fremde Domains (Supabase, Firebase, Fonts, CDNs) NIE cachen -> direkt ans Netz
if(url.origin !== self.location.origin) return;

// sw.js: immer frisch
if(url.pathname === BASE+'/sw.js'){
e.respondWith(fetch(e.request).catch(function(){ return new Response('',{status:503}); }));
return;
}

// updates.json: immer frisch (App regelt 24h selbst)
if(url.pathname === BASE+'/updates.json'){
e.respondWith(
fetch(new Request(e.request,{cache:'no-store'}))
.catch(function(){ return caches.match(BASE+'/updates.json'); })
);
return;
}

// index.html: Network-First (immer frisch laden, Cache nur als Offline-Fallback)
if(url.pathname === BASE+'/' || url.pathname === BASE+'/index.html'){
e.respondWith(
fetch(new Request(BASE+'/index.html',{cache:'no-store'})).then(function(res){
if(res && res.status === 200){
var clone = res.clone();
caches.open(CACHE).then(function(c){ c.put(BASE+'/index.html', clone); });
}
return res;
}).catch(function(){
return caches.match(BASE+'/index.html').then(function(cached){
return cached || new Response('<p>Bitte einmal online öffnen.</p>',{headers:{'Content-Type':'text/html'}});
});
})
);
return;
}

// Alles andere: Cache-first
e.respondWith(
caches.match(e.request).then(function(cached){
return cached || fetch(e.request).then(function(res){
if(res && res.status === 200){
var clone = res.clone();
caches.open(CACHE).then(function(c){ c.put(e.request, clone); });
}
return res;
});
}).catch(function(){ return new Response('',{status:503}); })
);
});

// IDB
function openDB(){ return new Promise(function(res,rej){ var r=indexedDB.open('kk-sw',1); r.onupgradeneeded=function(e){e.target.result.createObjectStore('kv');}; r.onsuccess=function(e){res(e.target.result);}; r.onerror=function(){rej(r.error);}; }); }
function dbGet(k){ return openDB().then(function(db){ return new Promise(function(res,rej){ var q=db.transaction('kv','readonly').objectStore('kv').get(k); q.onsuccess=function(){res(q.result);}; q.onerror=function(){rej(q.error);}; }); }).catch(function(){return undefined;}); }
function dbSet(k,v){ return openDB().then(function(db){ return new Promise(function(res,rej){ var tx=db.transaction('kv','readwrite'); tx.objectStore('kv').put(v,k); tx.oncomplete=res; tx.onerror=function(){rej(tx.error);}; }); }).catch(function(){}); }

function maybeNotify(){
return Promise.all([dbGet('notifyTime'),dbGet('lastNotified'),dbGet('dueCount')]).then(function(v){
var t=v[0],last=v[1]||0,due=v[2]||0;
if(!t||!due) return;
var now=new Date(), today=now.toISOString().slice(0,10);
if(last===today) return;
var p=t.split(':').map(Number), nowM=now.getHours()*60+now.getMinutes(), tgtM=p[0]*60+p[1];
if(Math.abs(nowM-tgtM)>10) return;
return self.registration.showNotification('Karteikarten Manager',{
body:due+' Karte'+(due!==1?'n':'')+' warte'+(due===1?'t':'n')+' auf dich.',
icon:BASE+'/icon.svg', tag:'kk-daily', renotify:true, vibrate:[180,90,180]
}).then(function(){ return dbSet('lastNotified',today); });
});
}
var checkTimer=null;
function scheduleCheck(t){
if(checkTimer)clearTimeout(checkTimer); if(!t)return;
var p=t.split(':').map(Number), now=new Date(), tgt=new Date(now);
tgt.setHours(p[0],p[1],0,0); if(tgt<=now)tgt.setDate(tgt.getDate()+1);
checkTimer=setTimeout(function(){maybeNotify();scheduleCheck(t);},tgt-now);
}
self.addEventListener('message',function(e){
var d=e.data||{};
if(d.type==='SET_NOTIFY_TIME'){dbSet('notifyTime',d.time);dbSet('dueCount',d.dueCount||0);dbSet('lastNotified',null);scheduleCheck(d.time);}
if(d.type==='DISABLE_NOTIFY'){dbSet('notifyTime',null);if(checkTimer)clearTimeout(checkTimer);}
if(d.type==='UPDATE_DUE'){dbSet('dueCount',d.dueCount);}
});
setInterval(maybeNotify,5*60*1000);
dbGet('notifyTime').then(function(t){if(t)scheduleCheck(t);});
self.addEventListener('notificationclick',function(e){
e.notification.close();
e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(function(cs){
var c=cs.find(function(x){return x.url.startsWith(self.location.origin);}); return c?c.focus():self.clients.openWindow(BASE+'/');
}));
});