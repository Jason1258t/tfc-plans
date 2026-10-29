"""
Текстуры, модели и состояния блоков аддона. Запуск: python3 art/gen_assets.py
Раскладки клемм — те же, что в Layout.java (центры {x, z} в пикселях, клемма 4×4×4, низ на высоте 3);
совпадение моделей с точками крепления проводов во всех положениях проверяет art/CheckNodes.java.
Стиль — как у преобразователя Electro Energetics: стальная плита 16×5×16, медные клеммы сверху, палитра EE.
"""
import json
import os
import random

from png import write

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(HERE, '..', 'src', 'main', 'resources', 'assets', 'ee_extras')
NS = 'ee_extras'

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
    # Инверторы: те же клеммы, что у выпрямителей; вместо диода — знак преобразователя «= / ~»
    'three_phase_inverter': (
        [(3, 3), (8, 3), (13, 3), (3, 13), (13, 13)],
        ['phase', 'phase', 'phase', 'plus', 'minus'],
    ),
    'single_phase_inverter': (
        [(3, 3), (13, 3), (3, 13), (13, 13)],
        ['phase', 'phase', 'plus', 'minus'],
    ),
    # Двусторонний преобразователь: верхний ряд — заряд (сеть EE → FE), нижний — разряд (FE → сеть EE)
    'bidirectional_converter': (
        [(3, 3), (13, 3), (3, 13), (13, 13)],
        ['phase', 'phase', 'phase', 'phase'],  # медные, как у преобразователя EE; «+»/«−» — гравировкой
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


# Тяжёлые блоки (Tier.HEAVY): те же раскладки, клемма — проходной изолятор с медной шапкой, центр шапки на высоте 14
HEAVY = ['three_phase_rectifier', 'single_phase_rectifier', 'three_phase_inverter', 'single_phase_inverter']
HEAVY_Y = 14
CERAMIC = [hexc(c) for c in ['6b3a26', '8a4b30', 'a65c3a', 'c27453']]  # глазурь изоляторов, как у EE


def texture(terminals, kinds, seed, converter=False, inverter=False):
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
    if converter:
        return converter_marks(px, top, terminal, plate)
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
    if inverter:
        # Знак инвертора между клеммами постоянного тока (x 6..10, z 9..15): рамка, диагональ, «=» вверху слева,
        # «~» внизу справа
        for i in range(5):
            top(6 + i, 9, DARKER)
            top(6 + i, 15, DARKER)
        for z in range(9, 16):
            top(6, z, DARKER)
            top(10, z, DARKER)
        for i in range(5):
            top(9 - i // 2 if i < 4 else 7, 10 + i, DARK)
        top(7, 10, HI)
        top(8, 10, HI)
        top(7, 11, HI)
        top(8, 11, HI)
        for dx, dz in ((0, 13), (1, 12), (2, 13)):
            top(7 + dx, dz + 1, HI)
    else:
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


def heavy_parts(px, seed):
    """Тяжёлый блок — дорисовать в свободные места текстуры: бок корпуса (16..29, 0..9) с рёбрами жёсткости,
    радиаторное ребро (0..7, 0..9), глазурь изолятора с юбками (8..13, 0..3)"""
    rng = random.Random(seed)
    for y in range(10):
        for x in range(14):
            border = x in (0, 13) or y in (0, 9)
            c = EDGE if border else RIM if y in (1, 8) else rng.choice(FILL)
            if not border and x in (4, 9):
                c = DARK
            px[y][16 + x] = c
    for x in range(2, 12):  # табличка
        px[3][16 + x] = DARKER
        px[5][16 + x] = DARKER
    for y in range(10):
        for x in range(8):
            px[y][x] = DARKER if x in (0, 7) else DARK if y % 3 == 0 else rng.choice(FILL[:5])
    for y in range(4):
        for x in range(6):
            px[y][8 + x] = CERAMIC[0] if y == 3 else CERAMIC[3] if (x == 1 and y < 3) else CERAMIC[1 + (y % 2)]
    return px


def converter_marks(px, top, terminal, plate):
    """Преобразователь: «+»/«−» у каждой клеммы, стрелка вниз (в FE) между клеммами заряда, вверх — у разряда"""
    for cx, row in ((3, 6), (13, 6), (3, 10), (13, 10)):
        if cx == 3:
            for dx, dz in ((0, -1), (-1, 0), (0, 0), (1, 0), (0, 1)):
                top(cx + dx, row + dz, RED[2])
        else:
            for dx in (-1, 0, 1):
                top(cx + dx, row, BLUE[3])
    for z in range(1, 6):  # ↓ между клеммами заряда (z 1..5)
        top(8, z, DARKER)
    for dx in (-2, -1, 1, 2):
        top(8 + dx, 5 - abs(dx), DARKER)
    for z in range(11, 16):  # ↑ между клеммами разряда (z 11..15)
        top(8, z, DARKER)
    for dx in (-2, -1, 1, 2):
        top(8 + dx, 11 + abs(dx), DARKER)
    for x in range(5, 12):  # «шина FE» посередине
        top(x, 8, HI)
    plate(16, 16, 16, 16)
    plate(16, 11, 16, 5)
    for x in range(18, 30, 2):
        px[13][x] = DARKER
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


# Как держать блок в руке и показывать в инвентаре — как у преобразователя EE (иконка — объёмная, под 30° / −135°)
DISPLAY = {
    'thirdperson_righthand': {'rotation': [75, 45, 0], 'translation': [0, 2.5, 0], 'scale': [0.375, 0.375, 0.375]},
    'thirdperson_lefthand': {'rotation': [75, 45, 0], 'translation': [0, 2.5, 0], 'scale': [0.375, 0.375, 0.375]},
    'firstperson_righthand': {'rotation': [0, 45, 0], 'scale': [0.4, 0.4, 0.4]},
    'firstperson_lefthand': {'rotation': [0, -135, 0], 'scale': [0.4, 0.4, 0.4]},
    'ground': {'translation': [0, 3, 0], 'scale': [0.25, 0.25, 0.25]},
    'gui': {'rotation': [30, -135, 0], 'scale': [0.625, 0.625, 0.625]},
    'head': {'translation': [0, 18, 0], 'scale': [1.5, 1.5, 1.5]},
    'fixed': {'scale': [0.5, 0.5, 0.5]},
}


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
    return {'credit': 'ee_extras', 'textures': {'0': tex, 'particle': tex}, 'elements': els, 'display': DISPLAY}


def heavy_model(name, terminals, kinds, rolled):
    """Целый блок: корпус 14×10×14, по бокам радиаторные рёбра, крышка, на ней проходные изоляторы с шапками"""
    tex = f'{NS}:block/heavy_{name}'
    els = []
    body = {'texture': '#0', 'uv': [8, 0, 15, 5]}
    els.append({'name': 'body', 'from': [1, 0, 1], 'to': [15, 10, 15], 'faces': {
        'north': body, 'east': body, 'south': body, 'west': body,
        'down': {'texture': '#0', 'uv': [8, 8, 15, 15], 'cullface': 'down'}}})
    fin = {'texture': '#0', 'uv': [0, 0, 4, 5]}
    fin_edge = {'texture': '#0', 'uv': [0, 0, 0.5, 5]}
    # Рёбра — по сторонам, вдоль которых нет клемм (при крене — на других сторонах, как и клеммы)
    for z in (2.5, 5.5, 8.5, 11.5):
        for x0 in (0, 15):
            a, b = ([x0, 1, z], [x0 + 1, 9, z + 1])
            if rolled:
                a, b = [16 - b[2], 1, a[0]], [16 - a[2], 9, b[0]]
            els.append({'from': a, 'to': b, 'faces': {
                'north': fin, 'south': fin, 'east': fin, 'west': fin,
                'up': fin_edge, 'down': fin_edge}})
    side = {'texture': '#0', 'uv': [8, 5.5, 16, 6]}
    up = {'texture': '#0', 'uv': [0, 8, 8, 16], **({'rotation': 90} if rolled else {})}
    els.append({'name': 'lid', 'from': [0, 10, 0], 'to': [16, 11, 16], 'faces': {
        'north': side, 'east': side, 'south': side, 'west': side, 'up': up,
        'down': {'texture': '#0', 'uv': [8, 8, 16, 16]}}})
    ceramic = {f: {'texture': '#0', 'uv': [4, 0, 7, 2]} for f in ('north', 'east', 'south', 'west')}
    for t, k in zip(terminals, kinds):
        x, z = roll(t) if rolled else t
        els.append({'name': 'bushing', 'from': [x - 1.5, 11, z - 1.5], 'to': [x + 1.5, HEAVY_Y - 1, z + 1.5],
                    'faces': dict(ceramic, up={'texture': '#0', 'uv': [4, 0, 5.5, 1.5]})})
        u = UV_TERM[k]
        cap = {f: {'texture': '#0', 'uv': [u[0], u[1], u[0] + 1, u[1] + 1]} for f in ('north', 'east', 'south', 'west', 'up', 'down')}
        els.append({'name': k, 'from': [x - 1, HEAVY_Y - 1, z - 1], 'to': [x + 1, HEAVY_Y + 1, z + 1], 'faces': cap})
    return {'credit': 'ee_extras', 'textures': {'0': tex, 'particle': tex}, 'elements': els, 'display': DISPLAY}


def blockstate(model_dir):
    variants = {}
    for facing, rot in ROT.items():
        for logged in ('dry', 'oillogged', 'waterlogged'):
            for rolled in (False, True):
                key = f'facing={facing},logged_state={logged},roll={str(rolled).lower()}'
                variants[key] = {'model': f'{NS}:block/{model_dir}/' + ('block_roll' if rolled else 'block'), **rot}
    return {'variants': variants}


def dump(obj, *path):
    full = os.path.join(RES, *path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, 'w') as f:
        json.dump(obj, f, indent=2)


import machines  # noqa: E402 — генератор, выпрямители и инверторы по образцу настоящих (art/machines.py)

for i, (name, (terminals, kinds)) in enumerate(LAYOUTS.items()):
    os.makedirs(os.path.join(RES, 'textures', 'block'), exist_ok=True)
    # Сид — по прежнему порядку (у старых блоков текстура не меняется), у новых — свой
    seed = {'three_phase_rectifier': 1258, 'single_phase_rectifier': 1259, 'bidirectional_converter': 1260}.get(name, 1300 + i)
    if name == 'bidirectional_converter':
        write(os.path.join(RES, 'textures', 'block', name + '.png'), texture(terminals, kinds, seed, converter=True))
        for rolled, fn in ((False, 'block'), (True, 'block_roll')):
            dump(model(name, terminals, kinds, rolled), 'models', 'block', name, fn + '.json')
    else:
        inverter = name.endswith('_inverter')
        machines.emit(name, machines.converter(name, terminals, kinds, inverter, seed), RES, NS, dump, DISPLAY)
        heavy = 'heavy_' + name
        machines.emit(heavy, machines.heavy_converter(heavy, terminals, kinds, inverter, seed + 100), RES, NS, dump,
                      DISPLAY)
        dump({'parent': f'{NS}:block/{heavy}/block'}, 'models', 'item', heavy + '.json')
        dump(blockstate(heavy), 'blockstates', heavy + '.json')
    dump({'parent': f'{NS}:block/{name}/block'}, 'models', 'item', name + '.json')
    dump(blockstate(name), 'blockstates', name + '.json')
# ---------------------------------------------------------------- компактный кинетический генератор (2.3)

name = 'compact_kinetic_generator'
machines.emit(name, machines.compact_generator(1400), RES, NS, dump, machines.lying_display(DISPLAY))
dump({'parent': f'{NS}:block/{name}/block'}, 'models', 'item', name + '.json')
dump(blockstate(name), 'blockstates', name + '.json')
import acmachines  # noqa: E402 — преобразователи частоты и синхронизаторы (art/acmachines.py, 2.4)

acmachines.generate(RES, NS, dump, blockstate, DISPLAY, machines.emit)
import cables  # noqa: E402 — кабели, соединитель, изоляторы, катушка (art/cables.py)

cables.generate(RES, NS, dump, ROT, DISPLAY)
import lines  # noqa: E402 — провода ЛЭП и натяжной зажим (art/lines.py)

lines.generate(RES, NS, dump)
print('готово:', os.path.normpath(RES))
