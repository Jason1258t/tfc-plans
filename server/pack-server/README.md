# Сервер сборки «TFC Studio»

Хранит сборку игры — моды, конфиги, скрипты KubeJS, ресурспаки, данные мира — и раздаёт её программе `tfc`
у хоста и игроков. Зачем и как всё устроено целиком — [docs/plans/pack-cli.md](../../docs/plans/pack-cli.md).
Сделано хранение (этап 2: снимки, файлы, ключи), сборка данных сайта с публикацией (этап 4) и раздача контента сайта
для `tfc pull` (раздел `/site`, этап 5).

- Без зависимостей: только Node.js 22+. Можно ставить на ту же машину, что и [сервер файлов](../file-server/README.md):
  другая служба (`tfc-pack`), другой порт (8788), свой блок в Caddy.
- **Снимок** — список файлов сборки на момент заливки: путь, контрольная сумма sha256, размер, вид файла.
  Сами файлы лежат один раз по содержимому: одинаковый jar в десяти версиях занимает место один раз.
- **Текущий снимок** — то, что ставят игроки. Откат — переключить текущий на прошлый, ничего не удаляется.
- **Ключи.** Сборка не публичная: моды раздаём только своим. У каждого свой ключ, роль `player` (качать)
  или `admin` (заливать, переключать, выдавать ключи). На сервере хранится только хеш ключа.

## Что нужно

- Сервер с Ubuntu 22.04 или 24.04 с открытыми портами 80 и 443 (или одним любым — см. ниже). Памяти хватит 512 МБ, места — от 5 ГБ:
  сборка ≈ 0,5 ГБ, каждое обновление добавляет только изменённые файлы (~50–100 МБ).
- Домен (поддомен), который указывает на IP сервера, например `pack.example.com`.

## Установка

На сервере:

```bash
git clone https://github.com/Jason1258t/tfc-plans.git
cd tfc-plans/server/pack-server
sudo bash deploy/install.sh pack.example.com
```

**Порты 80 и 443 заняты** (на машине уже есть прокси, VPN и т. п.). Тогда HTTPS — на своём порту, а сертификат
выдаётся через DNS-проверку DuckDNS, порт 80 не нужен. Поддомен на https://www.duckdns.org, его IP — адрес сервера,
токен DuckDNS — в файл на сервере (не в чат и не в git):

```bash
mkdir -p /etc/tfc-pack && (umask 077; read -rsp 'Токен DuckDNS: ' T; echo; printf %s "$T" > /etc/tfc-pack/duckdns.token)
sudo HTTPS_PORT=8443 DUCKDNS_TOKEN_FILE=/etc/tfc-pack/duckdns.token bash deploy/install.sh pack.duckdns.org
```

Адрес сервера станет `https://pack.duckdns.org:8443`; в файрволе открывается только этот порт. Caddy доставляется
с модулем DuckDNS; после обновления пакета `caddy` через apt запустите `install.sh` ещё раз — вернёт модуль.

Скрипт ставит Node.js 22 и Caddy, создаёт пользователя `tfcpack`, службу `tfc-pack` и файл настроек
`/etc/tfc-pack.env`. В конце печатает ответ `/health` и **первый ключ администратора** — сохраните его,
второй раз он не покажется. Проверка снаружи: `https://pack.example.com/health`.

Настройки — в `/etc/tfc-pack.env` (описание — [.env.example](.env.example)). После правки: `sudo systemctl restart tfc-pack`.

Обновление кода — `git pull` и тот же скрипт без домена: `sudo bash deploy/install.sh`. Настройки, сборку и ключи
он не трогает.

Логи: `journalctl -u tfc-pack -f`. Каждая заливка, снимок, переключение и выдача ключа — одна строка с именем ключа.

**Если рядом уже стоит сервер файлов**, установленный раньше: скрипт перенесёт его блок из `/etc/caddy/Caddyfile`
в `/etc/caddy/conf.d/tfc-files.caddy` (старый Caddyfile сохранится рядом как `Caddyfile.bak.<дата>`), дальше у каждой
службы свой файл в `conf.d/`.

## Ключи

Выдаёт хост — через API (позже командой `tfc admin invite <ник>`) или прямо на сервере:

```bash
cd /opt/tfc-pack
sudo -u tfcpack env DATA_DIR=/var/lib/tfc-pack node cli.mjs key add Вася              # ключ игрока
sudo -u tfcpack env DATA_DIR=/var/lib/tfc-pack node cli.mjs key add host2 --role admin
sudo -u tfcpack env DATA_DIR=/var/lib/tfc-pack node cli.mjs key list
sudo -u tfcpack env DATA_DIR=/var/lib/tfc-pack node cli.mjs key revoke <id>
```

Ключ показывается один раз. Потерял — выдайте новый и отзовите старый. Последний ключ администратора отозвать
нельзя: сначала выдайте другой. Перезапускать службу не нужно.

## Что можно класть в снимок

Пути — относительно папки версии (инстанса), через `/`. Всё из папки мира — под `world/`, без имени мира.

| Путь                                                                        | Вид (`kind`)     |
| --------------------------------------------------------------------------- | ---------------- |
| `mods/*.jar`                                                                | `mod`            |
| `config/…`, кроме `fancymenu`, `jmsharedmaps`, `CSC`, `voicechat`, `xaero*` | `config`         |
| `defaultconfigs/…`                                                          | `defaultconfig`  |
| `serverconfig/…`                                                            | `serverconfig`   |
| `kubejs/…`                                                                  | `kubejs`         |
| `resourcepacks/…`                                                           | `resourcepack`   |
| `world/data/tfc_calendar.dat`                                               | `world-data`     |
| `world/datapacks/…`                                                         | `world-datapack` |

**Никогда не принимаются** (снимок отклоняется целиком, со списком плохих путей): `server.properties`, `ops.json`,
`whitelist.json`, `banned-*.json`, `usercache.json`, `options.txt`, `servers.dat`, `level.dat`, папки `playerdata/`,
`stats/`, `region/`, `entities/`, `poi/`, `advancements/`, `logs/`, `crash-reports/`, скрытые файлы, `*.bak`,
пути с `..`. Логи не раздаются: в логе сервера — адреса игроков.

## Сборка данных сайта и публикация

Из снимка сервер сам собирает данные сайта (то, что `npm run pack` кладёт в `public/`: предметы, рецепты, иконки,
карта, разбор KubeJS) и выкладывает на сайт только изменённое.

- **Когда.** После смены текущего снимка (`POST /pack/current`, в том числе откат) и по `POST /admin/rebuild`.
  Очередь, один запуск за раз; каждое задание — отдельный процесс, ход и лог — `GET /jobs/:id`.
- **Как.** Снимок раскладывается в `work/<снимок>/` жёсткими ссылками на `blobs/` (место не занимает), запускается
  `scripts/pack.mjs` с выходом в `data/<снимок>/`; кеш распакованных jar — `cache/`. Код разборщиков — своя копия
  репозитория в `repo/` (клонируется при первой сборке; `"pull": true` в rebuild — подтянуть свежий `main`,
  `npm ci` — если поменялся `package-lock.json`). Сервер, запущенный из репозитория (`npm run dev`), берёт сам
  репозиторий и `git pull` не делает.
- **Публикация** (`scripts/publish-data.mjs`), по порядку: запись `packUpdates` (если поменялись моды, предметы
  или рецепты), документы `config` (новые и изменённые по sha1 файла), Hosting — копия текущей версии сайта без
  папок данных, файлы данных, загрузка только новых (хеш — sha256 от gzip, как у firebase CLI), выпуск релиза.
  Сайт, аддоны и ресурспаки остаются, как выложил разработчик. Нужен сервисный ключ (`GOOGLE_APPLICATION_CREDENTIALS`)
  с ролями Cloud Datastore User и Firebase Hosting Admin.
- **Пробный режим по умолчанию.** После смены снимка публикация только показывает, что изменится (`AUTO_PUBLISH=dry-run`).
  Выложить — `tfc admin publish --live` (то же, что `POST /admin/publish {"dryRun": false}`; только текущий снимок)
  или `AUTO_PUBLISH=live` (тогда сборка нового снимка сначала подтягивает свежий код разборщиков). Ход и итог
  заданий — `tfc admin jobs`.
- **Защита публикации.** Сборка без объёмных иконок (старый код, нет jar для генератора) не убирает их с сайта;
  больше 300 удалений за раз — только с `--allow-removals`. Объёмные иконки рисуются на сервере (чистый Node);
  ресурсы Minecraft и NeoForge для них сборка качает сама в `<DATA>/cache/platform/`.
- **Память.** Сборка модов без лимита берёт до ~1,2 ГБ, с `BUILD_HEAP_MB=640` — около 0,9 ГБ (меньше ~400 —
  не хватает). Если процесс убит (OOM), в задании так и написано; тогда — своп или машина с памятью побольше.

Файлы мира, которых нет в снимке (например, отдельный слой скриптов KubeJS сервера), сервер не видит: в данных
сайта будет только то, что залито. Скрипты, которые выполняет сервер Minecraft, должны лежать в `kubejs/` снимка.

Данные собранного снимка раздаются по ключу игрока (`GET /data`) — так их берёт сборка сайта без jar
(`TFC_PACK_URL` и `TFC_PACK_TOKEN` в `.env.local`) и `npm run pack:fetch`.

## Контент сайта для `tfc pull`

Сайт закрыт App Check, поэтому датапаки, скрипты KubeJS и схемы программа берёт здесь (`/site/…`, ключ игрока),
а сервер читает Firestore REST сервисным ключом (`GOOGLE_APPLICATION_CREDENTIALS`, нужна роль Cloud Datastore User;
без ключа — от имени `firebase login`, это для разработки). Доступ — `scripts/firestore-rest.mjs` из копии
репозитория `repo/` (она появляется после первой сборки; до этого `/site` отвечает 503).

- Только чтение. Бюджет бесплатного Firestore — 50 тыс. чтений в сутки на всех, поэтому списки кешируются
  на `SITE_CACHE_SEC` (по умолчанию 300 с): один `tfc pull all` — около 20 чтений (по одному на документ), повтор
  в течение 5 минут — ни одного. Схемы — без поля превью (маска полей).
- Исходники схем (`files/{id}` + `chunks/` пакета firestore-files) кешируются на диске в `site-files/` навсегда:
  файл с данным id не меняется. Отдаются только файлы, на которые ссылается запись `schematics`; хеш сверяется.
- Датапак в zip и схему с заменами собирает сама программа (общие модули сайта), сервер отдаёт записи как есть.

## Бэкап и переезд

Всё состояние — папка `/var/lib/tfc-pack` (`blobs/`, `snapshots/`, `channels.json`, `keys.json`; `data/`, `jobs/`,
`cache/`, `repo/`, `site-files/` — пересобираются, в бэкап не обязательны). Бэкап — её копия
(`rsync -a`). Переезд: поставить по инструкции выше, скопировать папку, `sudo systemctl restart tfc-pack`.
Ключи переезжают вместе с ней.

## API

Вход — `Authorization: Bearer <ключ>`. Ответы — JSON, ошибка — `{ error, ... }`.

| Запрос                            | Кто    | Что делает                                                                                                                                                                                                                                             |
| --------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /health`                     | все    | жив ли, текущий снимок, сколько снимков и файлов                                                                                                                                                                                                       |
| `GET /pack/current`               | player | текущий снимок целиком (404 — ещё нет)                                                                                                                                                                                                                 |
| `GET /pack/snapshots`             | player | `{ current, snapshots: [сводки, новые сверху] }`                                                                                                                                                                                                       |
| `GET /pack/snapshots/:id`         | player | снимок целиком                                                                                                                                                                                                                                         |
| `GET /blobs/:sha256`              | player | файл; `Range` — докачка оборванного                                                                                                                                                                                                                    |
| `POST /blobs/pack`                | player | `{ sha256: [...] }` (до 5000 файлов по 4 МБ, всего до 64 МБ) → gzip из записей «sha256 (64) + размер (12 цифр) + содержимое»: мелкие файлы одним запросом                                                                                              |
| `POST /blobs/missing`             | admin  | `{ sha256: [...] }` → `{ missing: [...] }` — что заливать                                                                                                                                                                                              |
| `PUT /blobs/:sha256`              | admin  | залить файл (тело — содержимое); хеш не сошёлся — 409, уже есть — 200 `existed`                                                                                                                                                                        |
| `POST /pack/snapshots`            | admin  | `{ note, mc, loader, files: [{ path, sha256, size?, kind? }] }` → сводка; 400 `problems` — плохие пути, 409 `missing` — не залиты файлы                                                                                                                |
| `POST /pack/current`              | admin  | `{ id }` — сделать текущим; `{ rollback: true }` — на прошлый текущий                                                                                                                                                                                  |
| `GET /admin/keys`                 | admin  | ключи (имя, роль, кто выдал — без самих ключей)                                                                                                                                                                                                        |
| `POST /admin/keys`                | admin  | `{ name, role }` → `{ id, key, ... }`                                                                                                                                                                                                                  |
| `DELETE /admin/keys/:id`          | admin  | отозвать                                                                                                                                                                                                                                               |
| `POST /admin/rebuild`             | admin  | `{ snapshot?, parts?: [mods, kubejs, config, world], pull?, publish?: none \| dry-run \| live }` → 202 задание; без `snapshot` — текущий                                                                                                               |
| `POST /admin/publish`             | admin  | `{ snapshot?, dryRun?, allowRemovals? }` → 202 задание; по умолчанию пробно, `dryRun: false` — выложить (только текущий снимок); `allowRemovals` — разрешить убрать с сайта больше 300 файлов                                                          |
| `GET /jobs`                       | admin  | `{ running, queued, jobs }` — последние 100 заданий                                                                                                                                                                                                    |
| `GET /jobs/:id?from=N`            | admin  | задание: `state` (queued, running, done, failed), `error`, `result` (сборка, отчёт публикации, пик памяти), `log` с байта N, `logSize`                                                                                                                 |
| `GET /data[?snapshot=]`           | player | собранные данные снимка (по умолчанию текущего): `{ snapshot, build, files: [{ path, sha256, size }] }`; 404 — ещё не собраны                                                                                                                          |
| `GET /data/:snapshot/<путь>`      | player | файл собранных данных                                                                                                                                                                                                                                  |
| `GET /site/datapacks?name=…`      | player | `{ items, unknown, all }`: датапаки с `install` (с `name` — названные по имени или id, любые); `all` — имена всех, `unknown` — не найденные                                                                                                            |
| `GET /site/kubejs?name=…`         | player | то же для `kubejsScripts` (имя — `fileName`)                                                                                                                                                                                                           |
| `GET /site/schematics`            | player | `{ items }` — записи библиотеки схем без превью                                                                                                                                                                                                        |
| `GET /site/files/:id`             | player | исходник схемы (байты из хранилища сайта); только файлы схем                                                                                                                                                                                           |
| `POST /site/reports`              | player | отчёт `tfc report`: тело — байты (до 25 МБ), заголовок `X-Report` — `encodeURIComponent(JSON)` `{ name, kind: crash\|log, type, label, note, files, taskId }` → `files/{id}` в хранилище сайта (автор — имя ключа); ответ `{ id, name, size, chunks }` |
| `GET /admin/updates`              | admin  | `{ updates }` — предложенные обновления сборки (новые сверху): `{ id, author, note, base, files, remove, status, snapshot? }`                                                                                                                          |
| `POST /admin/updates`             | admin  | `{ note, files: [{ path, sha256, size? }], remove: [path] }` — предложить; файлы заливаются заранее (`PUT /blobs`), 409 `missing` — не залиты                                                                                                          |
| `GET /admin/updates/:id`          | admin  | одно обновление                                                                                                                                                                                                                                        |
| `POST /admin/updates/:id/approve` | admin  | `{ force? }` — снимок = текущий + файлы − remove, сразу текущий (как `POST /pack/current`, с заданием сборки); автор одобрить не может (403); пути поменяли после предложения — 409 `conflicts`                                                        |
| `POST /admin/updates/:id/reject`  | admin  | `{ reason? }` — отклонить                                                                                                                                                                                                                              |
| `GET /admin/changes`              | admin  | правки конфигов от агента (Firestore `configChanges`, без кеша) — для `tfc admin changes`                                                                                                                                                              |
| `POST /admin/changes/:id`         | admin  | `{ status: applied\|rejected, results, updateTime }` — итог хоста; запись только если правку не меняли после чтения (иначе 409)                                                                                                                        |

`POST /pack/current` отвечает ещё и `job` — id задания сборки (или публикации, если снимок уже собран).

Снимок: `{ id, createdAt, author, note, mc, loader, parent, files: [{ path, sha256, size, kind }] }`; `parent` — какой
снимок был текущим, когда создавали этот (по нему программа покажет, что сборку за это время меняли).

Заливка: сначала `/blobs/missing`, потом `PUT` только недостающих. При отказе до приёма файла (нет ключа, больше
лимита по `Content-Length`) сервер закрывает соединение, не дочитывая тело.

## На своей машине

```bash
cd server/pack-server
npm run key -- add host --role admin   # ключ в ./data/keys.json
npm run dev                            # http://127.0.0.1:8788, данные — ./data
```

Сборку данных локальный сервер запускает из этого же репозитория; пробная публикация читает Firebase от имени
`firebase login`.

## Публикация схем из CLI

`POST /site/schematics` принимает исходные байты `.nbt` (до 10 МБ) и `X-Schematic` —
`encodeURIComponent(JSON.stringify({ name, fileName, author?, sourceOwner?, id?, revision?, asSource? }))`.
Нужен ключ игрока; копии других игроков и указание другого автора — ключ хоста. Без `id` создаётся запись,
с `id` обновляется исходник автора/загрузчика или хоста. `revision` — Firestore `updateTime` из
`GET /site/schematics`. Конфликт возвращает 409. Авторство и настройки существующей записи сохраняются.

Сервер проверяет NBT (до 32 МБ после распаковки, ограничение глубины и числа тегов), дубликаты исходников
и совпадения с обработанной копией. Запись файла становится полной одновременно со сменой карточки,
с условием на ревизию; сбой до этого убирает загруженные части. Прежний исходник при обновлении остаётся
в хранилище, чтобы не оборвать начатые загрузки. Списки кешируются, публикации обрабатываются последовательно
и перечитывают библиотеку; Firestore-права браузера этим API не меняются.
