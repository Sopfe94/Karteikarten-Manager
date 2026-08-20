module.exports = async function(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  try {
    var b = req.body || {};
    if (typeof b === "string") { try { b = JSON.parse(b); } catch(e) { b = {}; } }

    var refreshToken = b.refresh_token;
    if (!refreshToken) return res.status(400).json({ error: "no_refresh_token" });

    var clientId = process.env.GOOGLE_CLIENT_ID;
    var clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      console.error("FEHLER: GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET nicht gesetzt!");
      return res.status(500).json({ error: "server_not_configured" });
    }

    var params = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    });

    var r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString()
    });

    var data = await r.json();
    if (!r.ok) {
      console.error("Google-Token-Refresh-Fehler:", r.status, JSON.stringify(data).substring(0, 300));
      return res.status(r.status).json({ error: "refresh_failed", detail: data.error });
    }

    return res.status(200).json({ access_token: data.access_token, expires_in: data.expires_in });

  } catch(e) {
    console.error("Exception:", e.message);
    return res.status(500).json({ error: e.message });
  }
};
