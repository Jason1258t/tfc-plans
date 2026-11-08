#!/usr/bin/env bash
# Исполнитель очереди стенда (dev #310) на test1a: задания агентов, в простое — проверка печати схем (dev #305).
# Cron раз в минуту держит одного живого (flock), поэтому без systemd и linger:
#   * * * * * $HOME/tfc-stand/print-worker/repo/scripts/stand-queue.sh >> $HOME/tfc-stand/queue/serve.log 2>&1
# Код — клон main (git pull перед запуском; исполнитель сам выходит, когда в origin/main новый код), ключ —
# ~/tfc-stand/print-worker/env (TFC_PACK_URL, TFC_PACK_TOKEN — ключ роли worker). Установка — docs/state/infra.md.
set -euo pipefail
base="$HOME/tfc-stand/print-worker"
mkdir -p "$HOME/tfc-stand/queue"
exec 9>"$HOME/tfc-stand/queue/lock"
flock -n 9 || exit 0
export JAVA_HOME="$HOME/.local/opt/tfc-stand/java"
export PATH="$HOME/.local/opt/tfc-stand/node/bin:$JAVA_HOME/bin:$PATH"
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
exec node scripts/stand-queue.mjs serve
