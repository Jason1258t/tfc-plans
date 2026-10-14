"""
Текстуры, модели и состояния блоков выпрямителей. Запуск: python3 art/gen_assets.py
Раскладки клемм — те же, что в Layout.java (центры {x, z} в пикселях, клемма 4×4×4, низ на высоте 3);
совпадение моделей с точками крепления проводов во всех положениях проверяет art/CheckNodes.java.
Стиль — как у преобразователя Electro Energetics: стальная плита 16×5×16, медные клеммы сверху, палитра EE.
"""
import json
import os
import random

from png import write

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(HERE, '..', 'src', 'main', 'resources', 'assets', 'ee_rectifier')
NS = 'ee_rectifier'

# id блока → (центры клемм, вид клеммы, x центров «~» под входами)
LAYOUTS = {
    'three_phase_rectifier': (
        [(3, 3), (8, 3), (13, 3), (3, 13), (13, 13)],
        ['phase', 'phase', 'phase', 'plus', 'minus'],
    ),
    'single_phase_rectifier': (
        [(3, 3), (13, 3), (3, 13), (13, 13)],
        ['phase', 'phase', 'plus', 'minus'],
    ),
}


def roll(t):
    """(x, z) → (16 − z, x): так же, как Layout.roll"""
    return (16 - t[1], t[0])


# ---------------------------------------------------------------- палитра EE


def hexc(h, a=255):
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)


FILL = [hexc(c) for c in ['8f9691'] * 5 + ['9aa49d'] * 4 + ['a8b3ab']]
RIM, EDGE, CORNER = hexc('828784'), hexc('595858'), hexc('494848')
DARK, DARKER, HI = hexc('60635f'), hexc('505351'), hexc('b4c1b8')
COPPER = [hexc(c) for c in ['b26247', 'c87456', 'd67b5b', 'e3826c']]
RED = [hexc(c) for c in ['7a2420', '9c2f27', 'b8392d', 'd4503f']]
BLUE = [hexc(c) for c in ['1f2a44', '2b3a5e', '3a4d78', '4d6394']]
CLEAR = (0, 0, 0, 0)


def texture(terminals, kinds, seed):
    """32×32: верх (0..15, 16..31), низ (16..31, 16..31), бок (16..31, 11..15), клеммы медь/«+»/«−» (0/4/8, 12)"""
    rng = random.Random(seed)
    px = [[CLEAR] * 32 for _ in range(32)]

    def put(x, y, c):
        px[y][x] = c

    def plate(x0, y0, w, h):
        """Стальная пластина как у плит EE: тёмная рамка, светлая внутренняя кромка, спокойный шум"""
        for y in range(h):
            for x in range(w):
                border = x in (0, w - 1) or y in (0, h - 1)
                corner = x in (0, w - 1) and y in (0, h - 1)
                rim = h > 6 and (x in (1, w - 2) or y in (1, h - 2))
                put(x0 + x, y0 + y, CORNER if corner else EDGE if border else RIM if rim else rng.choice(FILL))

    def terminal(x0, y0, pal):
        """Клемма 4×4: тёмный край, блик в углу"""
        for y in range(4):
            for x in range(4):
                edge = x in (0, 3) or y in (0, 3)
                put(x0 + x, y0 + y, pal[0] if (x in (0, 3) and y in (0, 3)) else pal[1] if edge else pal[2])
        put(x0 + 1, y0 + 1, pal[3])

    def top(x, z, c):
        put(x, 16 + z, c)

    plate(0, 16, 16, 16)
    # Гравировка «~» под каждым входом (z = 6..7)
    for (cx, cz), k in zip(terminals, kinds):
        if k != 'phase':
            continue
        for dx, dz in ((-1, 7), (0, 6), (1, 7)):
            top(cx + dx, dz, DARKER)
        top(cx + 2, 6, DARKER)
    # «+» и «−» над выходными клеммами
    for (cx, cz), k in zip(terminals, kinds):
        if k == 'plus':
            for dx, dz in ((0, -1), (-1, 0), (0, 0), (1, 0), (0, 1)):
                top(cx + dx, 9 + dz, RED[2])
        elif k == 'minus':
            for dx in (-1, 0, 1):
                top(cx + dx, 9, BLUE[3])
    # Символ диода между выходами (x 6..10, z 10..14): треугольник ▶ и черта |
    for z in range(10, 15):
        for x in range(6, 7 + 2 - abs(z - 12)):
            top(x, z, DARK)
        top(10, z, DARKER)
    for x in range(5, 9):
        top(x, 1, HI)

    plate(16, 16, 16, 16)  # низ
    plate(16, 11, 16, 5)  # бок: рамка и прорези-радиатор
    for x in range(18, 30, 2):
        put(x, 13, DARKER)
    terminal(0, 12, COPPER)
    terminal(4, 12, RED)
    terminal(8, 12, BLUE)
    return px


# ---------------------------------------------------------------- модели и состояния

UV_TERM = {'phase': [0, 6, 2, 8], 'plus': [2, 6, 4, 8], 'minus': [4, 6, 6, 8]}
# Повороты — как у преобразователя EE (блок «лицом вверх» — исходная модель)
ROT = {
    'up': {},
    'down': {'x': 180},
    'south': {'x': 270},
    'north': {'x': 270, 'y': 180},
    'east': {'x': 270, 'y': 270},
    'west': {'x': 270, 'y': 90},
}


def faces(uv):
    return {f: {'texture': '#0', 'uv': uv} for f in ('north', 'east', 'south', 'west', 'up', 'down')}


def model(name, terminals, kinds, rolled):
    tex = f'{NS}:block/{name}'
    els = []
    for t, k in zip(terminals, kinds):
        x, z = roll(t) if rolled else t
        els.append({'name': k, 'from': [x - 2, 3, z - 2], 'to': [x + 2, 7, z + 2], 'faces': faces(UV_TERM[k])})
    side = {'texture': '#0', 'uv': [8, 5.5, 16, 8]}
    # При крене верх тоже повёрнут (текстура по часовой на 90°), гравировка остаётся у своих клемм
    up = {'texture': '#0', 'uv': [0, 8, 8, 16], **({'rotation': 90} if rolled else {})}
    els.append({
        'name': 'base',
        'from': [0, 0, 0],
        'to': [16, 5, 16],
        'faces': {
            'north': dict(side, cullface='north'),
            'east': dict(side, cullface='east'),
            'south': dict(side, cullface='south'),
            'west': dict(side, cullface='west'),
            'up': up,
            'down': {'texture': '#0', 'uv': [8, 8, 16, 16], 'cullface': 'down'},
        },
    })
    return {'credit': 'ee_rectifier', 'textures': {'0': tex, 'particle': tex}, 'elements': els}


def dump(obj, *path):
    full = os.path.join(RES, *path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, 'w') as f:
        json.dump(obj, f, indent=2)


for i, (name, (terminals, kinds)) in enumerate(LAYOUTS.items()):
    os.makedirs(os.path.join(RES, 'textures', 'block'), exist_ok=True)
    write(os.path.join(RES, 'textures', 'block', name + '.png'), texture(terminals, kinds, 1258 + i))
    for rolled, fn in ((False, 'block'), (True, 'block_roll')):
        dump(model(name, terminals, kinds, rolled), 'models', 'block', name, fn + '.json')
    dump({'parent': f'{NS}:block/{name}/block'}, 'models', 'item', name + '.json')
    variants = {}
    for facing, rot in ROT.items():
        for logged in ('dry', 'oillogged', 'waterlogged'):
            for rolled in (False, True):
                key = f'facing={facing},logged_state={logged},roll={str(rolled).lower()}'
                variants[key] = {'model': f'{NS}:block/{name}/' + ('block_roll' if rolled else 'block'), **rot}
    dump({'variants': variants}, 'blockstates', name + '.json')
print('готово:', os.path.normpath(RES))
