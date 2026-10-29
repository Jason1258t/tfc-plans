# server/ — file server and pack server

Human docs — [docs/pack-server.md](../docs/pack-server.md); state — [docs/state/infra.md](../docs/state/infra.md).

- Node without dependencies on purpose (runs on a 1-core / 2 GB VPS) — don't add packages. Both are workspace packages
  (`@tfc/pack-server`, `@tfc/file-server`) but are installed on the VPS by copying the folder (`deploy/install.sh`),
  without npm: their own code may import only their own folder. Helpers others use (`lib/paths`, `lib/datapacks`,
  `lib/schematic-nbt`) are public as `@tfc/pack-server/<module>` — keep them dependency-free and backward compatible.
- VPS `ssh tfc` (root) hosts **foreign services — don't touch**: Telegram proxy (Docker, 443), Xray (6080, 6443, 6444,
  8080; 8443 reserved), a bot, raven-subscribe (47291), ufw rule on 6000. Before opening a port: `ss -tulnp`,
  `ufw status`, root command history.
- Pack server: code `/opt/tfc-plans`, service `tfc-pack` (127.0.0.1:8788, Caddy on 28788), data `/var/lib/tfc-pack`,
  settings `/etc/tfc-pack.env`. Publishing is dry-run by default.
