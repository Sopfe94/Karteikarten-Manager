export default async function handler(req, res) {
if (req.method !== ‘POST’) return res.status(405).end();

try {
var body = req.body || {};
var name = body.name || ‘(kein Betreff)’;
var os = body.os || ‘Nicht angegeben’;
var message = body.message || ‘’;

if (!message.trim()) {
  return res.status(400).json({ error: 'Nachricht fehlt' });
}

var token = process.env.GITHUB_TOKEN;
if (!token) {
  return res.status(500).json({ error: 'GITHUB_TOKEN fehlt' });
}

var issueBody = 'Betriebssystem: ' + os + '\n\n' + message;

var response = await fetch('https://api.github.com/repos/Sopfe94/Karteikarten-Manager/issues', {
  method: 'POST',
  headers: {
    'Authorization': 'token ' + token,
    'Content-Type': 'application/json',
    'User-Agent': 'KarteikartenManager/1.0'
  },
  body: JSON.stringify({
    title: 'Problem: ' + name,
    body: issueBody
  })
});

var data = await response.text();
console.log('GitHub response:', response.status, data.substring(0, 200));

if (response.ok) {
  return res.status(200).json({ ok: true });
} else {
  return res.status(500).json({ error: response.status, detail: data.substring(0, 500) });
}

} catch (err) {
console.error(‘Catch error:’, err.message);
return res.status(500).json({ error: err.message });
}
}
