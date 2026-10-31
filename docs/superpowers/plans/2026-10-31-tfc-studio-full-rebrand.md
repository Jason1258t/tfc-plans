# Полный ребрендинг TFC Studio — план реализации

> **Для исполнителя:** выполнять задачи последовательно, в worktree `tfc-studio-full-rebrand`; субагентов не использовать.

**Цель:** заменить действующее публичное название «TFC Планы» / «TFC Plans» на «TFC Studio» в основном репозитории и исходниках аддонов, не меняя технические идентификаторы.

**Границы:** сохранить `tfc-plans`, имена npm-пакетов, Firebase project, URL и названия репозиториев. Не переписывать исторические документы `docs/superpowers/specs/` и `docs/superpowers/plans/`. Не выпускать новые версии и jar аддонов.

---

## Задача 1: Основной репозиторий

**Файлы:**

- `AGENTS.md`, `README.md`
- `packages/core/package.json`, `cli/package.json`, `scripts/package.json`
- `cli/tfc.mjs`
- `scripts/smooth-stone-datapack.mjs`, `scripts/pellet-arc-datapack.mjs`, `scripts/tfc-dist.mjs`
- `scripts/mcp/tools.mjs`, `scripts/mcp-dev/tools.mjs`
- `server/pack-server/server.mjs`, `server/pack-server/package.json`, `server/pack-server/README.md`
- `server/pack-server/deploy/tfc-pack.service`, `server/pack-server/deploy/Caddyfile`
- `server/common/caddy-site.sh`
- `server/file-server/server.mjs`, `server/file-server/package.json`, `server/file-server/README.md`
- `server/file-server/deploy/tfc-files.service`
- `docs/state/site.md`

- [x] Прочитать каждый файл перед правкой и заменить действующие упоминания старого бренда на `TFC Studio`; в примере Firebase использовать `TFC Studio Web`.
- [x] Сохранить все технические идентификаторы, команды и URL без изменений.
- [x] Дополнить существующий раздел `TFC Studio branding` в `docs/state/site.md` записью о полном текстовом ребрендинге.
- [x] Проверить `git diff -- AGENTS.md README.md packages cli scripts server docs/state/site.md` и отсутствие непредусмотренных правок.

## Задача 2: Исходники аддонов

**Файлы:**

- `tools/AGENTS.md`, `tools/README.md`
- `tools/builder-tools-mod/src/main/resources/META-INF/neoforge.mods.toml`
- `tools/pyrofuel-mod/src/main/resources/META-INF/neoforge.mods.toml`
- `tools/create-aeronautics-extra-mod/src/main/java/aero/extra/AeroExtra.java`
- `tools/create-aeronautics-extra-mod/src/main/resources/META-INF/neoforge.mods.toml`
- `tools/create-aeronautics-extra-mod/README.md`
- `tools/miner-tools-mod/src/main/java/miner/tools/MinerTools.java`
- `tools/miner-tools-mod/src/main/resources/META-INF/neoforge.mods.toml`
- `tools/ee-extras-mod/src/main/java/ee/extras/EeExtras.java`
- `tools/ee-extras-mod/src/main/resources/META-INF/neoforge.mods.toml`
- `tools/ie-extras-mod/src/main/java/ie/extras/IeExtras.java`
- `tools/ie-extras-mod/src/main/resources/META-INF/neoforge.mods.toml`
- `tools/ie-extras-mod/README.md`
- `tools/small-diesel-mod/src/main/java/small/diesel/SmallDiesel.java`
- `tools/small-diesel-mod/src/main/resources/META-INF/neoforge.mods.toml`

- [x] Создать ветку в отдельном репозитории: `git -C tools switch -c feat/tfc-studio-full-rebrand origin/main`.
- [x] Прочитать каждый файл перед правкой и заменить старый бренд в описаниях, комментариях и `authors`.
- [x] Проверить `git -C tools diff --check` и `git -C tools diff`.
- [x] Закоммитить: `Аддоны: фирменное название TFC Studio`.
- [x] Отправить в основной репозиторий аддонов: `git -C tools push origin HEAD:main`.
- [x] Убедиться, что коммит доступен в `origin/main`; не собирать и не публиковать новые jar.

## Задача 3: Проверки и публикация

**Файлы:**

- изменённые файлы задач 1 и 2
- `docs/superpowers/plans/2026-10-31-tfc-studio-full-rebrand.md`

- [x] Повторно найти `TFC Планы|TFC Plans|TFC планы|TFC plans`; оставить только осознанные исторические упоминания в архивных планах и спецификациях.
- [x] Отформатировать изменённые поддерживаемые файлы через Prettier, не применяя его ко всему `src`.
- [x] Выполнить `npm run lint`, `npx tsc -b`, `npm run boundaries`, `npm run ui:boundaries`, `npm run tfc:dist`.
- [x] Выполнить `git diff --check`, проверить чистоту `tools/` после коммита и наличие нового указателя submodule в основном diff.
- [x] Отметить выполненные пункты плана `[x]` и закоммитить основной репозиторий на русском.
- [ ] Выполнить `ship` без повторного деплоя сайта: runtime-файлы сайта в этой задаче не меняются.
- [ ] Закрыть dev-задачу #177 русским отчётом: что изменено, что проверено, что jar аддонов не выпускались.
