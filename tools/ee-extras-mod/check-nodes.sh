#!/usr/bin/env bash
# Проверка: клеммы моделей = точки крепления проводов во всех положениях блоков (у соединителей — 24) (после ./gradlew build)
set -euo pipefail
cd "$(dirname "$0")"
export JAVA_HOME="${JAVA_HOME:-$HOME/.gradle/local-tools/jdk21/Contents/Home}"
CP=$(./gradlew -q -I art/classpath.gradle printCompileClasspath 2>/dev/null | sed -n 's/^CP=//p')
"$JAVA_HOME/bin/java" -cp "$CP:build/classes/java/main" art/CheckNodes.java 2>&1 | grep -v "StatusConsoleListener"
