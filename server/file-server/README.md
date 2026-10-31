# Сервер файлов «TFC Studio»

Хранит вложения сайта (картинки задач, датапаки, исходники схем) на обычном Ubuntu-сервере вместо Firestore.
Сайт работает с ним через тот же интерфейс, что и с Firestore (`src/lib/fileStorage`), поэтому игроки разницы
не заметят. Переключение — адрес сервера в сборке сайта (`VITE_FILES_SERVER`), переезд файлов — `scripts/files-migrate.mjs`.

- Без зависимостей: только Node.js 22+. Файлы лежат на диске (`/var/lib/tfc-files/files/<id>.bin` + `<id>.json`).
- Пускает только сайт: проверяет токен анонимного входа Firebase и токен App Check — так же, как правила Firestore.
  Проверяются и ник автора (2–24 символа), и лимит 25 МБ на файл.
- Список файлов обновляется у всех сразу (поток событий SSE), как сейчас с Firestore.
- HTTPS делает Caddy: сам получает и продлевает сертификат. Сайт открыт по HTTPS, поэтому без него браузер
  не пустит запросы.

## Что нужно

- Сервер с Ubuntu 22.04 или 24.04 (хватит самого маленького: 1 ядро, 512 МБ памяти) с открытыми портами 80 и 443.
- Домен, который указывает на IP сервера (запись A), например `files.example.com`. Нет своего домена — подойдёт
  бесплатный поддомен (DuckDNS и т. п.).

## Установка

На сервере:

```bash
git clone https://github.com/Jason1258t/tfc-plans.git
cd tfc-plans/server/file-server
sudo bash deploy/install.sh files.example.com
```

Скрипт ставит Node.js 22 и Caddy, создаёт пользователя `tfcfiles`, службу `tfc-files` (systemd) и файл настроек
`/etc/tfc-files.env` с новым ключом администратора. В конце печатает ответ `/health`. Проверка снаружи:
`https://files.example.com/health`.

Настройки — в `/etc/tfc-files.env` (описание — [.env.example](.env.example)). После правки: `sudo systemctl restart tfc-files`.
Если сайт открывают ещё с какого-то адреса, допишите его в `ALLOWED_ORIGINS`.

Обновление кода — `git pull` и тот же скрипт без домена: `sudo bash deploy/install.sh`. Настройки и файлы он не трогает.

Логи: `journalctl -u tfc-files -f`. Каждая загрузка и удаление — одна строка с ником.

## Переезд с Firestore на сервер

На своём компьютере, в папке проекта (нужен `firebase login`):

```bash
# ключ — строка ADMIN_TOKEN из /etc/tfc-files.env на сервере
export FILES_ADMIN_TOKEN=...
node scripts/files-migrate.mjs --from firestore --to https://files.example.com --dry-run
node scripts/files-migrate.mjs --from firestore --to https://files.example.com
```

Потом в `.env.local` пропишите `VITE_FILES_SERVER=https://files.example.com` и задеплойте сайт. Сразу после деплоя
запустите перенос ещё раз: он докопирует файлы, которые успели загрузить в Firestore, пока сайт переключался
(уже перенесённые пропускаются). Из Firestore файлы не удаляются. Когда всё работает, их можно убрать тем же
скриптом с `--delete-source`.

Каждый файл сверяется по контрольной сумме до и после записи. id, имя, дата, автор и задача сохраняются, поэтому
ссылки из задач, схем и датапаков не ломаются.

## Переезд на другой сервер и бэкап

- Бэкап — копия папки `/var/lib/tfc-files`, например `rsync -a`. Можно и скриптом на свой компьютер:
  `node scripts/files-migrate.mjs --from https://files.example.com --to dir:./files-backup`.
- Новый сервер: установить по инструкции выше, затем
  `FILES_FROM_TOKEN=<ключ старого> FILES_TO_TOKEN=<ключ нового> node scripts/files-migrate.mjs --from https://старый --to https://новый`.
  Или скопировать `/var/lib/tfc-files` через rsync и перезапустить службу.
- Обратно в Firestore: `--from https://files.example.com --to firestore`, затем убрать `VITE_FILES_SERVER` и задеплоить.

## API

| Запрос                   | Что делает                                                                  |
| ------------------------ | --------------------------------------------------------------------------- |
| `GET /health`            | жив ли сервер, сколько файлов (без входа)                                   |
| `GET /files`             | список записей                                                              |
| `GET /files/events`      | SSE: `snapshot` (весь список), `put` (файл добавлен), `delete` (`{id}`)     |
| `GET /files/:id`         | запись                                                                      |
| `GET /files/:id/content` | содержимое                                                                  |
| `POST /files`            | загрузка: тело — файл; `X-File-Name`, `X-File-Meta` (JSON), `X-File-Sha256` |
| `PUT /files/:id`         | импорт с заданным id и `X-File-Created-At`, только с `X-Admin-Token`        |
| `DELETE /files/:id`      | удаление                                                                    |

Вход: `Authorization: Bearer <ID-токен Firebase>` и `X-Firebase-AppCheck: <токен>`, либо `X-Admin-Token`.
Опыты на своей машине без Firebase: `npm run dev` (без проверки входа, порт 8787, папка `./data`).
