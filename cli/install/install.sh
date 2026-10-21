#!/bin/sh
# Установка tfc на macOS и Linux одной командой:
#   curl -fsSL https://tfc-plans-fd2c.web.app/tfc/install.sh | sh
# Скачивает tfc своей системы с сайта во временную папку, сверяет контрольную сумму и запускает `tfc install`:
# тот ставит себя в ~/.local/bin и, если этой папки нет в PATH, дописывает её в настройки оболочки (~/.zshrc и т. п.).
# Копию этого файла сайт раздаёт из public/tfc/ (кладёт npm run tfc:dist).
set -eu

SITE="${TFC_SITE:-https://tfc-plans-fd2c.web.app}"

fail() {
  echo "Ошибка: $*" >&2
  exit 1
}

case "$(uname -s)" in
  Darwin) os=macos ;;
  Linux) os=linux ;;
  *) fail "tfc есть для Windows, macOS и Linux, а это $(uname -s)" ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=x64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) fail "нет tfc для процессора $(uname -m)" ;;
esac
# Терминал под Rosetta называет Mac на M1–M4 «x86_64» — берём родную сборку
if [ "$os" = macos ] && [ "$arch" = x64 ] && [ "$(sysctl -n hw.optional.arm64 2>/dev/null || true)" = 1 ]; then
  arch=arm64
fi
target="$os-$arch"
[ "$target" = linux-arm64 ] && fail "для Linux на ARM собранного tfc нет — поставьте пакет npm (см. $SITE/updates)"

command -v curl >/dev/null 2>&1 || fail "нужен curl"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT INT TERM

curl -fsSL -H 'Cache-Control: no-cache' "$SITE/tfc/version.json" -o "$tmp/version.json" ||
  fail "не удалось связаться с $SITE"
# version.json пишет JSON.stringify с отступами: у каждой цели свой блок { file, size, sha256 }
want="$(sed -n "/\"$target\"/,/}/p" "$tmp/version.json" | sed -n 's/.*"sha256": *"\([0-9a-f]*\)".*/\1/p')"
[ -n "$want" ] || fail "на сайте нет tfc для $target"
version="$(sed -n 's/^  "version": *"\([^"]*\)".*/\1/p' "$tmp/version.json")"

echo "Скачиваю tfc $version ($target)..."
curl -fL --progress-bar "$SITE/tfc/tfc-$target.zip" -o "$tmp/tfc.zip" || fail "файл не скачался"

if command -v shasum >/dev/null 2>&1; then got="$(shasum -a 256 "$tmp/tfc.zip" | cut -d' ' -f1)"
elif command -v sha256sum >/dev/null 2>&1; then got="$(sha256sum "$tmp/tfc.zip" | cut -d' ' -f1)"
else got="$want"; fi
[ "$got" = "$want" ] || fail "файл пришёл повреждённым (контрольная сумма не сошлась) — запустите команду ещё раз"

if command -v unzip >/dev/null 2>&1; then unzip -oq "$tmp/tfc.zip" -d "$tmp"
elif command -v python3 >/dev/null 2>&1; then
  python3 -c 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "$tmp/tfc.zip" "$tmp"
elif command -v bsdtar >/dev/null 2>&1; then bsdtar -xf "$tmp/tfc.zip" -C "$tmp"
else fail "нечем распаковать zip — поставьте unzip"; fi
chmod +x "$tmp/tfc"

# stdin здесь — сам скрипт (curl | sh): программе отдаём пустой, вопросов с --yes нет
"$tmp/tfc" install --yes </dev/null
