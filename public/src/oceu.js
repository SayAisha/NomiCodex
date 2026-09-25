// Overclock calculator, ported from the Leveret "oceu" tag for NomiCodex.
// Math is a faithful port; the Discord arg parser is replaced by a form UI.
export const TIERS = [
    { tier: 0, name: "ULV", threshold: 8 },
    { tier: 1, name: "LV", threshold: 32 },
    { tier: 2, name: "MV", threshold: 128 },
    { tier: 3, name: "HV", threshold: 512 },
    { tier: 4, name: "EV", threshold: 2048 },
    { tier: 5, name: "IV", threshold: 8192 },
    { tier: 6, name: "LuV", threshold: 32768 },
    { tier: 7, name: "ZPM", threshold: 131072 },
    { tier: 8, name: "UV", threshold: 524288 },
    { tier: 9, name: "UHV", threshold: 2097152 },
    { tier: 10, name: "UEV", threshold: 8388608 },
    { tier: 11, name: "UIV", threshold: 33554432 },
    { tier: 12, name: "UXV", threshold: 134217728 },
    { tier: 13, name: "OpV", threshold: 536870912 },
    { tier: 14, name: "MAX", threshold: 2147483648 },
];
const MV_TIER = 2;
function tierName(tier) {
    const t = TIERS.find((t) => t.tier === tier);
    return t ? t.name : null;
}
function tierIndexByName(name) {
    if (!name)
        return null;
    const lower = name.toLowerCase();
    const t = TIERS.find((t) => t.name.toLowerCase() === lower);
    return t ? t.tier : null;
}
// first tier whose threshold covers this EU/t; CE reports ULV recipes as LV
function tierOf(eu, ce) {
    for (const t of TIERS)
        if (eu <= t.threshold)
            return (ce || t.tier !== 0) ? t.tier : 1;
    return 14;
}
function voltageOf(tier) {
    return 32 * Math.pow(4, tier - 1);
}
function hasFlag(flags, prefix) {
    const hits = flags.filter((f) => f.startsWith(prefix));
    return hits.length > 0 ? hits[0] : null;
}
function flagValue(flags, prefix) {
    const hit = hasFlag(flags, prefix);
    return hit ? hit.substring(prefix.length + 1) : null;
}

export function validateArgs(args) {
    if (args.base_eu < 0)
        throw new Error("EU cost must be positive");
    if (args.base_duration <= 0)
        throw new Error("Recipe duration must be positive");
    if (args.base_chance < 0 || args.base_chance_bonus < 0)
        throw new Error("Recipe chance must be positive");
    if (args.base_chance > 100 || args.base_chance_bonus > 100)
        throw new Error("Recipe chance must be smaller than 100%");
    if (args.base_parallel < 0)
        throw new Error("Recipe parallel must be positive");
    if (args.amperage < 0)
        throw new Error("Recipe amperage must be positive");
    if ((args.base_recipe_heat || args.base_coil_heat) && (!args.base_recipe_heat || !args.base_coil_heat))
        throw new Error("Both recipe temperature and coil temperature must be provided");
}

// standard (and GTCE) overclocking — port of the tag's u()
function calcStandard(args, tier) {
    const flags = args.flags;
    const res = { parallel: null, chance: null, chance_bonus: null };
    let eu = args.base_eu;
    const ce = hasFlag(flags, "--ce");
    if (hasFlag(flags, "--parallel")) {
        const p = Math.min(args.base_parallel, Math.floor(args.amperage * voltageOf(tier) / args.base_eu));
        eu = args.base_eu * p;
        res.parallel = p;
    }
    const ocCount = Math.max(0, tier - tierOf(eu, ce));
    let outEu = eu;
    let time = args.base_duration;
    if (ce) {
        const speed = eu <= 16 ? 2 : 2.8;
        const ocByTime = Math.floor(Math.log(time) / Math.log(speed));
        const oc = Math.min(ocByTime, ocCount);
        time = Math.max(1, Math.ceil(time / Math.pow(speed, oc)));
        outEu = Math.floor(eu * Math.pow(4, oc));
        const chanceOcs = hasFlag(flags, "--macerator")
            ? (tier >= MV_TIER ? ocCount - 1 : ocCount)
            : (tier >= MV_TIER ? ocCount + 1 : ocCount);
        res.chance = Math.min(100, args.base_chance * Math.pow(2, chanceOcs));
    }
    else {
        let ocTime;
        if (hasFlag(flags, "--lcr")) {
            ocTime = Math.min(ocCount, Math.floor(Math.log(time) / Math.log(4)));
            outEu = Math.floor(eu * Math.pow(4, ocTime));
            time = Math.max(1, Math.floor(args.base_duration / Math.pow(4, ocCount)));
            if (hasFlag(flags, "--subtick") && ocCount > ocTime)
                res.parallel = res.parallel * Math.pow(4, ocCount - ocTime);
        }
        else {
            ocTime = Math.min(ocCount, Math.floor(Math.log(time) / Math.log(2)));
            outEu = Math.floor(eu * Math.pow(4, hasFlag(flags, "--parallel") ? ocCount : ocTime));
            time = Math.max(1, Math.floor(args.base_duration / Math.pow(2, ocCount)));
            if (hasFlag(flags, "--subtick") && ocCount > ocTime)
                res.parallel = res.parallel * Math.pow(2, ocCount - ocTime);
        }
        res.chance = Math.min(100, args.base_chance + args.base_chance_bonus * ocCount);
    }
    if (hasFlag(flags, "--config"))
        time = Math.floor(0.9 * time);
    const timeMult = parseFloat(flagValue(flags, "--time"));
    const euMult = parseFloat(flagValue(flags, "--eu"));
    if (timeMult)
        time = Math.floor(time * timeMult);
    if (euMult)
        outEu = Math.floor(outEu * euMult);
    res.tier = tier;
    res.eu = outEu;
    res.time = time;
    res.chance_bonus = args.base_chance_bonus;
    return res;
}

// EBF / pyrolyse heat overclocking — port of the tag's c()
function calcEbf(args, tier) {
    const flags = args.flags;
    const res = { parallel: null, chance: null, chance_bonus: null };
    if (hasFlag(flags, "--ce"))
        return calcStandard(args, tier);
    let eu = args.base_eu;
    if (hasFlag(flags, "--parallel")) {
        const p = Math.min(args.base_parallel, Math.floor(args.amperage * voltageOf(tier) / args.base_eu));
        eu = args.base_eu * p;
        res.parallel = p;
    }
    const heatDiscount = (recipeHeat, coilHeat) => Math.pow(0.95, Math.floor((coilHeat - recipeHeat) / 900));
    const minTier = tierOf(eu * heatDiscount(args.base_recipe_heat, args.base_coil_heat), false);
    const maxTier = tierOf(voltageOf(tier) * args.amperage - 1, false);
    const ocCount = maxTier - minTier;
    const effCoil = args.base_coil_heat + 100 * (maxTier - 2);
    const heatOcs = Math.floor((effCoil - args.base_recipe_heat) / 1800);
    let outEu = eu * heatDiscount(args.base_recipe_heat, effCoil) * Math.pow(4, ocCount);
    let time = args.base_duration
        / Math.pow(4, Math.min(ocCount, heatOcs))
        / Math.pow(2, Math.max(0, ocCount - heatOcs));
    if (hasFlag(flags, "--config"))
        time = Math.floor(0.9 * time);
    const timeMult = parseFloat(flagValue(flags, "--time"));
    const euMult = parseFloat(flagValue(flags, "--eu"));
    if (timeMult)
        time = Math.floor(time * timeMult);
    if (euMult)
        outEu = Math.floor(outEu * euMult);
    res.eu = Math.floor(outEu);
    res.time = Math.max(1, Math.floor(time));
    res.tier = tier;
    res.chance_bonus = args.base_chance_bonus;
    return res;
}

// rows for every relevant tier — port of the tag's h()
export function computeRows(args) {
    const flags = args.flags;
    const ce = hasFlag(flags, "--ce");
    const extra = hasFlag(flags, "--extra");
    if (extra && ce)
        throw new Error("Nomifactory CE does not have UEV+ Voltage, voltages in Nomifactory cap to MAX (same as UHV)");
    validateArgs(args);
    const ebf = hasFlag(flags, "--ebf");
    const minTier = tierOf(args.base_eu, !!ce);
    const rows = [];
    const voltageName = flagValue(flags, "--voltage");
    if (voltageName) {
        const tier = tierIndexByName(voltageName);
        if (tier === null)
            throw new Error(voltageName + " is not a valid voltage");
        rows.push(ebf ? calcEbf(args, tier) : calcStandard(args, tier));
        return rows;
    }
    const top = extra ? 14 : 9;
    for (let tier = minTier; tier <= top; tier++)
        rows.push(ebf ? calcEbf(args, tier) : calcStandard(args, tier));
    return rows;
}

function formatRate(perSecond) {
    if (perSecond < 1e-4)
        return (perSecond * 60 * 60).toFixed(2) + "/h";
    if (perSecond < 0.01)
        return (perSecond * 60).toFixed(2) + "/min";
    return perSecond.toFixed(2) + "/s";
}
function rowRate(row, mult) {
    let rate = 1 / (row.time / 20) * mult;
    if (row.parallel)
        rate *= row.parallel;
    return formatRate(rate);
}
export function formatAmount(n) {
    if (n >= 1e12)
        return (n / 1e12).toFixed(2) + "T";
    if (n >= 1e9)
        return (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6)
        return (n / 1e6).toFixed(2) + "M";
    if (n >= 1e4)
        return (n / 1e3).toFixed(1) + "K";
    return String(n);
}

// ---------------- panel UI ----------------
let panel = null;
function el(html) {
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstChild;
}
function num(root, id, fallback) {
    const v = parseFloat(root.querySelector("#" + id).value);
    return isNaN(v) ? fallback : v;
}
function checked(root, id) {
    return root.querySelector("#" + id).checked;
}

export function OpenOceu(prefill) {
    const neiPanel = document.getElementById("nei");
    if (panel)
        panel.remove();
    panel = el(`<div id="oceu" class="panel oceu-panel">
        <div class="hgroup oceu-head">
            <span class="search-label">Overclock calculator</span>
            <button class="oceu-close">✕</button>
        </div>
        <div class="oceu-body">
            <div class="oceu-form">
                <label>EU/t<input id="oc-eu" type="number" min="0" value="120"></label>
                <label>Duration (s)<input id="oc-dur" type="number" min="0" step="any" value="20"></label>
                <label>Base chance %<input id="oc-chance" type="number" min="0" max="100" placeholder="0"></label>
                <label>Chance bonus %<input id="oc-bonus" type="number" min="0" max="100" placeholder="0"></label>
                <label>Parallel<input id="oc-par" type="number" min="1" placeholder="1"></label>
                <label>Amperage<input id="oc-amp" type="number" min="1" placeholder="1"></label>
                <label class="oceu-check"><input id="oc-ebf" type="checkbox"> Heat OC (EBF)</label>
                <label>Recipe heat K<input id="oc-rheat" type="number" min="0" placeholder="3600" disabled></label>
                <label>Coil heat K<input id="oc-cheat" type="number" min="0" placeholder="2700" disabled></label>
            </div>
            <div class="oceu-flags">
                <label class="oceu-check"><input id="oc-ce" type="checkbox"> GTCE mode</label>
                <label class="oceu-check"><input id="oc-lcr" type="checkbox"> Perfect OC (LCR)</label>
                <label class="oceu-check"><input id="oc-subtick" type="checkbox"> Subtick</label>
                <label class="oceu-check"><input id="oc-macerator" type="checkbox"> Macerator chance</label>
                <label class="oceu-check"><input id="oc-config" type="checkbox"> Maint. hatch (0.9x)</label>
                <label class="oceu-check"><input id="oc-extra" type="checkbox"> Tiers up to MAX</label>
                <label class="oceu-check"><input id="oc-rf" type="checkbox"> RF input</label>
                <label class="oceu-check"><input id="oc-tick" type="checkbox"> Ticks</label>
                <label class="oceu-check"><input id="oc-rates" type="checkbox"> Rates</label>
                <label>Input ×<input id="oc-in" type="number" min="0" step="any" placeholder="1" style="width:64px"></label>
                <label>Output ×<input id="oc-out" type="number" min="0" step="any" placeholder="1" style="width:64px"></label>
                <label>Time ×<input id="oc-time" type="number" step="any" placeholder="1.0" style="width:64px"></label>
                <label>EU ×<input id="oc-eum" type="number" step="any" placeholder="1.0" style="width:64px"></label>
                <label>Voltage
                    <select id="oc-voltage"><option value="">All</option></select>
                </label>
                <label class="oceu-check"><input id="oc-volcanus" type="checkbox"> Volcanus</label>
                <label class="oceu-check"><input id="oc-cryo" type="checkbox"> Cryo freezer</label>
            </div>
            <div class="oceu-error hidden"></div>
            <div class="oceu-result scroll-area"></div>
        </div>
    </div>`);
    document.getElementById("panels").appendChild(panel);
    const voltageSel = panel.querySelector("#oc-voltage");
    for (const t of TIERS) {
        const o = document.createElement("option");
        o.value = t.name;
        o.textContent = t.name;
        voltageSel.appendChild(o);
    }
    const $ = (id) => panel.querySelector("#" + id);
    // prefill from a recipe card
    if (prefill) {
        if (prefill.type) {
            const t = prefill.type.toLowerCase();
            if (t === "large chemical reactor")
                $("oc-lcr").checked = true;
            if (t === "blast furnace" || t === "pyrolyse oven" || t === "alloy blast smelting") {
                $("oc-ebf").checked = true;
                $("oc-rheat").disabled = false;
                $("oc-cheat").disabled = false;
            }
            if (t === "pulverization")
                $("oc-macerator").checked = true;
        }
        if (prefill.eu)
            $("oc-eu").value = prefill.eu;
        if (prefill.duration)
            $("oc-dur").value = (prefill.duration / 20).toString();
        if (prefill.chance != null && prefill.chance < 100 && prefill.chance > 0)
            $("oc-chance").value = prefill.chance;
        if (prefill.amperage && prefill.amperage > 1)
            $("oc-amp").value = prefill.amperage;
        if (prefill.heat) {
            $("oc-ebf").checked = true;
            $("oc-rheat").value = prefill.heat;
            $("oc-cheat").value = Math.max(2700, Math.ceil(prefill.heat / 900) * 900);
            $("oc-rheat").disabled = false;
            $("oc-cheat").disabled = false;
        }
    }
    panel.querySelector(".oceu-close").addEventListener("click", () => {
        panel.remove();
        panel = null;
        if (neiPanel)
            neiPanel.classList.remove("hidden");
    });
    panel.addEventListener("input", recalc);
    panel.addEventListener("change", recalc);
    function collectArgs() {
        const flags = [];
        if ($("oc-ce").checked)
            flags.push("--ce");
        if ($("oc-lcr").checked)
            flags.push("--lcr");
        if ($("oc-macerator").checked)
            flags.push("--macerator");
        if ($("oc-config").checked)
            flags.push("--config");
        if ($("oc-extra").checked)
            flags.push("--extra");
        if ($("oc-tick").checked)
            flags.push("--tick");
        if ($("oc-rates").checked)
            flags.push("--rates");
        if ($("oc-ebf").checked)
            flags.push("--ebf");
        const subtick = $("oc-subtick").checked;
        if (subtick)
            flags.push("--subtick", "--parallel");
        let args_parallel = num(panel, "oc-par", 1) || 1;
        const parallel = args_parallel;
        if ((parallel > 1 || subtick) && !$("oc-ebf").checked)
            flags.push("--parallel");
        if (parallel > 1 && $("oc-ebf").checked)
            flags.push("--parallel");
        const inMult = num(panel, "oc-in", 1);
        const outMult = num(panel, "oc-out", 1);
        if ($("oc-rates").checked && inMult != 1)
            flags.push("--input:" + inMult);
        if (outMult != 1)
            flags.push("--output:" + outMult);
        const timeMult = num(panel, "oc-time", NaN);
        if (!isNaN(timeMult) && timeMult != 1 && $("oc-time").value)
            flags.push("--time:" + timeMult);
        const euMult = num(panel, "oc-eum", NaN);
        if (!isNaN(euMult) && euMult != 1 && $("oc-eum").value)
            flags.push("--eu:" + euMult);
        const voltage = $("oc-voltage").value;
        if (voltage)
            flags.push("--voltage:" + voltage);
        let baseEu = Math.floor(num(panel, "oc-eu", 0));
        if ($("oc-rf").checked)
            baseEu = Math.floor(baseEu / 4);
        if ($("oc-volcanus").checked && $("oc-ebf").checked) {
            flags.push("--time:0.45454545", "--eu:0.9", "--parallel");
            args_parallel = 8;
        }
        if ($("oc-cryo").checked && !$("oc-ebf").checked) {
            flags.push("--time:0.5", "--parallel");
            args_parallel = 4;
        }
        const durationSeconds = num(panel, "oc-dur", 0);
        return {
            base_eu: baseEu,
            base_duration: Math.max(1, Math.floor(durationSeconds * 20)),
            base_chance: num(panel, "oc-chance", 0),
            base_chance_bonus: num(panel, "oc-bonus", 0),
            base_parallel: args_parallel,
            amperage: num(panel, "oc-amp", 1) || 1,
            base_recipe_heat: $("oc-ebf").checked ? num(panel, "oc-rheat", 0) : 0,
            base_coil_heat: $("oc-ebf").checked ? num(panel, "oc-cheat", 0) : 0,
            flags,
        };
    }
    function recalc() {
        $("oc-rheat").disabled = !$("oc-ebf").checked;
        $("oc-cheat").disabled = !$("oc-ebf").checked;
        const errBox = panel.querySelector(".oceu-error");
        const result = panel.querySelector(".oceu-result");
        try {
            const args = collectArgs();
            const rows = computeRows(args);
            errBox.classList.add("hidden");
            renderTable(result, rows, args);
        }
        catch (e) {
            errBox.textContent = String(e.message || e);
            errBox.classList.remove("hidden");
            result.innerHTML = "";
        }
    }
    function renderTable(container, rows, args) {
        const flags = args.flags;
        const ce = hasFlag(flags, "--ce");
        const tick = hasFlag(flags, "--tick");
        const showChance = rows.some((r) => r.chance != null && args.base_chance > 0);
        const showParallel = rows.some((r) => r.parallel != null);
        const inMult = parseFloat(flagValue(flags, "--input")) || 1;
        const outMult = parseFloat(flagValue(flags, "--output")) || 1;
        const showRates = hasFlag(flags, "--rates") != null;
        const showInput = hasFlag(flags, "--input") != null;
        let html = `<table class="oceu-table"><thead><tr><th>EU/t</th><th>Time</th>`;
        if (showChance)
            html += `<th>Chance</th>`;
        if (showParallel)
            html += `<th>Parallel</th>`;
        if (showInput)
            html += `<th>Input</th>`;
        if (showRates)
            html += `<th>Rates</th>`;
        html += `<th>Voltage</th></tr></thead><tbody>`;
        for (const row of rows) {
            html += `<tr><td>${formatAmount(row.eu)}</td><td>${tick || row.time < 20 ? row.time + "t" : (row.time / 20) + "s"}</td>`;
            if (showChance)
                html += `<td>${Math.round(row.chance)}%</td>`;
            if (showParallel)
                html += `<td>${row.parallel}x</td>`;
            if (showInput)
                html += `<td>${rowRate(row, inMult)}</td>`;
            if (showRates)
                html += `<td>${rowRate(row, outMult)}</td>`;
            const name = (ce && row.tier === 9) ? "MAX" : tierName(row.tier);
            html += `<td>${name}</td></tr>`;
        }
        html += `</tbody></table>`;
        container.innerHTML = html;
    }
    if (neiPanel)
        neiPanel.classList.add("hidden");
    recalc();
}
