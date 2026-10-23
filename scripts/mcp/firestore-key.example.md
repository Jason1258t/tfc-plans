# Ключ Firestore для MCP

MCP-сервер `tfc-pack` читает и пишет Firestore (задачи, гайды, конфиги). Без ключа он ходит от имени `firebase login`,
и его токен может отозвать firebase CLI из другой сессии (деплой, `firebase login --reauth`) — тогда инструменты
сайта падают с `401 UNAUTHENTICATED`. Отдельный сервисный аккаунт этого не боится.

## Как завести

1. Google Cloud Console → проект `tfc-plans-fd2c` → IAM & Admin → Service Accounts → Create service account,
   например `tfc-mcp`.
   Проверьте проект в шапке консоли: адрес аккаунта должен кончаться на `@tfc-plans-fd2c.iam.gserviceaccount.com`.
   Аккаунт из другого проекта тоже подойдёт, но роль ему надо выдать в `tfc-plans-fd2c`: IAM → Grant access →
   его адрес → роль ниже. Иначе Firestore отвечает `403 PERMISSION_DENIED`.
2. Роль — **Cloud Datastore User** (чтение и запись документов Firestore). Больше не нужно: не давайте Owner/Editor.
3. Аккаунт → Keys → Add key → JSON. Скачанный файл положите вне репозитория:

   ```bash
   mkdir -p ~/.config/tfc && chmod 700 ~/.config/tfc
   mv ~/Downloads/tfc-plans-fd2c-*.json ~/.config/tfc/mcp-firestore.json
   chmod 600 ~/.config/tfc/mcp-firestore.json
   ```

4. Перезапустите MCP (новая сессия или `/mcp`). Путь по умолчанию уже прописан в `.mcp.json`:

   ```json
   "env": { "TFC_FIRESTORE_KEY": "${TFC_FIRESTORE_KEY:-~/.config/tfc/mcp-firestore.json}" }
   ```

   Другой путь — задайте `TFC_FIRESTORE_KEY` в окружении, из которого запускается Claude Code.

## Как это работает

- Ключ берёт только MCP-сервер (`scripts/mcp/firestore.mjs` переносит путь в `GOOGLE_APPLICATION_CREDENTIALS` своего
  процесса). Не задавайте `GOOGLE_APPLICATION_CREDENTIALS` глобально: её подхватит firebase CLI, и деплои пойдут от
  имени аккаунта без прав на Hosting.
- Файла нет — MCP пишет в журнал «ключа … нет» и работает через `firebase login`, как раньше.
- Сервисный аккаунт обходит правила Firestore (как и `firebase login`), поэтому ключ — секрет: не коммитьте его, не
  кладите в репозиторий и в `public/`. Утёк — удалите ключ в консоли (Keys → Delete) и создайте новый.
