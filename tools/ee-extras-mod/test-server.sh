#!/usr/bin/env bash
# Проверка мода на настоящем сервере (среда разработки NeoForge + Create + Electro Energetics из jar сборки):
# плоский мир, через RCON ставим трёхфазный выпрямитель в двух положениях, однофазный и диод EE, смотрим данные устройств
# (/cee device_data); затем /rectest (тестовый мод src/devtest) собирает цепи «батареи переменного тока → выпрямитель →
# нагреватель и вольтметр», протягивая провода через API EE, и снимает показания. Потом сервер останавливается.
# С аргументами — выполняет их вместо этого списка (например ./test-server.sh 'rectest gen 64' 'sleep 3' 'rectest genreport').
set -euo pipefail
cd "$(dirname "$0")"
export JAVA_HOME="${JAVA_HOME:-$HOME/.gradle/local-tools/jdk21/Contents/Home}"
# KEEP=1 — не стирать мир (проверка сохранения); OLD_JAR=<jar> — положить ещё и этот jar (старая версия аддона рядом
# с новой — проверка перехода со старых id); IE=1 — добавить Immersive Engineering из jar сборки (конденсаторы)
if [ -z "${KEEP:-}" ]; then rm -rf run; fi
mkdir -p run/mods
rm -f run/mods/*.jar
cp libs/create-1.21.1-*.jar libs/electroenergetics-*.jar run/mods/
MODS="${MODS:-${TFC_MODS_DIR:-${TFC_PACK_CACHE:-$HOME/.cache/tfc-plans/pack}/mods}}"
if [ -n "${IE:-}" ]; then cp "$MODS"/ImmersiveEngineering-*.jar run/mods/; fi
if [ -n "${OLD_JAR:-}" ]; then cp "$OLD_JAR" run/mods/; fi
echo 'eula=true' > run/eula.txt
cat > run/server.properties <<'P'
level-type=minecraft\:flat
online-mode=false
spawn-protection=0
generate-structures=false
enable-rcon=true
rcon.port=25599
rcon.password=check
P
# MICROTICKS=N — настройка EE simulation.microTicks (сколько расчётов цепи за тик) для мира разработки
if [ -n "${MICROTICKS:-}" ]; then
  mkdir -p run/world/serverconfig
  printf '[simulation]\n\tmicroTicks = %s\n' "$MICROTICKS" > run/world/serverconfig/electroenergetics-server.toml
fi
./gradlew runServer --console=plain > run/check.log 2>&1 &
GRADLE=$!
if [ $# -gt 0 ]; then
  SERVER_PID=$GRADLE python3 rcon.py 25599 check 'forceload add 0 0 32 32' "$@" 'stop' || true
  wait $GRADLE || true
  grep -E "ERROR|Exception|Caused by" run/check.log | grep -v "^\s*at " | head -30 || true
  exit 0
fi
SERVER_PID=$GRADLE python3 rcon.py 25599 check \
  'forceload add 0 0' \
  'setblock 0 -60 0 ee_extras:three_phase_rectifier[facing=up,roll=false]' \
  'setblock 2 -60 0 ee_extras:three_phase_rectifier[facing=north,roll=true]' \
  'setblock 4 -60 0 electroenergetics:diode' \
  'setblock 6 -60 0 ee_extras:single_phase_rectifier[facing=east,roll=false]' \
  'sleep 3' \
  'execute if block 2 -60 0 ee_extras:three_phase_rectifier[facing=north,roll=true] run say выпрямитель стоит' \
  'cee device_data 0 -60 0' \
  'cee debug device_data 0 -60 0' \
  'cee device_data 2 -60 0' \
  'cee device_data 4 -60 0' \
  'cee device_data 6 -60 0' \
  'forceload add 0 10 16 30' \
  'rectest build' \
  'sleep 2' \
  'rectest power 100' \
  'sleep 4' \
  'rectest report' \
  'cee device_data 2 -60 13' \
  'cee device_data 2 -60 23' \
  'setblock 0 -60 0 air' \
  'sleep 1' \
  'cee device_data 0 -60 0' \
  'stop' || true
wait $GRADLE || true
grep -E "ERROR|Exception|Caused by|ee_extras" run/check.log | grep -v "^\s*at " | head -30 || true
