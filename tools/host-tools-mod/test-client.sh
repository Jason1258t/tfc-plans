#!/usr/bin/env bash
# Проверка в клиенте разработки (окно Minecraft откроется само и закроется): проверочный мод создаёт плоский мир
# и гоняет /host, /host random, /host stop, кнопку в меню паузы, окно «Открыть для сети», /ping и таб.
# Итог — строки HTTEST, скриншоты — run/screenshots/httest-*.png. Нужны свободные порты 57016, 30000–30004, 41234.
# EXTRA_MODS="jar …" — ещё моды в run/mods (например watut, чтобы проверить таб вместе с ним).
set -euo pipefail
cd "$(dirname "$0")"
export JAVA_HOME="${JAVA_HOME:-$HOME/.gradle/local-tools/jdk21/Contents/Home}"
rm -rf run/saves/httest run/screenshots/httest-* run/mods
mkdir -p run/mods
for j in ${EXTRA_MODS:-}; do cp "$j" run/mods/; done
# Русский язык — чтобы проверить подписи из ru_ru
[ -f run/options.txt ] || printf 'lang:ru_ru\nonboardAccessibility:false\ntutorialStep:none\n' > run/options.txt
./gradlew runClient --console=plain > run/check.log 2>&1 || true
grep -E "HTTEST|ERROR|Exception|Caused by|host_tools|Mixin.*(fail|error)" run/check.log | grep -v "^\s*at " | head -80
