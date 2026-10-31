# TFC Studio branding design

Date: 2026-10-31
Status: concept approved by the project owner; implementation not started

## Product name

The public product name is **TFC Studio**.

The Russian descriptor is **«Инженерная экосистема для TerraFirmaCraft»**. It explains the product where a subtitle is useful; it is not part of the compact wordmark.

«TFC Планы» no longer describes the product accurately: tasks are only one part of an ecosystem that also includes documents, Create schematics, recipes, reference material, addons, maps and shared workspaces. «Studio» is neutral enough for a community release and does not imply a personal blog, a single pack or a task-only tool.

Repository names, Firebase identifiers, package names, URLs and other technical identifiers are outside the naming change unless separately planned.

## Logo concept

The selected direction is **B — Modular System**.

The sign consists of three connected isometric modules arranged around a shared centre. It represents tools, data and workspaces combined into one engineering ecosystem. The geometry must remain simple and constructed rather than resembling a generic gear, a Minecraft item or pixel clip art.

The full sign adds restrained blueprint construction lines: a centre grid, an outer construction circle, dimension ticks and small copper nodes. These lines communicate engineering without turning the name «Чертёж» into the brand itself.

A copper upper plane is the active element of the system and preserves continuity with the previous copper-ingot icon.

## Logo variants

1. **Full sign** — the three modules plus construction lines. Use at 40 px and above, including the normal site header, introductory screens and brand presentations.
2. **Compact sign** — the same three modules with thicker strokes and no construction lines, dimension marks or small nodes. Use below 40 px, including favicons at 16, 24 and 32 px.
3. **Horizontal lockup** — the sign to the left of the wordmark. `TFC` is the dominant line; `STUDIO` is smaller, uppercase and letter-spaced below it.
4. **Standalone sign** — used where the product name is already clear from context or space is limited.

The compact and full variants must remain recognisably the same sign; the compact version is a simplification, not a second logo.

## Colour and typography

Core colours from the approved mockup:

- Graphite background: `#15191D`.
- Main light outline: `#D8E2E7`.
- Construction lines: `#607784`, used at reduced opacity.
- Copper accent: `#D98C62`.
- Primary wordmark on dark: `#EDF2F4`.
- Primary wordmark on light: `#1C252B`.

Light and dark versions use the same geometry and copper accent. Outlines and wordmark colours adapt to preserve contrast.

The wordmark uses the site's interface sans-serif stack, with Inter as the preferred family when available and system sans-serif fallbacks. No new font dependency is required for the logo concept.

## Usage and scope

The first implementation should cover the visible identity: SVG logo assets, the site header, favicon, welcome/onboarding text, HTML title and social metadata, and the social preview image where applicable.

The header uses the horizontal lockup on desktop and may use the standalone compact sign on narrow screens. The full sign must not be shrunk into favicon sizes.

This round does not rename technical identifiers, migrate data, change navigation or redesign unrelated pages. Domain and trademark availability have not been checked and are not claimed.

## Verification for implementation

Check the logo in desktop and mobile headers, in light and dark themes, and at 16, 24, 32 and 48 px. Confirm that construction details disappear only in the compact variant, the copper accent remains legible, SVG assets scale cleanly, and old «TFC Планы» product-facing text is not left in the covered surfaces. Technical identifiers may intentionally remain unchanged.
