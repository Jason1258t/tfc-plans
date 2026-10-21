"""Текстуры каски шахтёра: модель на игроке и иконка (с погашенным и горящим фонарём).

Модель — из мода Mining Helmet (CysticTurtle85, MIT, art/mining-helmet/LICENSE). Его текстура серая: мод красит
ремешок краской на лету. Здесь она перекрашивается по костям модели (какой кости принадлежит каждый пиксель — по uv
граней из geo.json): яркость пикселя внутри кости → градиент своей палитры. Каска — окрашенная сталь (жёлтая, как
таблички IE), рёбра и поля — сталь, рамка фонаря — тёмная сталь, стекло — бледное или яркое.
Иконка 16×16 нарисована заново. Запуск: python3 art/gen_helmet.py (его вызывает release.sh).
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
import png

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(HERE, '..', 'src', 'main', 'resources', 'assets', 'miner_tools')
SRC = os.path.join(HERE, 'mining-helmet', 'mining_helmet_layer_1.png')
GEO = os.path.join(RES, 'geo', 'miner_helmet.geo.json')

def hexc(s):
    return tuple(int(s[i:i + 2], 16) for i in (1, 3, 5))

# Палитры от тёмного к светлому
PAINT = [hexc(c) for c in ('#7a5413', '#a8741b', '#cf9a2a', '#e7b941', '#f4d36a')]   # окрашенная сталь
STEEL = [hexc(c) for c in ('#3d4042', '#55595c', '#6f7477', '#8c9194', '#aab0b2')]   # поля, рёбра
FRAME = [hexc(c) for c in ('#2b2c2d', '#3a3c3e', '#4c4f52', '#62666a')]              # рамка фонаря
LENS_OFF = (178, 172, 128)
LENS_ON = (255, 252, 214)
# Кость модели → палитра. Leather — колпак (у исходного мода крашеная кожа), Base — поля, Straps — рёбра поверх
BONES = {'Leather': PAINT, 'Base': STEEL, 'Straps': STEEL, 'Light': FRAME}


def ramp(pal, t):
    t = min(max(t, 0.0), 1.0) * (len(pal) - 1)
    i = min(int(t), len(pal) - 2)
    f = t - i
    return tuple(round(pal[i][k] * (1 - f) + pal[i + 1][k] * f) for k in range(3))


def lum(p):
    return 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]


def owners():
    """Пиксель текстуры → кость (первая, чья грань его накрывает)"""
    geo = json.load(open(GEO))['minecraft:geometry'][0]
    out = {}
    for bone in geo['bones']:
        for cube in bone.get('cubes', []):
            for face in cube['uv'].values():
                x, y = face['uv']
                w, h = face['uv_size']
                for yy in range(int(min(y, y + h)), int(max(y, y + h))):
                    for xx in range(int(min(x, x + w)), int(max(x, x + w))):
                        out.setdefault((xx, yy), bone['name'])
    return out


def armor(lit):
    src = png.read(SRC)
    own = owners()
    # Пределы яркости по костям — градиент на весь диапазон кости
    rng = {}
    for y, row in enumerate(src):
        for x, p in enumerate(row):
            if p[3] and own.get((x, y)) in BONES and not is_lens(p):
                lo, hi = rng.get(own[(x, y)], (255, 0))
                rng[own[(x, y)]] = (min(lo, lum(p)), max(hi, lum(p)))
    out = []
    for y, row in enumerate(src):
        line = []
        for x, p in enumerate(row):
            bone = own.get((x, y))
            if not p[3]:
                line.append((0, 0, 0, 0))
            elif is_lens(p):
                line.append((LENS_ON if lit else LENS_OFF) + (255,))
            elif bone in BONES:
                lo, hi = rng[bone]
                t = (lum(p) - lo) / (hi - lo) if hi > lo else 0.5
                line.append(ramp(BONES[bone], 0.15 + 0.7 * t) + (p[3],))
            else:
                # Пиксели вне граней модели не видны; красим сталью, чтобы в файле не было серых пятен
                line.append(ramp(STEEL, lum(p) / 255) + (p[3],))
        out.append(line)
    return out


def is_lens(p):
    return p[0] > 200 and p[2] < p[0] - 20


# Иконка 16×16: каска спереди, фонарь посередине. Буквы: p — краска (по высоте светлее сверху), r — ребро,
# L — рамка фонаря, l — стекло, B — поля, b — тень под полями
ICON = """
................
................
................
......rrrr......
....pprrrrpp....
...pppLLLLppp...
..pppLllllLppp..
..pppLllllLppp..
.ppppLllllLpppp.
.ppppLLLLLLpppp.
.pppppppppppppp.
BBBBBBBBBBBBBBBB
.bbbbbbbbbbbbbb.
................
................
................
"""


def icon(lit):
    rows = [r for r in ICON.strip('\n').split('\n')]
    out = []
    for y, row in enumerate(rows):
        line = []
        for x, c in enumerate(row):
            side = (x - 7.5) / 8  # -1 слева … 1 справа: свет слева сверху
            if c == '.':
                line.append((0, 0, 0, 0))
            elif c == 'p':
                line.append(ramp(PAINT, 0.95 - 0.06 * y - 0.25 * side) + (255,))
            elif c == 'r':
                line.append(ramp(STEEL, 0.8 - 0.08 * y - 0.2 * side) + (255,))
            elif c == 'L':
                line.append(ramp(FRAME, 0.7 - 0.3 * side) + (255,))
            elif c == 'l':
                if lit:
                    line.append(LENS_ON + (255,))
                else:
                    line.append(ramp([(120, 116, 86), LENS_OFF], 0.6 - 0.4 * side) + (255,))
            elif c == 'B':
                line.append(ramp(STEEL, 0.75 - 0.35 * side) + (255,))
            elif c == 'b':
                line.append(ramp(STEEL, 0.1) + (255,))
        out.append(line)
    if lit:
        # Блик на стекле
        out[6][6] = (255, 255, 255, 255)
    return out


def main():
    os.makedirs(os.path.join(RES, 'textures', 'models', 'armor'), exist_ok=True)
    os.makedirs(os.path.join(RES, 'textures', 'item'), exist_ok=True)
    png.write(os.path.join(RES, 'textures', 'models', 'armor', 'miner_helmet.png'), armor(False))
    png.write(os.path.join(RES, 'textures', 'models', 'armor', 'miner_helmet_lit.png'), armor(True))
    png.write(os.path.join(RES, 'textures', 'item', 'miner_helmet.png'), icon(False))
    png.write(os.path.join(RES, 'textures', 'item', 'miner_helmet_lit.png'), icon(True))
    print('текстуры каски готовы')


if __name__ == '__main__':
    main()
