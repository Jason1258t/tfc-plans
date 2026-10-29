#!/usr/bin/env bash
# Сборка выпускного jar и иконки сайта. Загрузка на сервер — отдельным шагом.
set -euo pipefail
cd "$(dirname "$0")"
export JAVA_HOME="${JAVA_HOME:-$HOME/.gradle/local-tools/jdk21/Contents/Home}"
[ -d libs ] || ./libs.sh
./gradlew build -q --console=plain
VERSION=$(sed -n 's/^mod_version=//p' gradle.properties)
cp "build/libs/builder-tools-$VERSION.jar" .
(cd ../.. && node scripts/mcp/render.mjs tools/builder-tools-mod builder_tools:builder_belt --out tools/builder-tools-mod/icons --size 192)
