export default async function handler(req, res) {
if (req.method !== “POST”) return res.status(405).end();
try {
var b = req.body || {};
var token = process.env.GITHUB_TOKEN;
if (!token) return res.status(500).json({ error: “no token” });
var title = “Problem: “ + (b.name || “kein Betreff”);
var body = “OS: “ + (b.os || “-”) + “\n\n” + (b.message || “”);
var r = await fetch(“https://api.github.com/repos/Sopfe94/Karteikarten-Manager/issues”, {
method: “POST”,
headers: {
“Authorization”: “token “ + token,
“Content-Type”: “application/json”,
“User-Agent”: “KarteikartenApp”
},
body: JSON.stringify({ title: title, body: body })
});
var d = await r.text();
console.log(“status:”, r.status, d.substring(0, 300));
return res.status(r.ok ? 200 : 500).json({ ok: r.ok, s: r.status });
} catch (e) {
console.error(“error:”, e.message);
return res.status(500).json({ error: e.message });
}
}
