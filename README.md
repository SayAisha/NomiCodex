# [NomiCodex](https://sayaisha.github.io/NomiCodex/)

**[→ Open NomiCodex](https://sayaisha.github.io/NomiCodex/)** — an unofficial recipe browser for the
**[NomiFactory CEu](https://github.com/Nomi-CEu/Nomi-CEu)** Minecraft modpack, with normal and
expert (hard mode) support.

## Features

- Search every item and fluid, browse every recipe
- Machine recipes with EU/t, duration, voltage tier, heat and chance outputs
- Multiblock and singleblock machines per recipe type, oredict-aware inputs
- **Extended Crafting** support — basic/advanced/elite/ultimate tables, ender crafter,
  combination crafting and the quantum compressor
- Built-in overclock calculator (ported from the `oceu` Leveret tag) with automatic
  recipe-kind detection (standard, EBF heat, LCR perfect OC)
- `--uses` lookups: see what recipes consume an item
- Light and dark themes
- Fully static — hosted on GitHub Pages, nothing to install

## Leveret tag

The `RP` tag for the [Leveret](https://github.com/NotMyWing/LeveretLisp) bot queries this site:
search an item, list its recipes, post the recipe card as an image, filter by machine
(`%t RP signalum EBF`), overclock it (`--oc`) or show uses (`--uses`).

## How it works

Item and recipe data is dumped straight from a Nomi CEu 1.7.7 server with a small custom
dump mod, converted into a compact binary pack, and served statically. Item icons are
rendered in-game using the icon rendering pipeline from
[susy-factory-flow](https://github.com/SymmetricDevs/susy-factory-flow). Recipe cards are
pre-rendered images, so the tag works without any backend.

## Credits

Made by **[Aisha](https://github.com/SayAisha)**.

NomiCodex stands on the shoulders of:

- **[NomiFactory CEu](https://github.com/Nomi-CEu/Nomi-CEu)** — the modpack this browses.
  All items, recipes and content belong to its team and the mod authors.
- **[GTNH Calculator](https://github.com/ShadowTheAge/gtnh)** by ShadowTheAge — the site's
  codebase, data format and NEI-style interface were adapted from this project.
- **[susy-factory-flow](https://github.com/SymmetricDevs/susy-factory-flow)** by
  SymmetricDevs — the in-game icon rendering pipeline used to capture every item texture.
- **[HadEnoughItems](https://github.com/GTNewHorizons/HadEnoughItems)** — the in-game
  ingredient registry the icon renderer works through.
- **Mojang / Minecraft** — the game all of this is about.

## Disclaimer

Unofficial, fan-made tool. Not affiliated with, endorsed by, or sponsored by the
NomiFactory CEu team, GTCEu, or any mod authors. Minecraft, NomiFactory CEu, and all
mods, items, names, and textures are the property of their respective owners. All rights
belong to their owners.
