#!/usr/bin/env bash
# Проверка аддона на сервере разработки (NeoForge + TFC, Patchouli, IE из libs/, плоский мир, RCON 25604).
# Без аргументов — сценарий из README («Что проверено»); с аргументами — эти команды. KEEP=1 — не стирать мир.
set -euo pipefail
cd "$(dirname "$0")"
export JAVA_HOME="${JAVA_HOME:-$HOME/.gradle/local-tools/jdk21/Contents/Home}"
[ -d libs ] || ./libs.sh
if lsof -iTCP:25604 -sTCP:LISTEN >/dev/null 2>&1; then
  echo 'Порт проверки занят: сначала остановите предыдущий сервер.' >&2
  exit 1
fi
if [ -z "${KEEP:-}" ]; then rm -rf run; fi
mkdir -p run/mods
rm -f run/mods/*.jar
cp libs/*.jar run/mods/
echo 'eula=true' > run/eula.txt
cat > run/server.properties <<'P'
level-type=minecraft\:flat
online-mode=false
spawn-protection=0
generate-structures=false
enable-rcon=true
rcon.port=25604
rcon.password=check
server-port=25605
P
if [ $# -eq 0 ]; then
  set -- 'pyrotest setup' 'sleep 4' 'pyrotest report' 'pyrotest empty' 'sleep 2' 'pyrotest stopped'
fi
./gradlew runServer --console=plain > run/check.log 2>&1 &
GRADLE=$!
SERVER_PID=$GRADLE python3 rcon.py 25604 check 'forceload add -16 -16 16 16' "$@" 'stop' | tee run/results.txt
wait $GRADLE
grep -E "PYROTEST|ERROR|Exception|Caused by" run/check.log | head -40 || true

if grep -E 'PYROTEST FAIL|unexpected error|No value present' run/results.txt; then exit 1; fi
