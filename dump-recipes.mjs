// Dump full recipe details (io, gt metadata) for an item's site production list
// Usage: node dump-recipes.mjs <itemId> <normal|expert>
import fs from "node:fs";
import zlib from "node:zlib";
import { Repository, Goods, Recipe, RecipeIoType } from "./src/repository.js";

const id = process.argv[2];
const mode = process.argv[3] || "normal";
const raw = fs.readFileSync(`data-${mode}/data.bin`);
const repo = Repository.load(zlib.gunzipSync(raw).buffer.slice(0, zlib.gunzipSync(raw).length));

const goods = repo.GetById(id);
const ioTypeName = ["ItemIn", "OreIn", "FluidIn", "ItemOut", "FluidOut"];
let n = 0;
for (const ptr of goods.production) {
    n++;
    const r = repo.GetObject(ptr, Recipe);
    const gt = r.gtRecipe;
    const meta = gt ? gt.metadata.map(m => `${m.key}=${m.value}`).join(",") : "";
    const ios = r.items.map(io =>
        `${ioTypeName[io.type]}:${io.goods.name ?? io.goods.id}${io.type === 1 ? "(oredict)" : ""} x${io.amount}${io.slot !== 65535 ? "@" + io.slot : ""}`).join(" | ");
    console.log(`#${n} ${r.recipeType.name} eu=${gt ? gt.voltage * gt.amperage : 0} dur=${gt ? gt.durationTicks : 0} tier=${gt ? gt.voltageTier : "-"} meta=[${meta}]`);
    console.log(`    ${ios}`);
}
