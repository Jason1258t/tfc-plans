#!/usr/bin/env bash
# Проверка аддона на сервере разработки (NeoForge + Create, Create Diesel Generators, Electro Energetics из libs/,
# плоский мир, RCON 25596). Без аргументов — сценарий из README («Что проверено»); с аргументами — эти команды.
# KEEP=1 — не стирать мир; NO_EE=1 — без Electro Energetics (аддон должен грузиться и без него).
set -euo pipefail
cd "$(dirname "$0")"
export JAVA_HOME="${JAVA_HOME:-$HOME/.gradle/local-tools/jdk21/Contents/Home}"
[ -d libs ] || ./libs.sh
if [ -z "${KEEP:-}" ]; then rm -rf run; fi
mkdir -p run/mods
rm -f run/mods/*.jar
cp libs/create-1.21.1-*.jar libs/createdieselgenerators-*.jar run/mods/
if [ -z "${NO_EE:-}" ]; then cp libs/electroenergetics-*.jar run/mods/; fi
echo 'eula=true' > run/eula.txt
cat > run/server.properties <<'P'
level-type=minecraft\:flat
online-mode=false
spawn-protection=0
generate-structures=false
enable-rcon=true
rcon.port=25596
rcon.password=check
server-port=25572
P
if [ $# -eq 0 ]; then
  set -- 'sdtest engines' 'sleep 3' 'sdtest mark' 'sleep 30' 'sdtest report' 'sleep 40' 'sdtest report' \
    'sdtest generator 4' 'sleep 3' 'sdtest mark' 'sleep 30' 'sdtest report' \
    'sdtest heaters 4' 'sleep 3' 'sdtest mark' 'sleep 30' 'sdtest report' 'sdtest water'
fi
./gradlew runServer --console=plain > run/check.log 2>&1 &
GRADLE=$!
SERVER_PID=$GRADLE python3 rcon.py 25596 check 'forceload add -16 -16 48 48' "$@" 'stop' || true
wait $GRADLE || true
grep -E "ERROR|Exception|Caused by|small_diesel" run/check.log | grep -v "^\s*at " | head -30 || true
