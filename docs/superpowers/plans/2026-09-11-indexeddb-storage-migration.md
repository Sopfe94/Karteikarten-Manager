# IndexedDB Storage Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `localStorage` with `IndexedDB` as the persistence backend for the app's main data blob (`kkm-v2`), so that decks containing embedded card images no longer silently lose all progress once the JSON payload exceeds localStorage's ~5MB quota.

**Architecture:** Introduce a synchronous in-memory cache (`_storeCache`) that becomes the new "source of truth" for the existing, unchanged `loadStore()` function — every one of the dozens of existing synchronous call sites (`loadStore().settings`, `loadStore()._syncedAt`, etc.) keeps working with zero changes. Only two things become genuinely async: a one-time `loadStoreInitial()` call at boot (populates the cache from IndexedDB, with a one-time migration from the old localStorage key for existing users) and `saveStore()`'s actual disk persistence (fires the IndexedDB write in the background after synchronously updating the cache, so callers never have to await it).

**Tech Stack:** Vanilla `indexedDB` browser API (no library — matches the existing `sw.js` IndexedDB usage pattern for notification state), plain `<script>` (non-module) JS matching the rest of `index.html`, Playwright for verification (established pattern this session: CDN-swapped local test HTML + custom Supabase stubs under `/tmp/rtest/`).

**Spec:** This plan's own "Confirmed Root Cause" section below (no separate spec doc — derived directly from Playwright-verified diagnostic logging captured this session: `localStorage.setItem()` for `STORE_KEY="kkm-v2"` throws `QuotaExceededError` once the JSON payload exceeds ~3.3MB, confirmed at exactly 3,458,958 characters, because cards can embed base64 JPEG images via `toCanvas`/`toDataURL()` calls in the crop/upload feature. This was previously completely silent — an empty `try{}catch(e){}` around the write — which is why it looked like random data loss after force-quit rather than a deterministic, repeatable write failure).

## Global Constraints

- File to modify: `/home/user/Karteikarten-Manager/index.html` only (no changes to `sw.js` beyond the mandatory version-bump-together ritual in the final task).
- Every task's code lives inside the single big inline `<script>` — no ES modules, no `async`/`await` (codebase uses `.then()`/`.catch()` chains throughout; stay consistent), `var` not `let`/`const` (matches existing style).
- `loadStore()` MUST remain callable synchronously everywhere it already is — this is the core design invariant of the whole migration. If any task requires making an existing `loadStore()` call site `async`, stop and reconsider the approach before continuing.
- Every task ends with a `node --check` syntax pass on the extracted longest `<script>` block, then a Playwright verification against a freshly CDN-swapped copy of `index.html` (regenerate the test HTML fresh each time from the CURRENT file — reusing a stale test file silently tests old code, as happened once earlier this session).
- `KKM_VERSION` (index.html) and `CACHE` (sw.js) are bumped together on EVERY ship, even for a single task if it ships alone — but per this plan, only the final task actually ships (commits/pushes); Tasks 1-6 are implemented and verified locally without shipping individually, then Task 7 bumps the version once for the whole migration and ships it as one PR. Do not skip the version bump.
- Never commit, push, or open a PR before Task 7 — Tasks 1-6 are local edit-and-verify cycles only.

## Confirmed Root Cause (do not re-investigate — build on this)

From this session's Playwright-verified diagnostic logging, captured directly from the user's device:
```
💾 saveStore: Erschließung eines Baugrundstückes=29%(62K) | ... | _syncedAt: 1789105744355
❌❌ saveStore: localStorage.setItem FEHLGESCHLAGEN: QuotaExceededError The quota has been exceeded. | Groesse: 3458958 Zeichen
❌❌ saveStore: Backup-setItem FEHLGESCHLAGEN: QuotaExceededError The quota has been exceeded.
```
This confirms: the write reliably fails once above ~3.3MB, for BOTH the primary key and the backup key (both live in localStorage today), and previously failed completely silently.

---

## Task 1: IndexedDB low-level helpers

**Files:**
- Modify: `index.html:1932-1933` (insert new code immediately after the existing `var STORE_BACKUP_KEY=...` line, before `function loadStore(){`)
- Test: `/tmp/rtest/idb_helpers_test.js` (new, scratch — not part of the repo)

**Interfaces:**
- Produces: `kkmIdbOpen()` → `Promise<IDBDatabase>`; `kkmIdbGet(key)` → `Promise<any>` (resolves `undefined` if key not found); `kkmIdbSet(key, value)` → `Promise<void>` (rejects with the original `DOMException`/`Error` on failure, e.g. `QuotaExceededError` — though IndexedDB's quota is orders of magnitude larger than localStorage's, so this should be rare going forward).

- [ ] **Step 1: Add the IndexedDB helpers**

Insert immediately after `var STORE_BACKUP_KEY=STORE_KEY+'-backup';` (currently `index.html:1932`):

```js
var KKM_IDB_NAME='kkm-store-db';
var KKM_IDB_STORE='kv';
function kkmIdbOpen(){
  return new Promise(function(resolve,reject){
    var req=indexedDB.open(KKM_IDB_NAME,1);
    req.onupgradeneeded=function(){ req.result.createObjectStore(KKM_IDB_STORE); };
    req.onsuccess=function(){ resolve(req.result); };
    req.onerror=function(){ reject(req.error); };
  });
}
function kkmIdbGet(key){
  return kkmIdbOpen().then(function(db){
    return new Promise(function(resolve,reject){
      var tx=db.transaction(KKM_IDB_STORE,'readonly');
      var req=tx.objectStore(KKM_IDB_STORE).get(key);
      req.onsuccess=function(){ resolve(req.result); };
      req.onerror=function(){ reject(req.error); };
    });
  });
}
function kkmIdbSet(key,value){
  return kkmIdbOpen().then(function(db){
    return new Promise(function(resolve,reject){
      var tx=db.transaction(KKM_IDB_STORE,'readwrite');
      tx.objectStore(KKM_IDB_STORE).put(value,key);
      tx.oncomplete=function(){ resolve(); };
      tx.onerror=function(){ reject(tx.error); };
    });
  });
}
```

- [ ] **Step 2: Syntax check**

```bash
cd /home/user/Karteikarten-Manager
node -e "
const fs=require('fs');
const html=fs.readFileSync('index.html','utf8');
const blocks=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
let longest=blocks.reduce((a,b)=>a.length>b.length?a:b,'');
fs.writeFileSync('/tmp/rtest/plan_check_1.js', longest);
"
node --check /tmp/rtest/plan_check_1.js
```
Expected: no output (syntax OK).

- [ ] **Step 3: Write and run a direct round-trip Playwright test**

These functions are top-level `function` declarations in a non-module `<script>`, so they're reachable as `window.kkmIdbGet`/`window.kkmIdbSet` from `page.evaluate()`. Regenerate the CDN-swapped test file fresh (do this for every task in this plan, not just this one):

```bash
node -e "
const fs=require('fs');
let html=fs.readFileSync('/home/user/Karteikarten-Manager/index.html','utf8');
html=html.replace(/https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/react\/18\.3\.1\/umd\/react\.production\.min\.js/g,'file:///tmp/rtest/localcdn/react.production.min.js');
html=html.replace(/https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/react-dom\/18\.3\.1\/umd\/react-dom\.production\.min\.js/g,'file:///tmp/rtest/localcdn/react-dom.production.min.js');
html=html.replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2\/dist\/umd\/supabase\.js/g,'file:///tmp/rtest/backup_stub.js');
html=html.replace(/https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf\/2\.5\.1\/jspdf\.umd\.min\.js/g,'file:///tmp/rtest/localcdn/jspdf-stub.js');
html=html.replace(/https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/dompurify\/3\.4\.13\/purify\.min\.js/g,'file:///tmp/rtest/localcdn/dompurify-stub.js');
fs.writeFileSync('/tmp/rtest/test_task1.html', html);
"
```

Write `/tmp/rtest/idb_helpers_test.js`:
```js
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  await page.route('**/*', route => route.request().url().startsWith('file://') ? route.continue() : route.abort());
  await page.goto('file:///tmp/rtest/test_task1.html');
  await page.waitForTimeout(1500);

  const result = await page.evaluate(async () => {
    await window.kkmIdbSet('testkey', {hello: 'world', n: 42});
    const got = await window.kkmIdbGet('testkey');
    const missing = await window.kkmIdbGet('does-not-exist');
    return { got, missing };
  });
  console.log('=== gespeicherter Wert korrekt zurueckgelesen? ===');
  console.log(JSON.stringify(result.got) === JSON.stringify({hello:'world', n:42}));
  console.log('\n=== fehlender Key liefert undefined? ===');
  console.log(result.missing === undefined);
  await browser.close();
})();
```

Run:
```bash
cd /tmp/rtest && NODE_PATH=/opt/node22/lib/node_modules timeout 60 node idb_helpers_test.js
```
Expected: both assertions print `true`.

- [ ] **Step 4: Commit is deferred — this is a local checkpoint only (see Global Constraints). Move to Task 2.**

---

## Task 2: In-memory cache + `loadStore()` / `loadStoreInitial()` rewrite with migration

**Files:**
- Modify: `index.html:1933-1958` (replace the entire current `function loadStore(){...}` body)
- Test: `/tmp/rtest/load_store_migration_test.js` (new)

**Interfaces:**
- Consumes: `kkmIdbGet(key)` from Task 1; `normalizeStore(s)` and `storeHasContent(s)` (existing, unchanged, at `index.html:1913` and `index.html:1929`).
- Produces: `_storeCache` (module-level var, `null` until first populated by `loadStoreInitial()`); `loadStore()` → synchronous, unchanged external signature, returns `_storeCache` if populated else a safe empty default; `loadStoreInitial()` → `Promise<object>`, call exactly once per page load, populates `_storeCache` (checks IndexedDB `'data'` key, then IndexedDB `'dataBackup'` key, then migrates from the OLD `localStorage.getItem(STORE_KEY)` value as a last resort for users upgrading from a pre-migration version, then falls back to an empty default) — Task 4 wires this into `App()`'s boot sequence.

- [ ] **Step 1: Replace `loadStore()` and add `loadStoreInitial()`**

Replace the current body of `function loadStore(){...}` (currently `index.html:1933-1958`, ending right before the `/* Merkt sich, ob der letzte saveStore()...` comment) with:

```js
var _storeCache=null; // synchrone Quelle der Wahrheit, sobald befuellt
function loadStore(){
  if(_storeCache) return _storeCache;
  return normalizeStore({decks:[],folders:[],reminder:null,arbeiten:[],settings:{lernTage:7,lernArten:['Klausur','Test']}});
}
/* Ersetzt die alte, rein synchrone loadStore()-Implementierung: IndexedDB
   ist von Natur aus asynchron, daher wird der eigentliche Lesevorgang nur
   EINMAL beim Boot ausgefuehrt (siehe App() in Task 4) und fuellt
   _storeCache - danach bleibt loadStore() ueberall im Code unveraendert
   synchron nutzbar. Prueft IndexedDB (primaer, dann Backup), und
   migriert als letzten Ausweg einmalig den alten localStorage-Stand
   (fuer Nutzer, die von einer Version vor diesem Umbau aktualisieren -
   deren Daten duerfen nicht verloren wirken). */
function loadStoreInitial(){
  return kkmIdbGet('data').then(function(idbData){
    var normalized=idbData?normalizeStore(idbData):null;
    if(storeHasContent(normalized)){
      _storeCache=normalized;
      return _storeCache;
    }
    return kkmIdbGet('dataBackup').then(function(idbBackup){
      var normalizedBackup=idbBackup?normalizeStore(idbBackup):null;
      if(storeHasContent(normalizedBackup)){
        dbg('♻️ loadStoreInitial: IndexedDB primaer leer, nutze IndexedDB-Backup ('+(normalizedBackup.decks||[]).length+' Stapel).');
        _storeCache=normalizedBackup;
        return _storeCache;
      }
      try{
        var raw=localStorage.getItem(STORE_KEY);
        if(raw){
          var migrated=normalizeStore(JSON.parse(raw));
          if(storeHasContent(migrated)){
            dbg('📦➡️🗄️ Migration: uebernehme alten localStorage-Stand nach IndexedDB ('+(migrated.decks||[]).length+' Stapel).');
            _storeCache=migrated;
            return kkmIdbSet('data',migrated).then(function(){ return _storeCache; }).catch(function(){ return _storeCache; });
          }
        }
      }catch(e){}
      _storeCache=normalizeStore({decks:[],folders:[],reminder:null,arbeiten:[],settings:{lernTage:7,lernArten:['Klausur','Test']}});
      return _storeCache;
    });
  }).catch(function(e){
    dbg('❌❌ loadStoreInitial: IndexedDB-Fehler:',e&&e.name,e&&e.message);
    _storeCache=normalizeStore({decks:[],folders:[],reminder:null,arbeiten:[],settings:{lernTage:7,lernArten:['Klausur','Test']}});
    return _storeCache;
  });
}
```

Leave `saveStore()` and everything below it untouched for now (Task 3 handles `saveStore()`).

- [ ] **Step 2: Syntax check** (same pattern as Task 1 Step 2, write to `/tmp/rtest/plan_check_2.js`)

- [ ] **Step 3: Write and run the migration Playwright test**

Regenerate `/tmp/rtest/test_task2.html` fresh (same CDN-swap script as Task 1 Step 3, output filename changed).

Write `/tmp/rtest/load_store_migration_test.js`:
```js
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  await page.addInitScript(() => {
    // Simuliert einen bestehenden Nutzer VOR dem Umbau: echte Daten
    // liegen noch im alten localStorage-Key, IndexedDB ist leer.
    localStorage.setItem('kkm-v2', JSON.stringify({
      decks: [{id:'d1', name:'Alter Stapel', emoji:'📚', cards:[
        {id:'c1', front:'F', back:'A', lvl:2, nextReview:null}
      ], created:'2026-09-01', updatedAt:'2026-09-01T00:00:00.000Z'}],
      folders: [], reminder: null, arbeiten: [],
      settings: {lernTage:7, lernArten:['Klausur','Test'], lernSpaceEnabled:true, dailyGoal:30},
      _syncedAt: 1700000000000
    }));
  });
  await page.route('**/*', route => route.request().url().startsWith('file://') ? route.continue() : route.abort());
  await page.goto('file:///tmp/rtest/test_task2.html');
  await page.waitForTimeout(1500);

  const result = await page.evaluate(async () => {
    const migrated = await window.loadStoreInitial();
    const idbAfter = await window.kkmIdbGet('data');
    return { migrated, idbAfter };
  });
  console.log('=== Migration: loadStoreInitial() liefert den alten Stapel? ===');
  console.log(result.migrated.decks.length === 1 && result.migrated.decks[0].name === 'Alter Stapel');
  console.log('\n=== Migration: Stand liegt jetzt auch wirklich in IndexedDB? ===');
  console.log(!!result.idbAfter && result.idbAfter.decks.length === 1);

  // Zweiter Fall: IndexedDB hat bereits einen (neueren) eigenen Stand -
  // der alte localStorage-Rest darf NICHT mehr gewinnen.
  await page.evaluate(async () => {
    await window.kkmIdbSet('data', {decks:[{id:'d2',name:'IndexedDB-Stapel',cards:[],created:'x',updatedAt:'x'}],folders:[],arbeiten:[],settings:{lernTage:7,lernArten:['Klausur','Test']},_syncedAt:1800000000000});
  });
  const second = await page.evaluate(async () => {
    window.__storeCacheResetForTest = null; // _storeCache ist module-scope, nicht von aussen ruecksetzbar - neuer Tab-Kontext noetig
    return await window.loadStoreInitial();
  });
  console.log('\n=== IndexedDB-Stand hat Vorrang vor dem alten localStorage-Rest? ===');
  console.log(second.decks[0].name === 'IndexedDB-Stapel');

  await browser.close();
})();
```

Run:
```bash
cd /tmp/rtest && NODE_PATH=/opt/node22/lib/node_modules timeout 60 node load_store_migration_test.js
```
Expected: all three assertions print `true`. (Note: the second `loadStoreInitial()` call in the same page context re-reads IndexedDB fresh since `_storeCache` is already non-null from the first call, but IndexedDB itself was updated in between — `loadStoreInitial()`'s own `kkmIdbGet('data')` check runs again and this time finds real content immediately, so it correctly returns the newer IndexedDB value without falling through to the migration branch. If this assertion fails, `_storeCache` is being reused instead of re-checked — re-read Step 1's code, `loadStoreInitial()` must always call `kkmIdbGet` fresh, never short-circuit on `_storeCache` already being set.)

- [ ] **Step 4: Local checkpoint only — do not commit. Move to Task 3.**

---

## Task 3: `saveStore()` rewrite — async IndexedDB persistence with error logging

**Files:**
- Modify: `index.html:1976-2016` (the body of `saveStore(d)`, from the `/* Bug-Fix: dieser Schreibvorgang...` comment through the closing `}`)
- Test: `/tmp/rtest/save_store_quota_test.js` (new)

**Interfaces:**
- Consumes: `kkmIdbSet(key,value)` from Task 1; `_storeCache`, `storeHasContent(d)` from Task 2 / existing.
- Produces: `saveStore(d)` — same synchronous call signature as before (callers never change), but now: (1) updates `_storeCache=d` synchronously so any `loadStore()` call immediately after sees the new value, (2) persists to IndexedDB asynchronously in the background with error logging on failure, (3) writes the throttled backup copy to IndexedDB too (same 30s throttle logic, unchanged), (4) no longer touches `localStorage` for either key.

- [ ] **Step 1: Replace the persistence half of `saveStore()`**

Keep the existing debug-logging block at the top of `saveStore(d)` (`index.html:1966-1975`, the `try{ var deckCount=... dbg('💾 saveStore:'...) }catch(e){}` block) completely unchanged. Replace everything from the `/* Bug-Fix: dieser Schreibvorgang war seit jeher komplett lautlos...` comment (currently starting `index.html:1976`) through the function's closing `}` (currently `index.html:2016`) with:

```js
  /* Persistiert jetzt nach IndexedDB statt localStorage - der urspruengliche
     Grund fuer diesen ganzen Umbau: localStorage.setItem() warf bei
     Kartenbildern oberhalb von ca. 3.3MB ein stillschweigend verschlucktes
     QuotaExceededError (siehe Plan-Header, per Log am 2026-09-11 direkt
     beim Nutzer bestaetigt). IndexedDB erlaubt um Groessenordnungen mehr
     Speicherplatz. _storeCache wird SOFORT synchron aktualisiert, damit
     jeder loadStore()-Aufruf direkt danach den neuen Stand sieht - der
     eigentliche Schreibvorgang auf die Festplatte laeuft im Hintergrund
     und wird bei einem Fehlschlag (jetzt: sollte praktisch nie mehr
     vorkommen) weiterhin explizit geloggt statt lautlos zu verschwinden. */
  _storeCache=d;
  kkmIdbSet('data',d).catch(function(e){
    dbg('❌❌ saveStore: IndexedDB setItem FEHLGESCHLAGEN:',e&&e.name,e&&e.message);
  });
  /* Sicherungskopie: wird NUR geschrieben, wenn d tatsaechlich Inhalt hat
     - damit dieser Zweit-Key nie versehentlich selbst mit einem leeren/
     kaputten Stand ueberschrieben wird und garantiert die letzte
     bekannt-gute Version haelt (siehe loadStoreInitial()-Fallback).
     Bewusst zeitlich entkoppelt vom primaeren Schreibvorgang: wird
     hoechstens alle 30s neu geschrieben (aber sofort beim allerersten
     Mal), damit sie im Ernstfall (z.B. der weiterhin ungeklaerte iOS-
     Force-Quit-Timing-Fall) bereits eine Weile sicher persistiert ist,
     waehrend der primaere Key weiter bei jeder Aenderung aktuell bleibt. */
  try{
    var nowTs=Date.now();
    if(storeHasContent(d)&&(_lastBackupWriteAt===0||(nowTs-_lastBackupWriteAt)>=30000)){
      _lastBackupWriteAt=nowTs;
      kkmIdbSet('dataBackup',d).catch(function(e){
        dbg('❌❌ saveStore: IndexedDB Backup-setItem FEHLGESCHLAGEN:',e&&e.name,e&&e.message);
      });
    }
  }catch(e){}
}
```

- [ ] **Step 2: Syntax check** (write to `/tmp/rtest/plan_check_3.js`)

- [ ] **Step 3: Write and run the quota-relief Playwright test**

Regenerate `/tmp/rtest/test_task3.html` fresh.

Write `/tmp/rtest/save_store_quota_test.js`:
```js
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  await page.route('**/*', route => route.request().url().startsWith('file://') ? route.continue() : route.abort());
  await page.goto('file:///tmp/rtest/test_task3.html');
  await page.waitForTimeout(1500);

  const result = await page.evaluate(async () => {
    // Baut absichtlich eine >5MB grosse Nutzlast (groesser als das
    // Log-bestaetigte 3.3MB-Fehlschlag-Limit von localStorage) - simuliert
    // einen Kartenbild-lastigen Stapel.
    const bigImage = 'data:image/jpeg;base64,' + 'A'.repeat(5 * 1024 * 1024);
    const store = {
      decks: [{id:'d1', name:'Bildstapel', emoji:'📚', cards:[
        {id:'c1', front:'F', back:'A', lvl:1, nextReview:null, image: bigImage}
      ], created:'2026-09-01', updatedAt:'2026-09-01T00:00:00.000Z'}],
      folders: [], reminder: null, arbeiten: [],
      settings: {lernTage:7, lernArten:['Klausur','Test'], lernSpaceEnabled:true, dailyGoal:30},
      _syncedAt: Date.now()
    };
    window.saveStore(store);
    await new Promise(r => setTimeout(r, 500)); // dem Hintergrund-Schreibvorgang Zeit geben
    const idbData = await window.kkmIdbGet('data');
    const log = (window.__KKM_LOG||[]).join('\n');
    return {
      payloadSizeMB: (JSON.stringify(store).length / (1024*1024)).toFixed(1),
      idbHasBigImage: !!(idbData && idbData.decks[0].cards[0].image === bigImage),
      logHasQuotaError: log.includes('FEHLGESCHLAGEN'),
      loadStoreSeesSame: window.loadStore().decks[0].name === 'Bildstapel'
    };
  });
  console.log('=== Nutzlast-Groesse (erwartet: > 3.3MB, das alte Limit) ===');
  console.log(result.payloadSizeMB + ' MB');
  console.log('\n=== In IndexedDB angekommen trotz Groesse >3.3MB? ===');
  console.log(result.idbHasBigImage);
  console.log('\n=== Kein Fehlschlag-Log (bestaetigt: Quota-Problem geloest)? ===');
  console.log(!result.logHasQuotaError);
  console.log('\n=== loadStore() sieht sofort synchron den neuen Stand? ===');
  console.log(result.loadStoreSeesSame);

  await browser.close();
})();
```

Run:
```bash
cd /tmp/rtest && NODE_PATH=/opt/node22/lib/node_modules timeout 60 node save_store_quota_test.js
```
Expected: payload prints something >3.3MB, and all three boolean assertions print `true`. If `idbHasBigImage` is `false`, check the object store transaction in `kkmIdbSet` isn't timing out — increase the `setTimeout` wait in the test before re-reading.

- [ ] **Step 4: Local checkpoint only — do not commit. Move to Task 4.**

---

## Task 4: Wire `App()`'s boot sequence to the async store load

**Files:**
- Modify: `index.html:6747-6755` (the `data` `useState` initializer)
- Modify: `index.html:6774-6793` (the `hasLocalDataRef` `useRef` initializer and the fast-path `useEffect` that follows it)
- Modify: `index.html:7360-7391` (three `hasLocalDataRef.current` checks inside `checkInitialAuth()`)
- Modify: `index.html:7625-7635` (`handleAuthUserFailure`)
- Test: `/tmp/rtest/boot_async_load_test.js` (new)

**Interfaces:**
- Consumes: `loadStoreInitial()` from Task 2.
- Produces: `storeReadyRef` (new `useRef` inside `App()`, holds the single `loadStoreInitial()` promise for this mount — other code in `App()`'s scope reads `storeReadyRef.current` to chain `.then()` off it); `reportDataBootReadyOrError()` (new helper function inside `App()`, replaces the repeated `if(hasLocalDataRef.current)reportDataBootReady();else reportDataBootError();` pattern at all 3 `checkInitialAuth()` call sites).

- [ ] **Step 1: Add `storeReadyRef` and rewrite the `data`/`hasLocalDataRef` initializers**

Replace `index.html:6747-6755` (the `var ds=useState(function(){...}); var data=ds[0]; var setData=ds[1];` block) with:

```js
  var storeReadyRef=useRef(null);
  if(storeReadyRef.current===null) storeReadyRef.current=loadStoreInitial();
  var ds=useState(function(){ return loadStore(); }); var data=ds[0]; var setData=ds[1];
```

Replace `index.html:6774-6779` (the `var hasLocalDataRef=useRef((function(){...})());` block) with:

```js
  var hasLocalDataRef=useRef(false); // sicherer Default - wird unten befuellt, sobald storeReadyRef aufgeloest ist
```

Immediately after that (still before `var dataBootReportedRef=useRef(false);` at the old `index.html:6780`), add:

```js
  useEffect(function(){
    storeReadyRef.current.then(function(s){
      hasLocalDataRef.current=!!((s.decks&&s.decks.length>0)||(s.folders&&s.folders.length>0)||(s.arbeiten&&s.arbeiten.length>0));
      try{
        dbg('📦 Boot-Daten:',(s.decks||[]).map(function(d){
          return d.name+'='+deckPct(d)+'%('+((d.cards||[]).length)+'K,upd:'+String(d.updatedAt||'').slice(0,16)+')';
        }).join(' | '),'| _syncedAt:',s._syncedAt||0);
      }catch(e){}
      setData(s);
    });
  },[]);
```

- [ ] **Step 2: Update the fast-path effect and add `reportDataBootReadyOrError()`**

Replace `index.html:6791-6793` (`useEffect(function(){ if(hasLocalDataRef.current)reportDataBootReady(); },[]);`) with:

```js
  function reportDataBootReadyOrError(){
    storeReadyRef.current.then(function(){
      if(hasLocalDataRef.current)reportDataBootReady();else reportDataBootError();
    });
  }
  useEffect(function(){
    storeReadyRef.current.then(function(){
      if(hasLocalDataRef.current)reportDataBootReady();
    });
  },[]);
```

(This keeps the original fast-path semantics — report ready immediately once local data is CONFIRMED present, without waiting on the network — just now gated on the IndexedDB promise instead of a synchronous check. In practice this still resolves in low single-digit milliseconds, far faster than any network round trip.)

- [ ] **Step 3: Replace the three `checkInitialAuth()` call sites**

At `index.html:7368` (inside the offline-known-google-user branch), replace:
```js
          if(hasLocalDataRef.current)reportDataBootReady();else reportDataBootError(); // offline - mit lokalem Stand weiterarbeiten, Check kommt per 'online' erneut
```
with:
```js
          reportDataBootReadyOrError(); // offline - mit lokalem Stand weiterarbeiten, Check kommt per 'online' erneut
```

At `index.html:7383` (inside `signInAnonymously().catch(...)`), replace:
```js
            if(hasLocalDataRef.current)reportDataBootReady();else reportDataBootError();
```
with:
```js
            reportDataBootReadyOrError();
```

At `index.html:7390` (the outer `.catch()` of `checkInitialAuth()`'s `getSession()` chain), replace:
```js
      if(hasLocalDataRef.current)reportDataBootReady();else reportDataBootError();
```
with:
```js
      reportDataBootReadyOrError();
```

- [ ] **Step 4: Update `handleAuthUserFailure`**

Replace the full body of `handleAuthUserFailure` (`index.html:7625-7635`) with:

```js
  function handleAuthUserFailure(user){
    storeReadyRef.current.then(function(){
      if(hasLocalDataRef.current){ reportDataBootReady(); return; }
      if(_authRetryCount<2){
        _authRetryCount++;
        var delay=_authRetryCount===1?4000:8000;
        dbg('🔁 Automatischer Wiederholungsversuch '+_authRetryCount+'/2 in '+delay+'ms...');
        setTimeout(function(){ handleAuthUser(user,true); },delay);
      } else {
        reportDataBootError();
      }
    });
  }
```

- [ ] **Step 5: Syntax check** (write to `/tmp/rtest/plan_check_4.js`)

- [ ] **Step 6: Write and run the boot-flow Playwright test**

Regenerate `/tmp/rtest/test_task4.html` fresh, using `/tmp/rtest/backup_stub.js` as the Supabase stub swap target (same as prior tasks and this session's earlier `backup_fallback_test.js`).

Write `/tmp/rtest/boot_async_load_test.js`:
```js
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.addInitScript(() => {
    localStorage.setItem('kkm-onboarded', '1');
    localStorage.setItem('kkm-dsgvo', '1.1.0');
    localStorage.setItem('kkm-ls-id', 'Test-Nutzer-1234');
    localStorage.setItem('kkm-ls-consent', '1');
    // Kein alter localStorage-Stand, kein IndexedDB-Stand - simuliert ein
    // WIRKLICH frisches Geraet (nicht der Migrationsfall aus Task 2).
  });
  await page.route('**/*', route => route.request().url().startsWith('file://') ? route.continue() : route.abort());
  await page.goto('file:///tmp/rtest/test_task4.html');
  await page.waitForTimeout(2000);

  const skipBtn = page.locator('button:has-text("Überspringen")');
  if (await skipBtn.count() > 0) { await skipBtn.click(); await page.waitForTimeout(200); }

  const bodyText = await page.evaluate(() => document.body.innerText);
  console.log('=== Kein Crash auf leerem/frischem Geraet (kein "undefined" o.ae. sichtbar)? ===');
  console.log(!bodyText.includes('undefined') && !bodyText.includes('null'));

  // Jetzt: einen Stapel anlegen und lernen, um zu pruefen, dass die
  // normale Speicher-Kette (data state -> saveStore -> IndexedDB) noch
  // funktioniert nach der Umstellung.
  await page.click('button:has-text("Stapel lernen")').catch(()=>{});
  await page.waitForTimeout(300);

  const idbState = await page.evaluate(async () => {
    return await window.kkmIdbGet('data');
  });
  console.log('\n=== IndexedDB hat nach Boot einen validen (leeren) Store, kein Absturz? ===');
  console.log(!!idbState && Array.isArray(idbState.decks));

  console.log('\nFehler:', JSON.stringify(errors));
  await browser.close();
})();
```

Run:
```bash
cd /tmp/rtest && NODE_PATH=/opt/node22/lib/node_modules timeout 60 node boot_async_load_test.js
```
Expected: both assertions print `true`, `Fehler: []`.

- [ ] **Step 7: Local checkpoint only — do not commit. Move to Task 5.**

---

## Task 5: Fix the now-stale raw-localStorage diagnostic line

**Files:**
- Modify: `index.html:7530-7537` (the `_rawPrimary` diagnostic block inside `finishAuthUser`'s login restore-check, added earlier this session)

**Interfaces:**
- Consumes: `_storeCache` (Task 2), `storeHasContent` (existing).
- Produces: no new interface — this task only corrects an existing `dbg()` line's meaning so it doesn't mislead future debugging sessions.

**Why this task exists:** this diagnostic line was written earlier this session to answer "is the primary localStorage key really empty, or does the comparison logic just think so?" — with the storage backend now IndexedDB, reading raw `localStorage.getItem(STORE_KEY)` here would silently report on a key nothing writes to anymore (always whatever stale value was last migrated away from, misleading in any future debugging session).

- [ ] **Step 1: Replace the diagnostic block**

Replace `index.html:7530-7537`:
```js
          /* Diagnose-Log: liest den primaeren Key roh direkt von der
             Festplatte (ohne loadStore()s Backup-Fallback dazwischen),
             damit im Debug-Log sichtbar ist, ob wirklich NICHTS mehr
             auf dem Geraet steht oder ob nur der Vergleich unten aus
             einem anderen Grund localTs=0 sieht. */
          var _rawPrimary=null; try{ _rawPrimary=localStorage.getItem(STORE_KEY); }catch(e){}
          var localTs=loadStore()._syncedAt||0;
          dbg('🔍 Restore-Check (Login):','remoteTs='+remoteTs,'localTs='+localTs,'wird angewendet='+(remoteTs>localTs),'| primaer roh vorhanden='+(!!_rawPrimary)+' Laenge='+(_rawPrimary?_rawPrimary.length:0));
```
with:
```js
          /* Diagnose-Log: zeigt, ob der In-Memory-Cache (die neue
             synchrone Quelle der Wahrheit seit der IndexedDB-Umstellung)
             tatsaechlich Inhalt hat, damit im Debug-Log weiterhin
             sichtbar ist, ob wirklich nichts lokal vorliegt oder der
             Vergleich unten aus einem anderen Grund localTs=0 sieht. */
          var localTs=loadStore()._syncedAt||0;
          dbg('🔍 Restore-Check (Login):','remoteTs='+remoteTs,'localTs='+localTs,'wird angewendet='+(remoteTs>localTs),'| lokaler Cache Inhalt='+storeHasContent(_storeCache));
```

- [ ] **Step 2: Syntax check** (write to `/tmp/rtest/plan_check_5.js`)

- [ ] **Step 3: Manual verification** — this is a pure logging-text change with no new behavior to test in isolation; it will be exercised by Task 6's full regression pass. Skip a dedicated Playwright test for this task, but do re-grep to confirm no other reference to `_rawPrimary` remains:

```bash
grep -n "_rawPrimary" /home/user/Karteikarten-Manager/index.html
```
Expected: no output.

- [ ] **Step 4: Local checkpoint only — do not commit. Move to Task 6.**

---

## Task 6: Full regression pass

**Files:** none modified — this task only runs verification.

**Interfaces:** none new.

- [ ] **Step 1: Syntax check the fully-migrated file**

```bash
cd /home/user/Karteikarten-Manager
node -e "
const fs=require('fs');
const html=fs.readFileSync('index.html','utf8');
const blocks=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
let longest=blocks.reduce((a,b)=>a.length>b.length?a:b,'');
fs.writeFileSync('/tmp/rtest/plan_check_final.js', longest);
"
node --check /tmp/rtest/plan_check_final.js
```
Expected: no output.

- [ ] **Step 2: Regenerate every existing session Playwright test HTML fresh against the fully-migrated file**

This session already built and relies on these test suites (all under `/tmp/rtest/`, stub files unchanged): the race-condition guard test (`race_test.js` / `race2_test.js` pattern), the backup-fallback test (`backup_fallback_test.js` pattern), the retry-on-failure test (`retry_test.js`), and the quota-error-surfacing test (`quota_test.js`). Regenerate a fresh CDN-swapped HTML for each (same substitution script used in every task above, output files e.g. `test_regression_race.html`, `test_regression_backup.html`, `test_regression_retry.html`), then re-point each existing `_test.js` file's `page.goto()` at the new filename and run all four:

```bash
cd /tmp/rtest
NODE_PATH=/opt/node22/lib/node_modules timeout 60 node <regenerated race test>.js
NODE_PATH=/opt/node22/lib/node_modules timeout 60 node <regenerated backup test>.js
NODE_PATH=/opt/node22/lib/node_modules timeout 60 node <regenerated retry test>.js
```

Expected for each: the same pass/fail assertions that were true before this migration are still true now — most importantly, the backup-fallback test's core assertion ("primary looks empty → falls back to last-known-good") should now be checking IndexedDB content instead of a localStorage key, so re-read that test's seed data (`page.addInitScript`) and change any `localStorage.setItem('kkm-v2', ...)` / `localStorage.setItem('kkm-v2-backup', ...)` seeding to instead seed IndexedDB directly via `page.evaluate(() => window.kkmIdbSet('data', ...))` / `window.kkmIdbSet('dataBackup', ...)` called after `page.goto()` but before checking behavior — since `page.addInitScript()` runs before the page's own scripts (including `kkmIdbSet`) exist, IndexedDB seeding must happen via `page.evaluate()` after navigation instead, not via `addInitScript`.

- [ ] **Step 3: Confirm no remaining references to the old storage keys outside migration code**

```bash
grep -n "localStorage.setItem(STORE_KEY\|localStorage.setItem(STORE_BACKUP_KEY\|localStorage.getItem(STORE_BACKUP_KEY" /home/user/Karteikarten-Manager/index.html
```
Expected: no output (the only remaining `localStorage.getItem(STORE_KEY)` should be the one-time migration read inside `loadStoreInitial()` from Task 2 — confirm with:
```bash
grep -n "localStorage.getItem(STORE_KEY)" /home/user/Karteikarten-Manager/index.html
```
Expected: exactly one match, inside `loadStoreInitial()`.

- [ ] **Step 4: Local checkpoint only — do not commit. Move to Task 7.**

---

## Task 7: Version bump and ship

**Files:**
- Modify: `index.html:1080` (`KKM_VERSION`)
- Modify: `sw.js:2` (`CACHE`)

**Interfaces:** none new.

- [ ] **Step 1: Bump both versions together**

Read the current values first (`grep -n 'var KKM_VERSION' index.html` and `grep -n 'const CACHE' sw.js`), then increment both by one patch/cache number, matching this session's established convention (e.g. `1.8.136` → `1.8.137`, `kkm-v350` → `kkm-v351`).

- [ ] **Step 2: Final syntax check**

Same pattern as every prior task's Step 2/syntax-check, extracting into a fresh scratch file.

- [ ] **Step 3: Commit**

```bash
cd /home/user/Karteikarten-Manager
git add index.html sw.js
git commit -m "$(cat <<'EOF'
Primaere Datenspeicherung von localStorage auf IndexedDB umstellen

Root-Cause-Fix: localStorage.setItem() fuer den Haupt-Datenblock warf
QuotaExceededError sobald das JSON-Payload durch eingebettete Karten-
bilder (Zuschneiden/Hochladen-Feature) ueber ca. 3.3MB wuchs - per
Diagnose-Logging dieser Session direkt am Geraet der Nutzerin bestae-
tigt (exakter Fehlschlag bei 3.458.958 Zeichen). Der Fehlschlag war
bisher komplett stillschweigend (leeres try/catch), wirkte deshalb wie
zufaelliger Datenverlust nach Force-Quit statt eines deterministischen,
reproduzierbaren Schreibfehlers.

IndexedDB erlaubt um Groessenordnungen mehr Speicherplatz. Die Umstel-
lung haelt loadStore() ueberall im Code synchron nutzbar (ueber einen
neuen In-Memory-Cache als Quelle der Wahrheit) - nur der einmalige
Boot-Ladevorgang und der eigentliche Hintergrund-Schreibvorgang sind
jetzt asynchron. Bestehende Nutzer:innen werden beim ersten Start
automatisch von ihrem alten localStorage-Stand nach IndexedDB migriert.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Uq7JyYAa2m5jZdHFezGEqF
EOF
)"
```

- [ ] **Step 4: Push and open a PR to `beta`**

```bash
git push -u origin beta
```
(This session has been pushing directly to `beta` per its established, user-acknowledged workflow rather than feature-branch-plus-PR for every change — confirm with the user before this step if that has changed.)

- [ ] **Step 5: Report to the user**

Summarize in plain terms (matching this session's established communication style with Sophie, the non-technical app owner): what changed, why it fixes her exact reported problem (images causing silent save failures), and ask her to test again with a card that includes an image, since that's now directly exercisable rather than only inferred from log evidence.
