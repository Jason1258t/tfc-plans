# Dev tracker on the VPS

Decided 2026-10-26 with the host: development tasks (former site groups «Разработка» and «Фиксы») and their plan
docs move out of Firestore to SQLite inside the pack server. Reason: agents' work logs and every site visit's
subscription to the whole `tasks` collection burn the 50k reads/day free tier (it ran out on 2026-10-26 before noon).

## Choices

- **SQLite** via built-in `node:sqlite` (Node 22.23 on the VPS) — no packages, no daemon, one file
  `<DATA_DIR>/dev.db`. MongoDB rejected: a separate daemon of 200–400 MB on a 2 GB machine where the data build already
  takes ~0.9 GB and foreign services live.
- **Inside the pack server** (`server/pack-server/lib/dev.mjs`, routes `/dev/…`), behind the same Caddy on 28788.
- **Access**: a pack key of any role (agents, `tfc`) or the site's Firebase ID token (+ App Check when
  `APP_CHECK_PROJECT_NUMBER` is set) — the same level as Firestore rules today. Author — `by` from the body (agent nick
  or site nick), else the key name.
- **Site page `/dev` with edits** from the start: list, filters, task dialog with work log and plan docs.
- **Old tasks**: imported once (`scripts/dev-migrate.mjs`, Firestore reads once), then deleted from Firestore after a
  separate confirmation by the host.

## Model

- `tasks`: `id` (number, shown `#12`), title, body (markdown), kind (`feature|fix|refactor|docs|infra|idea`), area
  (`site|mcp|addon|server|pack|app|agents`), status (`backlog|todo|doing|review|done|dropped`), priority 0–3,
  assignee, branch, checklist (JSON), author, created/updated/done timestamps, `rev`, `legacy` (Firestore id).
- `notes`: work log entries per task (author, kind `note|status|report`, text, time) — append-only, no revision.
- `docs`: plan docs (title, markdown, optional task, `rev`, `legacy`).
- Writes with `baseRev` refuse with 409 when the record changed. A status change writes a `status` note itself.
- Daily backup `VACUUM INTO <DATA_DIR>/dev-backup/dev-YYYYMMDD.db`, last 14 kept.
- `files` (dev #357, 2026-11-14): attachments — `id` (20 chars, Firestore-style; migrated ones keep their old id),
  task (cascade on task delete), name, MIME type, size, `sha256`, author, time. Content in `<DATA_DIR>/dev-files/<sha256>`
  (deduplicated; a file is removed when no attachment references it). Server module — `lib/dev-files.mjs`.

## Attachments (dev #357)

Before: Firestore `files` with `taskId = "dev:<id>"` — reads from the scarce quota, and agents had no write path (the
stand evidence of #311 could not be attached). Now everything is on the pack server:

- API (same auth as `/dev`): `GET|POST /dev/tasks/:id/files`, `GET|DELETE /dev/files/:id`, `GET /dev/files/:id/content`.
  Upload body — the file itself; `X-File-Name` and `X-File-By` URI-encoded, `X-File-Sha256` required and checked while
  streaming (mismatch → 409). Admin key may pass `X-File-Id` / `X-File-Created` (migration). Same content + name on the
  same task → `existed`, not a copy. Upload and delete write a log note.
- Limits: 50 MB per file (`DEV_FILE_MAX_BYTES`), 5 GB total (`DEV_FILES_MAX_BYTES`), `MIN_FREE_BYTES` on the disk;
  extension allowlist (images, text/logs/configs/code, archives, nbt/schematics/jar, pdf, audio/video), `.log.N` too.
  Content is always served as a download with `CSP: sandbox` and `nosniff`.
- `GET /dev/tasks/:id` returns `files` too — the site and `dev_get` need no extra request.
- Site: `src/pages/dev/model/files.ts` → `FileSource` of `features/task-files` (the shared gallery and attachment list
  take a source; without one they use the Firestore store as before for players' tasks).
- MCP: `dev_file_get`, `dev_file_put` (`scripts/mcp-dev/files.mjs`); `addon_stand task=` attaches `evidence/` +
  `verdict.json` as one zip.
- Migration: `scripts/dev-files-migrate.mjs` (dry run, `--apply`, then verified by size and SHA256). Firestore copies
  are left in place but nothing reads them.

## MCP

`tfc-plans-dev` gets `dev_list`, `dev_get`, `dev_create`, `dev_update`, `dev_note`, `dev_doc_get`, `dev_doc_put`, `dev_file_get`, `dev_file_put` —
HTTPS to the pack server with the `tfc` key (`TFC_PACK_URL`/`TFC_PACK_TOKEN` or `tfc login`), signed with
`TFC_AGENT_NICK`. Zero Firestore reads. The `tfc-pack` task tools stay for players' tasks.

## Stages

1. Server module + API, MCP tools, site page — this branch.
2. Deploy server (install.sh), import old tasks when the Firestore quota allows, check, then delete them (host's yes).
3. AGENTS.md, `dev-session` skill, docs/mcp.md → the work log goes to `dev_*`.
4. Later: SSE for live updates on the page, links task ↔ commits/branches from `ship`.
