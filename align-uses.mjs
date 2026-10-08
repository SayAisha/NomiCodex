// Reads the site's data.bin with the site's own repository parser and dumps,
// for every goods object, its consumption (uses) and production (recipes)
// recipe-pointer lists IN SITE ORDER, mapped to recipe ids and compact keys.
// Usage: node dump-site-order.mjs <normal|expert>
import fs from "node:fs";
import zlib from "node:zlib";
import { Repository, Goods, Recipe } from "./src/repository.js";

const mode = process.argv[2] || "normal";
const raw = fs.readFileSync(`data-${mode}/data.bin`);
const buf = zlib.gunzipSync(raw);
const repo = Repository.load(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

// recipe pointer -> id (id sits at element offset +4, per FillObjectPositionMap)
const ptrToId = new Map();
for (let i = 0; i < repo.recipes.length; i++) {
    const ptr = repo.recipes[i];
    ptrToId.set(ptr, repo.GetString(repo.elements[ptr + 4]));
}

function recipeKey(ptr) {
    const r = repo.GetObject(ptr, Recipe);
    const gt = r.gtRecipe;
    let e = 0, d = 0;
    if (gt) { e = gt.voltage * gt.amperage; d = gt.durationTicks; }
    let n = "";
    for (const io of r.items) {
        if (io.type === 3 || io.type === 4) { n = io.goods.name ?? io.goods.id; break; }
    }
    return JSON.stringify([r.recipeType.name, e, d, n]);
}

// goods id -> { uses: [recipe keys in site order], recipes: [...] }
const out = {};
const dump = (goods) => {
    const u = [], p = [];
    for (const ptr of goods.consumption) {
        const id = ptrToId.get(ptr);
        if (id) u.push(recipeKey(ptr));
    }
    for (const ptr of goods.production) {
        const id = ptrToId.get(ptr);
        if (id) p.push(recipeKey(ptr));
    }
    if (u.length || p.length) out[goods.id] = { u, p };
};
for (let i = 0; i < repo.items.length; i++) dump(repo.GetObject(repo.items[i], Goods));
for (let i = 0; i < repo.fluids.length; i++) dump(repo.GetObject(repo.fluids[i], Goods));

fs.writeFileSync(`/tmp/site-order-${mode}.json`, JSON.stringify(out));
console.log(`${mode}: ${Object.keys(out).length} goods with uses/recipes`);
