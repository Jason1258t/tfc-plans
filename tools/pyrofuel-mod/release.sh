#!/usr/bin/env bash
# Сборка выпуска и иконок. Проверка сервера запускается отдельно.
set -euo pipefail
cd "$(dirname "$0")"
export JAVA_HOME="${JAVA_HOME:-$HOME/.gradle/local-tools/jdk21/Contents/Home}"
[ -d libs ] || ./libs.sh
python3 art/gen_resources.py
python3 art/gen_assets.py
./gradlew build --console=plain
VERSION=$(sed -n 's/^mod_version=//p' gradle.properties)
cp "build/libs/pyrofuel-$VERSION.jar" .
(cd ../.. && node scripts/mcp/render.mjs tools/pyrofuel-mod pyrofuel:pyrocoke_mix pyrofuel:soaked_pyromass pyrofuel:raw_pyrocoke_briquette pyrofuel:pyrocoke_briquette pyrofuel:stabilizing_additive pyrofuel:raw_pyrogel_bucket pyrofuel:pyrogel_bucket --out tools/pyrofuel-mod/icons --size 192)
echo "Готово: pyrofuel-$VERSION.jar"
