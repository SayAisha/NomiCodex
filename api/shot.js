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
// per-deployment VERCEL_URLs are SSO-protected on the Hobby plan — only
// the production alias is publicly fetchable, so always render from that
const selfOrigin = `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL || "nomi-codex.vercel.app"}`;
const BASE = (process.env.BASE_URL || (selfOrigin ? selfOrigin + "/" : "https://sayaisha.github.io/NomiCodex/")).replace(/\/*$/, "/");
const g = globalThis;

// one browser per warm instance (Fluid Compute keeps instances alive between
// requests) — launching per request is what made cold renders so slow.
// Launches are SERIALIZED: concurrent launches race @sparticuz/chromium's
// binary extraction and die with "spawn ETXTBSY" (text file busy), leaving
// the instance in a launch-crash loop. ETXTBSY also gets a short backoff —
// the binary settles once the writer closes it.
let launchChain = Promise.resolve();
async function launchBrowser() {
    const run = async () => {
        const opts = process.env.CHROME_PATH
            ? { executablePath: process.env.CHROME_PATH, args: ["--no-sandbox", "--disable-gpu"] }
            : { executablePath: await chromium.executablePath(), args: [...chromium.args, "--disable-gpu"], headless: chromium.headless };
        for (let attempt = 0; ; attempt++) {
            try {
                return await puppeteer.launch(opts);
            } catch (e) {
                if (/ETXTBSY/.test(String((e && e.message) || e)) && attempt < 4) {
                    await new Promise(r => setTimeout(r, 1500 + attempt * 1500));
                    continue;
                }
                throw e;
            }
        }
    };
    const p = launchChain.then(run, run);
    launchChain = p.catch(() => {});
    return p;
}

async function getBrowser() {
    if (!g.__browser) {
        g.__browser = launchBrowser().catch((e) => { g.__browser = null; throw e; });
    }
    return g.__browser;
}

async function render(target, sel) {
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
        await page.setViewport({ width: 2000, height: 1200, deviceScaleFactor: 2 });
        await page.goto(target, { waitUntil: "domcontentloaded", timeout: 25000 });
        const ready = () => page.waitForFunction(() => document.body.dataset.ready === "1", { timeout: 15000 })
            .then(() => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))))
            .then(() => true).catch(() => false);
        // a not-ready page means a blank capture — reload and retry rather
        // than shipping an empty card (cold instances can be slow on the
        // first atlas download)
        if (!await ready()) {
            await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
            await ready();
        }
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

// a crashed browser process leaves a dead cached handle that turns every
// later render into "Connection closed" until the instance recycles —
// detect it, drop the handle and relaunch once
const CRASH_RE = /Connection closed|Target closed|Browser (?:has )?(?:disconnected|closed)|Session closed|Protocol error/i;
async function renderSafe(target, sel) {
    try {
        return await render(target, sel);
    } catch (e) {
        if (!CRASH_RE.test(String((e && e.message) || e))) throw e;
        g.__browser = null;
        return await render(target, sel);
    }
}

// small LRU of in-flight/finished renders; the probe pre-renders so the
// image fetch that follows (Discord's proxy) usually lands on a finished PNG
function prender(key, target, sel) {
    if (!g.__shots) g.__shots = new Map();
    if (!g.__shots.has(key)) {
        if (g.__shots.size > 32) g.__shots.delete(g.__shots.keys().next().value);
        g.__shots.set(key, renderSafe(target, sel).catch((e) => { g.__lastErr = String((e && e.message) || e).slice(0, 300); return null; }));
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
    // selection/theme params pass through to the page (content-pinned cards,
    // light renders) — they also make the prender key distinct per variant
    for (const p of ["out", "eu", "dur", "theme"]) {
        const v = q.get(p);
        if (v) params.set(p, v);
    }
    const target = `${BASE}#/item/${encodeURIComponent(item)}?${params}`;
    // rv busts Discord's image-proxy cache whenever the renderer changes;
    // unknown params don't affect the prender key
    const selfUrl = `/api/shot?${params.toString()}&item=${encodeURIComponent(item)}&rv=6` +
        (q.get("sel") ? "&sel=" + q.get("sel") : "");
    const key = target + "|" + sel;

    // probe: answer with the URL; wait=<secs> holds the response until the
    // render finishes (capped) so the caller can embed a URL that is already
    // rendered and instance-cached — Discord's image proxy will not sit
    // through a cold render, which is why first-run embeds used to come up
    // empty and only the second attempt attached
    if (q.get("format") === "json") {
        const p = prender(key, target, sel);
        const waitRaw = parseFloat(q.get("wait"));
        if (!Number.isNaN(waitRaw)) {
            const cap = Math.min(12, Math.max(0.5, waitRaw)) * 1000;
            await Promise.race([p, new Promise(r => setTimeout(r, cap))]);
        }
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
