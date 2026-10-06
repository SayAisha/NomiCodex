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
    "arc furnace", "alloy blast smelting", "assembler", "assembly line", "autoclave", "blast furnace",
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

// recipe types hidden from tag results by default — macerator ore-doubling
// and extractor steps bury the interesting recipes. Explicitly naming the
// machine ("rp ore dust macerator") still shows them.
const HIDDEN_TYPES = new Set(["pulverization", "extractor"]);

// "tier one" ↔ "tier 1": number words canonicalize to digits on both the
// query and the item-name side, so "Steel Plated Micro Miner [Tier One]"
// is findable as "micro miner tier 1"
const NUM_WORDS = {
    zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6",
    seven: "7", eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12",
    thirteen: "13", fourteen: "14", fifteen: "15", sixteen: "16",
    seventeen: "17", eighteen: "18", nineteen: "19", twenty: "20",
    thirty: "30", forty: "40", fifty: "50", sixty: "60", seventy: "70",
    eighty: "80", ninety: "90"
};
const NUM_RE = new RegExp("\\b(" + Object.keys(NUM_WORDS).join("|") + ")\\b", "g");
const canon = s => String(s).toLowerCase().replace(NUM_RE, w => NUM_WORDS[w]);
const isAlnumChar = c => (c >= "a" && c <= "z") || (c >= "0" && c <= "9");
// whole-word find: a boundary is any non-alphanumeric, so "1" matches in
// "[tier 1]" but must not match inside "tier 10"
function hasWord(hay, needle) {
    let idx = hay.indexOf(needle);
    while (idx !== -1) {
        const b = idx === 0 || !isAlnumChar(hay[idx - 1]);
        const a = idx + needle.length === hay.length || !isAlnumChar(hay[idx + needle.length]);
        if (b && a) return true;
        idx = hay.indexOf(needle, idx + 1);
    }
    return false;
}

const _modes = {};

function getMode(mode) {
    if (!_modes[mode]) {
        const gz = fs.readFileSync(path.join(process.cwd(), "search-data", `${mode}.json.gz`));
        _modes[mode] = JSON.parse(zlib.gunzipSync(gz));
    }
    return _modes[mode];
}

function scoreItem(item, tokens, alias) {
    const cname = canon(item[1]);
    const aliasCanon = alias ? canon(alias) : null;
    let total = 0;
    let sq = null; // lazy: name with all non-alphanumerics stripped, for
    // "microminer"-style queries typed without the space
    for (const t of tokens) {
        const ct = canon(t);
        if (/^\d+$/.test(ct)) {
            // digit tokens match whole words only — "1" must not hit "10"
            if (hasWord(cname, ct)) { total += 1; continue; }
            if (aliasCanon && cname.indexOf(aliasCanon) !== -1) continue;
            return null;
        }
        const idx = cname.indexOf(ct);
        if (idx === -1) {
            if (sq === null) sq = cname.replace(/[^a-z0-9]/g, "");
            if (ct.length >= 3 && sq.indexOf(ct.replace(/[^a-z0-9]/g, "")) !== -1) { total += 1; continue; }
            if (aliasCanon && cname.indexOf(aliasCanon) !== -1) continue;
            return null;
        }
        if (idx === 0) total += 0;
        else if (cname[idx - 1] === " ") total += 1;
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
        const qCanon = canon(queryLower);
        const qSq = qCanon.replace(/[^a-z0-9]/g, "");
        for (const item of items) {
            const nameCanon = canon(item[1]);
            let best = levenshtein(qCanon, nameCanon);
            const dSq = levenshtein(qSq, nameCanon.replace(/[^a-z0-9]/g, ""));
            if (dSq < best) best = dSq;
            if (best > threshold) {
                for (const word of nameCanon.split(" ")) {
                    if (Math.abs(word.length - qCanon.length) > threshold) continue;
                    const d = levenshtein(qCanon, word);
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

    const queryCanon = canon(queryLower);
    candidates.sort((a, b) => {
        const aExact = a.item[1].toLowerCase() === queryLower || canon(a.item[1]) === queryCanon;
        const bExact = b.item[1].toLowerCase() === queryLower || canon(b.item[1]) === queryCanon;
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
            if (s2 === "alloy blast smelting") return 5;
            if (s2.includes("craft")) return 6;
            return 7;
        }
        if (s2 === "blast furnace" || s2 === "electric blast furnace") return 0;
        if (s2 === "large chemical reactor") return 1;
        if (s2 === "mixer") return 2;
        if (s2 === "alloy blast smelting") return 3;
        if (s2.includes("craft")) return 4;
        return 5;
    };

    let recipes = index.recipes[best[0]] || [];
    if (machineFilter && recipes.length) {
        const fUpper = machineFilter.toUpperCase();
        recipes = recipes.filter(r => r.type.toUpperCase().includes(fUpper));
    }
    const wantsHidden = machineFilter && HIDDEN_TYPES.has(machineFilter);
    if (!wantsHidden && recipes.length)
        recipes = recipes.filter(r => !HIDDEN_TYPES.has(r.type.toLowerCase()));
    if (recipes.length > 1)
        recipes = [...recipes].sort((a, b) => typePri(a.type) - typePri(b.type));

    let uses = wantsUses ? (index.uses[best[0]] || []) : [];
    if (!wantsHidden && uses.length)
        uses = uses.filter(e => !HIDDEN_TYPES.has(String(e.t || "").toLowerCase()));

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
