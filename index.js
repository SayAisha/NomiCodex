

const loading = document.getElementById("loading");

// theme: apply before anything renders to avoid a flash
{
    const param = new URL(location.href).searchParams.get("theme");
    const wanted = param === "light" || param === "dark" ? param : localStorage.getItem("nomi-theme");
    if (wanted === "light")
        document.documentElement.classList.add("light");
}
export const MODE_KEY = "nomi-mode";
export function GetCurrentMode() {
    const url = new URL(location.href);
    const fromUrl = url.searchParams.get("mode");
    if (fromUrl === "normal" || fromUrl === "expert") {
        localStorage.setItem(MODE_KEY, fromUrl);
        return fromUrl;
    }
    const stored = localStorage.getItem(MODE_KEY);
    return stored === "expert" ? "expert" : "normal";
}
try {
    const mode = GetCurrentMode();
    document.querySelectorAll(".mode-option").forEach((btn) => {
        if (btn.dataset.mode === mode)
            btn.classList.add("active");
        btn.addEventListener("click", () => {
            localStorage.setItem(MODE_KEY, btn.dataset.mode);
            location.reload();
        });
    });
    // Point the icon stylesheet at this mode's atlas (custom property on <html>
    // resolves relative to the document URL)
    document.documentElement.style.setProperty('--atlas-url', `url("data-${mode}/atlas.webp?v=8")`);
    // Warm the atlas cache
    const atlas = new Image();
    atlas.src = `./data-${mode}/atlas.webp?v=8`;
    // Load repository and data in parallel
    const [repositoryModule, response] = await Promise.all([
        import("./repository.js?v=20"),
        fetch(`./data-${mode}/data.bin?v=10`)
    ]);
    const stream = response.body.pipeThrough(new DecompressionStream("gzip"));
    const buffer = await new Response(stream).arrayBuffer();
    repositoryModule.Repository.load(buffer);
    console.log("Repository loaded", repositoryModule.Repository.current);
    // Then load other modules
    await Promise.all([
        import("./itemIcon.js?v=20"),
        import("./tooltip.js?v=20"),
        import("./nei.js?v=20"),
        import("./menu.js?v=20"),
        import("./recipeList.js?v=20")
    ]);
    let page = await import("./page.js?v=20");
    page.UpdateProject();
    loading.remove();
    // theme toggle
    const themeToggle = document.getElementById("theme-toggle");
    if (themeToggle) {
        themeToggle.addEventListener("click", () => {
            const light = document.documentElement.classList.toggle("light");
            localStorage.setItem("nomi-theme", light ? "light" : "dark");
        });
    }

    // overclock calculator (ported from the Leveret oceu tag)
    const oceuModule = await import("./oceu.js?v=20");
    document.getElementById("oceu-link")?.addEventListener("click", (e) => {
        e.preventDefault();
        oceuModule.OpenOceu(null);
    });
    document.addEventListener("click", (e) => {
        const btn = e.target instanceof Element ? e.target.closest(".oceu-btn") : null;
        if (btn) {
            e.preventDefault();
            e.stopPropagation();
            oceuModule.OpenOceu({
                eu: +btn.dataset.eu,
                duration: +btn.dataset.dur,
                chance: +btn.dataset.chance,
                amperage: +btn.dataset.amp,
                heat: +btn.dataset.heat,
                type: btn.dataset.type || "",
            });
        }
    });
    const oceuParam = new URL(location.href).searchParams.get("oceu");
    if (oceuParam) {
        const [eu, dur] = oceuParam.split(",").map(Number);
        oceuModule.OpenOceu({ eu, duration: Math.round((dur || 20) * 20) });
    }

    // styled hover explanations for [data-info] spans (e.g. recipe voltage)
    const tooltipModule = await import("./tooltip.js?v=20");
    document.addEventListener("mouseover", (e) => {
        const target = e.target instanceof Element ? e.target.closest("[data-info]") : null;
        if (target)
            tooltipModule.ShowTooltip(target, { header: target.getAttribute("data-info") });
    });
    document.addEventListener("mouseout", (e) => {
        if (e.target instanceof Element && e.target.closest("[data-info]"))
            tooltipModule.HideTooltip();
    });

    // NEI-only mode: open the item browser straight away (?item=<id> deep-links to one)
    if (new URL(location.href).searchParams.get("noauto") === null) {
    const nei = await import("./nei.js?v=20");
    const deepLink = new URL(location.href).searchParams.get("item");
    const target = deepLink ? repositoryModule.Repository.current.GetById(deepLink) : null;
    nei.ShowNei(target, nei.ShowNeiMode.Production, null);
        // ?one=<n>: isolate recipe card n (RP tag screenshots). Cards render
        // virtually on scroll, so hunt downward until the target exists.
        const oneParam = new URL(location.href).searchParams.get("one");
        if (oneParam !== null && target !== null) {
            const one = parseInt(oneParam) || 0;
            const scroll = document.getElementById("nei-scroll");
            const mark = (kept) => {
                scroll.scrollTop = Math.max(0, kept.offsetTop - 80);
                const rect = kept.getBoundingClientRect();
                const marker = document.createElement("div");
                marker.style.cssText = `position:fixed;left:${rect.left - 12}px;top:${rect.top - 12}px;width:${rect.width + 24}px;height:${rect.height + 24}px;border:3px solid #ff00ff;pointer-events:none;z-index:99999;`;
                document.body.appendChild(marker);
            };
            const hunt = () => {
                const boxes = document.querySelectorAll(".nei-recipe-box");
                if (boxes.length > one) {
                    boxes.forEach((box, i) => {
                        if (i !== one)
                            box.remove();
                    });
                    mark(boxes[one]);
                } else if (scroll.scrollTop + scroll.clientHeight < scroll.scrollHeight - 10) {
                    scroll.scrollTop += Math.floor(scroll.clientHeight * 0.9);
                    setTimeout(hunt, 120);
                } else if (boxes.length) {
                    boxes.forEach((box, i) => {
                        if (i !== boxes.length - 1)
                            box.remove();
                    });
                    mark(boxes[boxes.length - 1]);
                }
            };
            scroll.scrollTop = 0;
            hunt();
        }
    }
}
catch (error) {
    loading.innerHTML = "An error occurred on loading:<br>" + error.message;
    console.error(error);
}
//# sourceMappingURL=index.js.map