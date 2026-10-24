#!/usr/bin/env bash
# Проверка аддона на сервере разработки (NeoForge + Create и Electro Energetics из libs/, плоский мир, RCON 25594).
# Без аргументов — сценарий из README («Что проверено»); с аргументами — эти команды. KEEP=1 — не стирать мир.
# SABLE=1 — ещё Sable из кеша сборки (корабли Aeronautics — его подуровни; /sable assemble …). Sable требует NeoForge
# 21.1.228+, поэтому сервер тогда идёт на NEO (по умолчанию 21.1.251 — есть в кеше Gradle), сам аддон собран на 21.1.219.
set -euo pipefail
cd "$(dirname "$0")"
export JAVA_HOME="${JAVA_HOME:-$HOME/.gradle/local-tools/jdk21/Contents/Home}"
[ -d libs ] || ./libs.sh
if [ -z "${KEEP:-}" ]; then rm -rf run; fi
mkdir -p run/mods
rm -f run/mods/*.jar
cp libs/create-1.21.1-*.jar libs/electroenergetics-*.jar run/mods/
NEO_ARG=()
if [ -n "${SABLE:-}" ]; then
  MODS="${MODS:-${TFC_MODS_DIR:-${TFC_PACK_CACHE:-$HOME/.cache/tfc-plans/pack}/mods}}"
  cp "$MODS"/sable-neoforge-*.jar run/mods/
  NEO_ARG=(-Pneo_version="${NEO:-21.1.251}")
fi
echo 'eula=true' > run/eula.txt
cat > run/server.properties <<'P'
level-type=minecraft\:flat
online-mode=false
spawn-protection=0
generate-structures=false
enable-rcon=true
rcon.port=25594
rcon.password=check
server-port=25574
P
if [ $# -eq 0 ]; then
  # A — один генератор без аккумулятора на 4 нагревателя; B — генератор + аккумулятор 50 % без нагрузки (заряд);
  # E — только аккумулятор 100 % на 4 нагревателя, лицом на восток (разряд, вал без нагрузки)
  set -- 'aetest build 0 256 1 0 0 4' 'aetest build 1 256 1 1 50 0' 'aetest build 2 128 0 1 100 4' \
    'sleep 3' 'aetest mark' 'sleep 20' 'aetest report' \
    'aetest add 0 0' 'aetest add 2 0' 'sleep 2' 'aetest report' \
    'aetest remove 1' 'aetest add 1 1' 'sleep 1' 'aetest report' 'aetest break 2'
fi
./gradlew ${NEO_ARG[@]+"${NEO_ARG[@]}"} runServer --console=plain > run/check.log 2>&1 &
GRADLE=$!
SERVER_PID=$GRADLE python3 rcon.py 25594 check 'forceload add -16 -16 48 48' "$@" 'stop' || true
wait $GRADLE || true
grep -E "ERROR|Exception|Caused by|create_aeronautics_extra" run/check.log | grep -v "^\s*at " | head -30 || true
