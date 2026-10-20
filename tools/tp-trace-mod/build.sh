#!/usr/bin/env bash
# Сборка tp-trace-<версия>.jar без Gradle: компиляция против Minecraft+NeoForge из среды ee-rectifier-mod
# (build/moddev, путь классов — art/classpath.gradle) без модов сборки. В jar — только свои классы.
set -euo pipefail
cd "$(dirname "$0")"
VERSION=1.0.0
export JAVA_HOME="${JAVA_HOME:-$HOME/.gradle/local-tools/jdk21/Contents/Home}"
CP=$(cd ../ee-rectifier-mod && ./gradlew -q -I art/classpath.gradle printCompileClasspath 2>/dev/null | sed -n 's/^CP=//p')
rm -rf build && mkdir -p build/classes
"$JAVA_HOME/bin/javac" --release 21 -proc:none -cp "$CP" -d build/classes $(find src/main/java -name '*.java')
cp -r src/main/resources/* build/classes/
rm -f tp-trace-*.jar
(cd build/classes && "$JAVA_HOME/bin/jar" --create --file "../../tp-trace-$VERSION.jar" .)
echo "готово: $(pwd)/tp-trace-$VERSION.jar"
