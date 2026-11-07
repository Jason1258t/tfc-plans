#!/usr/bin/env bash
# Фоновая проверка печати схем (dev #305) на test1a, из cron раз в 10 минут:
#   */10 * * * * ~/tfc-stand/print-worker/repo/scripts/print-worker.sh >> ~/tfc-stand/print-worker/worker.log 2>&1
# Один запуск за раз (flock), код — клон main (git pull), ключ — ~/tfc-stand/print-worker/env
# (TFC_PACK_URL, TFC_PACK_TOKEN — ключ администратора). Установка — docs/state/infra.md «Print check worker».
set -euo pipefail
base="$HOME/tfc-stand/print-worker"
exec 9>"$base/lock"
flock -n 9 || exit 0
export JAVA_HOME="$HOME/.local/opt/tfc-stand/java"
export PATH="$HOME/.local/opt/tfc-stand/node/bin:$PATH"
set -a
# shellcheck disable=SC1091
. "$base/env"
set +a
cd "$base/repo"
before=$(git rev-parse HEAD)
git pull -q --ff-only || echo "git pull не прошёл — работаю на $before"
if [ "$before" != "$(git rev-parse HEAD)" ] && ! git diff --quiet "$before" HEAD -- package-lock.json; then
  npm ci --ignore-scripts --no-audit --no-fund
fi
node scripts/print-worker.mjs
