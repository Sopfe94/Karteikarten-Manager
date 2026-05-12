module.exports = async function handler(req, res) {
if (req.method !== “POST”) return res.status(405).end();
try {
var b = req.body || {};
var token = process.env.GITHUB_TOKEN;
if (!token) return res.status(500).json({ error: “no token” });
var r = await fetch(“https://api.github.com/repos/Sopfe94/Karteikarten-Manager/issues”, {
method: “POST”,
headers: {
“Authorization”: “token “ + token,
“Content-Type”: “application/json”,
“User-Agent”: “App”
},
body: JSON.stringify({
title: “Problem: “ + (b.name || “-”),
body: (b.os || “-”) + “\n\n” + (b.message || “-”)
})
});
var d = await r.text();
console.log(“GitHub:”, r.status, d.substring(0, 200));
return res.status(r.ok ? 200 : 500).json({ ok: r.ok });
} catch (e) {
console.error(“err:”, e.message);
return res.status(500).json({ error: e.message });
}
};
