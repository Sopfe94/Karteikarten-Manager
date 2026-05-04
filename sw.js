// ── Karteikarten Service Worker v5 ───────────────────────────────────────────
const CACHE = 'kkm-v5';
// NEVER cache index.html – always fetch fresh from network
const CACHE_ASSETS = ['/manifest.json', '/icon.svg', '/logo.svg'];

// ── Install ───────────────────────────────────────────────────────────────────
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function(c) { return c.addAll(CACHE_ASSETS).catch(function(){}); })
      .then(function() { return self.skipWaiting(); })
  );
});

// ── Activate ──────────────────────────────────────────────────────────────────
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE; })
            .map(function(k) { return caches.delete(k); })
      );
    }).then(function() { return self.clients.claim(); })
  );
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', function(e) {
  if (e.request.method !== 'GET') return;

  var url = new URL(e.request.url);

  // index.html and / → always network first, no cache
  if (url.pathname === '/' || url.pathname === '/index.html') {
    e.respondWith(
      fetch(e.request).catch(function() {
        return caches.match('/index.html');
      })
    );
    return;
  }

  // SW itself → always network
  if (url.pathname === '/sw.js') {
    e.respondWith(fetch(e.request));
    return;
  }

  // Everything else → cache first
  e.respondWith(
    caches.match(e.request).then(function(hit) {
      return hit || fetch(e.request).then(function(res) {
        if (res && res.status === 200) {
          var clone = res.clone();
          caches.open(CACHE).then(function(c) { c.put(e.request, clone); });
        }
        return res;
      });
    })
  );
});

// ── IDB helpers ───────────────────────────────────────────────────────────────
function openDB() {
  return new Promise(function(res, rej) {
    var r = indexedDB.open('kk-sw', 1);
    r.onupgradeneeded = function(e) { e.target.result.createObjectStore('kv'); };
    r.onsuccess = function(e) { res(e.target.result); };
    r.onerror = function() { rej(r.error); };
  });
}
function dbGet(key) {
  return openDB().then(function(db) {
    return new Promise(function(res, rej) {
      var req = db.transaction('kv','readonly').objectStore('kv').get(key);
      req.onsuccess = function() { res(req.result); };
      req.onerror = function() { rej(req.error); };
    });
  }).catch(function() { return undefined; });
}
function dbSet(key, val) {
  return openDB().then(function(db) {
    return new Promise(function(res, rej) {
      var tx = db.transaction('kv','readwrite');
      tx.objectStore('kv').put(val, key);
      tx.oncomplete = res;
      tx.onerror = function() { rej(tx.error); };
    });
  }).catch(function(){});
}

// ── Notifications ─────────────────────────────────────────────────────────────
function maybeNotify() {
  return Promise.all([dbGet('notifyTime'), dbGet('lastNotified'), dbGet('dueCount')])
    .then(function(vals) {
      var notifyTime = vals[0];
      var lastNotified = vals[1] || 0;
      var dueCount = vals[2] || 0;
      if (!notifyTime) return;
      var now = new Date();
      var todayStr = now.toISOString().slice(0,10);
      if (lastNotified === todayStr) return;
      var parts = notifyTime.split(':').map(Number);
      var nowMins = now.getHours() * 60 + now.getMinutes();
      var targetMins = parts[0] * 60 + parts[1];
      if (Math.abs(nowMins - targetMins) > 10) return;
      if (dueCount === 0) return;
      return self.registration.showNotification('Karteikarten Manager', {
        body: dueCount + ' Karte' + (dueCount !== 1 ? 'n' : '') + ' warte' + (dueCount === 1 ? 't' : 'n') + ' auf dich.',
        icon: '/icon.svg',
        tag: 'kk-daily',
        renotify: true,
        vibrate: [180, 90, 180]
      }).then(function() { return dbSet('lastNotified', todayStr); });
    });
}

// ── Messages ──────────────────────────────────────────────────────────────────
self.addEventListener('message', function(e) {
  var d = e.data || {};
  if (d.type === 'SET_NOTIFY_TIME') {
    dbSet('notifyTime', d.time);
    dbSet('dueCount', d.dueCount || 0);
    dbSet('lastNotified', null);
    scheduleCheck(d.time);
  }
  if (d.type === 'DISABLE_NOTIFY') { dbSet('notifyTime', null); if (checkTimer) clearTimeout(checkTimer); }
  if (d.type === 'UPDATE_DUE') { dbSet('dueCount', d.dueCount); }
});

var checkTimer = null;
function scheduleCheck(timeStr) {
  if (checkTimer) clearTimeout(checkTimer);
  if (!timeStr) return;
  var parts = timeStr.split(':').map(Number);
  var now = new Date();
  var target = new Date(now);
  target.setHours(parts[0], parts[1], 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  checkTimer = setTimeout(function() { maybeNotify(); scheduleCheck(timeStr); }, target - now);
}

setInterval(maybeNotify, 5 * 60 * 1000);
dbGet('notifyTime').then(function(t) { if (t) scheduleCheck(t); });

self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({type:'window',includeUncontrolled:true}).then(function(cs) {
      var c = cs.find(function(x) { return x.url.startsWith(self.location.origin); });
      return c ? c.focus() : self.clients.openWindow('/');
    })
  );
});

self.addEventListener('periodicsync', function(e) {
  if (e.tag === 'kk-daily') e.waitUntil(maybeNotify());
});
