// NomiCodex shot service — Vercel serverless edition.
// GET /api/shot?item=<id>&mode=normal&r=1[&type=...][&view=uses][&sel=card|body]
//   -> renders the live site card in headless Chromium, returns the PNG.
// GET /api/shot?...&format=json -> {ok, url} (probe for the tag's fallback).
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";

const BASE = (process.env.BASE_URL || "https://sayaisha.github.io/NomiCodex/").replace(/\/*$/, "/");

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
    const selfUrl = `/api/shot?${params.toString()}&item=${encodeURIComponent(item)}` +
        (q.get("sel") ? "&sel=" + q.get("sel") : "");

    // probe mode: hand back the embed URL instantly — the actual render
    // happens once, when Discord fetches the image
    if (q.get("format") === "json") {
        const host = (req.headers && (req.headers.host || req.headers.Host)) || "";
        return res.json({ ok: true, url: selfUrl, abs: host ? `https://${host}${selfUrl}` : selfUrl });
    }

    let browser = null;
    try {
        const opts = process.env.CHROME_PATH
            ? { executablePath: process.env.CHROME_PATH, args: ["--no-sandbox", "--disable-gpu"] }
            : { executablePath: await chromium.executablePath(), args: [...chromium.args, "--disable-gpu"], headless: chromium.headless };
        browser = await puppeteer.launch(opts);
        const page = await browser.newPage();
        await page.setViewport({ width: 1100, height: 900, deviceScaleFactor: 2 });
        await page.goto(target, { waitUntil: "domcontentloaded", timeout: 25000 });
        try {
            await page.waitForSelector(sel, { timeout: 8000 });
            await page.waitForFunction(() => document.body.dataset.ready === "1", { timeout: 8000 });
        } catch (e) { /* capture whatever rendered */ }
        const el = await page.$(sel);
        if (!el) throw new Error("card not found");
        const png = await el.screenshot({ type: "png" });

        res.setHeader("Content-Type", "image/png");
        res.setHeader("Cache-Control", "public, max-age=86400");
        return res.end(png);
    } catch (e) {
        res.statusCode = 500;
        return res.json({ ok: false, error: String(e.message || e) });
    } finally {
        if (browser) await browser.close().catch(() => {});
    }
}
