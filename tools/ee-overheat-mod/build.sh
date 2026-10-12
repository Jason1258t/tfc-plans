#!/usr/bin/env bash
# Сборка ee-overheat-1.0.0.jar без Gradle: заглушки Mixin/Create нужны только для компиляции и в jar не попадают.
set -euo pipefail
cd "$(dirname "$0")"
rm -rf build && mkdir -p build/classes
javac --release 21 -d build/classes $(find stubs src/main/java -name '*.java')
# заглушки не упаковываем
rm -rf build/classes/org build/classes/net build/classes/com
cp -r src/main/resources/* build/classes/
(cd build/classes && jar --create --file ../../ee-overheat-1.0.0.jar .)
echo "готово: $(pwd)/ee-overheat-1.0.0.jar"
