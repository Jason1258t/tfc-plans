#!/usr/bin/env bash
# Проверка аддона на настоящем сервере (среда разработки NeoForge хоста, devserver/): TFC + Patchouli + TFC Real World
# из jar сборки (кеш снимка, npm run pack:fetch) и собранный jar аддона. Размер карты — как на сервере группы (100 000 × 50 000). Через RCON:
# /rwtest mixin — миксин применился и сервер видит нужный размер карты; /rwtest clear — стирание не срабатывает; /rwtest portal|command — выход из ада.
# С аргументами — выполняет их вместо стандартного списка.
set -euo pipefail
cd "$(dirname "$0")"
./build.sh
cd devserver
export JAVA_HOME="${JAVA_HOME:-$HOME/.gradle/local-tools/jdk21/Contents/Home}"
rm -rf run && mkdir -p run/mods run/world/serverconfig/tfc_real_world
MODS="${MODS:-${TFC_MODS_DIR:-${TFC_PACK_CACHE:-$HOME/.cache/tfc-plans/pack}/mods}}"
cp "$MODS"/TerraFirmaCraft-NeoForge-*.jar "$MODS"/Patchouli-*.jar "$MODS"/TFC-Real-World-NeoForge-*.jar \
  ../rw-host-fix-*.jar run/mods/
# EXTRA_MODS="путь/к.jar …" — ещё моды на сервер (например диагностика ../tp-trace-mod/tp-trace-1.0.0.jar)
for j in ${EXTRA_MODS:-}; do cp "../$j" run/mods/; done
printf '[generation_modes]\nhorizontal_scale = 100000\nvertical_scale = 50000\n' > run/world/serverconfig/tfc_real_world/server.toml
echo 'eula=true' > run/eula.txt
cat > run/server.properties <<'P'
online-mode=false
enable-rcon=true
rcon.port=25598
rcon.password=check
P
./gradlew runServer --console=plain > run/check.log 2>&1 &
GRADLE=$!
if [ $# -eq 0 ]; then
  set -- 'rwtest mixin' 'rwtest clear' 'rwtest portal -297 -4642' 'rwtest portal -297 -6200' 'rwtest portal 13000 0' \
    'rwtest command -297 -6200' 'sleep 2'
fi
SERVER_PID=$GRADLE python3 rcon.py 25598 check "$@" 'stop' || true
wait $GRADLE || true
grep -E "ERROR|Exception|Caused by|rw_host_fix|выход из ада" run/check.log | grep -v "^\s*at " | head -30 || true
