# Offline-Unterstützung: Scanner-Precaching, PDF-Cache, Netzwerk-Hinweis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drei vom Nutzer (Sophie) explizit priorisierte Offline-Lücken schließen: (1) der PDF-Scanner-Werkzeugkasten (opencv.js/onnx/pdf.js) funktioniert ab dem allerersten App-Start offline, statt erst nach dem ersten erfolgreichen Online-Einsatz; (2) einmal geöffnete PDFs bleiben offline erneut öffenbar, mit einer bewusst begrenzten Speicher-Obergrenze; (3) ein gescanntes Dokument kann offline erstellt werden und wird automatisch hochgeladen, sobald die Verbindung zurück ist; (4) Netzwerk-Aktionen (Freunde/Gruppen/Chat) zeigen offline einen klaren Hinweis statt eines stillen, irreführenden Erfolgs-Toasts.

**Architecture:** Alle drei Phasen bauen auf bereits vorhandenen Mustern dieser Session auf: die `kkmIdbOpen/kkmIdbGet/kkmIdbSet`-Helfer aus der gerade abgeschlossenen IndexedDB-Migration (gleicher `kv`-Object-Store, neue Präfix-Keys statt neuer Stores), das bestehende `online`/`offline`-Event-Muster (`window.addEventListener('online',...)`, schon zweimal im Code verwendet), und das bestehende Cache-First-Muster in `sw.js`. Phase 1 (Service Worker) verschiebt das Vorab-Cachen des ca. 30MB schweren Scanner-Werkzeugkastens von "on-demand beim ersten Scan" auf "im Hintergrund kurz nach Aktivierung", ohne die schnelle Standard-Installation zu verlangsamen. Phase 2 fängt den bereits vorhandenen PDF-Download-Schritt ab und persistiert die rohen PDF-Bytes (nicht die gerenderten Seiten - deutlich platzsparender) in IndexedDB mit einer LRU-Verdrängung. Phase 3 macht aus dem fertigen, aber noch nicht hochgeladenen Scan-Blob einen IndexedDB-Eintrag, der bei einem `online`-Event automatisch nachgeholt wird. Phase 4 ist bewusst klein: nur ein sichtbarer Hinweis, kein neues Retry-System.

**Tech Stack:** Gleich wie der Rest der App - `var`, `.then()/.catch()`-Ketten, ein einziges großes inline `<script>`, React über `createElement` ohne JSX. IndexedDB über die bestehenden `kkmIdb*`-Helfer. Playwright für Verifikation (etabliertes Muster dieser Session: CDN-getauschte lokale Test-HTML + Supabase-Stubs unter `/tmp/rtest/`).

**Spec:** Dieses Plandokument selbst, basierend auf einer bereits abgeschlossenen Code-Bestandsaufnahme (Audit, siehe "Confirmed Findings" unten) und Sophies expliziten Scope-Entscheidungen in einem direkten Gespräch (siehe "User Decisions" unten) - keine neue Konzeptphase, nur Strukturierung in umsetzbare Aufgaben.

## Confirmed Findings (Audit, nicht erneut untersuchen)

- `sw.js`: `STATIC`+`CDN` (index.html, manifest, icon, React/ReactDOM/Supabase/jsPDF/DOMPurify) werden beim Install vorab gecacht (`cacheWithRetry`, 2 Versuche). Der Scanner-Werkzeugkasten (`opencv.js` 10.3MB, `ort-wasm-simd-threaded.wasm` 13.5MB, `docaligner.onnx` 4.9MB, `ort.wasm.min.js` 50KB, `ort-wasm-simd-threaded.mjs`, `pdf.min.js` 320KB, `pdf.worker.min.js` 1.1MB - zusammen ca. 30MB, alle selbst gehostet im Repo-Root) ist bewusst NICHT in `STATIC`/`CDN` (Kommentar `sw.js:12-18`), landet nur im generischen Cache-First-Handler (`sw.js:131-142`) und wird daher erst beim ersten tatsächlichen Scan/PDF-Öffnen gecacht.
- `index.html` Scan-Flow ist komplett clientseitig bis auf den letzten Schritt: `handleCameraCapture` (~8453) → `onScanCropImageLoad`/`cvDetectDocumentCorners` (~8467, opencv/onnx-Kantenerkennung) → `confirmScanCrop` (~8527) → `confirmScanName` (~8433) → `buildPdfBlobFromImages(pages)` (~1300) → `driveUploadPdf(blob,name,docsFolderId,pageCount)` (~1283, einziger Netzwerk-Schritt) → `loadDocsFolder(docsFolderId)`.
- `index.html` PDF-Anzeige: `prefetchDocFile(file)` (~7115) läd via `driveFetch(...&alt=media)` (~1184) einen `arrayBuffer`, dann `renderPdfPages(arrayBuffer)` zu gerenderten Seiten. Cache ist nur `docPfCacheRef.current` (~7114, In-Memory-`useRef`, nicht persistiert, pro Sitzung verloren). `openDocViewer` (~8653) nutzt diesen Cache oder ruft `prefetchDocFile` neu auf.
- `index.html` Netzwerk-Schreibaktionen (Freunde/Gruppen/Chat, `LernSpaceView` ~5069-6311): `getSb().rpc(...).then(function(){},function(){})` - Fehler werden komplett verschluckt, optimistisches lokales State-Update + Erfolgs-Toast laufen unabhängig vom tatsächlichen RPC-Ausgang. `LernSpaceView` selbst hat bereits `isOnline`-State (~5149-5154, `navigator.onLine` + `online`/`offline`-Listener) - direkt wiederverwendbar.
- Bestehendes `online`-Event-Wiederholungs-Muster: `index.html:7462-7463`, `function onBackOnline(){ ...; checkInitialAuth('online-event'); } window.addEventListener('online',onBackOnline);` - exaktes Vorbild für die Scan-Upload-Warteschlange.
- IndexedDB-Helfer aus der IndexedDB-Migration (bereits gemergt, nicht neu definieren): `kkmIdbOpen()`, `kkmIdbGet(key)`, `kkmIdbSet(key,value)` - ein Object-Store `kv`, beliebige String-Keys, siehe `index.html` (Suche `KKM_IDB_NAME`).

## User Decisions (verbindlich, siehe direktes Gespräch mit Sophie)

1. **Phase 1 zuerst bauen:** Scanner-Werkzeugkasten so vorab cachen, dass er ab dem ersten Start offline funktioniert.
2. **Phase 2 nur wenn der Speicher-Ansatz vernünftig ist:** PDF-Inhalte offline cachen, MIT begrenzter Obergrenze (siehe Architektur-Entscheidung unten) - Sophie: "wenn du sagst PDFs zwischenzuspeichern funktioniert und frisst nicht all zu viel Speicher wäre das Supper."
3. **PDF-Scanner soll auch offline nutzbar sein, selbst wenn Phase 2 (Offline-Öffnen) nicht käme** - Scan jetzt erstellen, Upload folgt automatisch beim nächsten Online-Moment.
4. **Phase 3 (Netzwerk) bewusst klein halten:** NUR ein kurzes Hinweis-Overlay bei tatsächlicher Offline-Nutzung, ausdrücklich KEIN Retry-/Warteschlangen-System für die Netzwerk-Schreibaktionen selbst - das wäre ein größerer Umbau als gewünscht.

## Architektur-Entscheidung: Vorab-Cache-Strategie für den Scanner-Werkzeugkasten (Sophie zur Kenntnis, nicht nur stillschweigend entschieden)

Die ~30MB des Scanner-Werkzeugkastens direkt in den blockierenden `install()`-Schritt zu packen (wie es `STATIC`/`CDN` heute schon tun) würde jede Neuinstallation/jedes Update spürbar verlangsamen - auch für Nutzer:innen, die den Scanner nie anfassen. Stattdessen: **Task 1 cacht den Werkzeugkasten in einem separaten, nicht-blockierenden Hintergrund-Schritt direkt nach erfolgreicher `activate()`** (wenn die kritischen App-Dateien schon sicher gecacht sind). Praktisch heißt das: der Scanner ist offline nutzbar, sobald die App einmal kurz online lief (typischerweise binnen Sekunden nach der Installation, nicht erst nach dem ersten tatsächlichen Scan-Versuch wie heute) - aber nicht literally in der allerersten Millisekunde vor jeglicher Netzwerkaktivität. Das ist der bestmögliche Kompromiss ohne die App für alle langsamer zu machen; falls Sophie eine andere Priorität hat (z.B. lieber langsamere Installation, dafür garantiert sofort einsatzbereiter Scanner), ist das eine 1-Zeilen-Änderung in Task 1.

## Architektur-Entscheidung: PDF-Cache-Obergrenze (Sophie zur Kenntnis)

IndexedDB auf iOS Safari (installierte PWA, "Standalone"-Modus wie bei Sophies eigenem Nutzungsfall) unterliegt keiner festen kleinen Quote wie das alte `localStorage`, sondern einem laufwerksabhängigen Kontingent - in der Praxis für die allermeisten Geräte im Bereich mehrerer hundert MB bis GB. Ein KI-Karteikartenmanager sollte davon aber nur einen bescheidenen, vorhersehbaren Anteil beanspruchen, statt unbegrenzt zu wachsen. **Empfehlung: harte Obergrenze von 150MB Gesamtgröße für gecachte PDF-Rohdaten, mit LRU-Verdrängung** (am längsten nicht geöffnetes Dokument fliegt zuerst raus, wenn eine neue Datei die Grenze sprengen würde). 150MB entspricht bei typischen Vorlesungsunterlagen (meist 1-10MB pro PDF) ungefähr 15 bis über 100 gleichzeitig zwischengespeicherten Dokumenten - großzügig für aktives Lernen, aber weit von "frisst das ganze Handy voll" entfernt. Task 5 macht diese Zahl als eine einzelne benannte Konstante konfigurierbar, falls Sophie sie später ändern will.

## Global Constraints

- Dateien: `index.html` und `sw.js` ausschließlich (gleiche zwei Dateien wie jedes bisherige Feature dieser Session).
- `var` nicht `let`/`const`, `.then()/.catch()`-Ketten nicht `async`/`await`, ein einziges großes inline `<script>`, kein Modul-Syntax.
- IndexedDB-Zugriff ausschließlich über die bestehenden `kkmIdbOpen()/kkmIdbGet(key)/kkmIdbSet(key,value)`-Helfer - keine neuen parallelen IndexedDB-Zugriffsfunktionen erfinden.
- Jede Aufgabe endet mit einem `node --check` auf dem extrahierten längsten `<script>`-Block, dann einer frischen Playwright-Verifikation (CDN-getauschte Kopie von `index.html`, jedes Mal neu aus der AKTUELLEN Datei generiert - eine veraltete Test-Datei testet sonst stillschweigend alten Code, ein wiederkehrendes Problem dieser Session).
- `KKM_VERSION` (index.html) und `CACHE` (sw.js) werden zusammen genau einmal am Ende (Task 6) hochgezählt, nicht pro Aufgabe.
- Ziel-Branch zum Schluss: `beta` (nicht `main`) - wie jedes bisherige Feature dieser Session für dieses Repo.
- Phase 3 (Netzwerk) bleibt bewusst auf ein reines Sichtbarkeits-Overlay beschränkt - keine Retry-Logik für die RPC-Aufrufe selbst einbauen, auch wenn es naheliegend wirkt.

---

## Task 1: Service Worker - Scanner-Werkzeugkasten im Hintergrund nach `activate()` vorab cachen

**Files:**
- Modify: `sw.js:1-76` (neue Konstante + neuer Hintergrund-Cache-Aufruf nach der bestehenden `activate`-Logik)
- Test: `/tmp/rtest/sw_heavy_precache_test.js` (neu)

**Interfaces:**
- Consumes: `cacheWithRetry(c,url,retries)` (bereits vorhanden, `sw.js:29-34`), `CACHE`-Konstante (bereits vorhanden).
- Produces: neue Konstante `HEAVY` (Liste der Scanner-Dateien), kein neues öffentliches Interface - rein interne SW-Ergänzung.

- [ ] **Step 1: `HEAVY`-Liste ergänzen**

Direkt nach dem bestehenden `CDN`-Array (nach `sw.js:11`, vor dem erklärenden Kommentar an `sw.js:12`), einfügen:
```js
const HEAVY = [
BASE+'/opencv.js',
BASE+'/ort.wasm.min.js',
BASE+'/ort-wasm-simd-threaded.wasm',
BASE+'/ort-wasm-simd-threaded.mjs',
BASE+'/docaligner.onnx',
BASE+'/pdf.min.js',
BASE+'/pdf.worker.min.js'
];
```
(Reihenfolge nach ungefährer Dateigröße aufsteigend ist hier egal, `Promise.all` läuft parallel - aber die Dateinamen müssen exakt mit den tatsächlichen Dateien im Repo-Root übereinstimmen, vorher mit `ls /home/user/Karteikarten-Manager/*.wasm /home/user/Karteikarten-Manager/*.mjs /home/user/Karteikarten-Manager/*.onnx /home/user/Karteikarten-Manager/pdf*.js /home/user/Karteikarten-Manager/opencv.js /home/user/Karteikarten-Manager/ort*.js` gegenchecken, inklusive der bisher nicht einzeln aufgelisteten `ort-wasm-simd-threaded.mjs`.)

Den erklärenden Kommentar (`sw.js:12-18`, "bewusst NICHT in STATIC...") ersetzen durch:
```js
/* opencv.js, ort.wasm.min.js, ort-wasm-simd-threaded.(wasm|mjs),
   docaligner.onnx sowie pdf.min.js/pdf.worker.min.js (PDF-Viewer)
   liegen selbst gehostet. Absichtlich NICHT in STATIC/CDN (wuerde
   die normale Installation um ca. 30MB verlangsamen, fuer alle
   Nutzer:innen, auch ohne Scanner-Nutzung) - werden stattdessen
   in HEAVY gelistet und erst NACH erfolgreichem activate() im
   Hintergrund nachgeladen (siehe unten), damit der Scanner kurz
   nach der Installation offline bereitsteht, ohne den normalen
   App-Start zu verlangsamen. */
```

- [ ] **Step 2: Hintergrund-Precaching nach `activate()` auslösen**

Der bestehende `activate`-Handler (`sw.js:61-76`) endet mit `.then(function(){ return self.clients.claim(); })`. Direkt danach, als eigenständige Anweisung NACH dem `self.addEventListener('activate', ...)`-Block (nicht mehr innerhalb der `waitUntil`-Kette - dieser Schritt darf die Aktivierung nicht verzögern), einfügen:
```js
/* Scanner-Werkzeugkasten NICHT innerhalb von activate()s waitUntil,
   damit die eigentliche Aktivierung (und damit "App ist offline-
   bereit") nicht durch 30MB Hintergrund-Download verzoegert wird -
   laeuft parallel dazu, sobald ein neuer SW aktiv wird. Retry-Logik
   identisch zu cacheWithRetry oben (2 Versuche, kurze Pause). */
self.addEventListener('activate', function(e){
caches.open(CACHE).then(function(c){
Promise.all(HEAVY.map(function(url){ return cacheWithRetry(c,url,2); }));
});
});
```
(Das ist ein zweiter, separater `activate`-Listener - beide Listener feuern beim selben Event, Browser unterstützen mehrere Listener pro Event-Typ problemlos. Bewusst kein `e.waitUntil(...)` hier, damit dieser Download wirklich im Hintergrund läuft statt die Aktivierung zu blockieren.)

- [ ] **Step 3: Playwright-Verifikation**

Frisch generierte `/tmp/rtest/test_sw_heavy.html` (gleiches CDN-Tausch-Muster wie jede bisherige Aufgabe dieser Session) + ein Service-Worker-Kontext-Test (Playwright unterstützt SW-Registrierung in einem echten Browser-Kontext - `page.context().serviceWorkers()` nach Registrierung abfragen, oder direkter: `caches.open('kkm-vXXX').then(c=>c.keys())` per `page.evaluate` nach ein paar Sekunden Wartezeit prüfen).

Schreibe `/tmp/rtest/sw_heavy_precache_test.js`:
```js
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  const page = await context.newPage();
  await page.goto('file:///tmp/rtest/test_sw_heavy.html');
  // Service Worker registrieren funktioniert nicht zuverlaessig ueber
  // file://-URLs in allen Browsern - falls das hier fehlschlaegt, als
  // Ausweichloesung die HEAVY-Liste direkt aus sw.js extrahieren und
  // per node --check + eval gegen die tatsaechlichen Dateien im
  // Repo-Root abgleichen (alle 7 Dateien vorhanden, Pfade korrekt),
  // statt einer echten SW-Registrierung - dokumentiere im Report,
  // welcher der beiden Wege tatsaechlich funktioniert hat.
  await page.waitForTimeout(500);
  console.log('=== Platzhalter, siehe Kommentar oben - Implementer entscheidet den robusteren Testweg ===');
  await browser.close();
})();
```
(Diese Aufgabe hat KEINEN festen Testcode wie sonst üblich - Service-Worker-Verhalten unter Playwright/`file://` ist notorisch unzuverlässig. Der Implementer soll selbst entscheiden zwischen einer echten SW-Registrierung im Playwright-Testkontext ODER einer einfacheren Prüfung: `node --check` auf `sw.js` plus ein kleines Node-Skript, das `HEAVY` aus dem Dateitext extrahiert und gegen `fs.existsSync` für jede referenzierte Datei im Repo-Root prüft (stellt sicher, dass keine Datei falsch benannt ist, auch ohne echten Browser-Cache-Test). Im Report explizit begründen, welcher Weg gewählt wurde und warum.)

- [ ] **Step 4: Report per Kontrakt aus dem Dispatch-Prompt.**

---

## Task 2: IndexedDB-Cache für PDF-Rohdaten + LRU-Verdrängung

**Files:**
- Modify: `index.html` - neue Hilfsfunktionen (Platzierung: direkt nach den bestehenden `kkmIdb*`-Helfern, gleicher Bereich wie `STORE_BACKUP_KEY`), neue Aufrufe in `prefetchDocFile` (~7115-7128).
- Test: `/tmp/rtest/pdf_cache_test.js` (neu)

**Interfaces:**
- Consumes: `kkmIdbGet(key)`, `kkmIdbSet(key,value)` (bereits vorhanden).
- Produces: `pdfCacheGet(fileId)` (liefert `Promise<ArrayBuffer|null>`), `pdfCachePut(fileId,arrayBuffer)` (liefert `Promise<void>`, kümmert sich intern um die 150MB-Obergrenze + LRU-Verdrängung) - beide werden von Task 2 selbst in `prefetchDocFile` verdrahtet, aber als eigenständige Funktionen geschrieben, falls eine spätere Aufgabe sie separat braucht.

- [ ] **Step 1: Cache-Index-Struktur + Hilfsfunktionen**

Direkt nach den bestehenden `kkmIdb*`-Funktionen (finde die exakte Stelle mit `grep -n "^function kkmIdbSet"` und füge direkt danach ein), einfügen:
```js
/* PDF-Roh-Cache: persistiert die per driveFetch(...&alt=media)
   geladenen PDF-Bytes (ArrayBuffer) in IndexedDB, damit einmal
   geoeffnete Dokumente auch offline erneut oeffenbar sind - nicht
   die gerenderten Seiten (docPfCacheRef), die waeren als Bilddaten
   um ein Vielfaches groesser. Eigener Key-Namensraum im selben
   kv-Store: 'pdfblob:<fileId>' fuer die Bytes, 'pdfCacheIndex' fuer
   ein Verzeichnis {fileId: {size, lastAccess}} zur LRU-Verdraengung,
   ohne bei jedem Zugriff den ganzen Object-Store durchsuchen zu
   muessen. */
var PDF_CACHE_MAX_BYTES=150*1024*1024;
function pdfCacheGet(fileId){
  return kkmIdbGet('pdfblob:'+fileId).then(function(buf){
    if(!buf)return null;
    return kkmIdbGet('pdfCacheIndex').then(function(idx){
      idx=idx||{};
      if(idx[fileId]){
        idx[fileId].lastAccess=Date.now();
        return kkmIdbSet('pdfCacheIndex',idx).then(function(){return buf;}).catch(function(){return buf;});
      }
      return buf;
    }).catch(function(){return buf;});
  }).catch(function(){return null;});
}
function pdfCachePut(fileId,arrayBuffer){
  var size=arrayBuffer.byteLength;
  return kkmIdbGet('pdfCacheIndex').then(function(idx){
    idx=idx||{};
    var entries=Object.keys(idx).map(function(id){return {id:id,size:idx[id].size,lastAccess:idx[id].lastAccess};});
    var total=entries.reduce(function(sum,e){return sum+e.size;},0);
    entries.sort(function(a,b){return a.lastAccess-b.lastAccess;}); // aeltester Zugriff zuerst
    var evictChain=Promise.resolve();
    var i=0;
    while(total+size>PDF_CACHE_MAX_BYTES&&i<entries.length){
      (function(entry){
        evictChain=evictChain.then(function(){ return kkmIdbSet('pdfblob:'+entry.id,null); }).catch(function(){});
        delete idx[entry.id];
      })(entries[i]);
      total-=entries[i].size;
      i++;
    }
    return evictChain.then(function(){
      idx[fileId]={size:size,lastAccess:Date.now()};
      return kkmIdbSet('pdfCacheIndex',idx);
    }).then(function(){
      return kkmIdbSet('pdfblob:'+fileId,arrayBuffer);
    });
  }).catch(function(e){
    dbg('❌ pdfCachePut fehlgeschlagen:',e&&e.name,e&&e.message);
  });
}
```
(Hinweis fuer den Implementer: `kkmIdbSet(key,null)` als "loeschen" nutzt IndexedDBs `put(null,key)` - pruefe kurz, dass `kkmIdbGet` fuer einen so "geloeschten" Key sauber `null`/`undefined` zurueckgibt und nicht z.B. `null` faelschlich als "vorhanden, aber leer" fehlinterpretiert wird an anderen bestehenden `kkmIdbGet`-Aufrufstellen - falls das ein Problem ist, stattdessen eine eigene `kkmIdbDelete(key)`-Hilfsfunktion nach dem gleichen Muster wie `kkmIdbSet` ergaenzen, die `objectStore.delete(key)` statt `.put()` nutzt, und in `pdfCachePut`s Verdraengungs-Schleife die verwenden statt `kkmIdbSet(key,null)`.)

- [ ] **Step 2: In `prefetchDocFile` verdrahten**

Aktuellen Code (`index.html:~7115-7128`) finden mit `grep -n -A15 "function prefetchDocFile"`, dann `var p=driveFetch(...)` Kette so erweitern, dass sie ERST den Cache prüft, und einen erfolgreichen Netzwerk-Download zusätzlich cacht:
```js
function prefetchDocFile(file){
  var entry=docPfCacheRef.current[file.id];
  if(entry)return entry.promise;
  var p=pdfCacheGet(file.id).then(function(cachedBuf){
    if(cachedBuf)return cachedBuf;
    return driveFetch('https://www.googleapis.com/drive/v3/files/'+file.id+'?alt=media')
      .then(function(r){ if(!r.ok)throw new Error('Download fehlgeschlagen'); return r.arrayBuffer(); })
      .then(function(buf){ pdfCachePut(file.id,buf).catch(function(){}); return buf; });
  }).then(renderPdfPages)
    .then(function(pages){
      if(docPfCacheRef.current[file.id])docPfCacheRef.current[file.id].pages=pages;
      return pages;
    })
    .catch(function(e){ delete docPfCacheRef.current[file.id]; throw e; });
  docPfCacheRef.current[file.id]={promise:p,pages:null};
  return p;
}
```
(Wichtig: `pdfCachePut` wird NICHT awaited/verkettet vor `renderPdfPages` - das Cachen läuft im Hintergrund, der Nutzer wartet nicht darauf, exakt wie bei `saveStore()`s Hintergrund-Schreibvorgang aus der IndexedDB-Migration dieser Session.)

- [ ] **Step 3: Syntax check** (write to `/tmp/rtest/plan_check_offline_2.js`)

- [ ] **Step 4: Playwright-Verifikation**

Frisch generierte Test-HTML. Schreibe `/tmp/rtest/pdf_cache_test.js`, das:
1. Einen `file.id` mit gestubtem `driveFetch` (Stub liefert einen kleinen Fake-`ArrayBuffer`, z.B. 1000 Bytes) einmal via `prefetchDocFile` lädt, prüft dass `window.kkmIdbGet('pdfblob:'+id)` danach den Buffer enthält.
2. Ein zweites Mal denselben `file.id` lädt, diesmal mit `driveFetch` komplett deaktiviert/wirft immer einen Fehler (simuliert offline) - prüft, dass `prefetchDocFile` trotzdem erfolgreich auflöst (aus dem Cache, kein Netzwerk-Aufruf nötig).
3. Die Verdrängung testet: mehrere Fake-Dateien mit `pdfCachePut` einfügt, deren Gesamtgröße `PDF_CACHE_MAX_BYTES` übersteigt, prüft dass die älteste (am längsten nicht zugegriffene) verschwunden ist und die Gesamtgröße im Index unter dem Limit bleibt.

Run: `cd /tmp/rtest && NODE_PATH=/opt/node22/lib/node_modules timeout 60 node pdf_cache_test.js`

- [ ] **Step 5: Report per Kontrakt aus dem Dispatch-Prompt.**

---

## Task 3: Scan-Upload-Warteschlange für Offline-Erstellung

**Files:**
- Modify: `index.html:~8433-8452` (`confirmScanName`), neue Warteschlangen-Logik + `online`-Event-Listener.
- Test: `/tmp/rtest/scan_queue_test.js` (neu)

**Interfaces:**
- Consumes: `kkmIdbGet`/`kkmIdbSet`, `buildPdfBlobFromImages(pages)` (bereits vorhanden, ~1300), `driveUploadPdf(blob,filename,parentId,pageCount)` (bereits vorhanden, ~1283), das bestehende `online`-Event-Muster (Vorbild: `index.html:7462-7463`).
- Produces: `queueScanForUpload(entry)`, `flushScanQueue()`, ein neuer `useEffect` mit `online`-Listener in `App()` (gleiche Komponente, in der `onBackOnline` bereits existiert).

- [ ] **Step 1: Warteschlangen-Hilfsfunktionen**

Nach den PDF-Cache-Hilfsfunktionen aus Task 2 einfügen:
```js
/* Scan-Upload-Warteschlange: ein Scan (Bild-Erfassung + Zuschnitt +
   PDF-Zusammenbau) laeuft komplett lokal ab - nur der letzte Schritt
   (driveUploadPdf) braucht Netzwerk. Schlaegt der Upload wegen
   fehlender Verbindung fehl, landet der fertige PDF-Blob hier in
   IndexedDB (als Base64-String, da Blobs nicht direkt strukturiert
   klonbar in aelteren IndexedDB-Implementierungen sind - matcht das
   bestehende Bild-Speicherformat der Karten) statt verloren zu gehen,
   und wird automatisch nachgeholt, sobald 'online' feuert. */
function queueScanForUpload(blob,filename,parentId,pageCount){
  return blobToDataURL(blob).then(function(dataUrl){
    return kkmIdbGet('scanUploadQueue').then(function(queue){
      queue=queue||[];
      queue.push({id:'scan-'+Date.now()+'-'+Math.random().toString(36).slice(2),dataUrl:dataUrl,filename:filename,parentId:parentId,pageCount:pageCount,queuedAt:Date.now()});
      return kkmIdbSet('scanUploadQueue',queue);
    });
  });
}
function blobToDataURL(blob){
  return new Promise(function(resolve,reject){
    var fr=new FileReader();
    fr.onload=function(){resolve(fr.result);};
    fr.onerror=function(){reject(fr.error);};
    fr.readAsDataURL(blob);
  });
}
function dataURLToBlob(dataUrl){
  var parts=dataUrl.split(',');
  var mime=parts[0].match(/:(.*?);/)[1];
  var bin=atob(parts[1]);
  var arr=new Uint8Array(bin.length);
  for(var i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);
  return new Blob([arr],{type:mime});
}
function flushScanQueue(){
  return kkmIdbGet('scanUploadQueue').then(function(queue){
    if(!queue||!queue.length)return;
    var chain=Promise.resolve();
    var remaining=queue.slice();
    queue.forEach(function(entry){
      chain=chain.then(function(){
        var blob=dataURLToBlob(entry.dataUrl);
        return driveUploadPdf(blob,entry.filename,entry.parentId,entry.pageCount).then(function(){
          remaining=remaining.filter(function(e){return e.id!==entry.id;});
          return kkmIdbSet('scanUploadQueue',remaining);
        }).catch(function(e){
          dbg('❌ Warteschlangen-Upload fehlgeschlagen, bleibt in der Warteschlange:',entry.filename,e&&e.message);
        });
      });
    });
    return chain;
  }).catch(function(){});
}
```

- [ ] **Step 2: `confirmScanName` auf die Warteschlange umstellen**

Aktuellen Code finden (`grep -n -A20 "function confirmScanName"`), das `.catch()` am Ende der bestehenden Kette so erweitern, dass ein Netzwerkfehler in die Warteschlange geht statt nur einen Fehler-Toast zu zeigen:
```js
  function confirmScanName(){
    var pages=scanNamePending;
    if(!pages||!pages.length)return;
    var name=scanFileName.trim().replace(/[\\/:*?"<>|]/g,"-");
    if(!name)name="Scan";
    if(!/\.pdf$/i.test(name))name+=".pdf";
    setScanNameModalOpen(false);setScanNamePending(null);
    setScanBusy(true);
    buildPdfBlobFromImages(pages).then(function(blob){
      return driveUploadPdf(blob,name,docsFolderId,pages.length).then(function(){
        setScanBusy(false);setScanModalOpen(false);setScanMode(null);setScanPages([]);
        loadDocsFolder(docsFolderId);
        showToast("Dokument gespeichert.");
      }).catch(function(e){
        return queueScanForUpload(blob,name,docsFolderId,pages.length).then(function(){
          setScanBusy(false);setScanModalOpen(false);setScanMode(null);setScanPages([]);
          showToast("Kein Internet - Scan wird automatisch hochgeladen, sobald du wieder online bist.");
        });
      });
    }).catch(function(e){
      setScanBusy(false);
      showToast("Scan konnte nicht gespeichert werden.");
      dbg("❌ Scan-Upload-Fehler:",e.message);
    });
  }
```
(Beachte: der äußere `.catch()` bleibt für Fehler in `buildPdfBlobFromImages` selbst - der neue innere `.catch()` fängt NUR den Upload-Schritt ab und leitet in die Warteschlange um, statt den Nutzer mit einem harten Fehler-Toast allein zu lassen.)

- [ ] **Step 3: Automatischer Abgleich bei `online`-Event**

In `App()`, direkt neben der bestehenden `window.addEventListener('online',onBackOnline)`-Stelle (`~7463` vor der IndexedDB-Migration, aktuelle Zeile mit `grep -n "onBackOnline"` bestätigen), einen zusätzlichen Listener registrieren - entweder als eigener `useEffect` oder als zusätzlicher Aufruf innerhalb von `onBackOnline` selbst (Implementer-Wahl, je nachdem was mit dem umgebenden Code sauberer harmoniert):
```js
useEffect(function(){
  function onBackOnlineFlushScans(){ flushScanQueue(); }
  window.addEventListener('online',onBackOnlineFlushScans);
  flushScanQueue(); // auch direkt beim Boot versuchen, falls schon online
  return function(){ window.removeEventListener('online',onBackOnlineFlushScans); };
},[]);
```

- [ ] **Step 4: Syntax check** (write to `/tmp/rtest/plan_check_offline_3.js`)

- [ ] **Step 5: Playwright-Verifikation**

Schreibe `/tmp/rtest/scan_queue_test.js`: simuliert `driveUploadPdf` als immer-fehlschlagend (Stub), ruft die Scan-Bestätigung mit Fake-Seiten auf, prüft dass `window.kkmIdbGet('scanUploadQueue')` danach einen Eintrag enthält und der Nutzer den "wird automatisch hochgeladen"-Hinweis sieht (kein harter Fehler). Dann `driveUploadPdf` auf Erfolg umstellen (Stub-Verhalten ändern) und `window.dispatchEvent(new Event('online'))` feuern - prüft, dass die Warteschlange danach leer ist und `driveUploadPdf` tatsächlich aufgerufen wurde.

Run: `cd /tmp/rtest && NODE_PATH=/opt/node22/lib/node_modules timeout 60 node scan_queue_test.js`

- [ ] **Step 6: Report per Kontrakt aus dem Dispatch-Prompt.**

---

## Task 4: Netzwerk-Bereich - Offline-Hinweis-Overlay

**Files:**
- Modify: `index.html` (`LernSpaceView`, ~5069-6311) - neue Overlay-Komponente + Einbindung an den Netzwerk-Schreibaktionen.

**Interfaces:**
- Consumes: bereits vorhandenes `isOnline`-State in `LernSpaceView` (~5149-5154).
- Produces: eine kleine `NetworkOfflineHint`-Komponente (oder Inline-Bedingung, Implementer-Wahl je nach bestehendem Stil in dieser Datei), keine neue Logik außerhalb der Anzeige.

**Bewusst außerhalb des Umfangs dieser Aufgabe (nicht bauen):** kein Retry, keine Warteschlange für die RPC-Aufrufe selbst, kein Ändern der bestehenden `.then(function(){},function(){})`-Fehlerbehandlung - nur eine zusätzliche, rein visuelle Bedingung.

- [ ] **Step 1: Sichtbaren Hinweis ergänzen**

Finde die Stellen, an denen Netzwerk-Schreibaktionen ausgelöst werden (Buttons für Freund-Anfrage annehmen/ablehnen, Gruppe erstellen/verlassen/löschen, Rolle ändern, Stapel teilen, Chat senden - `grep -n "ls_accept_friend_request\|ls_send_friend_request\|ls_create_group\|ls_leave_group\|ls_share_deck"` für die exakten aktuellen Stellen). Statt jede einzelne Stelle individuell zu ändern (fehleranfällig bei so vielen Stellen), einen einzelnen, gut sichtbaren Hinweis-Banner am Kopf von `LernSpaceView`s Render-Ausgabe ergänzen, der erscheint, wenn `!isOnline`:
```js
!isOnline&&h('div',{className:'lp-offline-hint',style:{background:'rgba(255,180,60,0.12)',border:'1px solid rgba(255,180,60,0.35)',borderRadius:12,padding:'10px 14px',margin:'0 0 12px',fontSize:13,color:'rgba(255,255,255,0.85)',display:'flex',alignItems:'center',gap:8}},
  '📡 Du bist offline - Freunde, Gruppen und Nachrichten sind erst wieder verfügbar, sobald du online bist.'
),
```
(Platzierung: ganz oben im zurückgegebenen Element-Baum von `LernSpaceView`, vor dem bestehenden Inhalt - exakte Stelle vom Implementer anhand des aktuellen Render-Aufbaus gewählt, üblicherweise gleich nach dem öffnenden `h('div',...` Wrapper.)

Zusätzlich: bei den eigentlichen Schreibaktions-Handlern (Freund annehmen, Gruppe verlassen, etc.) am Anfang jeder Funktion eine frühe Rückkehr mit Toast statt der optimistischen Aktion, wenn offline:
```js
function acceptFriendRequest(req){
  if(!isOnline){ showToast('Offline - bitte später erneut versuchen.'); return; }
  // ... bestehender Code unveraendert ...
}
```
(Diese Änderung an JEDER der ca. 10 Schreibaktions-Funktionen anwenden, die der Audit identifiziert hat - `acceptFriendRequest`/`cancelFriendRequest`/`removeFriend`/`createGroup`/`inviteGroupMember`/`leaveGroup`/`deleteGroup`/`changeGroupRole`/`removeGroupMember`/`shareDeck`/Chat-Senden - exakte Funktionsnamen im aktuellen Code mit `grep -n "getSb().rpc('ls_accept_friend_request'\|getSb().rpc('ls_send_friend_request'"` etc. bestätigen, da die Namen in diesem Plan nur ungefähr aus dem Audit übernommen sind.)

- [ ] **Step 2: Syntax check** (write to `/tmp/rtest/plan_check_offline_4.js`)

- [ ] **Step 3: Playwright-Verifikation**

Schreibe `/tmp/rtest/network_offline_hint_test.js`: navigiert zum Netzwerk-Bereich, setzt `Object.defineProperty(navigator,'onLine',{value:false})` + feuert ein `offline`-Event, prüft dass der Hinweis-Banner sichtbar wird UND dass ein Klick auf z.B. "Freund hinzufügen" einen Toast zeigt statt einen RPC-Aufruf zu machen (RPC-Aufrufzähler im Stub bleibt bei 0).

Run: `cd /tmp/rtest && NODE_PATH=/opt/node22/lib/node_modules timeout 60 node network_offline_hint_test.js`

- [ ] **Step 4: Report per Kontrakt aus dem Dispatch-Prompt.**

---

## Task 5: Regressionstest der bereits bestehenden Suiten

**Files:** keine Änderungen - nur Verifikation.

- [ ] **Step 1:** `node --check` auf dem vollständig extrahierten Skript.
- [ ] **Step 2:** Frisch regenerierte Kopien der bestehenden Regressions-Suiten dieser Session (Race-Condition-Guard, Backup-Fallback, Retry-on-Failure aus der IndexedDB-Migration; die Playwright-Verifikation der Testphase/Einladungscodes falls noch als Datei vorhanden) gegen die jetzt weiter veränderte Datei laufen lassen - sicherstellen, dass die neuen `kkmIdbGet('pdfCacheIndex')`/`kkmIdbGet('scanUploadQueue')`-Keys nirgendwo mit den bestehenden `'data'`/`'dataBackup'`-Keys kollidieren oder deren Migrations-/Backup-Logik stören (unwahrscheinlich, da eigener Namensraum, aber explizit gegenprüfen).
- [ ] **Step 3:** Lokaler Checkpoint - kein Commit hier, weiter zu Task 6.

---

## Task 6: Versions-Bump und Ship

**Files:**
- Modify: `index.html` (`KKM_VERSION`)
- Modify: `sw.js` (`CACHE`)

- [ ] **Step 1:** Aktuelle Werte lesen (`grep -n 'var KKM_VERSION' index.html`, `grep -n 'const CACHE' sw.js`), beide um eine Nebenversion/Cache-Nummer erhöhen, gleiche Konvention wie jedes bisherige Feature dieser Session.
- [ ] **Step 2:** Finaler Syntax-Check, gleiches Muster wie jede vorige Aufgabe.
- [ ] **Step 3:** Commit mit einer Zusammenfassung aller 4 Phasen (Scanner-Vorab-Cache, PDF-Offline-Cache mit 150MB-Obergrenze + LRU, Scan-Upload-Warteschlange, Netzwerk-Offline-Hinweis), deutsch, im Stil der bisherigen Commits dieser Session.
- [ ] **Step 4:** Push zum Feature-Branch, PR zu `beta`, Merge - wie jedes bisherige Feature dieser Session für dieses Repo.
- [ ] **Step 5:** Bericht an Sophie in ihrem etablierten Kommunikationsstil (locker, per du, kurze Sätze) - was jetzt offline funktioniert, und der Hinweis, dass sie das mit Flugmodus testen kann: einmal ein Dokument öffnen (online), dann Flugmodus an, nochmal öffnen (sollte klappen); Scanner direkt nach Installation im Flugmodus testen; einen Scan im Flugmodus machen und dann wieder online gehen (sollte automatisch hochladen); im Netzwerk-Bereich im Flugmodus den Hinweis-Banner sehen.
