# Сервер сборки «TFC Планы»

Хранит сборку игры — моды, конфиги, скрипты KubeJS, ресурспаки, данные мира — и раздаёт её программе `tfc`
у хоста и игроков. Зачем и как всё устроено целиком — [docs/plans/pack-cli.md](../../docs/plans/pack-cli.md).
Сейчас сделано хранение (этап 2): снимки, файлы, ключи. Сборка данных сайта на сервере и раздел `/site` — следующие этапы.

- Без зависимостей: только Node.js 22+. Можно ставить на ту же машину, что и [сервер файлов](../file-server/README.md):
  другая служба (`tfc-pack`), другой порт (8788), свой блок в Caddy.
- **Снимок** — список файлов сборки на момент заливки: путь, контрольная сумма sha256, размер, вид файла.
  Сами файлы лежат один раз по содержимому: одинаковый jar в десяти версиях занимает место один раз.
- **Текущий снимок** — то, что ставят игроки. Откат — переключить текущий на прошлый, ничего не удаляется.
- **Ключи.** Сборка не публичная: моды раздаём только своим. У каждого свой ключ, роль `player` (качать)
  или `admin` (заливать, переключать, выдавать ключи). На сервере хранится только хеш ключа.

## Что нужно

- Сервер с Ubuntu 22.04 или 24.04 с открытыми портами 80 и 443. Памяти хватит 512 МБ, места — от 5 ГБ:
  сборка ≈ 0,5 ГБ, каждое обновление добавляет только изменённые файлы (~50–100 МБ).
- Домен (поддомен), который указывает на IP сервера, например `pack.example.com`.

## Установка

На сервере:

```bash
git clone https://github.com/Jason1258t/tfc-plans.git
cd tfc-plans/server/pack-server
sudo bash deploy/install.sh pack.example.com
```

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

## Бэкап и переезд

Всё состояние — папка `/var/lib/tfc-pack` (`blobs/`, `snapshots/`, `channels.json`, `keys.json`). Бэкап — её копия
(`rsync -a`). Переезд: поставить по инструкции выше, скопировать папку, `sudo systemctl restart tfc-pack`.
Ключи переезжают вместе с ней.

## API

Вход — `Authorization: Bearer <ключ>`. Ответы — JSON, ошибка — `{ error, ... }`.

| Запрос                    | Кто    | Что делает                                                                                                                              |
| ------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`             | все    | жив ли, текущий снимок, сколько снимков и файлов                                                                                        |
| `GET /pack/current`       | player | текущий снимок целиком (404 — ещё нет)                                                                                                  |
| `GET /pack/snapshots`     | player | `{ current, snapshots: [сводки, новые сверху] }`                                                                                        |
| `GET /pack/snapshots/:id` | player | снимок целиком                                                                                                                          |
| `GET /blobs/:sha256`      | player | файл; `Range` — докачка оборванного                                                                                                     |
| `POST /blobs/missing`     | admin  | `{ sha256: [...] }` → `{ missing: [...] }` — что заливать                                                                               |
| `PUT /blobs/:sha256`      | admin  | залить файл (тело — содержимое); хеш не сошёлся — 409, уже есть — 200 `existed`                                                         |
| `POST /pack/snapshots`    | admin  | `{ note, mc, loader, files: [{ path, sha256, size?, kind? }] }` → сводка; 400 `problems` — плохие пути, 409 `missing` — не залиты файлы |
| `POST /pack/current`      | admin  | `{ id }` — сделать текущим; `{ rollback: true }` — на прошлый текущий                                                                   |
| `GET /admin/keys`         | admin  | ключи (имя, роль, кто выдал — без самих ключей)                                                                                         |
| `POST /admin/keys`        | admin  | `{ name, role }` → `{ id, key, ... }`                                                                                                   |
| `DELETE /admin/keys/:id`  | admin  | отозвать                                                                                                                                |

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
