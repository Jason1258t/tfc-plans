# Item textures for pack addons

Use this workflow when creating or replacing a flat item texture. For block faces, respect the model UV layout;
a rendered block icon and its face textures are different assets. Preserve an explicit user choice of style or size.

## References and visual brief

- Inspect similar items in the actual pack first: MCP `items_search`, `texture_get`, and `model_render` where relevant.
  Open the reference images; record the item ids and source mod. Choose references for silhouette, palette, material
  treatment and detail density, rather than copying an unrelated icon because it is convenient.
- Define the object and its recognizable parts, viewing angle, material, palette, lighting and intended texture size.
  Match the neighboring mod's art direction. Minecraft does not by itself mean mandatory 16×16 pixel art.
- Separate the detailed generation source from the runtime PNG. Use a high-quality source (for example, about
  1024×1024 when supported); choose a power-of-two runtime size from the references and readability, commonly
  32/64/128 pixels. These are starting points, not fixed requirements. Do not upscale a crude 16×16 drawing and
  call it a detailed source; do not ship a large source automatically as the runtime asset.

## Generate the artwork

Use the harness's available image-generation tool for new artwork. In Codex, use the installed `imagegen` skill
and built-in image tool when available; follow its current tool instructions rather than hardcoding API parameters.
Other agents use their available equivalent. Do not require a separate API key for a built-in tool.

Supply the inspected references as images when supported, with each image's role explained. Merely naming a mod
is not a visual reference. A useful prompt structure (adapt to the actual item):

```text
Create one inventory item texture for [item and its function].
References: [images and which palette/material/silhouette traits to match].
Show [recognizable parts], viewed [angle], with [material and restrained lighting].
Match the references' game art style and detail density. Clear silhouette, readable at [runtime size].
One complete isolated object, centered with a small transparent margin, no cropped edges.
True transparent background; no checkerboard drawn into the image, scene, text, watermark or cast ground shadow.
Produce a detailed source suitable for reduction, without an artificial coarse pixel grid.
```

Do not substitute a few programmatically drawn rectangles, ellipses or random noise for generated artwork.
Code is appropriate for technical patterns, UV assembly and mechanical processing when needed; original artwork
is generated unless the user requests procedural drawing. If generation is unavailable, state that limitation and
ask about an available alternative; do not silently present a procedural placeholder as a finished texture.

For revisions, preserve the approved silhouette, palette and materials and name the specific defect to fix.
Use the image tool for visual edits according to its instructions. Keep the selected original and final prompt
under the addon's `art/` directory so later work does not depend on a temporary file or an agent's personal cache.

## Prepare and inspect the game asset

- Keep the original, then use supported image processing for mechanical crop/resize/export. Preserve aspect ratio,
  transparent margins and alpha; do not remove a painted background using a rough color threshold. If it is not
  truly transparent, correct it with the image tool. Inspect edges on both light and dark backgrounds.
- Reduce to the chosen runtime size. Use nearest-neighbor for an intentionally pixel-aligned source; for smooth
  detailed art use a suitable downsampling filter and inspect the result for blur and alpha halos. Do not blindly
  apply one filter to every style. If reduction destroys identifying parts, simplify the artwork or revise size.
- Save the runtime PNG under `src/main/resources/assets/<modid>/textures/item/<name>.png`; check the consuming
  item model and its texture reference against the addon's existing conventions. Keep source artwork outside
  runtime resources. Do not add Pillow as a runtime/build requirement just for one conversion.
- View the final PNG at native resolution, enlarged without smoothing, and in a 16/32-pixel inventory-style preview
  beside the references. Assess silhouette, material, palette, legibility, padding and transparency. A large attractive
  source alone does not prove the final icon works. Show the resulting image to the user.
- Run MCP `resources_check` for the addon and `model_render` for the consuming model when supported. If a tool
  cannot render that item model, report the limitation and inspect the PNG/model reference separately.
- Report the source and final paths, final dimensions, generation tool and prompt, references used, and checks.
  Client appearance remains **«в игре не проверялось»** unless the user supplies an actual in-game check.
