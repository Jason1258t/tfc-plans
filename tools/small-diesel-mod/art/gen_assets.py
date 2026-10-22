"""
Текстуры, модели и состояния блоков Small Diesel. Запуск: python3 art/gen_assets.py
Модели — «лицом вверх» (у двигателя сверху выходит вал, у генератора сверху клеммы), положения — поворотами блокстейта,
как у плит Electro Energetics. Клеммы генератора — те же числа, что Terminals.CENTERS и Terminals.Y;
совпадение с точками проводов во всех положениях проверяет art/CheckNodes.java (./check-nodes.sh).
Палитра: сталь — как у плит EE, латунь — как у двигателей Create Diesel Generators.
"""
import json
import os
import random

from png import write

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(HERE, '..', 'src', 'main', 'resources', 'assets', 'small_diesel')
NS = 'small_diesel'


def hexc(h, a=255):
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)


FILL = [hexc(c) for c in ['8f9691'] * 5 + ['9aa49d'] * 4 + ['a8b3ab']]
RIM, EDGE, CORNER = hexc('828784'), hexc('595858'), hexc('494848')
DARK, DARKER, HI = hexc('60635f'), hexc('505351'), hexc('b4c1b8')
SOOT = [hexc(c) for c in ['2b2a2a', '363434', '403e3d', '4a4746']]
BRASS = [hexc(c) for c in ['7a5418', 'a8772a', 'd0a046', 'eecb6e']]
COPPER = [hexc(c) for c in ['b26247', 'c87456', 'd67b5b', 'e3826c']]
RED = [hexc(c) for c in ['7a2420', '9c2f27', 'b8392d', 'd4503f']]
BLUE = [hexc(c) for c in ['1f2a44', '2b3a5e', '3a4d78', '4d6394']]
CLEAR = (0, 0, 0, 0)

# Клеммы генератора (Terminals.java): «+» (4, 8), «−» (12, 8), центр на высоте 14,5
TERMINALS = [((4, 8), 'plus'), ((12, 8), 'minus')]
TERMINAL_Y = 14.5

ROT = {
    'up': {},
    'down': {'x': 180},
    'south': {'x': 270},
    'north': {'x': 270, 'y': 180},
    'east': {'x': 270, 'y': 270},
    'west': {'x': 270, 'y': 90},
}

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

# Области текстуры 32×32 (в единицах uv 0..16): верх, бок корпуса, низ, кромка, латунь, сажа, клеммы
UV_TOP = [0, 8, 8, 16]
UV_SIDE = [8, 0, 16, 6]
UV_BOTTOM = [8, 8, 16, 16]
UV_RIM = [8, 6, 16, 6.5]
UV_BRASS = [0, 0, 4, 2]
UV_SOOT = [0, 2, 2, 4]
UV_TERM = {'plus': [2, 6, 4, 8], 'minus': [4, 6, 6, 8]}


def texture(seed, kind):
    rng = random.Random(seed)
    px = [[CLEAR] * 32 for _ in range(32)]

    def plate(x0, y0, w, h):
        for y in range(h):
            for x in range(w):
                border = x in (0, w - 1) or y in (0, h - 1)
                corner = x in (0, w - 1) and y in (0, h - 1)
                rim = h > 6 and (x in (1, w - 2) or y in (1, h - 2))
                px[y0 + y][x0 + x] = CORNER if corner else EDGE if border else RIM if rim else rng.choice(FILL)

    def block4(x0, y0, pal):
        for y in range(4):
            for x in range(4):
                edge = x in (0, 3) or y in (0, 3)
                px[y0 + y][x0 + x] = pal[0] if (x in (0, 3) and y in (0, 3)) else pal[1] if edge else pal[2]
        px[y0 + 1][x0 + 1] = pal[3]

    def top(x, z, c):
        px[16 + z][x] = c

    plate(0, 16, 16, 16)
    if kind == 'engine':
        # Головка цилиндра: болты по углам, решётка клапанной крышки
        for x, z in ((3, 3), (12, 3), (3, 12), (12, 12)):
            top(x, z, BRASS[2])
        for z in range(5, 11, 2):
            for x in range(4, 12):
                top(x, z, DARK)
    else:
        # «+» под красной клеммой, «−» под синей; посередине знак постоянного тока «=»
        for dx, dz in ((0, -1), (-1, 0), (0, 0), (1, 0), (0, 1)):
            top(4 + dx, 12 + dz, RED[2])
        for dx in (-1, 0, 1):
            top(12 + dx, 12, BLUE[3])
        for x in (7, 8, 9):
            top(x, 7, DARKER)
            top(x, 9, DARKER)
    for x in range(5, 12):
        top(x, 1, HI)
    # Бок корпуса 16×12: рёбра охлаждения в верхней половине, латунная табличка внизу
    for y in range(12):
        for x in range(16):
            border = x in (0, 15) or y in (0, 11)
            c = EDGE if border else (DARK if (y < 6 and x % 2 == 0) else rng.choice(FILL))
            px[y][16 + x] = c
    for x in range(4, 12):
        px[8][16 + x] = BRASS[2]
        px[9][16 + x] = BRASS[1]
    for x in range(16):
        px[12][16 + x] = EDGE if x in (0, 15) else RIM
    plate(16, 16, 16, 16)
    block4(0, 0, BRASS)
    block4(4, 0, BRASS)
    block4(0, 4, SOOT)
    block4(4, 12, RED)
    block4(8, 12, BLUE)
    return px


def faces(uv, **extra):
    f = {k: {'texture': '#0', 'uv': uv} for k in ('north', 'east', 'south', 'west', 'up', 'down')}
    f.update(extra)
    return f


def roll(t):
    """(x, z) → (16 − z, x): так же, как Terminals.roll"""
    return (16 - t[1], t[0])


def r(a, b, rolled):
    if not rolled:
        return a, b
    return [16 - b[2], a[1], a[0]], [16 - a[2], b[1], b[0]]


def body(els, rolled, top_y):
    """Опорная плита, корпус с рёбрами, кромка крышки — общее у двигателя и генератора"""
    side = {'texture': '#0', 'uv': UV_SIDE}
    els.append({'name': 'base', 'from': [1, 0, 1], 'to': [15, 2, 15], 'faces': faces(UV_RIM, down={'texture': '#0', 'uv': UV_BOTTOM, 'cullface': 'down'})})
    els.append({'name': 'body', 'from': [2, 2, 2], 'to': [14, top_y, 14], 'faces': {
        'north': side, 'east': side, 'south': side, 'west': side,
        'up': {'texture': '#0', 'uv': UV_TOP, **({'rotation': 90} if rolled else {})}}})


def engine_model(name):
    """Двигатель: корпус, головка цилиндра, латунная крышка горловины, выхлопная труба; вал выходит сверху (блок-сущность)"""
    tex = f'{NS}:block/{name}'
    els = []
    body(els, False, 10)
    top = {'texture': '#0', 'uv': UV_TOP}
    side = {'texture': '#0', 'uv': UV_SIDE}
    els.append({'name': 'head', 'from': [3, 10, 3], 'to': [13, 13, 13], 'faces': {
        'north': side, 'east': side, 'south': side, 'west': side, 'up': top}})
    els.append({'name': 'filler', 'from': [10, 10, 13], 'to': [13, 12, 15], 'faces': faces(UV_BRASS)})
    els.append({'name': 'exhaust', 'from': [3, 10, 13], 'to': [5, 15, 15], 'faces': faces(UV_SOOT)})
    return {'credit': NS, 'textures': {'0': tex, 'particle': tex}, 'elements': els, 'display': DISPLAY}


def generator_model(name, rolled):
    """Генератор: тот же корпус, крышка с клеммами «+» и «−», латунная крышка горловины, выхлопная труба сбоку"""
    tex = f'{NS}:block/{name}'
    els = []
    body(els, rolled, 12)
    rim = {'texture': '#0', 'uv': UV_RIM}
    els.append({'name': 'lid', 'from': [1, 12, 1], 'to': [15, 13, 15], 'faces': {
        'north': rim, 'east': rim, 'south': rim, 'west': rim,
        'up': {'texture': '#0', 'uv': UV_TOP, **({'rotation': 90} if rolled else {})},
        'down': {'texture': '#0', 'uv': UV_BOTTOM}}})
    a, b = r([7, 13, 12], [9, 14, 14], rolled)
    els.append({'name': 'filler', 'from': a, 'to': b, 'faces': faces(UV_BRASS)})
    a, b = r([7, 3, 14], [9, 11, 16], rolled)
    els.append({'name': 'exhaust', 'from': a, 'to': b, 'faces': faces(UV_SOOT)})
    lo = TERMINAL_Y - 1.5
    for t, k in TERMINALS:
        x, z = roll(t) if rolled else t
        els.append({'name': k, 'from': [x - 2, lo, z - 2], 'to': [x + 2, lo + 3, z + 2], 'faces': faces(UV_TERM[k])})
    return {'credit': NS, 'textures': {'0': tex, 'particle': tex}, 'elements': els, 'display': DISPLAY}


def dump(obj, *path):
    full = os.path.join(RES, *path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, 'w') as f:
        json.dump(obj, f, indent=2)


os.makedirs(os.path.join(RES, 'textures', 'block'), exist_ok=True)

name = 'small_diesel_engine'
write(os.path.join(RES, 'textures', 'block', name + '.png'), texture(2100, 'engine'))
dump(engine_model(name), 'models', 'block', name + '.json')
dump({'parent': f'{NS}:block/{name}'}, 'models', 'item', name + '.json')
dump({'variants': {f'facing={f}': {'model': f'{NS}:block/{name}', **rot} for f, rot in ROT.items()}},
     'blockstates', name + '.json')

name = 'small_diesel_generator'
write(os.path.join(RES, 'textures', 'block', name + '.png'), texture(2101, 'generator'))
for rolled, fn in ((False, 'block'), (True, 'block_roll')):
    dump(generator_model(name, rolled), 'models', 'block', name, fn + '.json')
dump({'parent': f'{NS}:block/{name}/block'}, 'models', 'item', name + '.json')
variants = {}
for facing, rot in ROT.items():
    for logged in ('dry', 'oillogged', 'waterlogged'):
        for rolled in (False, True):
            variants[f'facing={facing},logged_state={logged},roll={str(rolled).lower()}'] = {
                'model': f'{NS}:block/{name}/' + ('block_roll' if rolled else 'block'), **rot}
dump({'variants': variants}, 'blockstates', name + '.json')
print('готово:', os.path.normpath(RES))
