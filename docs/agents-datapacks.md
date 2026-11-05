# Adding and updating datapacks

For all agents. Player commands: [tfc app](tfc-app.md#датапаки-мира-и-сборки). Deployment mechanics and migration:
[pack-wide datapacks](plans/datapacks-pack.md). Recipe design still follows `recipe-dev` and the pack canon.

## Sources and destinations

| What                                     | Source of truth                                                              | Destination / action                                                                           |
| ---------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| New editable recipes, tags or JSON fixes | Site card in Firestore `datapacks`, via MCP `datapack_put`                   | World (`world/datapacks/`) or pack (`kubejs/data/`) through `tfc datapacks pull <id>`          |
| A draft file within a card               | `entries[].path = data/<namespace>/recipe/…json` (1.21.1: singular `recipe`) | Relative path **inside** the ZIP, not an OS path                                               |
| ZIP from a site card                     | Generated from that card (`installTarget = 'world' \| 'pack'`)               | `<selected world>/datapacks/tfc-plans-<id>.zip` or `<instance>/kubejs/data/tfc-plans-<id>.zip` |
| Legacy/local ZIP without a site card     | File on host PC; after `tfc publish`, world ZIP in snapshot                  | Original filename under `world/datapacks/` in snapshot; inspect with MCP inventory/pack_get    |
| Confirmed shared fix                     | Current server snapshot: ZIP bytes and `datapacks` metadata                  | `<instance>/kubejs/data/tfc-plans-<id>.zip`, managed by CLI                                    |

Do not add new editable fixes as loose `kubejs/data` files or hand-built ZIPs in `public/`, `.cache/` or the Git
worktree. KubeJS is the **delivery destination**, not the normal authoring source. `public/` contains generated
site data; it is not the source of a datapack. Existing scripts that generate a pack use the shared writer for
`--upload`; ordinary agent edits go through MCP, without one-off Firestore REST scripts.

Raw pack files that genuinely belong to a pack overlay still follow `tfc admin propose`; host approval is separate
from editing a site card. Do not modify a confirmed ZIP directly, even through an overlay: its pinned hash is
protected. A ZIP-only source is not a Firestore card; never pass its synthetic `zip…` id to `datapack_put`.

## Deployment levels

- Shared fixes can be confirmed for the whole pack as ZIP files in `kubejs/data/` (installed KubeJS loads them). Source of
  truth: the current pack-server snapshot's `datapacks` records, including content/archive hashes and source revision.
  Site `install` is a world-test opt-in, not confirmation or permission to replace the pinned pack version.
- Inspect `tfc datapacks list` / `files`; `pull` / `install all|<id/name/filename>` puts unconfirmed packs into the
  selected world and confirmed ZIPs directly into the instance, also without a selected world. Host
  `confirm all|<id/name/filename>` promotes matching world ZIPs after verification in game; `unconfirm` returns a pinned
  version to world scope for retesting. Use `--dry-run` to inspect first.
- An agent cannot verify in game. Do not declare a version tested or run live `confirm` on the host's behalf without their
  explicit confirmation that those versions were checked. Ship the tooling normally; record the game check separately.
  Changed/unknown world copies must be preserved, with backups for managed removals.
- Local `undo` does not revert the server's confirmation; server `admin rollback` reverts the entire snapshot. Published
  site/MCP deployment labels follow the snapshot's `kubejs.json`, so can lag a queued rebuild/publish. Details and
  migration — [plans/datapacks-pack.md](plans/datapacks-pack.md).

## Inspect before editing

1. `datapacks_list query=…` — editable cards and published deployment labels.
2. `datapacks_inventory query=…` — live snapshot: ids, filenames, world/pack placement and hashes. Source-card
   data has a five-minute server cache; `refresh=true` rereads it (Firestore reads on server).
3. `datapack_get id=…` — **current editable source** and `revision` for `datapack_put baseRevision`.
4. `datapack_pack_get id=… [path=…]` — exact ZIP/files in the live snapshot, including a pinned/legacy ZIP with
   no site card. This may differ from the draft. Snapshot ids and confirmed source revisions are not valid CAS
   revisions for editing a card.

Published `kubejs.json` can lag a queued build. Use live inventory/pack_get when the question is what the server
currently distributes. These tools read only; they do not confirm, remove, upload or edit anything.

## Create / update a card

- Set `TFC_AGENT_NICK` to your own agent name. `datapack_put` signs the author/update and preserves existing authors.
- New: `datapack_put name=… namespace=… description=… entries=[{path, content, kind}]`. `content` can be JSON text
  or an object; generated entry ids are managed by the tool. During drafting, use `install=false`; an explicit
  CLI pull by id also fetches test cards. The `install` flag + `installTarget` (`world` or `pack`) control whether
  `tfc pull` installs the card into `world/datapacks/` or directly into `kubejs/data/` (snapshot confirmation via
  `confirm` pins a hash separately in the snapshot).
- Existing: read `datapack_get` immediately before editing. Pass its `revision` as `baseRevision`. Prefer `upsert`
  for changed files, `remove` for paths, `rename=[{from,to}]` for renames. `entries` replaces the entire file list.
  Preserve unrelated entries and document deliberate replacements. On revision conflict, reread and reconcile.
- Preview with `dry_run=true`, inspect errors/warnings, then perform the authorized write. Invalid JSON, duplicate
  paths, `..`, empty segments and old `recipes/` paths are rejected. Item/tag references and KubeJS removals are
  warnings that must be checked; the tool does not execute the game or prove a recipe works.
- `recipe_conflicts` and a fresh `recipe_get`/`datapack_get` verify the static result. Do not label a parsed recipe
  as tested in game. Removing a whole card remains a site action, not an MCP delete.

## Deliver and report

Give the host the exact id plus readable name and a copyable command, not a request to search folders:

```text
tfc datapacks <id>
tfc datapacks pull <id> --dry-run
tfc datapacks pull <id>
```

`pull` and `install` are aliases. Names/filename also work; id avoids ambiguity. `tfc pull datapacks <id>` uses the
same route. A named pull refreshes source cards, so a just-created MCP draft is available immediately. It touches
only the named packs. A confirmed pack goes to the instance without requiring a selected world; an unconfirmed
one requires a selected world (`tfc init --world <world>`). `all` follows default world offers plus confirmed packs.

For a pinned card, writing a new draft **does not replace** the confirmed version. Explain this in the report.
The host uses `unconfirm <id>` to return it to world testing, pulls the draft, checks in game, and confirms it again.
After the host checks the chosen versions: `tfc datapacks confirm <id> --dry-run`, then `confirm <id> --yes` and
restart. An agent cannot verify in game or declare that the host has checked a version without their report.

Report the source id/name, files changed, static checks and warnings, exact pull command and installation level.
State «в игре не проверялось» and what the host must check. Actual pack-wide promotion is a separate host action;
editing the card, changing `install`, or shipping site code is not promotion. Local `undo` restores local files;
server `admin rollback` changes the whole snapshot. Neither is a Firestore draft-history operation.
