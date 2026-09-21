// NomiCodex search — Vercel edition. The whole index (items, recipes, uses)
// ships gzipped inside the function bundle: zero runtime fetches, so there is
// no upstream to stall. GET /api/search?q=<query>&mode=<normal|expert>&uses=1
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const MACHINE_ALIASES = {
    EBF: "blast furnace", LCR: "large chemical reactor", CR: "chemical reactor",
    DT: "distillation tower", ABS: "alloy blast smelting", VF: "vacuum freezer",
    PYRO: "pyrolyse oven", FUSION: "fusion reactor", ASM: "assembler",
    CIRCUIT: "circuit assembler", CIRCASS: "circuit assembler", CIRCUITASS: "circuit assembler",
    ASSLINE: "assembly line", ASLINE: "assembly line",
    PULV: "pulverization", MACERATOR: "pulverization",
    CHEM: "chemical reactor", ARC: "arc furnace", CRACKER: "oil cracking unit",
    DISTILLERY: "distillery", BENDER: "metal bender", PRESS: "forming press",
    LASER: "precision laser engraver", HAMMER: "forge hammer", SAW: "cutting saw",
    WIREMILL: "wiremill", FERM: "fermenter", BREW: "brewing machine",
    CENTRIFUGE: "centrifuge", ELEC: "electrolyzer", MIX: "mixer",
    WASH: "ore washer", SIFTER: "sifter", EXTRUDER: "extruder",
    IMPLO: "implosion compressor", COMPRESSOR: "compressor", LATHE: "lathe",
    AUTOCLAVE: "autoclave", SOLIDIFIER: "fluid solidifier", SCANNER: "scanner",
    ASSEMBLY: "assembly line", COKE: "coke oven", PBF: "primitive blast furnace",
    SAG: "sag mill", SAGMILL: "sag mill", ALLOY: "alloy smelter",
    SMELTER: "alloy smelter", SOUL: "soul binder", SLICE: "slice and splice",
    DRACONIC: "draconic fusion", DEFUSION: "draconic fusion", XU2: "resonator",
};

const KNOWN_TYPES = [
    "arc furnace", "assembler", "assembly line", "autoclave", "blast furnace",
    "brewing machine", "canning machine", "centrifuge", "chemical bath",
    "chemical reactor", "circuit assembler", "coke oven", "combustion fuels",
    "compressor", "crafting", "crystallization", "cutting saw",
    "distillation tower", "distillery", "electrolyzer", "extractor",
    "extruder", "fermenter", "fluid heater", "fluid solidifier", "forge hammer",
    "forming press", "furnace", "fusion reactor", "gas collector", "lathe",
    "metal bender", "mixer", "oil cracking unit", "ore washer", "packager",
    "precision laser engraver", "primitive blast furnace", "pulverization",
    "pyrolyse oven", "rock breaker", "scanner", "sifter", "thermal centrifuge",
    "vacuum freezer", "wiremill", "alloy smelter", "sag mill",
    "slice and splice", "soul binder", "vat", "draconic fusion", "resonator",
    "basic crafting", "advanced crafting", "elite crafting", "ultimate crafting",
    "ender crafting", "combination crafting", "compression crafting", "casting",
];

const _modes = {};

function getMode(mode) {
    if (!_modes[mode]) {
        const gz = fs.readFileSync(path.join(process.cwd(), "search-data", `${mode}.json.gz`));
        _modes[mode] = JSON.parse(zlib.gunzipSync(gz));
    }
    return _modes[mode];
}

function scoreItem(item, tokens, alias) {
    const nameLower = item[1].toLowerCase();
    let total = 0;
    for (const t of tokens) {
        const idx = nameLower.indexOf(t);
        if (idx === -1) {
            if (alias && item[1].toLowerCase().indexOf(alias) !== -1) continue;
            return null;
        }
        if (idx === 0) total += 0;
        else if (nameLower[idx - 1] === " ") total += 1;
        else total += 2;
    }
    total += item[1].length / 100;
    if (item[3] === "gregtech") total -= 0.5;
    total -= Math.min(item[4], 20) / 100;
    return total;
}

function detectMachine(words) {
    for (let n = Math.min(3, words.length - 1); n >= 1; n--) {
        const suffix = words.slice(-n).join(" ").toUpperCase();
        const expansion = MACHINE_ALIASES[suffix];
        if (expansion) return { filter: expansion, remaining: words.slice(0, -n).join(" ") };
        const lower = suffix.toLowerCase();
        if (lower.length >= 4 && KNOWN_TYPES.includes(lower)) {
            return { filter: lower, remaining: words.slice(0, -n).join(" ") };
        }
    }
    return null;
}

function hasMachineType(item, filter) {
    const types = item[6];
    if (!types || types.length === 0) return false;
    const fUpper = filter.toUpperCase();
    return types.some(t => t.toUpperCase() === fUpper);
}

function levenshtein(a, b) {
    if (a === b) return 0;
    if (a.length > b.length) [a, b] = [b, a];
    const la = a.length, lb = b.length;
    const prev = new Array(la + 1);
    for (let i = 0; i <= la; i++) prev[i] = i;
    for (let j = 1; j <= lb; j++) {
        let last = prev[0];
        prev[0] = j;
        for (let i = 1; i <= la; i++) {
            const temp = prev[i];
            prev[i] = Math.min(prev[i] + 1, prev[i - 1] + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1));
            last = temp;
        }
    }
    return prev[la];
}

export default async function handler(req, res) {
    const url = new URL(req.url, "https://x");
    const q = url.searchParams.get("q") || "";
    const mode = url.searchParams.get("mode") === "expert" ? "expert" : "normal";
    const wantsUses = url.searchParams.get("uses") === "1";

    const send = (data, status = 200) => {
        res.statusCode = status;
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.end(JSON.stringify(data));
    };

    if (!q.trim()) return send({ error: "no query" }, 400);

    let index;
    try {
        index = getMode(mode);
    } catch (e) {
        return send({ error: "data unavailable", detail: String(e.message || e) }, 500);
    }
    const items = index.i;
    const aliases = index.a;

    const words = q.trim().split(/\s+/);
    const machineInfo = detectMachine(words);
    const query = machineInfo ? machineInfo.remaining : q.trim();
    const machineFilter = machineInfo ? machineInfo.filter : null;

    if (!query.trim()) return send({ error: "no item query", machine: machineFilter }, 400);

    const queryLower = query.toLowerCase();
    let alias = aliases[queryLower] || aliases[queryLower.split(" ")[0]] || null;

    if (!alias && /^[a-z]{2,5}$/.test(queryLower)) {
        const expansions = new Set();
        for (const item of items) {
            const nameLower = item[1].toLowerCase();
            const tag = " (" + queryLower + ")";
            const at = nameLower.indexOf(tag);
            if (at > 0) {
                const before = nameLower.slice(0, at).trim();
                const lastWord = before.split(" ").pop();
                if (lastWord) expansions.add(lastWord);
            }
        }
        if (expansions.size > 0) alias = [...expansions].sort((a, b) => a.length - b.length)[0];
    }

    const tokens = queryLower.split(/\s+/).filter(Boolean);
    let candidates = [];
    for (const item of items) {
        const s = scoreItem(item, tokens, alias);
        if (s !== null)
            candidates.push({ item, score: s, hasMachine: machineFilter ? hasMachineType(item, machineFilter) : null });
    }
    if (alias) {
        const aliasTokens = alias.split(/\s+/);
        const seen = new Set(candidates.map(c => c.item[0]));
        for (const item of items) {
            if (seen.has(item[0])) continue;
            const s = scoreItem(item, aliasTokens, null);
            if (s !== null)
                candidates.push({ item, score: s + 5, hasMachine: machineFilter ? hasMachineType(item, machineFilter) : null });
        }
    }

    if (candidates.length === 0) {
        const threshold = Math.max(1, Math.floor(queryLower.length / 3));
        for (const item of items) {
            const nameLower = item[1].toLowerCase();
            let best = levenshtein(queryLower, nameLower);
            if (best > threshold) {
                for (const word of nameLower.split(" ")) {
                    if (Math.abs(word.length - queryLower.length) > threshold) continue;
                    const d = levenshtein(queryLower, word);
                    if (d < best) best = d;
                }
            }
            if (best <= threshold) {
                const ingotBonus = item[1].toLowerCase().includes("ingot") ? 0 : 1;
                candidates.push({ item, score: 10 + best + ingotBonus, hasMachine: machineFilter ? hasMachineType(item, machineFilter) : null });
            }
        }
    }

    if (candidates.length === 0)
        return send({ error: "not found", query, alternatives: [] });

    candidates.sort((a, b) => {
        const aExact = a.item[1].toLowerCase() === queryLower;
        const bExact = b.item[1].toLowerCase() === queryLower;
        if (aExact !== bExact) return aExact ? -1 : 1;
        if (machineFilter && a.hasMachine !== b.hasMachine) return a.hasMachine ? -1 : 1;
        const aIngot = a.item[1].toLowerCase().includes("ingot") ? 0 : 1;
        const bIngot = b.item[1].toLowerCase().includes("ingot") ? 0 : 1;
        return a.score - b.score || aIngot - bIngot || a.item[1].length - b.item[1].length;
    });

    let hotChain = false;
    if (machineFilter && !candidates[0].hasMachine) {
        const hotName = "Hot " + candidates[0].item[1];
        const hot = items.find(i => i[1] === hotName && i[4] > 0 && hasMachineType(i, machineFilter));
        if (hot) {
            candidates.unshift({ item: hot, score: -1, hasMachine: true });
            hotChain = true;
        }
    }

    const best = candidates[0].item;
    const alternatives = candidates.slice(1, 6).map(c => ({
        id: c.item[0], name: c.item[1], mod: c.item[3], recipes: c.item[4],
        hasMachine: c.hasMachine,
    }));

    let circMode = /circuit|workstation|mainframe|computer|processor|cpu/i.test(String(best[1] || ""));
    const typePri = (t) => {
        const s2 = (t || "").toLowerCase();
        if (circMode) {
            if (s2 === "circuit assembler") return 0;
            if (s2 === "assembly line") return 1;
            if (s2 === "blast furnace" || s2 === "electric blast furnace") return 2;
            if (s2 === "large chemical reactor") return 3;
            if (s2 === "mixer") return 4;
            if (s2.includes("craft")) return 5;
            return 6;
        }
        if (s2 === "blast furnace" || s2 === "electric blast furnace") return 0;
        if (s2 === "large chemical reactor") return 1;
        if (s2 === "mixer") return 2;
        if (s2.includes("craft")) return 3;
        return 4;
    };

    let recipes = index.recipes[best[0]] || [];
    if (machineFilter && recipes.length) {
        const fUpper = machineFilter.toUpperCase();
        recipes = recipes.filter(r => r.type.toUpperCase().includes(fUpper));
    }
    if (recipes.length > 1)
        recipes = [...recipes].sort((a, b) => typePri(a.type) - typePri(b.type));

    const uses = wantsUses ? (index.uses[best[0]] || []) : [];

    return send({
        item: {
            id: best[0],
            name: best[1],
            displayName: best[2],
            mod: best[3],
            recipes: best[4],
            uses: best[5],
            types: best[6],
        },
        machineFilter,
        hotChain,
        recipes,
        uses,
        alternatives,
        mode,
    });
}
