export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { name, message } = req.body || {};
  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Nachricht fehlt' });
  }

  const apiKey  = process.env.BREVO_API_KEY;
  const toEmail = process.env.REPORT_EMAIL;

  if (!apiKey || !toEmail) {
    return res.status(500).json({ error: 'Server nicht konfiguriert' });
  }

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender: { name: 'Karteikarten Manager', email: toEmail },
      to: [{ email: toEmail }],
      subject: 'Problem gemeldet - Karteikarten Manager',
      textContent: `Von: ${name || 'Anonym'}\n\n${message}`,
    }),
  });

  if (response.ok) {
    return res.status(200).json({ ok: true });
  } else {
    const err = await response.text();
    console.error('Brevo error:', err);
    return res.status(500).json({ error: 'Fehler beim Senden' });
  }
}
