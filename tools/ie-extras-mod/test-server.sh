#!/usr/bin/env bash
# Проверка аддона на сервере разработки (NeoForge + TFC, Patchouli, IE из libs/, плоский мир, RCON 25597).
# Без аргументов — сценарий из README («Что проверено»); с аргументами — эти команды. KEEP=1 — не стирать мир.
set -euo pipefail
cd "$(dirname "$0")"
export JAVA_HOME="${JAVA_HOME:-$HOME/.gradle/local-tools/jdk21/Contents/Home}"
[ -d libs ] || ./libs.sh
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
rcon.port=25597
rcon.password=check
server-port=25573
P
if [ $# -eq 0 ]; then
  # 11 → 1173 °C (медь плавится при 1080), 10 → 1067 °C (не плавится), 4 → 427 °C; потом без энергии
  set -- 'ietest setup 10' 'sleep 60' 'ietest report' 'ietest signal 11' 'sleep 12' 'ietest report' \
    'ietest signal 4' 'sleep 45' 'ietest report' 'ietest power off' 'ietest drain' 'sleep 10' 'ietest report' \
    'ietest signal 0' 'sleep 25' 'ietest report'
fi
./gradlew runServer --console=plain > run/check.log 2>&1 &
GRADLE=$!
SERVER_PID=$GRADLE python3 rcon.py 25597 check 'forceload add -16 -16 16 16' "$@" 'stop' || true
wait $GRADLE || true
grep -E "ERROR|Exception|Caused by|ie_extras" run/check.log | grep -v "^\s*at " | head -30 || true
