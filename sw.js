// Service Worker v16 - CDN-Scripts (React, Supabase) offline cachen
const CACHE = 'kkm-v351';
const BASE = self.location.hostname === 'www.gross-apps.de' ? '/lernpuls' : '';
const STATIC = [BASE+'/index.html', BASE+'/manifest.json', BASE+'/icon.png'];
const CDN = [
'https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js',
'https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js',
'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js',
'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
'https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.4.13/purify.min.js'
];
const HEAVY = [
BASE+'/opencv.js',
BASE+'/ort.wasm.min.js',
BASE+'/ort-wasm-simd-threaded.wasm',
BASE+'/ort-wasm-simd-threaded.mjs',
BASE+'/docaligner.onnx',
BASE+'/pdf.min.js',
BASE+'/pdf.worker.min.js'
];
/* opencv.js, ort.wasm.min.js, ort-wasm-simd-threaded.(wasm|mjs),
   docaligner.onnx sowie pdf.min.js/pdf.worker.min.js (PDF-Viewer)
   liegen selbst gehostet. Absichtlich NICHT in STATIC/CDN (wuerde
   die normale Installation um ca. 30MB verlangsamen, fuer alle
   Nutzer:innen, auch ohne Scanner-Nutzung) - werden stattdessen
   in HEAVY gelistet und erst NACH erfolgreichem activate() im
   Hintergrund nachgeladen (siehe unten), damit der Scanner kurz
   nach der Installation offline bereitsteht, ohne den normalen
   App-Start zu verlangsamen. */

function sleep(ms){ return new Promise(function(res){ setTimeout(res,ms); }); }
/* Bug-Fix: c.add(url).catch(()=>{}) schluckte einen fehlgeschlagenen
   Cache-Versuch bisher komplett lautlos und endgueltig - eine kurze
   Netzwerkschwankung genau bei der Installation reichte, damit z.B.
   React nie gecacht wurde. Ging man dann offline, bevor die Seite
   ueber den generischen Fetch-Handler nochmal online geladen wurde
   (der es nachtraeglich gecacht haette), blieb #root fuer immer leer -
   kompletter weisser Bildschirm ohne jede Rueckmeldung. Jetzt bis zu
   3 Versuche mit kurzer Pause, bevor endgueltig aufgegeben wird. */
function cacheWithRetry(c,url,retries){
  return c.add(url).catch(function(err){
    if(retries<=0) return;
    return sleep(800).then(function(){ return cacheWithRetry(c,url,retries-1); });
  });
}
self.addEventListener('install', function(e){
self.skipWaiting();
e.waitUntil(
caches.open(CACHE).then(function(c){
return Promise.all(
  STATIC.concat(CDN).map(function(url){ return cacheWithRetry(c,url,2); })
);
})
);
});

/* Bug-Fix: activate() loeschte bisher IMMER sofort alle alten Caches,
   sobald ein neuer Service Worker aktiv wurde - auch wenn install()
   das Vor-Cachen (z.B. wegen einer Netzwerkflaute genau in dem
   Moment) nur teilweise geschafft hat (cacheWithRetry gibt nach 2
   Versuchen still auf, install() "gelingt" also trotzdem, siehe
   cacheWithRetry oben). Ergebnis: die neue, unvollstaendige Cache-
   Version wurde aktiv, die alte vollstaendige gleichzeitig geloescht -
   ohne Internet blieb dann nichts Brauchbares mehr uebrig, kompletter
   weisser Bildschirm beim naechsten Offline-Start. Jetzt: alte Caches
   nur loeschen, wenn die neue Version die kritischen Dateien (App-
   Shell + React/ReactDOM) nachweislich enthaelt - sonst bleiben die
   alten als Sicherheitsnetz erhalten (caches.match() in den fetch-
   Handlern oben durchsucht ohnehin automatisch alle Caches), bis ein
   spaeterer Online-Besuch das Nachladen erfolgreich abschliesst. */
var CRITICAL = STATIC.concat(CDN.slice(0,2));
self.addEventListener('activate', function(e){
e.waitUntil(
caches.open(CACHE).then(function(c){
return Promise.all(CRITICAL.map(function(u){ return c.match(u); }));
}).then(function(results){
var complete = results.every(function(r){ return !!r; });
if(!complete) return;
return caches.keys().then(function(keys){
return Promise.all(
keys.filter(function(k){ return k !== CACHE; })
.map(function(k){ return caches.delete(k); })
);
});
}).then(function(){ return self.clients.claim(); })
);
});

/* Scanner-Werkzeugkasten NICHT innerhalb von activate()s waitUntil,
   damit die eigentliche Aktivierung (und damit "App ist offline-
   bereit") nicht durch 30MB Hintergrund-Download verzoegert wird -
   laeuft parallel dazu, sobald ein neuer SW aktiv wird. Retry-Logik
   identisch zu cacheWithRetry oben (2 Versuche, kurze Pause). */
self.addEventListener('activate', function(){
caches.open(CACHE).then(function(c){
Promise.all(HEAVY.map(function(url){ return cacheWithRetry(c,url,2); })).catch(function(){});
});
});

self.addEventListener('fetch', function(e){
if(e.request.method !== 'GET') return;
var url = new URL(e.request.url);

// CDN-Scripts (React, Supabase): Cache-First – offline verfügbar
if(CDN.indexOf(e.request.url) !== -1){
e.respondWith(
  caches.match(e.request).then(function(cached){
    return cached || fetch(e.request).then(function(res){
      if(res && res.status===200){var clone=res.clone();caches.open(CACHE).then(function(c){c.put(e.request,clone);});}
      return res;
    });
  })
);
return;
}

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

// index.html: Cache-First (Update kommt via CACHE-Version-Bump)
if(url.pathname === BASE+'/' || url.pathname === BASE+'/index.html'){
e.respondWith(
caches.match(BASE+'/index.html').then(function(cached){
return cached || fetch(e.request).then(function(res){
if(res && res.status === 200){
var clone = res.clone();
caches.open(CACHE).then(function(c){ c.put(BASE+'/index.html', clone); });
}
return res;
}).catch(function(){
return new Response('<p>Bitte einmal online öffnen.</p>',{headers:{'Content-Type':'text/html'}});
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
icon:BASE+'/icon.png', tag:'kk-daily', renotify:true, vibrate:[180,90,180]
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