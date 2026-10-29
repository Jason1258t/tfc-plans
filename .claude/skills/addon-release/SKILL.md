---
name: addon-release
description: Release a pack addon (tools/<mod>) to the site — bump version, build, upload the jar to the pack server, write the version's changelog (addonVersions), update the card tools/<mod>/addon.json and the addon's site page (guide addon-<mod>), check with MCP addon_check, then ship. Use for "выпусти аддон", "залей аддон на сайт", a new addon version or a brand-new addon.
---

# Addon release: build → upload → changelog → card → page → check → ship

An addon on the site:

| What    | Where                                                                                                                                                                                                                          | Who reads it                                                                                                                                                                            |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| jar     | **pack server** blob by sha256 (all versions; not in git — `tools/*/*.jar` is ignored); the fresh build sits in `tools/<mod>/<jar>` locally                                                                                    | `tfc pull addons [<mod>@<ver>]` (key); the current one is copied to `/addons/` by `scripts/addons-index.mjs` (from `tools/`, else by the card's sha256 from cache / pack server / site) |
| version | Firestore `addonVersions/{mod}@{ver}`: date, status draft/released/withdrawn, jar {file, sha256, size}, **changelog** (Russian, for players, «what changed since the previous version»), checked + checkedNote; revisions kept | page tab «Версии», `/site/addons` on the pack server for `tfc`, pack-update records and patch notes                                                                                     |
| card    | `tools/<mod>/addon.json`: id, name, version, jar, sha256, order, side, summary, needs, replaces?, formerIds?, unlisted?, blocks (id, name, image, recipe)                                                                      | site list `/addons`, page header, `::addon-block` widget, `/addons/index.json` for `tfc pull addons` without a key                                                                      |
| icons   | `tools/<mod>/icons/*.png` (192 px, drawn by `release.sh` via `scripts/mcp/render.mjs`)                                                                                                                                         | `/addons/icons/<mod>/`                                                                                                                                                                  |
| page    | Firestore guide `addon-<mod>` (mod id with `_` → `-`), `section: addon`                                                                                                                                                        | `/addons/<mod>`, edited by players on the site                                                                                                                                          |

Work in a worktree (AGENTS.md). Game facts — from jars via MCP; nothing is checked in game.

## 1. Build

1. Version: `mod_version` in `gradle.properties` (or `VERSION=` in `build.sh` for the javac-only mods),
   `version` in `src/main/resources/META-INF/neoforge.mods.toml` if it's not `${file.jarVersion}`.
2. Dev-server checks per docs/addons.md («Как проверять без игры»), then `./release.sh` (or `./build.sh`) in the mod
   folder. It leaves exactly one jar in `tools/<mod>/` and redraws `icons/`.
3. Resources changed → MCP `resources_check addon=<worktree>/tools/<mod>`, look at `model_render`.

## 2. Upload and changelog

- `npm run tfc -- admin addon upload tools/<mod>/<jar>` (agent key in `~/.config/tfc` is admin): blob + version record
  as a draft. Refused if that version already has another jar — bump the version. Check the version inside the jar
  (`neoforge.mods.toml`) — EE Extras 2.2.0 shipped saying 2.1.2.
- MCP `addon_version_get` → `addon_version_put` (`baseRevision` from get; `"new"` if the upload didn't run): changelog
  for players in Russian — new blocks/items, numbers, fixes, what to rebuild; «**Важно:**» for what breaks or needs
  action (the patch note lifts it into «Главное»). `checked` + `checkedNote` (dev server / code / not in game).
  After the checks — `status: released`. Never `game` unless the user/host confirmed it in game.

## 3. Card `addon.json`

- `version`, `jar`, `sha256` (of that same jar) — the new ones. `summary` — one paragraph for the list (what it is, not a changelog); `needs` —
  who installs it and dependencies.
- New block or item players craft → add to `blocks`: `id`, Russian `name` (from `ru_ru.json`), `image` (file in
  `icons/`; add the id to `release.sh` ICONS if missing), `recipe` copied from the jar's
  `data/<mod>/recipe/*.json` (`jar_read`): `pattern` and `key` — `{ item }` for an item, `{ item, tag }` for a tag
  (item = icon, pick a real member via `tag_members`), the addon's own items additionally `image` and `name`.
  Variants with the same recipe shape may share one entry (as heavy single/three-phase).
- New addon: copy a card, `order` — next ten, `side` — `both` if it adds blocks/items.

## 4. Page (guide `addon-<mod>`)

- `guide_get addon-<mod>` → edit → `guide_put` with the revision (signed Claude, version history kept). New addon —
  `guide_put` with `baseRevision: "new"` and header `section: addon`, `title` = card name, `checked` (`server` when
  verified on the dev server, `code`, `none`).
- Structure: `## Блоки и предметы` — for each card block `::addon-block id=<id>` on its own line, then the description
  as text (terminals, numbers, how to use); `## Проверено` / `## Не проверено` — bullets starting with the version and
  date («2.4 (2026-10-25) на сервере разработки: …»), newest first. Not checked in game — say so.
- Players may have edited the page: keep their text, add yours.

## 5. Check

- MCP `addon_check id=<mod> root=<worktree>` — must show no **Ошибки** (it also checks the card sha256 against the jar
  and the version record: changelog written, jar uploaded, status). Warnings: fix or explain in the report.
  «Сведения» list jar items not named on the page — make sure each is described (often under a group entry).
- `npx tsc -b` if site code changed; browser on `dev-alt`: `/addons` and `/addons/<mod>` render, icons load, widgets
  have no errors.

## 6. Ship

- Update `docs/state/addons.md` (version, what changed, how verified) and the `docs/addons.md` table row.
- Addon repo first: in `tools/` commit (`Аддон <мод> <версия>: …`), `git -C tools push origin HEAD:main` (fast-forward;
  otherwise merge `origin/main` into your branch there, re-check, push). Then in the tfc-plans worktree commit the
  new `tools` pointer with the docs (`Аддоны: <мод> <версия> — …`), then the `ship` skill: merge →
  `npm run deploy:site` from `main` (prebuild copies the jar and icons) → push. `ship` refuses a pointer that is not
  on tfc-addons `origin/main`. `addon_check` afterwards reports «на сайте <версия> — задеплоено».
- Report: the host installs it with `tfc pull addons` (or the jar from `/addons/<mod>`) on the server and players;
  a broken version — status «отозвана» on the site (tfc rolls back to the previous released one);
  add to docs/state/pending.md what waits for the host or an in-game check.
