#!/usr/bin/env bash
# Проверка мода на настоящем сервере (среда разработки NeoForge + Curios, GeckoLib и Immersive Engineering из jar
# сборки): плоский мир, через RCON команды проверочного мода (src/devtest): /belttest — подбор с поясом, слот Curios,
# окно фильтра; /helmettest — каска (заряд, фонарь, свет, урон), с зарядной станцией IE и наковальнями. Потом сервер
# останавливается. С аргументами — выполняет их вместо этого. PORT — порт RCON (по умолчанию 25598), игры — PORT + 100.
set -euo pipefail
cd "$(dirname "$0")"
export JAVA_HOME="${JAVA_HOME:-$HOME/.gradle/local-tools/jdk21/Contents/Home}"
[ -d libs ] || ./libs.sh
rm -rf run
mkdir -p run/mods
cp libs/*.jar run/mods/
# IE — для проверки зарядной станции (каске для работы не нужен)
MODS="${MODS:-${TFC_MODS_DIR:-${TFC_PACK_CACHE:-$HOME/.cache/tfc-plans/pack}/mods}}"
cp "$MODS"/ImmersiveEngineering-*.jar run/mods/
PORT=${PORT:-25598}
echo 'eula=true' > run/eula.txt
cat > run/server.properties <<P
level-type=minecraft\\:flat
online-mode=false
server-port=$((PORT + 100))
spawn-protection=0
generate-structures=false
enable-rcon=true
rcon.port=$PORT
rcon.password=check
P
./gradlew runServer --console=plain > run/check.log 2>&1 &
GRADLE=$!
if [ $# -eq 0 ]; then
  set -- 'belttest' 'helmettest' 'helmettest charge' 'sleep 7' 'helmettest chargereport' \
    'helmettest anvil' 'sleep 4' 'helmettest anvilreport'
fi
SERVER_PID=$GRADLE python3 rcon.py $PORT check 'forceload add 0 0' "$@" 'stop' || true
wait $GRADLE || true
grep -E "ERROR|Exception|Caused by|miner_tools" run/check.log | grep -v "^\s*at " | head -30 || true
