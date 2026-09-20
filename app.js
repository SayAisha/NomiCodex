// NomiCodex — from-scratch frontend (2026). Built directly on the binary
// repository (repository.js) and the atlas; no classic-UI code involved.
import { Repository, Item, Fluid, OreDict, Recipe } from "./repository.js?v=21";
import { OpenOceu } from "./oceu.js?v=21";

const TIERS = ["ULV", "LV", "MV", "HV", "EV", "IV", "LuV", "ZPM", "UV", "UHV",
    "UEV", "UIV", "UXV", "OpV", "MAX"];
// @2x atlas (64px cells, 128 cols) so retina screens sample 1:1 — no
// engine-side smoothing, crisp pixels even without image-rendering support
let ATLAS_COLS = 128;
let ATLAS_UNIT = 64;
const SHOT = new URLSearchParams(location.hash.split("?")[1] ?? "").get("shot") === "1";
const DATA_V = 15, ATLAS_V = 6;

const $ = (s, r = document) => r.querySelector(s);
const el = (html) => {
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
};
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (n) => {
    if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
    if (n >= 1e4) return (n / 1e3).toFixed(1) + "K";
    return String(n);
};

let repo = null;
let INDEX = [];            // {ptr, id, plain, nameHtml, mod, iconId, isFluid}
let state = { filter: null, view: "recipes", showAll: false };

/* ---------------- icons ---------------- */

function iconStyle(iconId, size = SHOT ? 32 : 36) {
    if (iconId == null || iconId < 0)
        return "background:linear-gradient(45deg,#22262e 25%,#191c22 25% 50%,#22262e 50% 75%,#191c22 75%)";
    const s = size / ATLAS_UNIT;
    const x = (iconId % ATLAS_COLS) * ATLAS_UNIT * s;
    const y = Math.floor(iconId / ATLAS_COLS) * ATLAS_UNIT * s;
    const w = ATLAS_COLS * ATLAS_UNIT * s;
    return `background-position:-${x}px -${y}px;background-size:${w}px auto`;
}

function icon(iconId, size, attrs = "") {
    return `<span class="sicon" style="${iconStyle(iconId, size)};width:${size}px;height:${size}px;margin:0" ${attrs}></span>`;
}

/* ---------------- tooltip ---------------- */

const tt = (() => {
    let box = null;
    const ensure = () => box ?? (box = (() => {
        const b = el(`<div id="tt"></div>`);
        document.body.appendChild(b);
        return b;
    })());
    const show = (target, goods) => {
        const b = ensure();
        const isOre = goods instanceof OreDict;
        let title = isOre ? String(goods.id).replace(/^o:/, "") : (goods.name ?? goods.id);
        let variants = "";
        if (isOre) {
            variants = goods.items.slice(0, 8).map(v =>
                `<div class="tt-title">${icon(v.iconId, 24)}<span class="t">${v.name ?? ""}</span></div>`).join("");
        }
        const lines = (!isOre && goods.tooltip)
            ? `<div class="tt-lines">${goods.tooltip.split("\n").map(l => `<p>${l}</p>`).join("")}</div>` : "";
        b.innerHTML = `<div class="tt-title">${isOre ? "" : `${icon(goods.iconId, 24)}`}<span class="t">${title}</span></div>
            ${isOre ? `<div class="tt-mod">ore dictionary — any of ${goods.items.length}:</div>` : `<div class="tt-mod">${esc(goods.mod ?? "")}</div>`}${variants}${lines}
            <div class="tt-hint"><b>LMB</b> recipes · <b>RMB</b> uses</div>`;
        b.style.display = "block";
        const r = target.getBoundingClientRect();
        const bw = Math.min(320, b.offsetWidth), bh = b.offsetHeight;
        let x = r.left + r.width / 2 - bw / 2;
        let y = r.bottom + 8;
        if (y + bh > innerHeight - 8) y = Math.max(8, r.top - bh - 8);
        x = Math.max(8, Math.min(x, innerWidth - bw - 8));
        b.style.left = x + "px";
        b.style.top = y + "px";
    };
    const hide = () => box && (box.style.display = "none");
    return { show, hide };
})();

document.addEventListener("mouseover", (e) => {
    const t = e.target instanceof Element ? e.target.closest("[data-gptr]") : null;
    if (!t) return;
    try {
        const goods = repo.GetObject(parseInt(t.dataset.gptr, 10),
            t.dataset.ore === "1" ? OreDict : (t.dataset.fluid === "1" ? Fluid : Item));
        if (goods) tt.show(t, goods);
    } catch (err) { /* lazy parse issue — ignore */ }
});
document.addEventListener("mouseout", (e) => {
    if (e.target instanceof Element && e.target.closest("[data-gptr]")) tt.hide();
});

/* ---------------- click-to-navigate (LMB recipes / RMB uses) ---------------- */

function goodsIdFromNode(node) {
    const ptrNode = node.closest("[data-gptr]");
    if (ptrNode) {
        try {
            const goods = repo.GetObject(parseInt(ptrNode.dataset.gptr, 10),
                ptrNode.dataset.ore === "1" ? OreDict : (ptrNode.dataset.fluid === "1" ? Fluid : Item));
            if (!goods) return null;
            if (goods instanceof OreDict) return goods.items[0]?.id ?? null;
            return goods.id;
        } catch (err) { return null; }
    }
    const goNode = node.closest("[data-go]");
    if (goNode && !goNode.dataset.go.startsWith("#/"))
        return goNode.dataset.go;
    return null;
}

document.addEventListener("click", (e) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const t = e.target instanceof Element ? e.target.closest(".sicon[data-gptr], .tile[data-go]") : null;
    if (!t) return;
    const id = goodsIdFromNode(t);
    if (id) {
        e.preventDefault();
        e.stopPropagation();
        location.hash = "#/item/" + encodeURIComponent(id);
    }
});

document.addEventListener("contextmenu", (e) => {
    const t = e.target instanceof Element ? e.target.closest(".sicon[data-gptr], .tile[data-go], .chip[data-go]") : null;
    if (!t) return;
    const id = goodsIdFromNode(t);
    if (id) {
        e.preventDefault();
        e.stopPropagation();
        location.hash = "#/item/" + encodeURIComponent(id) + "?view=uses";
    }
});

/* ---------------- search ---------------- */

function tokensOf(q) {
    return q.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

// every token must appear somewhere in the name; rank rewards prefix hits,
// word-start hits, and tight grouping of the matched words
function matchesTokens(plain, tokens) {
    let score = 0, first = -1, last = -1;
    for (const t of tokens) {
        const idx = plain.indexOf(t);
        if (idx === -1) return null;
        score += idx === 0 ? 0 : plain[idx - 1] === " " ? 1 : 2;
        if (first === -1 || idx < first) first = idx;
        if (idx + t.length > last) last = idx + t.length;
    }
    score += (last - first) / 100;       // matched words close together rank better
    score += plain.length / 1000;
    return score;
}

function searchAll(q, limit = 8) {
    const tokens = tokensOf(q);
    if (!tokens.length) return [];
    if (tokens.length === 1) {
        const t = tokens[0];
        const scored = [];
        for (const e of INDEX) {
            const n = e.plain;
            let rank;
            if (n === t) rank = 0;
            else if (n.startsWith(t)) rank = 1;
            else if (n.includes(" " + t)) rank = 2;
            else if (n.includes(t)) rank = 3;
            else continue;
            scored.push({ e, rank });
        }
        scored.sort((a, b) => a.rank - b.rank || (b.e.mod === "gregtech" ? 1 : 0) - (a.e.mod === "gregtech" ? 1 : 0) || a.e.plain.length - b.e.plain.length || a.e.plain.localeCompare(b.e.plain));
        return scored.slice(0, limit).map(s => s.e);
    }
    const scored = [];
    for (const e of INDEX) {
        const score = matchesTokens(e.plain, tokens);
        if (score !== null)
            scored.push({ e, score });
    }
    scored.sort((a, b) => a.score - b.score || (b.e.mod === "gregtech" ? 1 : 0) - (a.e.mod === "gregtech" ? 1 : 0) || a.e.plain.localeCompare(b.e.plain));
    return scored.slice(0, limit).map(s => s.e);
}

function attachPalette(input, go) {
    let pop = null, sel = 0, results = [];
    const close = () => { pop?.remove(); pop = null; };
    const open = () => {
        if (!pop) {
            pop = el(`<div class="cmdbar-pop"></div>`);
            input.parentElement.appendChild(pop);
        }
        results = searchAll(input.value, 8);
        sel = 0;
        pop.innerHTML = results.length
            ? results.map((r, i) => `<div class="cmdbar-row${i === 0 ? " sel" : ""}" data-i="${i}">
                ${icon(r.iconId, 26)}
                <span class="row-name">${r.nameHtml}</span><span class="row-mod">${esc(r.mod)}</span></div>`).join("")
            : `<div class="cmdbar-empty">No items match “${esc(input.value)}”</div>`;
        pop.querySelectorAll(".cmdbar-row").forEach(row => {
            row.addEventListener("mousedown", (ev) => { ev.preventDefault(); go(results[+row.dataset.i]); close(); });
        });
    };
    const move = (d) => {
        if (!pop || !results.length) return;
        sel = (sel + d + results.length) % results.length;
        pop.querySelectorAll(".cmdbar-row").forEach((r, i) => r.classList.toggle("sel", i === sel));
    };
    input.addEventListener("input", open);
    input.addEventListener("focus", open);
    input.addEventListener("blur", () => setTimeout(close, 120));
    input.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
        else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
        else if (e.key === "Enter") {
            if (results.length) { go(results[Math.min(sel, results.length - 1)]); close(); input.blur(); }
        } else if (e.key === "Escape") { close(); input.blur(); }
    });
}

/* ---------------- recipe cards ---------------- */

function slotHtml(g, { ore = false, fluid = false, amount = 1, prob = 1 } = {}) {
    const iconId = ore ? (g.items?.[0]?.iconId ?? -1) : g.iconId;
    // non-consumable inputs carry no amount badge — programmed circuits
    // show their configuration on the texture itself
    let amt = amount != null && amount !== 0 && amount !== 1
        ? `<span class="amt">${fmt(amount)}</span>` : "";
    const p = prob < 1 ? `<span class="prob">${Math.round(prob * 100)}%</span>` : "";
    return `<span class="sicon${ore ? " ore" : ""}" style="${iconStyle(iconId)}"
        data-gptr="${g.objectOffset}" ${ore ? 'data-ore="1"' : ""} ${fluid ? 'data-fluid="1"' : ""}>${amt}${p}</span>`;
}

function gridHtml(entries, dimX, dimY, { compact = false, outputs = false } = {}) {
    if (!dimX || !dimY || !entries.length) return "";
    let useX = dimX, useY = dimY;
    if (compact) {
        useX = 0; useY = 0;
        for (const e of entries) {
            useX = Math.max(useX, (e.slot % dimX) + 1);
            useY = Math.max(useY, Math.floor(e.slot / dimX) + 1);
        }
    }
    const cells = entries.map(e => {
        return `<div class="slot" style="left:${(e.slot % dimX) * 44 + 4}px;top:${Math.floor(e.slot / dimX) * 44 + 4}px">
            ${slotHtml(e.goods, { ore: e.type === 1, fluid: e.type === 2 || e.type === 4, amount: e.amount, prob: outputs ? e.probability : 1 })}</div>`;
    }).join("");
    return `<div class="sgrid" style="width:${useX * 44 + 8}px;height:${useY * 44 + 8}px">${cells}</div>`;
}

function metaChips(r) {
    const gt = r.gtRecipe;
    if (!gt) return "";
    const chips = [];
    if (gt.voltage > 0) {
        chips.push(`<span class="mchip tier"><b>${TIERS[gt.voltageTier] ?? "?"}</b></span>`);
        chips.push(`<span class="mchip"><b>${fmt(gt.voltage)}</b> EU/t</span>`);
        chips.push(`<span class="mchip time"><b>${gt.durationSeconds % 1 ? gt.durationSeconds.toFixed(1) : gt.durationSeconds}</b>s</span>`);
        chips.push(`<span class="mchip">${fmt(gt.voltage * gt.amperage * gt.durationTicks)} EU</span>`);
        if (gt.amperage !== 1) chips.push(`<span class="mchip"><b>${gt.amperage}</b>A</span>`);
    } else if (gt.durationSeconds > 0) {
        chips.push(`<span class="mchip time"><b>${gt.durationSeconds % 1 ? gt.durationSeconds.toFixed(1) : gt.durationSeconds}</b>s</span>`);
    }
    for (const m of gt.metadata) {
        const v = m.value;
        switch (m.key) {
            case "coil_heat": chips.push(`<span class="mchip hot"><b>${Math.round(v)}</b>K heat</span>`); break;
            case "ender_time": chips.push(`<span class="mchip time"><b>${Math.round(v)}</b>s ender</span>`); break;
            case "combination_cost": case "power_cost": chips.push(`<span class="mchip"><b>${fmt(v)}</b> FE</span>`); break;
            case "eio_energy": chips.push(`<span class="mchip"><b>${fmt(v)}</b> µI</span>`); break;
            case "de_energy": case "xu2_energy": chips.push(`<span class="mchip"><b>${fmt(v)}</b> RF</span>`); break;
            case "de_tier": chips.push(`<span class="mchip tier">tier <b>${Math.round(v)}</b></span>`); break;
            case "cleanroom": if (v === 1) chips.push(`<span class="mchip">cleanroom</span>`); break;
            case "low_gravity": if (v === 1) chips.push(`<span class="mchip">low gravity</span>`); break;
            default: break;
        }
    }
    if (gt.circuitConflicts !== 0)
        chips.push(`<span class="mchip hot">circuit conflicts</span>`);
    return chips.join("");
}

function recipeCard(r) {
    const t = r.recipeType;
    const d = t.dimensions;
    const io = r.items;
    const insItems = io.filter(e => e.type === 0 || e.type === 1);
    const insFluids = io.filter(e => e.type === 2);
    const outItems = io.filter(e => e.type === 3);
    const outFluids = io.filter(e => e.type === 4);

    const left = gridHtml(insItems, d[0], d[1]) + gridHtml(insFluids, d[2], d[3]);
    const right = gridHtml(outItems, d[4], d[5], { compact: true, outputs: true })
        + gridHtml(outFluids, d[6], d[7], { compact: true, outputs: true });

    const crafter = t.defaultCrafter;
    const machineIcon = crafter ? `<span class="sicon" data-gptr="${crafter.objectOffset}" style="${iconStyle(crafter.iconId, 22)};width:22px;height:22px;margin:0"></span>` : "";

    const gt = r.gtRecipe;
    const ocAttrs = gt ? `data-eu="${gt.voltage}" data-dur="${gt.durationTicks}" data-amp="${gt.amperage}"`
        + (gt.MetadataByKey("coil_heat") ? ` data-heat="${gt.MetadataByKey("coil_heat")}"` : "") : "";

    return `<div class="rcard">
        <div class="rcard-head">${machineIcon}<span class="machine-name">${esc(t.name)}</span>
            ${gt ? `<button class="oc-btn" title="Overclock this recipe" ${ocAttrs}>⚡</button>` : ""}</div>
        <div class="rcard-body">
            <div class="rcard-side">${left || ""}</div>
            <div class="rcard-arrow"></div>
            <div class="rcard-side">${right || ""}</div>
        </div>
        <div class="rcard-foot">${metaChips(r)}</div>
    </div>`;
}

/* ---------------- views ---------------- */

const view = () => $("#view");
const recent = {
    load: () => { try { return JSON.parse(localStorage.getItem("nomi-recent") ?? "[]"); } catch { return []; } },
    push: (e) => {
        const list = recent.load().filter(x => x.id !== e.id);
        list.unshift({ id: e.id, plain: e.plain, nameHtml: e.nameHtml, iconId: e.iconId });
        localStorage.setItem("nomi-recent", JSON.stringify(list.slice(0, 10)));
    },
};

function renderHome() {
    const recents = recent.load().filter(r => repo.GetById(r.id));
    const quickNames = ["Steel Ingot", "Signalum Ingot", "Kanthal Ingot", "Ender Pearl", "Redstone",
        "Coal Singularity", "Crystaltine Ingot", "Ultimate Gem", "Ender Star", "Rose Gold Ingot"];
    const quicks = quickNames.map(n => searchAll(n, 1)[0]).filter(Boolean);
    view().innerHTML = `
    <div class="wrap">
        <div class="hero">
            <h1>Nomi<em>Codex</em></h1>
            <p>Every recipe in NomiFactory CEu 1.7.7 — normal &amp; expert</p>
            <div class="hero-search">
                <span class="search-ico">⌕</span>
                <input id="hero-q" placeholder="Search ${INDEX.length.toLocaleString()} items and fluids…" autocomplete="off" spellcheck="false">
            </div>
            <div class="hero-hint">press <kbd>/</kbd> anywhere to search</div>
        </div>
        ${recents.length ? `<div class="home-section"><h2>Recently viewed</h2><div class="chip-row">
            ${recents.map(r => `<span class="chip" data-go="${esc(r.id)}"><span class="mini-icon">${icon(r.iconId, 24)}</span>${r.nameHtml}</span>`).join("")}
        </div></div>` : ""}
        <div class="home-section"><h2>Popular</h2><div class="chip-row">
            ${quicks.map(q => `<span class="chip" data-go="${esc(q.id)}"><span class="mini-icon">${icon(q.iconId, 24)}</span>${q.nameHtml}</span>`).join("")}
        </div></div>
        <div class="home-section"><h2>Explore</h2>
            <span class="chip" data-go="#/browse">▦ &nbsp;Browse all ${INDEX.length.toLocaleString()} entries</span>
        </div>
        <div style="height:30px"></div>
    </div>`;
    const input = $("#hero-q");
    attachPalette(input, (e) => { location.hash = "#/item/" + encodeURIComponent(e.id); });
    setTimeout(() => input.focus(), 30);
    bindGo(view());
}

function renderBrowse(params) {
    const q = params.get("q") ?? "";
    const mod = params.get("mod") ?? "";
    const mods = [...new Set(INDEX.map(e => e.mod))].sort();
    const tokens = tokensOf(q);
    const filtered = INDEX.filter(e =>
        (!tokens.length || matchesTokens(e.plain, tokens) !== null) && (!mod || e.mod === mod));
    view().innerHTML = `
    <div class="wrap">
        <div class="browse-head">
            <h1>Browse</h1><span class="count">${filtered.length.toLocaleString()} of ${INDEX.length.toLocaleString()} entries${q ? ` for “${esc(q)}”` : ""}</span>
            <div class="browse-tools">
                <select id="mod-sel"><option value="">All mods</option>
                    ${mods.map(m => `<option value="${esc(m)}"${m === mod ? " selected" : ""}>${esc(m)}</option>`).join("")}
                </select>
            </div>
        </div>
        <div class="grid-tiles" id="tiles"></div>
        <div id="sentinel" style="height:1px"></div>
    </div>`;
    const tiles = $("#tiles");
    const CHUNK = 240;
    const CAP = 1500;   // keeps phone memory sane; search narrows anyway
    let idx = 0;
    const addChunk = () => {
        const frag = document.createDocumentFragment();
        const end = Math.min(idx + CHUNK, filtered.length);
        for (; idx < end; idx++) {
            const e = filtered[idx];
            frag.appendChild(el(`<div class="tile" data-go="${esc(e.id)}">
                <span class="sicon" data-gptr="${e.ptr}" style="${iconStyle(e.iconId, 36)};width:36px;height:36px;margin:0"></span>
                <span class="t-name">${e.nameHtml}</span><span class="t-mod">${esc(e.mod)}</span></div>`));
        }
        tiles.appendChild(frag);
    };
    addChunk();
    new IntersectionObserver((ents) => {
        if (ents[0].isIntersecting && idx < Math.min(filtered.length, CAP)) addChunk();
    }).observe($("#sentinel"));
    if (filtered.length > CAP) {
        const note = el(`<div class="empty" style="padding:16px">Showing the first ${CAP.toLocaleString()} of ${filtered.length.toLocaleString()} — type more of the name to narrow it down.</div>`);
        $("#sentinel").before(note);
    }
    $("#mod-sel").addEventListener("change", (e) => {
        const p = new URLSearchParams(location.hash.split("?")[1] ?? "");
        e.target.value ? p.set("mod", e.target.value) : p.delete("mod");
        location.hash = "#/browse" + (p.toString() ? "?" + p : "");
    });
    bindGo(view());
}

function renderItem(id) {
    const goods = repo.GetById(id);
    if (!goods) {
        view().innerHTML = `<div class="empty"><div class="big">🧭</div>Unknown item — it may not exist in this pack mode.</div>`;
        return;
    }
    const idxEntry = INDEX.find(e => e.id === goods.id);
    if (idxEntry) recent.push(idxEntry);

    const recipes = [...goods.production].map(p => repo.GetObject(p, Recipe));
    const uses = [...goods.consumption].map(p => repo.GetObject(p, Recipe));

    const isFluid = goods instanceof Fluid;
    // ingredients that are never crafted still have uses - open straight there
    if (state.view === null)
        state.view = recipes.length === 0 && uses.length > 0 ? "uses" : "recipes";
    const usesView = state.view === "uses";
    const list = usesView ? uses : recipes;

    // screenshot mode: bare single card for the shot service
    if (state.shot) {
        const fltName = state.filter ? state.filter.toLowerCase() : null;
        const flt = fltName && list.some(r => r.recipeType.name.toLowerCase() === fltName) ? fltName : null;
        const lst = flt ? list.filter(r => r.recipeType.name.toLowerCase() === flt) : list;
        const r = lst[(state.r ?? 1) - 1];
        view().innerHTML = `<div class="wrap"><div class="cards single">${r ? recipeCard(r) : ""}</div></div>`;
        document.title = (goods.name ?? goods.id) + " — NomiCodex";
        bindGo(view());
        requestAnimationFrame(() => { document.body.dataset.ready = "1"; });
        return;
    }

    // machine filter chips for the active view
    const byType = new Map();
    for (const r of list)
        byType.set(r.recipeType.name, (byType.get(r.recipeType.name) ?? 0) + 1);
    const types = [...byType.entries()].sort((a, b) => b[1] - a[1]);
    const filter = state.filter && byType.has(state.filter) ? state.filter : null;
    const shown = filter ? list.filter(r => r.recipeType.name === filter) : list;
    const shownCards = state.showAll ? shown : shown.slice(0, 24);

    view().innerHTML = `
    <div class="wrap">
        <div class="item-head">
            <div class="big-icon"><span class="sicon" style="${iconStyle(goods.iconId, 48)};width:48px;height:48px;margin:0"></span></div>
            <div class="item-id">
                <h1>${goods.name ?? esc(goods.id)}</h1>
                <div class="meta-line">
                    <span>${esc(goods.mod)}</span>
                    <span class="id-mono">${esc(goods.id)}</span>
                    <a class="id-mono" href="#/item/${encodeURIComponent(goods.id)}" title="Copy link" data-copy>⧉ link</a>
                </div>
            </div>
            <div class="spacer"></div>
            <div class="viewseg">
                <button class="${usesView ? "" : "on"}" data-view="recipes">Recipes <span class="vc">${recipes.length}</span></button>
                <button class="${usesView ? "on" : ""}" data-view="uses" ${uses.length ? "" : "disabled"}>Used in <span class="vc">${uses.length}</span></button>
            </div>
        </div>
        ${types.length > 1 ? `<div class="filter-row">
            <span class="fchip${filter ? "" : " on"}" data-f="">All <span class="n">${list.length}</span></span>
            ${types.slice(0, 14).map(([t, n]) => `<span class="fchip${filter === t ? " on" : ""}" data-f="${esc(t)}">${esc(t)} <span class="n">${n}</span></span>`).join("")}
        </div>` : "<div style='height:14px'></div>"}
        ${shownCards.length ? `<div class="cards${shownCards.length === 1 ? " single" : ""}${shownCards.length === 2 ? " pair" : ""}">${shownCards.map(recipeCard).join("")}</div>
            ${shown.length > shownCards.length ? `<div style="text-align:center;padding-bottom:30px"><button class="chip" id="more">Show all ${shown.length}</button></div>` : ""}`
        : `<div class="empty"><div class="big">${usesView ? "🔌" : "⚗️"}</div>${usesView
            ? (uses.length ? "No recipes match this filter." : "Not used as an input in any indexed recipe.")
            : (uses.length ? "This entry is not crafted - check Used in." : "No crafting recipes indexed for this entry.")}</div>`}
        <div style="height:50px"></div>
    </div>`;

    view().querySelectorAll(".viewseg [data-view]").forEach(b => b.addEventListener("click", () => {
        if (b.disabled) return;
        location.hash = "#/item/" + encodeURIComponent(goods.id) + (b.dataset.view === "uses" ? "?view=uses" : "");
    }));
    view().querySelectorAll(".fchip").forEach(c => c.addEventListener("click", () => {
        state.filter = c.dataset.f || null;
        state.showAll = false;
        renderItem(id);
    }));
    $("#more")?.addEventListener("click", () => { state.showAll = true; renderItem(id); });
    view().querySelectorAll(".oc-btn").forEach(b => b.addEventListener("click", () => {
        const gt = { eu: +b.dataset.eu, duration: +b.dataset.dur, amperage: +b.dataset.amp || 1,
            heat: +b.dataset.heat || 0, chance: 100, type: "" };
        OpenOceu(gt);
    }));
    view().querySelectorAll("[data-copy]").forEach(a => a.addEventListener("click", (e) => {
        e.preventDefault();
        navigator.clipboard?.writeText(location.href);
        a.textContent = "✓ copied";
        setTimeout(() => (a.textContent = "⧉ link"), 1200);
    }));
    bindGo(view());
}

function bindGo(root) {
    root.querySelectorAll("[data-go]").forEach(n => n.addEventListener("click", () => {
        const v = n.dataset.go;
        location.hash = v.startsWith("#/") ? v : "#/item/" + encodeURIComponent(v);
    }));
}

/* ---------------- router ---------------- */

function route() {
    tt.hide();
    state = { filter: null, view: null, showAll: false, r: null, shot: false };
    const hash = location.hash.replace(/^#\/?/, "");
    const [path, qs] = hash.split("?");
    const params = new URLSearchParams(qs ?? "");
    if (params.get("shot") === "1") state.shot = true;
    const rn = parseInt(params.get("r"), 10);
    if (rn >= 1) state.r = rn;
    const tp = params.get("type");
    if (tp) state.filter = tp;
    const seg = decodeURIComponent(path ?? "");
    if (seg.startsWith("item/")) {
        if (params.get("view") === "uses" || params.get("uses") === "1")
            state.view = "uses";
        else if (params.get("view") === "recipes")
            state.view = "recipes";
        renderItem(decodeURIComponent(seg.slice(5)));
    } else if (seg === "browse") {
        renderBrowse(params);
    } else {
        renderHome();
    }
}

/* ---------------- boot ---------------- */

async function boot() {
    const splash = $("#splash .msg");
    const qp = new URLSearchParams(location.hash.split("?")[1] ?? "");
    const mode = qp.get("mode") === "expert" || (!qp.has("mode") && localStorage.getItem("nomi-mode") === "expert") ? "expert" : "normal";
    document.querySelectorAll(".seg [data-mode]").forEach(b =>
        b.classList.toggle("on", b.dataset.mode === mode));
    if (SHOT) { ATLAS_COLS = 256; ATLAS_UNIT = 32; }
    const atlasUrl = new URL(`data-${mode}/${SHOT ? "atlas.webp" : "atlas2.webp"}?v=${ATLAS_V}`, document.baseURI).href;
    document.documentElement.style.setProperty("--atlas-url", `url("${atlasUrl}")`);
    if (SHOT) document.body.classList.add("shot");

    splash.textContent = "Downloading database…";
    let response = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            response = await fetch(`./data-${mode}/data.bin?v=${DATA_V}`);
            if (response.ok) break;
        } catch (e) { /* retry */ }
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
    }
    if (!response || !response.ok) {
        $("#splash").innerHTML = `<div class="err">Could not download the recipe database.<br>Check your connection and reload.</div>`;
        return;
    }
    const stream = response.body.pipeThrough(new DecompressionStream("gzip"));
    const buffer = await new Response(stream).arrayBuffer();
    splash.textContent = "Indexing…";
    await new Promise(r => setTimeout(r, 0));
    repo = Repository.load(buffer);

    // only entries that actually do something: have recipes or are used
    // in one — dead entries (service items, empty placeholders) stay hidden
    for (const ptr of repo.items) {
        const it = repo.GetObject(ptr, Item);
        if (it.production.length === 0 && it.consumption.length === 0)
            continue;
        INDEX.push({ ptr, id: it.id, plain: (it.name ?? it.id).replace(/<[^>]*>/g, "").toLowerCase(),
            nameHtml: it.name ?? it.id, mod: it.mod, iconId: it.iconId, isFluid: false });
    }
    for (const ptr of repo.fluids) {
        const f = repo.GetObject(ptr, Fluid);
        if (f.production.length === 0 && f.consumption.length === 0)
            continue;
        INDEX.push({ ptr, id: f.id, plain: (f.name ?? f.id).replace(/<[^>]*>/g, "").toLowerCase(),
            nameHtml: f.name ?? f.id, mod: f.mod, iconId: f.iconId, isFluid: true });
    }

    $("#splash").remove();

    // topbar wiring
    const searchInput = $("#q");
    attachPalette(searchInput, (e) => { location.hash = "#/item/" + encodeURIComponent(e.id); });
    document.addEventListener("keydown", (e) => {
        if (e.key === "/" && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
            e.preventDefault();
            searchInput.focus();
        }
    });
    document.querySelectorAll(".seg [data-mode]").forEach(b => b.addEventListener("click", () => {
        localStorage.setItem("nomi-mode", b.dataset.mode);
        location.reload();
    }));
    $("#theme").addEventListener("click", () => {
        const light = document.documentElement.classList.toggle("light");
        localStorage.setItem("nomi-theme", light ? "light" : "dark");
    });
    if (localStorage.getItem("nomi-theme") === "light")
        document.documentElement.classList.add("light");
    $(".logo").addEventListener("click", () => (location.hash = "#/"));

    // legacy deep links (?item=…)
    const legacy = new URL(location.href).searchParams.get("item");
    if (legacy) {
        location.replace(location.pathname + "#/item/" + encodeURIComponent(legacy));
        return;
    }
    window.addEventListener("hashchange", route);
    route();
}

boot();
