// NomiCodex shot service — renders a recipe card from the live site and
// returns a PNG URL for Discord embeds.
//   GET /shot?item=<id>&mode=normal&r=1&view=uses&sel=body
//   GET /img/<name>.png   (screenshots, hash-named, immutable)
//   GET /health
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { chromium } = require("playwright-core");

const PORT = +(process.env.PORT || 8788);
const BASE = (process.env.BASE_URL || "http://127.0.0.1:8765/").replace(/\/*$/, "/") + "#";
const SHOTS = path.join(__dirname, "shots");
fs.mkdirSync(SHOTS, { recursive: true });

let browser = null, tab = null;
let queue = Promise.resolve(); // one shot at a time — single warm tab

async function ensureBrowser() {
    if (browser) return;
    const opts = {
        args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
               "--disable-lcd-text", "--font-render-hinting=none"]
    };
    if (process.env.CHROME_PATH) opts.executablePath = process.env.CHROME_PATH;
    browser = await chromium.launch(opts);
    tab = await browser.newPage({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 2 });
    console.log("browser ready");
}

async function takeShot(q) {
    const item = q.get("item");
    if (!item) throw new Error("missing item");
    const mode = q.get("mode") === "expert" ? "expert" : "normal";
    const r = Math.max(1, parseInt(q.get("r"), 10) || 1);
    const view = q.get("view") === "uses" ? "uses" : null;
    const sel = q.get("sel") === "card" ? ".rcard" : ".rcard-body";
    const type = q.get("type") || "";

    const params = new URLSearchParams({ shot: "1", r: String(r), mode });
    if (view) params.set("view", view);
    if (type) params.set("type", type);
    const url = `${BASE}/item/${encodeURIComponent(item)}?${params}`;
    await ensureBrowser();
    if (!tab) throw new Error("browser not ready");
    await tab.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    try {
        await tab.waitForSelector(sel, { timeout: 15000 });
        await tab.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 15000 });
    } catch (e) { /* fall through: capture whatever rendered */ }
    const el = await tab.$(sel);
    if (!el) throw new Error("card not found for " + item);
    const png = await el.screenshot({ type: "png" });
    const name = crypto.createHash("sha1")
        .update([item, mode, r, view, sel, type].join("|")).digest("hex").slice(0, 12) + ".png";
    fs.writeFileSync(path.join(SHOTS, name), png);
    return { url: "/img/" + name, bytes: png.length };
}

const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    const send = (code, body, type) => {
        res.writeHead(code, { "Content-Type": type, "Access-Control-Allow-Origin": "*" });
        res.end(body);
    };
    if (u.pathname === "/health") return send(200, '{"ok":true}', "application/json");
    if (u.pathname.startsWith("/img/")) {
        const f = path.join(SHOTS, path.basename(u.pathname));
        if (!fs.existsSync(f)) return send(404, "gone", "text/plain");
        res.writeHead(200, {
            "Content-Type": "image/png",
            "Cache-Control": "public, max-age=31536000, immutable",
            "Access-Control-Allow-Origin": "*"
        });
        return fs.createReadStream(f).pipe(res);
    }
    if (u.pathname === "/shot") {
        const t = setTimeout(() => { if (!res.writableEnded) send(504, '{"error":"timeout"}', "application/json"); }, 50000);
        queue = queue
            .then(() => takeShot(u.searchParams))
            .then((r) => send(200, JSON.stringify(r), "application/json"))
            .catch((e) => send(400, JSON.stringify({ error: String(e.message || e) }), "application/json"))
            .finally(() => clearTimeout(t));
        return;
    }
    send(404, "not found", "text/plain");
});

server.listen(PORT, () => console.log("shot service on :" + PORT + " -> " + BASE));
ensureBrowser().catch((e) => { console.error("browser warmup failed:", e.message); });
