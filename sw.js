const CACHE = 'kkm-v2';
const ASSETS = ['/', '/index.html', '/manifest.json', '/icon.svg', '/logo.svg'];

function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('kk-sw', 1);
    r.onupgradeneeded = e => e.target.result.createObjectStore('kv');
    r.onsuccess = e => res(e.target.result);
    r.onerror = () => rej(r.error);
  });
}
async function dbGet(key) {
  try {
    const db = await openDB();
    return new Promise((res, rej) => {
      const req = db.transaction('kv','readonly').objectStore('kv').get(key);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  } catch { return undefined; }
}
async function dbSet(key, val) {
  try {
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction('kv','readwrite');
      tx.objectStore('kv').put(val, key);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
  } catch {}
}

async function maybeNotify() {
  const notifyTime = await dbGet('notifyTime');
  if (!notifyTime) return;
  const lastNotified = (await dbGet('lastNotified')) || 0;
  const now = new Date();
  const todayStr = now.toISOString().slice(0,10);
  if (lastNotified === todayStr) return;
  const [h, m] = notifyTime.split(':').map(Number);
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const targetMins = h * 60 + m;
  if (Math.abs(nowMins - targetMins) > 10) return;
  const dueCount = (await dbGet('dueCount')) || 0;
  if (dueCount === 0) return;
  await self.registration.showNotification('📚 Zeit zum Lernen!', {
    body: `${dueCount} Karte${dueCount !== 1 ? 'n' : ''} warte${dueCount === 1 ? 't' : 'n'} auf dich.`,
    icon: '/icon.svg', tag: 'kk-daily', renotify: true, vibrate: [180,90,180],
    actions: [{ action: 'open', title: '▶ Jetzt lernen' }, { action: 'later', title: '⏰ Später' }]
  });
  await dbSet('lastNotified', todayStr);
}

self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS).catch(()=>{})).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('/api/')) return;
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request)));
});

let checkTimer = null;
function scheduleNextCheck(timeStr) {
  if (checkTimer) clearTimeout(checkTimer);
  if (!timeStr) return;
  const [h,m] = timeStr.split(':').map(Number);
  const now = new Date();
  const target = new Date(now);
  target.setHours(h, m, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  checkTimer = setTimeout(async () => { await maybeNotify(); scheduleNextCheck(timeStr); }, target - now);
}

self.addEventListener('message', async e => {
  const d = e.data || {};
  if (d.type === 'SET_NOTIFY_TIME') {
    await dbSet('notifyTime', d.time); await dbSet('dueCount', d.dueCount||0); await dbSet('lastNotified', null);
    scheduleNextCheck(d.time);
  }
  if (d.type === 'DISABLE_NOTIFY') { await dbSet('notifyTime', null); if (checkTimer) clearTimeout(checkTimer); }
  if (d.type === 'UPDATE_DUE') await dbSet('dueCount', d.dueCount);
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'later') return;
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(cs => {
    const c = cs.find(x => x.url.startsWith(self.location.origin));
    return c ? c.focus() : self.clients.openWindow('/');
  }));
});

self.addEventListener('periodicsync', e => { if (e.tag === 'kk-daily') e.waitUntil(maybeNotify()); });
setInterval(maybeNotify, 5*60*1000);

(async () => { const t = await dbGet('notifyTime'); if (t) scheduleNextCheck(t); })();
