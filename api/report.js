export default async function handler(req, res) {
if (req.method !== ‘POST’) return res.status(405).end();

var body = req.body || {};
var name = body.name || ‘’;
var message = body.message || ‘’;

if (!message || !message.trim()) {
return res.status(400).json({ error: ‘Nachricht fehlt’ });
}

var apiKey = process.env.BREVO_API_KEY;
var toEmail = process.env.REPORT_EMAIL;

if (!apiKey || !toEmail) {
return res.status(500).json({ error: ‘Server nicht konfiguriert’ });
}

var mailBody = ’Betreff: ’ + (name || ‘(kein Betreff)’) + ‘\n\n’ + message;

var response = await fetch(‘https://api.brevo.com/v3/smtp/email’, {
method: ‘POST’,
headers: {
‘api-key’: apiKey,
‘Content-Type’: ‘application/json’,
},
body: JSON.stringify({
sender: { name: ‘Karteikarten Manager’, email: toEmail },
to: [{ email: toEmail }],
subject: ‘Problem gemeldet - Karteikarten Manager’,
textContent: mailBody,
}),
});

var data = await response.text();

if (response.ok) {
return res.status(200).json({ ok: true });
} else {
console.error(‘Brevo Fehler:’, response.status, data);
return res.status(500).json({ error: ‘Brevo Fehler’, status: response.status, detail: data });
}
}
