#!/usr/bin/env bash
# Сборка rw-host-fix-<версия>.jar без Gradle: компиляция против Minecraft+NeoForge из среды ee-rectifier-mod
# (build/moddev, путь классов — art/classpath.gradle) и TFC Real World из jar сборки (кеш снимка, npm run pack:fetch). В jar — только свои классы.
set -euo pipefail
cd "$(dirname "$0")"
VERSION=1.0.0
MODS="${MODS:-${TFC_MODS_DIR:-${TFC_PACK_CACHE:-$HOME/.cache/tfc-plans/pack}/mods}}"
export JAVA_HOME="${JAVA_HOME:-$HOME/.gradle/local-tools/jdk21/Contents/Home}"
CP=$(cd ../ee-rectifier-mod && ./gradlew -q -I art/classpath.gradle printCompileClasspath 2>/dev/null | sed -n 's/^CP=//p')
RW=$(ls "$MODS"/TFC-Real-World-NeoForge-*.jar | head -1)
rm -rf build && mkdir -p build/classes
"$JAVA_HOME/bin/javac" --release 21 -proc:none -cp "$CP:$RW" -d build/classes $(find src/main/java -name '*.java')
cp -r src/main/resources/* build/classes/
rm -f rw-host-fix-*.jar
(cd build/classes && "$JAVA_HOME/bin/jar" --create --file "../../rw-host-fix-$VERSION.jar" .)
echo "готово: $(pwd)/rw-host-fix-$VERSION.jar"
