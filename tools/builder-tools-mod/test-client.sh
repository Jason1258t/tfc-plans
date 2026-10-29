#!/usr/bin/env bash
# Создаёт временный плоский мир; проверяет клиентский обмен и синхронизацию сервера, затем закрывает окно.
set -euo pipefail
cd "$(dirname "$0")"
export JAVA_HOME="${JAVA_HOME:-$HOME/.gradle/local-tools/jdk21/Contents/Home}"
rm -rf run/mods
mkdir -p run/mods
cp libs/*.jar run/mods/
if [ "${TFC:-0}" = 1 ]; then
    MODS="${MODS:-${TFC_MODS_DIR:-${TFC_PACK_CACHE:-$HOME/.cache/tfc-plans/pack}/mods}}"
    cp "$MODS"/TerraFirmaCraft-NeoForge-*.jar "$MODS"/Patchouli-*.jar run/mods/
fi
rm -rf run/saves/buildertest
printf 'lang:ru_ru\nonboardAccessibility:false\ntutorialStep:none\n' > run/options.txt
./gradlew runClient --console=plain > run/client-check.log 2>&1
