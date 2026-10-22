# State: item icons

Part of [STATE.md](../STATE.md). Renderer details — [docs/mcp.md](../mcp.md#client-resources-models-textures-checks).

- Since 2026-10-21 an item with an element model gets the model itself at inventory angle as its icon
  (`scripts/mods/icons3d.mjs` → shared generator `scripts/mcp/render.mjs`, content-hash cache in `.cache/…/icons3d`),
  field `g` in `items.json`; `t` (texture) stays — multiblock and schematic cube faces use it. 8183 3D / JEI-like icons.
- 2026-10-21 evening: view rotation as in game (all icons used to be mirrored — furnace mouth left; checked against the
  Minecraft Wiki: mouth right); Sophisticated Backpacks (model parts and default colours from code); fluid buckets
  (fluid colour/texture from TFC, Firmalife, Aged Alcohol, TFC-IE, Alloy Ext, More Propulsion, IE classes;
  `scripts/mcp/fluids.mjs`), empty TFC vessels and molds, TFC armour without trim (leather — default colour); IE tools
  — visible OBJ parts per their callbacks; `builtin/entity` (`scripts/mcp/entityModels.mjs`) — chests (incl. TFC),
  beds, shulkers, banners, heads, shield, conduit, pot, Functional Storage drawers.
- 2026-10-22 (feat/icons-rest): `paletted_permutations` atlas textures (TFC bookshelves in 3D; lumber, twigs, boats,
  water wheels, TFC signs now coloured per wood — used to be the grey template), dragon and piglin heads, IE multiblocks
  (basic_split), IE conveyors (all 6), CC turtles, framed FS drawers, IE core sample and potion bucket, IE
  high_power_biodiesel and phenolic_resin buckets, Cuisine Delight skillet.
- 2026-10-22 (feat/icons-hidden): «drawn by code» rules split into per-mod modules (`scripts/mcp/models/`, registry; a
  failing handler leaves the item as a texture); Create Submarine barometer drawn as an aquarium. Hidden items not in
  game (`scripts/mods/visibility/`, field `h`): 48 Create Connected catalysts (FeatureToggle conditions: required mods —
  Dragons Plus, Garnished, Dye Depot etc. — not in the pack; 5 visible: empty, melting, washing, smoking, haunting) and
  30 TFC technical items (ore pan, poured glass, stone anvils…).
- Not ported: IE feedthrough. Not checked in game. Functional Storage drawers by code lie «on their side» (front
  vertical): rechecked in DrawerISTER/FunctionalStorageISTER and DrawerBlock (default state facing=down,
  subfacing=north — model unrotated), no reference found online — compare in game. IE coke oven and blast furnace front
  is not visible in the icon by code (OBJ front face is south).
- KubeJS items (`icons-kubejs/`) are still textures; models from `kubejs/assets` and resource packs are not used by site
  icons (MCP `model_render` uses them): e.g. Firmalife buckets are wooden in game.
