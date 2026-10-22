---
name: addon-release
description: Release a pack addon (tools/<mod>) to the site — bump version, build, update the card tools/<mod>/addon.json and the addon's site page (guide addon-<mod>), check with MCP addon_check, then ship. Use for "выпусти аддон", "залей аддон на сайт", a new addon version or a brand-new addon.
---

# Addon release: build → card → page → check → ship

An addon on the site is three things, all in the repo except the page:

| What | Where | Who reads it |
| --- | --- | --- |
| jar | `tools/<mod>/<jar>` (in git, one current version) | copied to `/addons/` by `scripts/addons-index.mjs` before dev/build |
| card | `tools/<mod>/addon.json`: id, name, version, jar, order, side, summary, needs, replaces?, unlisted?, blocks (id, name, image, recipe) | site list `/addons`, page header, `::addon-block` widget, `/addons/index.json` for `tfc pull addons` |
| icons | `tools/<mod>/icons/*.png` (192 px, drawn by `release.sh` via `scripts/mcp/render.mjs`) | `/addons/icons/<mod>/` |
| page | Firestore guide `addon-<mod>` (mod id with `_` → `-`), `section: addon` | `/addons/<mod>`, edited by players on the site |

Work in a worktree (CLAUDE.md). Game facts — from jars via MCP; nothing is checked in game.

## 1. Build

1. Version: `mod_version` in `gradle.properties` (or `VERSION=` in `build.sh` for the javac-only mods),
   `version` in `src/main/resources/META-INF/neoforge.mods.toml` if it's not `${file.jarVersion}`.
2. Dev-server checks per docs/addons.md («Как проверять без игры»), then `./release.sh` (or `./build.sh`) in the mod
   folder. It leaves exactly one jar in `tools/<mod>/` and redraws `icons/`.
3. Resources changed → MCP `resources_check addon=<worktree>/tools/<mod>`, look at `model_render`.

## 2. Card `addon.json`

- `version`, `jar` — the new ones. `summary` — one paragraph for the list (what it is, not a changelog); `needs` —
  who installs it and dependencies.
- New block or item players craft → add to `blocks`: `id`, Russian `name` (from `ru_ru.json`), `image` (file in
  `icons/`; add the id to `release.sh` ICONS if missing), `recipe` copied from the jar's
  `data/<mod>/recipe/*.json` (`jar_read`): `pattern` and `key` — `{ item }` for an item, `{ item, tag }` for a tag
  (item = icon, pick a real member via `tag_members`), the addon's own items additionally `image` and `name`.
  Variants with the same recipe shape may share one entry (as heavy single/three-phase).
- New addon: copy a card, `order` — next ten, `side` — `both` if it adds blocks/items.

## 3. Page (guide `addon-<mod>`)

- `guide_get addon-<mod>` → edit → `guide_put` with the revision (signed Claude, version history kept). New addon —
  `guide_put` with `baseRevision: "new"` and header `section: addon`, `title` = card name, `checked` (`server` when
  verified on the dev server, `code`, `none`).
- Structure: `## Блоки и предметы` — for each card block `::addon-block id=<id>` on its own line, then the description
  as text (terminals, numbers, how to use); `## Проверено` / `## Не проверено` — bullets starting with the version and
  date («2.4 (2026-10-25) на сервере разработки: …»), newest first. Not checked in game — say so.
- Players may have edited the page: keep their text, add yours.

## 4. Check

- MCP `addon_check id=<mod> root=<worktree>` — must show no **Ошибки**. Warnings: fix or explain in the report.
  «Сведения» list jar items not named on the page — make sure each is described (often under a group entry).
- `npx tsc -b` if site code changed; browser on `dev-wt`: `/addons` and `/addons/<mod>` render, icons load, widgets
  have no errors.

## 5. Ship

- Update `docs/state/addons.md` (version, what changed, how verified) and the `docs/addons.md` table row.
- Commit (`Аддоны: <мод> <версия> — …`), then the `ship` skill: merge → `npm run deploy:site` from `main` (prebuild
  copies the jar and icons) → push. `addon_check` afterwards reports «на сайте <версия> — задеплоено».
- Report: the host installs it with `tfc pull addons` (or the jar from `/addons/<mod>`) on the server and players;
  add to docs/state/pending.md what waits for the host or an in-game check.
