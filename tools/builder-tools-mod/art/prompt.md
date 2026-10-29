# Builder belt item texture

Current runtime asset: `../src/main/resources/assets/builder_tools/textures/item/builder_belt.png`, 16×16, 10 RGBA
colours including transparency. Generated with built-in ImageGen; original in `source-belt.png`.

User direction: the first texture worked as a concept, but not as a Minecraft item; use Create goggles as reference.
`reference-create-goggles.png` is the actual 16×16 sprite from Create 6.0.10 (`create:item/goggles`), inspected with MCP
`texture_get`, then viewed. It is a style reference only; the runtime belt does not reference that image.

## Final prompt

Create a Minecraft inventory ITEM SPRITE, not concept art, using the attached actual 16x16 Create goggles texture as
the strict style reference. Subject is builder's leather belt, NOT goggles. Match exactly this extremely LOW
resolution flat chunky sprite language, brown leather strap loop at back, two little square brown utility pouches in
front and a tiny flat brass buckle between them. No hammer, no tools, no microdetails. A strict 16 by 16 logical pixel
grid across entire canvas: every pixel is one large uniform square; maximal silhouette 14 pixels wide and 10 pixels
tall, centered. Only about 8-10 flat colors total, using the reference leather browns #3d2311 #6f3c2d #87593a #68452d
and brass #c7954b #e1c469; no blue lenses. Each pouch is ONLY 3 by 4 logical pixels, no rounded shape, no ornamental
buckle on pouches. Main buckle only 2 by 2 logical pixels. Bold flat single pixel material cues. Closely match
reference's low detail and stepped outline, not a high resolution illustration. No gradients, no antialiasing, no
noise, no sheen, no outlines smaller than logical pixels. Deliver a crisp enlarged version of this 16x16 sprite on a
true transparent background, no grid drawn in image. The final in-game asset WILL BE 16x16; do not introduce any
detail needing higher resolution.

## Preparation and verification

Mechanical conversion: resize the complete square source to 16×16 with nearest-neighbour sampling (no crop or
aspect-ratio change), quantize to 10 colours with Pillow FASTOCTREE, retain alpha. Final alpha bounds `(1,3)–(15,12)`.
`preview.png` compares belt (left) with Create goggles (right), enlarged without smoothing and at native size.
Runtime texture and item/generated model checked with MCP `resources_check` and `model_render`.

The first 32×32 concept source remains in `concepts/source-belt-v1.png`; it is not used by the game.
