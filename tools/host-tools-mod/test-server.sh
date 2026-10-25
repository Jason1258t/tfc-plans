#!/usr/bin/env bash
# Выделенный сервер с аддоном (RCON 25593): аддон грузится без клиентских миксинов, /host отказывает
# («только в мире хоста»), /ping и рассылка пинга работают.
set -euo pipefail
cd "$(dirname "$0")"
export JAVA_HOME="${JAVA_HOME:-$HOME/.gradle/local-tools/jdk21/Contents/Home}"
rm -rf run-server && mkdir -p run-server
echo 'eula=true' > run-server/eula.txt
cat > run-server/server.properties <<'S'
level-type=minecraft\:flat
online-mode=false
generate-structures=false
enable-rcon=true
rcon.port=25593
rcon.password=check
server-port=25570
S
./gradlew runServer --console=plain > run-server/check.log 2>&1 &
GRADLE=$!
SERVER_PID=$GRADLE python3 rcon.py 25593 check 'host' 'host status' 'ping' 'sleep 6' 'stop' || true
wait $GRADLE || true
grep -E "ERROR|Exception|Caused by|host_tools|Mixin" run-server/check.log | grep -v "^\s*at " | head -20 || true
