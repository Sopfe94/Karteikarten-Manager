# 📚 Karteikarten Manager – Vercel Deployment

## Dateien im Projekt
```
karteikarten-pwa/
├── index.html              ← App (kein Babel, kein Build nötig!)
├── sw.js                   ← Service Worker
├── manifest.json           ← PWA Manifest
├── icon.svg                ← App Icon
├── logo.svg                ← Logo
├── package.json            ← Abhängigkeiten
├── vercel.json             ← Vercel Konfiguration
├── api/
│   ├── register.js         ← Registrierung
│   ├── status.js           ← Status prüfen
│   └── admin.js            ← Admin-Verwaltung
└── VERCEL-ANLEITUNG.md
```

## Schritt 1 – Vercel Account anlegen
1. → **vercel.com** → „Sign Up" → kostenlos mit GitHub/Google/E-Mail

## Schritt 2 – Vercel KV Datenbank anlegen
1. Im Vercel Dashboard → **Storage** → **Create Database** → **KV**
2. Name: `karteikarten-db` → Region: Frankfurt (eu-central-1)
3. Auf „Create" klicken

## Schritt 3 – App deployen
1. Vercel Dashboard → **Add New Project**
2. Ganz unten: **„Deploy from CLI"** überspringen
3. Stattdessen: ZIP entpacken → den Ordner per **Drag & Drop** auf vercel.com/new
4. **Deploy** klicken → fertig!

## Schritt 4 – KV mit App verbinden
1. Im Vercel Projekt → **Storage** → deine KV Datenbank → **Connect to Project**
2. Dein Projekt auswählen → Connect

## Schritt 5 – Admin-Passwort setzen
1. Vercel Projekt → **Settings** → **Environment Variables**
2. Variable hinzufügen:
   - **Name:** `ADMIN_PASSWORD`
   - **Value:** (dein Passwort, z.B. `MeineKlasse2025!`)
3. Speichern → Projekt neu deployen (Deployments → Redeploy)

---

## Admin-Bereich nutzen
- In der App ganz unten rechts: kleines **⚙ Admin**-Symbol tippen
- Passwort eingeben
- Neue Registrierungen sehen → ✓ freigeben oder ✗ ablehnen

## App installieren (für Mitschüler)
| Gerät | Anleitung |
|-------|-----------|
| **iPhone** | Safari → Teilen (□↑) → „Zum Home-Bildschirm" |
| **Android** | Chrome → Menü (⋮) → „App installieren" |
| **Desktop Chrome** | Adressleiste → Install-Symbol |

---

## Wichtig: Standard-Passwort ändern!
Das Standard-Passwort ist `admin1234` – **bitte sofort** über Environment Variables ändern!
