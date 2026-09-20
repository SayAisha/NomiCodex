// NomiCodex shot service — Vercel serverless edition.
// GET /api/shot?item=<id>&mode=normal&r=1[&type=...][&view=uses][&sel=card|body]
//   -> renders the live site card in headless Chromium, returns the PNG.
// GET /api/shot?...&format=json -> {ok, url} instantly (tag probe) — also
//    kicks off the render in the background so Discord's image fetch is fast.
import puppeteer from "puppeteer-core";
// Vercel's Node 20+ runtimes are Amazon Linux 2023, but Vercel doesn't set
// the AWS env vars @sparticuz/chromium uses to detect that — hint it so the
// al2023 shared-library bundle (libnss3, libnspr4, ...) actually extracts.
// Dynamic import: ESM imports are hoisted, so this must run first.
if (process.env.VERCEL && !process.env.AWS_LAMBDA_JS_RUNTIME && !process.env.AWS_EXECUTION_ENV) {
    process.env.AWS_LAMBDA_JS_RUNTIME = `nodejs${process.versions.node.split(".")[0]}.x`;
}
const { default: chromium } = await import("@sparticuz/chromium");

// render from THIS deployment's own static copy (public/) — assets come
// from Vercel's edge instead of a cross-origin GitHub Pages round trip;
// falls back to Pages if the env vars are missing (e.g. local runs)
const selfOrigin = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null);
const BASE = (process.env.BASE_URL || (selfOrigin ? selfOrigin + "/" : "https://sayaisha.github.io/NomiCodex/")).replace(/\/*$/, "/");
const g = globalThis;

// one browser per warm instance (Fluid Compute keeps instances alive between
// requests) — launching per request is what made cold renders so slow
async function getBrowser() {
    if (!g.__browser) {
        const opts = process.env.CHROME_PATH
            ? { executablePath: process.env.CHROME_PATH, args: ["--no-sandbox", "--disable-gpu"] }
            : { executablePath: await chromium.executablePath(), args: [...chromium.args, "--disable-gpu"], headless: chromium.headless };
        g.__browser = puppeteer.launch(opts).catch((e) => { g.__browser = null; throw e; });
    }
    return g.__browser;
}

async function render(target, sel) {
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
        await page.setViewport({ width: 1100, height: 900, deviceScaleFactor: 2 });
        await page.goto(target, { waitUntil: "domcontentloaded", timeout: 25000 });
        try {
            await page.waitForSelector(sel, { timeout: 8000 });
            await page.waitForFunction(() => document.body.dataset.ready === "1", { timeout: 8000 });
            // let the decoded background sprites composite before capture
            await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
        } catch (e) { /* capture whatever rendered */ }
        const el = await page.$(sel);
        if (!el) {
            const dbg = await page.evaluate(() => ({
                href: location.href.slice(0, 90),
                splash: !!document.getElementById("splash"),
                msg: (document.getElementById("splash")?.textContent || "").trim().slice(0, 60),
                ready: document.body.dataset.ready || null
            })).catch((e) => ({ evalErr: String(e) }));
            throw new Error("card not found: " + JSON.stringify(dbg));
        }
        return await el.screenshot({ type: "png" });
    } finally {
        await page.close().catch(() => {});
    }
}

// small LRU of in-flight/finished renders; the probe pre-renders so the
// image fetch that follows (Discord's proxy) usually lands on a finished PNG
function prender(key, target, sel) {
    if (!g.__shots) g.__shots = new Map();
    if (!g.__shots.has(key)) {
        if (g.__shots.size > 8) g.__shots.delete(g.__shots.keys().next().value);
        g.__shots.set(key, render(target, sel).catch((e) => { g.__lastErr = String((e && e.message) || e).slice(0, 300); return null; }));
    }
    return g.__shots.get(key);
}

export default async function handler(req, res) {
    const q = new URL(req.url, "https://x").searchParams;
    const item = q.get("item");
    if (!item) {
        res.statusCode = 400;
        return res.json({ error: "missing item" });
    }
    const mode = q.get("mode") === "expert" ? "expert" : "normal";
    const r = Math.max(1, parseInt(q.get("r"), 10) || 1);
    const view = q.get("view") === "uses" ? "uses" : null;
    const type = q.get("type") || "";
    const sel = q.get("sel") === "card" ? ".rcard" : ".rcard-body";

    const params = new URLSearchParams({ shot: "1", r: String(r), mode });
    if (view) params.set("view", view);
    if (type) params.set("type", type);
    const target = `${BASE}#/item/${encodeURIComponent(item)}?${params}`;
    // rv busts Discord's image-proxy cache whenever the renderer changes;
    // unknown params don't affect the prender key
    const selfUrl = `/api/shot?${params.toString()}&item=${encodeURIComponent(item)}&rv=2` +
        (q.get("sel") ? "&sel=" + q.get("sel") : "");
    const key = target + "|" + sel;

    // probe: answer instantly, pre-render in the background for the fetch
    if (q.get("format") === "json") {
        prender(key, target, sel);
        const host = (req.headers && (req.headers.host || req.headers.Host)) || "";
        return res.json({ ok: true, url: selfUrl, abs: host ? `https://${host}${selfUrl}` : selfUrl });
    }

    try {
        let png = await prender(key, target, sel);
        if (!png) { g.__shots.delete(key); png = await prender(key, target, sel); }
        if (!png) throw new Error(g.__lastErr || "render failed");
        res.setHeader("Content-Type", "image/png");
        res.setHeader("Cache-Control", "public, max-age=300");
        return res.end(png);
    } catch (e) {
        res.statusCode = 500;
        return res.json({ ok: false, error: String(e.message || e) });
    }
}
