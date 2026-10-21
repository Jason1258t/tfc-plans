#!/usr/bin/env bash
# Проверка аддона на сервере разработки (NeoForge + Create из ../../mods, плоский мир, RCON 25597).
# Без аргументов — три запуска:
#  1) аддон выключен: линия «творческий мотор → валы → вентилятор», в учёт незагруженной части сети подкладывается
#     нагрузка 3 000 000 SU (как остаток после перезахода), мир сохраняется;
#  2) аддон выключен, тот же мир: фантом пережил перезапуск — сеть перегружена (так ведёт себя Create сам);
#  3) аддон включён, тот же мир: через секунду фантом убран, в логе — строка «убран фантом»;
#     плюс сеть через незагруженные чанки (за 3+ чанка от загруженных) — её фантом не трогается, пока их не загрузят.
# С аргументами — один запуск с этими командами (KEEP=1 — не стирать мир, OFF=1 — аддон выключен).
set -euo pipefail
cd "$(dirname "$0")"
export JAVA_HOME="${JAVA_HOME:-$HOME/.gradle/local-tools/jdk21/Contents/Home}"
MODS="${MODS:-../../mods}"

run() { # run <выключен 0|1> <команды…>
  local off=$1; shift
  mkdir -p run/mods
  rm -f run/mods/*.jar
  cp "$MODS"/create-1.21.1-*.jar run/mods/
  echo 'eula=true' > run/eula.txt
  cat > run/server.properties <<'S'
level-type=minecraft\:flat
online-mode=false
spawn-protection=0
generate-structures=false
enable-rcon=true
rcon.port=25597
rcon.password=check
server-port=25571
S
  local opts=""
  if [ "$off" = 1 ]; then opts="-Dstress_fix.disabled=true"; fi
  JAVA_TOOL_OPTIONS="$opts" ./gradlew runServer --console=plain > run/check.log 2>&1 &
  local gradle=$!
  SERVER_PID=$gradle python3 rcon.py 25597 check "$@" 'stop' || true
  wait $gradle || true
  grep -E "ERROR|Exception|Caused by|stress_fix|фантом" run/check.log | grep -v "^\s*at " | head -30 || true
}

if [ $# -gt 0 ]; then
  if [ -z "${KEEP:-}" ]; then rm -rf run; fi
  run "${OFF:-0}" "$@"
  exit 0
fi

rm -rf run
echo '== 1. аддон выключен: фантом в сеть, сохранение'
run 1 'forceload add 0 0' \
  'setblock 0 -60 0 create:creative_motor[facing=east]' \
  'fill 1 -60 0 4 -60 0 create:shaft[axis=x]' \
  'setblock 5 -60 0 create:encased_fan[facing=west]' \
  'sleep 2' "sftest report 1 -60 0" \
  "sftest phantom 1 -60 0 0 3000000 0" \
  'sleep 1' 'save-all flush' 'sleep 1'
echo '== 2. аддон выключен, перезапуск того же мира'
run 1 'sleep 2' "sftest report 1 -60 0"
echo '== 3. аддон включён, перезапуск того же мира'
run 0 'sleep 0.5' "sftest report 1 -60 0" 'sleep 2' "sftest report 1 -60 0" \
  'forceload add 992 992 1071 1007' \
  'setblock 1000 -60 1000 create:creative_motor[facing=east]' \
  'fill 1001 -60 1000 1069 -60 1000 create:shaft[axis=x]' \
  'setblock 1070 -60 1000 create:encased_fan[facing=west]' \
  'sleep 2' "sftest report 1001 -60 1000" \
  'forceload remove 1008 992 1071 1007' 'sleep 3' \
  "sftest phantom 1001 -60 1000 0 3000000 0" 'sleep 3' "sftest report 1001 -60 1000" 'stressfix' 'sleep 2' \
  'forceload add 1008 992 1071 1007' 'sleep 3' "sftest report 1001 -60 1000" "sftest report 1069 -60 1000"
