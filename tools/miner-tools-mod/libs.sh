#!/usr/bin/env bash
# Библиотеки для компиляции: Curios (слоты пояса и головы) и GeckoLib (модель каски) из папки mods/ сборки. В мод
# не попадают — в сборке они уже стоят.
set -euo pipefail
cd "$(dirname "$0")"
ROOT=../..
# В git worktree jar сборки нет — берём из основной копии
[ -n "$(ls $ROOT/mods/curios-neoforge-*.jar 2>/dev/null)" ] || ROOT=$(git rev-parse --path-format=absolute --git-common-dir)/..
rm -rf libs && mkdir libs
cp "$ROOT"/mods/curios-neoforge-*.jar "$ROOT"/mods/geckolib-neoforge-*.jar libs/
ls libs
