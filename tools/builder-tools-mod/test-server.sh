#!/usr/bin/env bash
# Настоящий сервер NeoForge + Curios; проверочный мод в выпускной jar не попадает.
set -euo pipefail
cd "$(dirname "$0")"
export JAVA_HOME="${JAVA_HOME:-$HOME/.gradle/local-tools/jdk21/Contents/Home}"
[ -d libs ] || ./libs.sh
rm -rf run
mkdir -p run/mods
cp libs/*.jar run/mods/
if [ "${TFC:-0}" = 1 ]; then
    MODS="${MODS:-${TFC_MODS_DIR:-${TFC_PACK_CACHE:-$HOME/.cache/tfc-plans/pack}/mods}}"
    cp "$MODS"/TerraFirmaCraft-NeoForge-*.jar "$MODS"/Patchouli-*.jar run/mods/
fi
PORT=${PORT:-25615}
echo 'eula=true' > run/eula.txt
cat > run/server.properties <<P
level-type=minecraft\\:flat
online-mode=false
server-port=$((PORT + 100))
spawn-protection=0
generate-structures=false
initial-enabled-packs=vanilla
generator-settings={"layers":[{"block":"minecraft:bedrock","height":1},{"block":"minecraft:dirt","height":2},{"block":"minecraft:grass_block","height":1}],"biome":"minecraft:plains"}
enable-rcon=true
rcon.port=$PORT
rcon.password=check
P
./gradlew runServer --console=plain > run/check.log 2>&1 &
GRADLE=$!
if [ $# -eq 0 ]; then set -- 'buildertest fault' 'buildertest'; fi
SERVER_PID=$GRADLE python3 rcon.py "$PORT" check 'forceload add 0 0' "$@" 'stop'
wait "$GRADLE"
