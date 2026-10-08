// Rebuild search-data + api shards from the site's data.bin (the authoritative
// source — includes every recipe variant the old build deduplicated away).
// Usage: node rebuild-search-data.mjs <normal|expert>
import fs from "node:fs";
import zlib from "node:zlib";
import { Repository, Goods, Recipe } from "./src/repository.js";

const mode = process.argv[2] || "normal";
const raw = zlib.gunzipSync(fs.readFileSync(`data-${mode}/data.bin`));
const repo = Repository.load(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
// NOTE: run `git checkout -- search-data/` before re-running — this script
// overwrites the gz it reads from
const old = JSON.parse(zlib.gunzipSync(fs.readFileSync(`search-data/${mode}.json.gz`)));

const TIERS = ["ULV","LV","MV","HV","EV","IV","LuV","ZPM","UV","UHV","UEV","UIV","UXV","OpV","MAX"];
const fmtN = n => n.toLocaleString("en-US");

function ioSummary(r, kinds) {
    // aggregate identical inputs (crafting grids repeat the same item per
    // slot) and resolve oredicts to their first member's name — matches the
    // old data's formatting so static-card hashes carry over
    const order = [], byKey = new Map();
    for (const io of r.items) {
        if (!kinds.includes(io.type)) continue;
        if (io.type === 0 && (io.goods.name === "Programmed Circuit" || io.amount === 0)) continue;
        const isFluid = io.type === 2 || io.type === 4;
        const name = io.type === 1
            ? (io.goods.items?.[0]?.name ?? io.goods.id)
            : (io.goods.name ?? io.goods.id);
        const key = name + (isFluid ? "\u0001" : "\u0000");
        if (!byKey.has(key)) { byKey.set(key, 0); order.push(key); }
        byKey.set(key, byKey.get(key) + io.amount);
    }
    return order.map(k => ({
        name: k.slice(0, -1),
        fluid: k.endsWith("\u0001"),
        amount: byKey.get(k)
    })).map(({ name, fluid, amount }) =>
        `${name} (${fmtN(amount)}${fluid ? "L" : ""})`).join(", ");
}
function firstOutputName(r) {
    for (const io of r.items) {
        if (io.type === 3 || io.type === 4) return io.goods.name ?? io.goods.id;
    }
    return "";
}
function recipeEntry(r, idx) {
    const gt = r.gtRecipe;
    let heat = 0, clean = false;
    if (gt) for (const m of gt.metadata) {
        if (m.key === "coil_heat") heat = Math.round(m.value);
        else if (m.key === "cleanroom") clean = true;
    }
    return {
        idx,
        type: r.recipeType.name,
        eu: gt ? gt.voltage * gt.amperage : 0,
        dur: gt ? gt.durationTicks : 0,
        amp: gt ? gt.amperage : 0,
        tier: gt && gt.voltageTier >= 0 && gt.voltageTier < TIERS.length ? TIERS[gt.voltageTier] : "ULV",
        heat, clean,
        img: "",
        ins: ioSummary(r, [0, 1, 2]),
        outs: ioSummary(r, [3, 4]),
    };
}
function ioNames(r, kinds) {
    // old uses entries carried input NAMES only, no amounts — matching that
    // format is what lets their static-card hashes carry over
    const order = [], seen = new Set();
    for (const io of r.items) {
        if (!kinds.includes(io.type)) continue;
        if (io.type === 0 && (io.goods.name === "Programmed Circuit" || io.amount === 0)) continue;
        const name = io.type === 1
            ? (io.goods.items?.[0]?.name ?? io.goods.id)
            : (io.goods.name ?? io.goods.id);
        if (!seen.has(name)) { seen.add(name); order.push(name); }
    }
    return order.join(", ");
}
function useEntry(r, goods) {
    const e = recipeEntry(r, 0);
    // amount of `goods` consumed: direct input, or via an oredict containing it
    let amount = 0;
    for (const io of r.items) {
        if (io.type > 2) continue;
        if (io.goods.id === goods.id) { amount = io.amount; break; }
        if (io.type === 1 && io.goods.items?.some(it => it.id === goods.id)) { amount = io.amount; break; }
    }
    const entry = { n: firstOutputName(r), t: e.type, e: e.eu, d: e.dur, x: e.tier, h: e.heat, a: amount, i: e.ins, g: "" };
    entry.__key = JSON.stringify([entry.t, entry.e, entry.d, entry.n, ioNames(r, [0, 1, 2])]);
    return entry;
}

// --- carryover maps for static card hashes (img on recipes, g on uses) ---
const oldImg = new Map(), oldG = new Map();
for (const [rid, recs] of Object.entries(old.recipes)) {
    for (const r of recs) {
        const k = JSON.stringify([r.type, r.eu, r.dur, r.ins, r.outs]);
        if (!oldImg.has(k)) oldImg.set(k, r.img || "");
    }
}
for (const [uid, uses] of Object.entries(old.uses)) {
    for (const u of uses) {
        const k = JSON.stringify([u.t, u.e, u.d, u.n, u.i]);
        if (!oldG.has(k)) oldG.set(k, u.g || "");
    }
}
// --- walk every goods object (items + fluids) ---
const recipes = {}, uses = {};
const oldByName = new Map(old.i.map(x => [x[0], x]));
let recipeCount = 0, useCount = 0, imgKept = 0, gKept = 0;
const walk = goods => {
    const prod = [...goods.production], cons = [...goods.consumption];
    if (!prod.length && !cons.length) return;
    if (prod.length) {
        const list = prod.map((ptr, i) => {
            const e = recipeEntry(repo.GetObject(ptr, Recipe), i);
            // exact key only — a card renders the inputs too, so reusing it
            // across different inputs (same outs) would show a wrong recipe
            e.img = oldImg.get(JSON.stringify([e.type, e.eu, e.dur, e.ins, e.outs])) || "";
            if (e.img) imgKept++;
            return e;
        });
        recipes[goods.id] = list;
        recipeCount += list.length;
    }
    if (cons.length) {
        const list = cons.map(ptr => {
            const e = useEntry(repo.GetObject(ptr, Recipe), goods);
            e.g = oldG.get(e.__key) || "";
            if (e.g) gKept++;
            delete e.__key;
            return e;
        });
        uses[goods.id] = list;
        useCount += list.length;
    }
};
for (let i = 0; i < repo.items.length; i++) walk(repo.GetObject(repo.items[i], Goods));
for (let i = 0; i < repo.fluids.length; i++) walk(repo.GetObject(repo.fluids[i], Goods));

// --- item index: keep identity fields from the old index, refresh counts/types ---
const items = old.i.map(x => {
    const rid = x[0];
    const prodTypes = [...new Set((recipes[rid] || []).map(r => r.type))];
    return [x[0], x[1], x[2], x[3], (recipes[rid] || []).length, (uses[rid] || []).length,
        prodTypes.length ? prodTypes : x[6]];
});

const out = { i: items, a: old.a, recipes, uses };
fs.writeFileSync(`/tmp/rebuilt-${mode}.json`, JSON.stringify(out));
fs.writeFileSync(`search-data/${mode}.json.gz`, zlib.gzipSync(JSON.stringify(out), { level: 9 }));

// --- shards for the Cloudflare worker fallback: r = mod 256, u = mod 2048 ---
const shardOf = (id, m, pad) => String([...id].reduce((a, c) => a + c.charCodeAt(0), 0) % m).padStart(pad, "0");
const rShards = {}, uShards = {};
for (const [id, list] of Object.entries(recipes)) {
    const s = shardOf(id, 256, 3);
    (rShards[s] ??= {})[id] = list;
}
for (const [id, list] of Object.entries(uses)) {
    const s = shardOf(id, 2048, 4);
    (uShards[s] ??= {})[id] = list;
}
let nFiles = 0;
const writeShards = (dir, shards) => {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, map] of Object.entries(shards)) {
        const body = JSON.stringify(map);
        fs.writeFileSync(`${dir}/${name}.txt`, body);
        fs.writeFileSync(`${dir}/${name}.json`, body);
        nFiles++;
    }
};
writeShards(`api/t/${mode}/r`, rShards);
writeShards(`api/t/${mode}/u`, uShards);

// worker item index {i, a}
fs.writeFileSync(`api/worker/index-${mode}.json`, JSON.stringify({ i: items, a: old.a }));

const oldRC = Object.values(old.recipes).reduce((a, b) => a + b.length, 0);
const oldUC = Object.values(old.uses).reduce((a, b) => a + b.length, 0);
console.log(`${mode}: recipes ${oldRC} -> ${recipeCount} | uses ${oldUC} -> ${useCount} | img kept ${imgKept}/${recipeCount} | g kept ${gKept}/${useCount} | shard files ${nFiles}`);
