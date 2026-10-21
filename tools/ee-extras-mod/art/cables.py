"""
Кабели: четырёхжильный соединитель, кабельные изоляторы, модель четырёхжильного кабеля, пустая модель жил, катушка.
Вызывается из gen_assets.py. Изоляторы и катушка — перекраска текстур EE (берутся из jar в ../../mods), остальное —
рисуется здесь в палитре EE. Координаты клемм соединителя — те же, что Layout.FOUR_CORE_TERMINATION.
"""
import glob
import os
import random
import tempfile
import zipfile

from png import read, write

HERE = os.path.dirname(os.path.abspath(__file__))
EE_JAR = sorted(glob.glob(os.path.join(HERE, '..', '..', '..', 'mods', 'electroenergetics-*.jar')))


def hexc(h, a=255):
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)


CLEAR = (0, 0, 0, 0)
FILL = [hexc(c) for c in ['8f9691'] * 5 + ['9aa49d'] * 4 + ['a8b3ab']]
RIM, EDGE, CORNER = hexc('828784'), hexc('595858'), hexc('494848')
DARKER, HI = hexc('505351'), hexc('b4c1b8')
RUBBER = [hexc(c) for c in ['18171a', '232125', '2d2b2f', '3a383c']]
# Цвета жил по IEC: L1 — коричневый, L2 — чёрный, L3 — серый, N — синий (тёмный край, середина, блик)
CORES = {
    'l1': [hexc('4a2a18'), hexc('6e4126'), hexc('8a5532')],
    'l2': [hexc('141414'), hexc('262626'), hexc('3a3a3a')],
    'l3': [hexc('5e5e5e'), hexc('7e7e7e'), hexc('9a9a9a')],
    'n': [hexc('1f2f5e'), hexc('2e4a8c'), hexc('4566b0')],
}
X = [2, 6, 10, 14]  # центры клемм L1, L2, L3, N


def ee_png(path):
    """Текстура из jar EE (png.read умеет только файлы)"""
    if not EE_JAR:
        raise SystemExit('нет jar Electro Energetics в ../../mods — нужен для текстур изоляторов и катушки')
    with zipfile.ZipFile(EE_JAR[-1]) as z, tempfile.NamedTemporaryFile(suffix='.png') as f:
        f.write(z.read('assets/electroenergetics/textures/' + path))
        f.flush()
        return read(f.name)


def luma(c):
    return 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]


def tint(c, base):
    """Светлый пиксель (керамика) — в цвет base с той же яркостью относительно белого"""
    k = luma(c) / 233
    return tuple(min(255, int(base[i] * k * 1.6)) for i in range(3)) + (c[3],)


# ---------------------------------------------------------------- текстуры


def termination_texture():
    """32×32: плита (0..15, 16..31), бок (16..31, 11..15), клеммы L1/L2/L3/N (0/4/8/12, 12), торец кабеля (16, 0)"""
    rng = random.Random(4242)
    px = [[CLEAR] * 32 for _ in range(32)]

    def plate(x0, y0, w, h):
        for y in range(h):
            for x in range(w):
                border = x in (0, w - 1) or y in (0, h - 1)
                corner = x in (0, w - 1) and y in (0, h - 1)
                rim = h > 6 and (x in (1, w - 2) or y in (1, h - 2))
                px[y0 + y][x0 + x] = CORNER if corner else EDGE if border else RIM if rim else rng.choice(FILL)

    plate(0, 16, 16, 16)
    plate(16, 11, 16, 5)
    for x in range(18, 30, 2):
        px[13][x] = DARKER
    for i, key in enumerate(['l1', 'l2', 'l3', 'n']):
        dark, mid, hi = CORES[key]
        for y in range(4):
            for x in range(4):
                px[12 + y][4 * i + x] = dark if x in (0, 3) or y in (0, 3) else mid
        px[13][4 * i + 1] = hi
    # Торец ввода кабеля: резиновая втулка 8×8 с отверстием
    for y in range(8):
        for x in range(8):
            r = max(abs(x - 3.5), abs(y - 3.5))
            px[y][16 + x] = RUBBER[0] if r > 3 else RUBBER[3] if r > 2 else RUBBER[1] if r > 1 else RUBBER[0]
    # Боковина выступа — резина (8..15, 0..7)
    for y in range(8):
        for x in range(8):
            px[y][24 + x] = RUBBER[1 + (x + y) % 2]
    return px


def segment_texture():
    """16×16: оболочка четырёхжильного кабеля — тёмная резина с синей и коричневой полосой (по длине — x)"""
    px = [[CLEAR] * 16 for _ in range(16)]
    for x in range(16):
        for y in range(6):
            px[y][x] = RUBBER[1] if y in (0, 5) else RUBBER[2]
        px[2][x] = CORES['n'][1]
        px[3][x] = CORES['l1'][1] if x % 8 < 4 else RUBBER[3]
    return px


def insulator_texture(base):
    src = ee_png('block/connector.png')
    out = []
    for row in src:
        out.append([tint(c, base) if c[3] and luma(c) > 180 and abs(c[0] - c[2]) < 20 else c for c in row])
    return out


def spool_texture():
    """
    Катушка двухпроводного кабеля EE как есть (намотка — чёрная оболочка), только концы жил другие: у EE синий (3×2)
    и красный хвост; здесь — коричневый L1 и синий N сбоку, серый L3 снизу. Без перекраски намотки — так читается.
    """
    px = [list(r) for r in ee_png('item/duplex_wire_spool.png')]
    for y, row in enumerate(px):
        for x, c in enumerate(row):
            if not c[3]:
                continue
            blue = c[2] > c[0] + 20
            red = y >= 13 and x >= 9 and c[0] > c[2] + 15  # хвост внизу: красный с тёмными и светлыми пикселями
            if blue:
                key = 'l1' if y == 11 else 'n'
            elif red:
                key = 'l3'
            else:
                continue
            dark, mid, hi = CORES[key]
            row[x] = hi if luma(c) > 70 else mid
    return px


# ---------------------------------------------------------------- модели

# Поворот крена (x, z) → (16 − z, x): какая грань куда уходит
ROLL_FACE = {'north': 'east', 'east': 'south', 'south': 'west', 'west': 'north', 'up': 'up', 'down': 'down'}


def box(name, frm, to, faces):
    return {'name': name, 'from': frm, 'to': to, 'faces': faces}


def roll_box(e):
    (x0, y0, z0), (x1, y1, z1) = e['from'], e['to']
    faces = {}
    for f, v in e['faces'].items():
        v = dict(v)
        if f in ('up', 'down'):
            v['rotation'] = (v.get('rotation', 0) + 90) % 360
        faces[ROLL_FACE[f]] = v
    return {**e, 'from': [16 - z1, y0, x0], 'to': [16 - z0, y1, x1], 'faces': faces}


def turn(els, o):
    """o раз крен — положение o (CableOrientation: ROLL + 2·FLIP)"""
    for _ in range(o):
        els = [roll_box(e) for e in els]
    return els


# Модели по положению o = ROLL + 2·FLIP
ORIENT_MODELS = ['block', 'block_roll', 'block_flip', 'block_flip_roll']


def termination_model(ns, o, display):
    t = '#0'
    side = {'texture': t, 'uv': [8, 5.5, 16, 8]}
    els = [box('plate', [0, 0, 1], [16, 2, 7], {
        'north': side, 'east': side, 'south': side, 'west': side,
        'up': {'texture': t, 'uv': [0, 8, 8, 11]}, 'down': {'texture': t, 'uv': [0, 8, 8, 11]}})]
    for i, x in enumerate(X):
        uv = {'texture': t, 'uv': [2 * i, 6, 2 * i + 2, 8]}
        els.append(box(['l1', 'l2', 'l3', 'n'][i], [x - 1.5, 2, 2.5], [x + 1.5, 5, 5.5],
                       {f: uv for f in ('north', 'east', 'south', 'west', 'up')}))
    rubber = {'texture': t, 'uv': [12, 0, 16, 4]}
    els.append(box('cable_entry', [6, 0, 7], [10, 4, 13], {
        'north': rubber, 'east': rubber, 'west': rubber, 'up': rubber, 'down': rubber,
        'south': {'texture': t, 'uv': [8, 0, 12, 4]}}))
    els = turn(els, o)
    tex = f'{ns}:block/four_core_termination'
    return {'credit': 'ee_extras', 'textures': {'0': tex, 'particle': tex}, 'elements': els, 'display': display}


def segment_model(ns):
    """Отрезок четырёхжильного кабеля (как у моделей отрезков EE: вдоль z от 0 до 8, сечение вокруг нуля)"""
    t = '#0'
    along = {'texture': t, 'uv': [0, 0, 16, 6], 'rotation': 90}
    return {
        'credit': 'ee_extras',
        'textures': {'0': f'{ns}:block/four_core_cable', 'particle': f'{ns}:block/four_core_cable'},
        'elements': [box('sheath', [-1.5, -1.5, 0], [1.5, 1.5, 8], {
            'east': {'texture': t, 'uv': [0, 0, 16, 6]}, 'west': {'texture': t, 'uv': [0, 0, 16, 6]},
            'up': along, 'down': along,
            'north': {'texture': t, 'uv': [0, 0, 6, 6]}, 'south': {'texture': t, 'uv': [0, 0, 6, 6]}})],
    }


def insulator_model(ns, name):
    """Опорный изолятор EE (connector/block.json) со своей текстурой"""
    with zipfile.ZipFile(EE_JAR[-1]) as z:
        import json
        m = json.loads(z.read('assets/electroenergetics/models/block/connector/block.json'))
    m['textures'] = {'0': f'{ns}:block/{name}', 'particle': f'{ns}:block/{name}'}
    m['credit'] = 'ee_extras (модель — опорный изолятор Electro Energetics)'
    return m


def blockstate(ns, name, rot, models):
    """FACING × ROLL × FLIP × вода/масло; models — по положению o = ROLL + 2·FLIP"""
    variants = {}
    for facing, r in rot.items():
        for flip in (False, True):
            for logged in ('dry', 'oillogged', 'waterlogged'):
                for rolled in (False, True):
                    key = f'facing={facing},flip={str(flip).lower()},logged_state={logged},roll={str(rolled).lower()}'
                    variants[key] = {'model': f'{ns}:block/{name}/{models[rolled + 2 * flip]}', **r}
    return {'variants': variants}


# Сторона кабеля двухпроводного соединителя EE по положению (BundledWireNodeConfigurator: юг, восток, север, запад)
# → сколько раз повернуть креном вывод, нарисованный на юг (крен уводит юг на запад)
EE_TURNS = [0, 3, 2, 1]


def ee_termination_models(ns):
    """
    Модели двухпроводного соединителя EE с резиновым выводом кабеля: у EE кабель выходит из гладкой боковины, точку не
    видно. Модели EE из jar + втулка у узла кабеля (8, 2, 12 лицом вверх, сторона 0). Лежат в assets/electroenergetics
    этого мода — ресурсы модов идут в порядке загрузки, ee_extras грузится после EE (ordering AFTER) и перекрывает.
    """
    import json
    out = {}
    with zipfile.ZipFile(EE_JAR[-1]) as z:
        for o, name in enumerate(ORIENT_MODELS):
            m = json.loads(z.read(f'assets/electroenergetics/models/block/duplex_wire_termination/{name}.json'))
            m['textures']['9'] = f'{ns}:block/four_core_termination'
            rubber = {'texture': '#9', 'uv': [12, 0, 16, 4]}
            gland = box('cable_gland', [6, 0, 12], [10, 4, 14], {
                'east': rubber, 'west': rubber, 'up': rubber, 'down': rubber,
                'south': {'texture': '#9', 'uv': [8, 0, 12, 4]}})
            m['elements'] = m['elements'] + turn([gland], EE_TURNS[o])
            m['credit'] = 'Electro Energetics; ee_extras: вывод кабеля (cable_gland)'
            out[name] = m
    return out


def dump_to(res, obj, namespace, *path):
    """Файл в assets/<namespace>/… (res — assets/<ns> этого мода)"""
    import json
    p = os.path.join(os.path.dirname(res), namespace, *path)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, 'w') as f:
        json.dump(obj, f, indent=2)


def generate(res, ns, dump, rot, display):
    tex = os.path.join(res, 'textures')
    os.makedirs(os.path.join(tex, 'block'), exist_ok=True)
    os.makedirs(os.path.join(tex, 'item'), exist_ok=True)

    write(os.path.join(tex, 'block', 'four_core_termination.png'), termination_texture())
    for o, name in enumerate(ORIENT_MODELS):
        dump(termination_model(ns, o, display), 'models', 'block', 'four_core_termination', name + '.json')
    dump({'parent': f'{ns}:block/four_core_termination/block'}, 'models', 'item', 'four_core_termination.json')
    dump(blockstate(ns, 'four_core_termination', rot, ORIENT_MODELS), 'blockstates', 'four_core_termination.json')

    for name, base in (('duplex_cable_insulator', hexc('5a5450')), ('four_core_cable_insulator', hexc('3f5a8c'))):
        write(os.path.join(tex, 'block', name + '.png'), insulator_texture(base))
        dump(insulator_model(ns, name), 'models', 'block', name, 'block.json')
        dump({'parent': f'{ns}:block/{name}/block'}, 'models', 'item', name + '.json')
        dump(blockstate(ns, name, rot, ['block'] * 4), 'blockstates', name + '.json')

    write(os.path.join(tex, 'block', 'four_core_cable.png'), segment_texture())
    dump(segment_model(ns), 'models', 'block', 'four_core_cable_segment.json')
    # Оболочка двухжильного кабеля: у EE 1.1.2 модели block/duplex_wire_segment нет — берём его витую пару
    dump({'parent': 'electroenergetics:block/bundled_wire_segment'}, 'models', 'block', 'duplex_cable_segment.json')
    for name, m in ee_termination_models(ns).items():
        dump_to(res, m, 'electroenergetics', 'models', 'block', 'duplex_wire_termination', name + '.json')
    dump({'credit': 'ee_extras: жилы кабеля не рисуются', 'textures': {'particle': f'{ns}:block/four_core_cable'},
          'elements': []}, 'models', 'block', 'empty_wire_segment.json')

    write(os.path.join(tex, 'item', 'four_core_cable_spool.png'), spool_texture())
    dump({'parent': 'minecraft:item/generated', 'textures': {'layer0': f'{ns}:item/four_core_cable_spool'}},
         'models', 'item', 'four_core_cable_spool.json')
