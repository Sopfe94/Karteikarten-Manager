module.exports = async function(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  try {
    var b = req.body || {};
    // Falls body nicht geparst wurde
    if (typeof b === "string") { try { b = JSON.parse(b); } catch(e) { b = {}; } }

    var t = process.env.GITHUB_TOKEN;
    if (!t) {
      console.error("FEHLER: GITHUB_TOKEN nicht gesetzt!");
      return res.status(500).json({ error: "no token" });
    }

    console.log("Sende Issue:", b.name, "|", b.os);

    var r = await fetch("https://api.github.com/repos/Sopfe94/Karteikarten-Manager/issues", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + t,
        "Content-Type": "application/json",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "KKM-Reporter"
      },
      body: JSON.stringify({
        title: "Problem: " + (b.name || "(kein Betreff)"),
        body: "**Betriebssystem:** " + (b.os || "Nicht angegeben") + "\n\n**Beschreibung:**\n" + (b.message || "-")
      })
    });

    var responseText = await r.text();
    console.log("GitHub Status:", r.status);
    console.log("GitHub Antwort:", responseText.substring(0, 300));

    if (!r.ok) {
      console.error("GitHub Fehler:", r.status, responseText.substring(0, 500));
      return res.status(500).json({ error: "github_error", status: r.status });
    }

    return res.status(200).json({ ok: true });

  } catch(e) {
    console.error("Exception:", e.message);
    return res.status(500).json({ error: e.message });
  }
};