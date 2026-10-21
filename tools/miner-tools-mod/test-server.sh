#!/usr/bin/env bash
# Проверка мода на настоящем сервере (среда разработки NeoForge + Curios из ../../mods): плоский мир, через RCON
# команда /belttest проверочного мода (src/devtest) — подбор с поясом, слот Curios, окно фильтра. Потом сервер
# останавливается. С аргументами — выполняет их вместо /belttest.
set -euo pipefail
cd "$(dirname "$0")"
export JAVA_HOME="${JAVA_HOME:-$HOME/.gradle/local-tools/jdk21/Contents/Home}"
[ -d libs ] || ./libs.sh
rm -rf run
mkdir -p run/mods
cp libs/curios-neoforge-*.jar run/mods/
echo 'eula=true' > run/eula.txt
cat > run/server.properties <<'P'
level-type=minecraft\:flat
online-mode=false
spawn-protection=0
generate-structures=false
enable-rcon=true
rcon.port=25598
rcon.password=check
P
./gradlew runServer --console=plain > run/check.log 2>&1 &
GRADLE=$!
if [ $# -eq 0 ]; then set -- 'belttest'; fi
SERVER_PID=$GRADLE python3 rcon.py 25598 check 'forceload add 0 0' "$@" 'stop' || true
wait $GRADLE || true
grep -E "ERROR|Exception|Caused by|miner_tools" run/check.log | grep -v "^\s*at " | head -30 || true
