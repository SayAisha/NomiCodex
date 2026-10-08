// Local test harness for api/search.js — run from nomicodex-deploy/
import handler from "./api/search.js";

const hidden = new Set(["pulverization", "extractor", "arc furnace", "packager", "compressor", "fluid solidifier"]);

async function call(q, mode = "normal", uses = false) {
    return new Promise((resolve) => {
        const req = { url: `https://x/api/search?q=${encodeURIComponent(q)}&mode=${mode}${uses ? "&uses=1" : ""}`, headers: {} };
        const res = {
            statusCode: 200,
            setHeader() {},
            end(body) { resolve({ status: this.statusCode, body: JSON.parse(body) }); }
        };
        handler(req, res);
    });
}

let fails = 0;
function check(name, cond, extra = "") {
    if (cond) console.log(`  ok   ${name}`);
    else { fails++; console.log(`  FAIL ${name} ${extra}`); }
}

const cases = [
    // --- number-word search ---
    ["micro miner tier 1", "Steel Plated Micro Miner [Tier One]"],
    ["micro miner 1", "Steel Plated Micro Miner [Tier One]"],
    ["micro miner 4", "Signalum Plated Micro Miner [Tier Four]"],
    ["micro miner tier six", "Enderium Plated Micro Miner [Tier Six]"],
    ["tier one micro miner", "Steel Plated Micro Miner [Tier One]"],
    ["tungsten micro miner 3", "Tungsten Carbide Plated Micro Miner [Tier Three]"],
    // --- no-space queries ---
    ["microminer tier 1", "Steel Plated Micro Miner [Tier One]"],
    ["microminer 4", "Signalum Plated Micro Miner [Tier Four]"],
    ["microminer tier six", "Enderium Plated Micro Miner [Tier Six]"],
    ["steelplatedmicrominer tier 1", "Steel Plated Micro Miner [Tier One]"],
    // --- tier 7+ name bridge (not named "Micro Miner" in the game data) ---
    ["micro miner tier 7", "Draconium Plated Micro Dragon Hunter [Tier Seven]"],
    ["microminer 8", "Crystal Matrix Plated Micro Leviathan Slayer [Tier Eight]"],
    ["micro miner 9", "Eternium Plated Micro Sun Eater [Tier Nine]"],
    ["microminer tier ten", "Neutronium Plated Micro Universe Harvester [Tier Ten]"],
    ["micro miner tier nine", "Eternium Plated Micro Sun Eater [Tier Nine]"],
];
for (const [q, expect] of cases) {
    const r = await call(q);
    check(`"${q}" -> ${expect}`, r.body.item && r.body.item.name === expect,
        `got ${r.body.item ? r.body.item.name : JSON.stringify(r.body).slice(0, 120)}`);
}

// bare "microminer" must behave exactly like the spaced "micro miner"
{
    const a = await call("micro miner");
    const b = await call("microminer");
    check(`"microminer" == "micro miner" behavior`,
        a.body.item?.name === b.body.item?.name && /Micro Miner/.test(b.body.item?.name || ""),
        `spaced: ${a.body.item?.name} vs squashed: ${b.body.item?.name}`);
}

// expert-mode bridges: half tiers + stabilized
{
    const r = await call("micro miner 4.5", "expert");
    check(`expert "micro miner 4.5" -> Mob Slayer`,
        r.body.item?.name === "Lumium Plated Micro Mob Slayer [Tier Four and Half]",
        `got ${r.body.item?.name}`);
    const r2 = await call("stabilized micro miner 7", "expert");
    check(`expert "stabilized micro miner 7" -> Stabilized Dragon Hunter`,
        r2.body.item?.name === "Stabilized Draconium Plated Micro Dragon Hunter [Tier Seven]",
        `got ${r2.body.item?.name}`);
    const r3 = await call("micro miner 8.5", "expert");
    check(`expert "micro miner 8.5" -> Excavator`,
        r3.body.item?.name === "Trinium Plated Micro Excavator [Tier Eight and Half]",
        `got ${r3.body.item?.name}`);
}
// normal mode must NOT bridge to expert-only items
{
    const r = await call("micro miner 4.5", "normal");
    check(`normal "micro miner 4.5" doesn't become Mob Slayer`,
        r.body.item?.name !== "Lumium Plated Micro Mob Slayer [Tier Four and Half]",
        `got ${r.body.item?.name}`);
}

// "tier 10" must NOT match "[Tier One]" (whole-word digits)
{
    const r = await call("micro miner tier 10");
    const name = r.body.item ? r.body.item.name : "";
    check(`"micro miner tier 10" finds no [Tier One]`, !name.includes("Tier One]"), `got ${name}`);
}

// --- regressions ---
for (const q of ["steel ingot", "pbi", "iridium ore ebf", "fusion reactor", "high octane gasoline", "polyethylene"]) {
    const r = await call(q);
    check(`regression "${q}"`, !!r.body.item, JSON.stringify(r.body).slice(0, 100));
}
{
    const r = await call("polyethylene");
    check(`polyethylene -> plastic alias`, /plastic/i.test(r.body.item?.name || ""), `got ${r.body.item?.name}`);
    const r2 = await call("micro miner tier 1", "expert");
    check(`expert mode micro miner tier 1`, r2.body.item?.name?.includes("Tier One"), `got ${r2.body.item?.name}`);
}

// --- hidden types ---
{
    const r = await call("steel ingot");
    const types = (r.body.recipes || []).map(x => x.type);
    check(`steel ingot recipes hide all basic processing types`,
        types.every(t => !hidden.has(t.toLowerCase())), types.join(", "));
}
{
    // variant completeness: sodium bisulfate must carry ALL recipes incl.
    // the salt-variant LCR/CR lines the old data build deduplicated away
    const r = await call("sodium bisulfate");
    const ins = (r.body.recipes || []).map(x => x.ins);
    check(`sodium bisulfate keeps the Salt + HCl variants`,
        ins.filter(i => i.startsWith("Salt (2)")).length === 2, ins.join(" | ").slice(0, 150));
    check(`sodium bisulfate visible recipes = 6 (8 minus 2 packagers)`,
        (r.body.recipes || []).length === 6, `got ${(r.body.recipes || []).length}`);
}
{
    // an ore dust whose primary step IS the macerator — must still resolve,
    // just without the hidden types
    const r = await call("iron ore dust");
    const types = (r.body.recipes || []).map(x => x.type);
    check(`iron ore dust resolves`, !!r.body.item, JSON.stringify(r.body).slice(0, 100));
    check(`iron ore dust hides pulverization`, types.every(t => t.toLowerCase() !== "pulverization"), types.join(", "));
}
{
    const r = await call("steel ingot", "normal", true);
    const types = (r.body.uses || []).map(x => x.t);
    check(`steel ingot uses hide extractor/pulverization`,
        types.every(t => !hidden.has(String(t).toLowerCase())),
        [...new Set(types)].slice(0, 8).join(", "));
}
{
    // explicit machine requests still show the new hidden types
    const rA = await call("steel ingot arc");
    const tA = (rA.body.recipes || []).map(x => x.type);
    check(`arc filter returns arc furnace`,
        rA.body.machineFilter === "arc furnace" && tA.some(t => t.toLowerCase() === "arc furnace"),
        `filter=${rA.body.machineFilter} types=${tA.slice(0, 3).join(", ")}`);
    const rP = await call("melon packager");
    const tP = (rP.body.recipes || []).map(x => x.type);
    check(`packager filter returns packager`,
        rP.body.machineFilter === "packager" && tP.some(t => t.toLowerCase() === "packager"),
        `filter=${rP.body.machineFilter}`);
    const rC = await call("steel ingot compressor");
    const tC = (rC.body.recipes || []).map(x => x.type);
    check(`compressor filter returns compressor`,
        rC.body.machineFilter === "compressor" && tC.some(t => t.toLowerCase() === "compressor"),
        `filter=${rC.body.machineFilter}`);
}
{
    // explicit machine request still shows the hidden types
    const r = await call("iron ore dust macerator");
    const types = (r.body.recipes || []).map(x => x.type);
    check(`macerator filter returns pulverization`,
        r.body.machineFilter === "pulverization" && types.some(t => t.toLowerCase() === "pulverization"),
        `filter=${r.body.machineFilter} types=${types.join(", ")}`);
}
{
    const r = await call("rubber bars extractor");
    const types = (r.body.recipes || []).map(x => x.type);
    check(`extractor filter returns extractor`,
        r.body.machineFilter === "extractor" && types.some(t => t.toLowerCase() === "extractor"),
        `filter=${r.body.machineFilter} types=${types.join(", ")}`);
}

console.log(fails ? `\n${fails} FAILURES` : "\nall passed");
process.exit(fails ? 1 : 0);
