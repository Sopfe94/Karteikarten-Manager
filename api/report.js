export default async function handler(req, res) {
if (req.method !== ‘POST’) return res.status(405).end();

const { name, message } = req.body || {};
if (!message || !message.trim()) {
return res.status(400).json({ error: ‘Nachricht fehlt’ });
}

const apiKey  = process.env.BREVO_API_KEY;
const toEmail = process.env.REPORT_EMAIL;

if (!apiKey || !toEmail) {
return res.status(500).json({ error: ‘Server nicht konfiguriert’, missing: { apiKey: !apiKey, toEmail: !toEmail } });
}

try {
const response = await fetch(‘https://api.brevo.com/v3/smtp/email’, {
method: ‘POST’,
headers: {
‘api-key’: apiKey,
‘Content-Type’: ‘application/json’,
},
body: JSON.stringify({
sender: { name: ‘Karteikarten Manager’, email: toEmail },
to: [{ email: toEmail }],
subject: ‘Problem gemeldet - Karteikarten Manager’,
textContent: `Betreff: ${name || '(kein Betreff)'}\n\n${message}`,
}),
});

const data = await response.text();

if (response.ok) {
  return res.status(200).json({ ok: true });
} else {
  console.error('Brevo Fehler:', response.status, data);
  return res.status(500).json({ error: 'Brevo Fehler', status: response.status, detail: data });
}

} catch (err) {
console.error(‘Fetch Fehler:’, err.message);
return res.status(500).json({ error: err.message });
}
}
