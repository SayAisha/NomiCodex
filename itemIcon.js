import { Repository, Goods, OreDict } from "./repository.js?v=20";
import { NeiSelect, ShowNei, ShowNeiMode } from "./nei.js?v=20";
import { ShowTooltip, HideTooltip, IsHovered } from "./tooltip.js?v=20";
// Global cycling state
let globalIndex = 0;
let oredictElements = [];
// Global actions map
export const actions = {
    "item_icon_click": "Left/Right click to add recipe",
    "select": "Click to select",
    "toggle_link_ignore": "Click to toggle link ignore",
    "crafter_click": "Click to select another crafter"
};
// Start global cycle once
window.setInterval(() => {
    globalIndex++;
    for (const element of oredictElements) {
        element.UpdateIconId();
    }
}, 500);
let highlightStyle = document.getElementById('item-icon-highlight-style');
export class IconBox extends HTMLElement {
    constructor() {
        super();
        this.obj = null;
        this.addEventListener("mouseenter", () => {
            const obj = this.GetDisplayObject();
            if (obj) {
                const actionType = this.getAttribute('data-action');
                const actionText = actionType ? actions[actionType] : undefined;
                ShowTooltip(this, {
                    goods: obj,
                    action: actionText !== null && actionText !== void 0 ? actionText : "Left/Right click to view Production/Consumption for this item"
                });
                this.UpdateHighlightStyle();
            }
        });
        this.addEventListener("mouseleave", () => {
            highlightStyle.textContent = '';
        });
        this.addEventListener('contextmenu', this.RightClick);
        this.addEventListener('click', this.LeftClick);
        this.UpdateIconId();
    }
    StartOredictCycle(oredict) {
        if (!oredict || oredict.items.length === 0)
            return;
        this.UpdateIconId();
        // Add to global cycle if not already there
        if (!oredictElements.includes(this)) {
            oredictElements.push(this);
        }
    }
    StopOredictCycle() {
        const index = oredictElements.indexOf(this);
        if (index > -1) {
            oredictElements.splice(index, 1);
        }
    }
    UpdateHighlightStyle() {
        var _a;
        const currentIconId = (_a = this.obj) === null || _a === void 0 ? void 0 : _a.id;
        if (currentIconId && !this.classList.contains('item-icon-grid')) {
            highlightStyle.textContent = `
                item-icon[data-id="${currentIconId}"] {
                    box-shadow: 0 0 0 2px #4CAF50;
                    background-color: #4CAF5020;
                }
            `;
        }
    }
    UpdateIconId() {
        const obj = this.GetDisplayObject();
        if (obj) {
            const iconId = obj.iconId;
            const ix = iconId % 256;
            const iy = Math.floor(iconId / 256);
            this.style.setProperty('--pos-x', `${ix * -32}px`);
            this.style.setProperty('--pos-y', `${iy * -32}px`);
            // Update tooltip if this element is currently being hovered
            if (IsHovered(this)) {
                ShowTooltip(this, { goods: obj });
                this.UpdateHighlightStyle();
            }
        }
    }
    static get observedAttributes() {
        return ['data-id'];
    }
    attributeChangedCallback(name, oldValue, newValue) {
        if (name === 'data-id') {
            this.StopOredictCycle();
            this.obj = Repository.current.GetById(newValue);
            if (this.obj instanceof OreDict) {
                this.StartOredictCycle(this.obj);
            }
            else {
                this.UpdateIconId();
            }
        }
    }
    GetDisplayObject() {
        if (this.obj instanceof Goods) {
            return this.obj;
        }
        if (this.obj instanceof OreDict) {
            return this.obj.items[globalIndex % this.obj.items.length];
        }
        return null;
    }
    disconnectedCallback() {
        this.StopOredictCycle();
        HideTooltip(this);
        if (IsHovered(this)) {
            highlightStyle.textContent = '';
        }
    }
    CustomAction() {
        return this.getAttribute('data-action');
    }
    RightClick(event) {
        if (this.CustomAction())
            return;
        if (event.ctrlKey || event.metaKey)
            return;
        event.preventDefault();
        ShowNei(this.obj, ShowNeiMode.Consumption, null);
    }
    LeftClick() {
        let action = this.CustomAction();
        if (action === "select")
            NeiSelect(this.GetDisplayObject());
        if (action)
            return;
        ShowNei(this.obj, ShowNeiMode.Production, null);
    }
}
customElements.define("item-icon", IconBox);
console.log("Registered custom element: item-icon");
//# sourceMappingURL=itemIcon.js.map