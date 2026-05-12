export default async function handler(req, res) {
if (req.method !== ‘POST’) return res.status(405).end();

var body = req.body || {};
var name = body.name || ‘(kein Betreff)’;
var os = body.os || ‘Nicht angegeben’;
var message = body.message || ‘’;

if (!message.trim()) {
return res.status(400).json({ error: ‘Nachricht fehlt’ });
}

var token = process.env.GITHUB_TOKEN;
if (!token) {
return res.status(500).json({ error: ‘Server nicht konfiguriert’ });
}

var response = await fetch(‘https://api.github.com/repos/Sopfe94/Karteikarten-Manager/issues’, {
method: ‘POST’,
headers: {
‘Authorization’: ’Bearer ’ + token,
‘Content-Type’: ‘application/json’,
‘Accept’: ‘application/vnd.github+json’,
‘X-GitHub-Api-Version’: ‘2022-11-28’
},
body: JSON.stringify({
title: ’Problem: ’ + name,
body: ’**Betriebssystem:** ’ + os + ‘\n\n**Beschreibung:**\n’ + message
})
});

var data = await response.text();

if (response.ok) {
return res.status(200).json({ ok: true });
} else {
console.error(‘GitHub Error:’, response.status, data);
return res.status(500).json({ error: response.status, detail: data });
}
}
