# cli/ — the `tfc` app (`@tfc/cli`)

Human docs — [cli/README.md](README.md), [docs/tfc-app.md](../docs/tfc-app.md); plan — `docs/plans/pack-cli.md`.

- Players run it as one file: `npm run tfc:dist` (`scripts/tfc-dist.mjs`) bundles `tfc.mjs` with esbuild and checks
  that only `cli/`, `@tfc/pack-server` helpers, the listed `@tfc/core` modules and `fflate` got in. A new import from
  core or pack-server — add it to that allowlist and to `buildVersion` there.
- Other packages — `@tfc/core/<module>`, `@tfc/pack-server/<module>` (declared in `package.json`); never
  `../server/…` or `../scripts/…`. `tfc build` loads `@tfc/scripts/pack` by a path in a variable on purpose: builders
  must not get into the players' file.
- Config and agent key — `lib/config.mjs` (`~/.config/tfc/config.json`, `%APPDATA%\tfc\config.json`); scripts take it
  as `@tfc/cli/config`.
- Output and messages are Russian; the app runs on Windows, macOS and Linux — paths via `node:path`, no shell.
