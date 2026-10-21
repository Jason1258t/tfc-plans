"""
Провода ЛЭП (LineWire.java) и натяжной зажим: текстуры отрезков, модели отрезков и зажима, предметы и катушки,
рецепты, тег катушек EE. Вызывается из gen_assets.py.

Отрезки — как у проводов EE: модель вдоль z от 0 до 8, сечение вокруг нуля (EE масштабирует его по толщине провода).
Тонкие провода — две плоскости крестом (как copper_wire_segment EE), шина и кабель — брусок (как iron_bus_segment).
Предметы и катушки — перекраска текстур EE из jar (медь → палитра металла), чтобы стояли в одном ряду с катушками EE.
"""
import json
import os

from cables import CLEAR, ee_png, hexc, luma
from png import write

# Палитры металлов от тёмного к светлому (медь — оттенки медного провода EE)
PAL = {
    'copper': ['5b2924', '793b2b', '904931', 'c26b4c', 'e3826c'],
    'aluminum': ['676c72', '8a9097', 'aab0b7', 'c8ced3', 'e8ecef'],
    'steel': ['33363a', '4a4e52', '62676c', '7c8287', '9aa0a5'],
    'bronze': ['533512', '75501e', '96692b', 'b9873b', 'd9aa5e'],
    'rubber': ['121114', '1b1a1e', '252328', '302e34', '403e45'],
    'zinc': ['55595c', '74797c', '93989b', 'b1b6b8', 'd2d6d8'],
}
PAL = {k: [hexc(c) for c in v] for k, v in PAL.items()}

# Ряды полосы текстуры block/line_wires (по 2 пикселя): id провода → (ряд, палитра, рисунок)
ROWS = {
    'stranded_copper': (0, 'copper', 'twist'),
    'acsr': (2, 'aluminum', 'twist'),
    'aluminum': (4, 'aluminum', 'plain'),
    'bronze': (6, 'bronze', 'plain'),
    'steel': (8, 'steel', 'twist'),
    'power_cable': (10, 'rubber', 'plain'),
    'copper_busbar': (12, 'copper', 'plain'),
}
BOX = {'power_cable', 'copper_busbar'}

# Провода: свой предмет (None — провод IE по тегу) и палитра предмета/катушки
ITEMS = {
    'copper_busbar': ('copper_busbar', 'copper'),
    'power_cable': ('power_cable', 'rubber'),
    'stranded_copper': ('stranded_copper_wire', 'copper'),
    'acsr': ('acsr_wire', 'aluminum'),
    'aluminum': (None, 'aluminum'),
    'bronze': ('bronze_wire', 'bronze'),
    'steel': (None, 'steel'),
}


def strip_texture():
    """16×16: по 2 пикселя на провод; «twist» — витые пряди (диагональ), «plain» — светлый верх, тёмный низ"""
    px = [[CLEAR] * 16 for _ in range(16)]
    for wid, (row, pal, kind) in ROWS.items():
        p = PAL[pal]
        for x in range(16):
            for dy in range(2):
                if kind == 'twist':
                    k = (x + 2 * dy) % 4
                    c = [p[3], p[4], p[2], p[1]][k]
                else:
                    c = p[3] if dy == 0 else p[1]
                    if x % 8 == 0:
                        c = p[2]
                px[row + dy][x] = c
    # АС: в стыке прядей проглядывает стальной сердечник
    for x in range(1, 16, 4):
        px[3][x] = PAL['steel'][2]
    return px


def clamp_texture():
    """16×16: оцинкованная сталь, болты (натяжной зажим)"""
    p = PAL['zinc']
    px = [[p[2 + (x * 7 + y * 3) % 2] for x in range(16)] for y in range(16)]
    for x in range(16):
        px[0][x] = p[1]
        px[15][x] = p[0]
    for y in range(16):
        px[y][0] = p[1]
        px[y][15] = p[0]
    for cx, cy in ((4, 4), (11, 4), (4, 11), (11, 11)):
        px[cy][cx] = p[4]
        px[cy][cx + 1] = p[3]
        px[cy + 1][cx] = p[1]
        px[cy + 1][cx + 1] = p[0]
    return px


def cross_model(ns, row):
    """Как copper_wire_segment EE: горизонтальная и вертикальная плоскости 2×8"""
    t = '#0'
    uv, uv_r = [8, row, 16, row + 2], [16, row, 8, row + 2]
    return {
        'credit': 'ee_extras', 'textures': {'0': f'{ns}:block/line_wires', 'particle': f'{ns}:block/line_wires'},
        'elements': [
            {'from': [-1, 0, 0], 'to': [1, 0, 8], 'faces': {
                'up': {'uv': uv_r, 'rotation': 90, 'texture': t}, 'down': {'uv': uv, 'rotation': 90, 'texture': t}}},
            {'from': [0, -1, 0], 'to': [0, 1, 8], 'faces': {
                'east': {'uv': uv, 'texture': t}, 'west': {'uv': uv_r, 'texture': t}}},
        ]}


def box_model(ns, row):
    """Как iron_bus_segment EE: брусок 2×2×8"""
    t = '#0'
    side, side_r, end = [0, row, 8, row + 2], [8, row, 0, row + 2], [0, row, 2, row + 2]
    return {
        'credit': 'ee_extras', 'textures': {'0': f'{ns}:block/line_wires', 'particle': f'{ns}:block/line_wires'},
        'elements': [{'from': [-1, -1, 0], 'to': [1, 1, 8], 'faces': {
            'north': {'uv': end, 'texture': t}, 'south': {'uv': end, 'texture': t},
            'east': {'uv': side, 'texture': t}, 'west': {'uv': side_r, 'texture': t},
            'up': {'uv': side, 'rotation': 90, 'texture': t}, 'down': {'uv': side_r, 'rotation': 90, 'texture': t}}}]}


def clamp_model(ns):
    """Натяжной зажим: гильза вдоль провода (ось x, как у гасителя EE) и болтовые ушки сверху и снизу"""
    t = '#0'

    def faces(u):
        return {f: {'uv': u, 'texture': t} for f in ('north', 'south', 'east', 'west', 'up', 'down')}
    return {
        'credit': 'ee_extras', 'textures': {'0': f'{ns}:block/tension_clamp', 'particle': f'{ns}:block/tension_clamp'},
        'elements': [
            {'from': [-4, -1.5, -1.5], 'to': [4, 1.5, 1.5], 'faces': faces([0, 0, 8, 3])},
            {'from': [-2.5, -3, -0.75], 'to': [-0.5, 3, 0.75], 'faces': faces([10, 0, 12, 6])},
            {'from': [0.5, -3, -0.75], 'to': [2.5, 3, 0.75], 'faces': faces([12, 0, 14, 6])},
        ]}


def is_copper(c):
    """Медь в текстурах EE: красная заметно больше зелёной (дерево катушки — около 1,4)"""
    return c[3] and c[0] > 1.7 * (c[1] + 1)


def is_grey(c):
    return c[3] and abs(c[0] - c[2]) < 12 and abs(c[0] - c[1]) < 12


def recolor(px, pal, pick):
    """Пиксели, отобранные pick, — в палитру pal по порядку яркости исходных оттенков"""
    shades = sorted({c for row in px for c in row if pick(c)}, key=luma)
    if not shades:
        return [list(r) for r in px]
    m = {c: pal[min(len(pal) - 1, int(i * len(pal) / len(shades)))] for i, c in enumerate(shades)}
    return [[m.get(c, c) if pick(c) else c for c in row] for row in px]


def twist(px, pal, core=None):
    """Витые пряди: каждая третья диагональ светлее на два тона; core — проблески сердечника (АС — сталь)"""
    idx = {c: i for i, c in enumerate(pal)}
    out = [list(r) for r in px]
    for y, row in enumerate(out):
        for x, c in enumerate(row):
            if c not in idx:
                continue
            if core and (x + y) % 4 == 0 and idx[c] < 3:
                row[x] = core
            elif (x - y) % 3 == 0:
                row[x] = pal[min(idx[c] + 2, len(pal) - 1)]
    return out


STRANDED = {'stranded_copper': None, 'acsr': PAL['steel'][1]}


def busbar_item():
    """Медная шина: плоская полоса по диагонали с отверстиями под болты"""
    p = PAL['copper']
    px = [[CLEAR] * 16 for _ in range(16)]
    for i in range(2, 14):
        for w in range(-1, 2):
            x, y = i + w, 15 - i
            if 0 <= x < 16:
                px[y][x] = [p[1], p[3], p[4]][w + 1]
    for i in (4, 8, 12):
        px[15 - i][i] = p[0]
    return px


def clamp_item():
    """Натяжной зажим: гильза по диагонали, сверху ушко"""
    p = PAL['zinc']
    px = [[CLEAR] * 16 for _ in range(16)]
    for i in range(3, 13):
        for w in range(-1, 2):
            x, y = i + w, 15 - i
            px[y][x] = [p[1], p[3], p[4]][w + 1]
    for y in range(3, 7):
        for x in range(9, 13):
            px[y][x] = p[2] if (x in (9, 12) or y in (3, 6)) else CLEAR
    # концы провода из гильзы
    for i in (1, 2, 13, 14):
        px[15 - i][i] = PAL['aluminum'][3]
    return px


def recipes(data, ns):
    def shaped(name, pattern, key, out, count=1):
        return name, {'type': 'minecraft:crafting_shaped', 'category': 'misc', 'pattern': pattern, 'key': key,
                      'result': {'count': count, 'id': out}}

    def shapeless(name, ingredients, out, count=1):
        return name, {'type': 'minecraft:crafting_shapeless', 'category': 'misc', 'ingredients': ingredients,
                      'result': {'count': count, 'id': out}}

    spool_key = {'s': {'item': 'electroenergetics:empty_spool'}}
    out = [
        shapeless('stranded_copper_wire', [{'tag': 'c:wires/copper'}] * 3, f'{ns}:stranded_copper_wire'),
        shapeless('acsr_wire', [{'tag': 'c:wires/aluminum'}] * 3 + [{'tag': 'c:wires/steel'}], f'{ns}:acsr_wire', 2),
        shapeless('bronze_wire', [{'tag': 'c:sheets/bronze'}, {'item': 'immersiveengineering:wirecutter'}],
                  f'{ns}:bronze_wire', 2),
        ('bronze_wire_cutting', {'type': 'create:cutting', 'ingredients': [{'tag': 'c:sheets/bronze'}],
                                 'processing_time': 50, 'results': [{'count': 4, 'id': f'{ns}:bronze_wire'}]}),
        shapeless('power_cable', [{'item': 'electroenergetics:heavily_insulated_wire'},
                                  {'item': f'{ns}:stranded_copper_wire'}, {'item': f'{ns}:stranded_copper_wire'}],
                  f'{ns}:power_cable'),
        shapeless('copper_busbar', [{'tag': 'c:plates/copper'}] * 2, f'{ns}:copper_busbar'),
        shapeless('tension_clamp', [{'tag': 'c:sheets/wrought_iron'}, {'tag': 'c:rods/wrought_iron'}],
                  f'{ns}:tension_clamp', 2),
    ]
    for wid, (item, _) in ITEMS.items():
        w = {'item': f'{ns}:{item}'} if item else {'tag': f'c:wires/{wid}'}
        out.append(shaped(f'{wid}_spool', [' w ', 'wsw', ' w '], {**spool_key, 'w': w}, f'{ns}:{wid}_spool'))
    for name, r in out:
        if 'immersiveengineering:' in json.dumps(r):  # кусачки IE — только если IE стоит (на сервере разработки его нет)
            r = {'neoforge:conditions': [{'type': 'neoforge:mod_loaded', 'modid': 'immersiveengineering'}], **r}
        p = os.path.join(data, ns, 'recipe', name + '.json')
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, 'w') as f:
            json.dump(r, f, indent=2)
    # Катушки — в тег катушек EE (как у его катушек проводов)
    p = os.path.join(data, 'electroenergetics', 'tags', 'item', 'wire_spools.json')
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, 'w') as f:
        json.dump({'replace': False, 'values': [f'{ns}:{w}_spool' for w in ITEMS]}, f, indent=2)


def generate(res, ns, dump):
    tex = os.path.join(res, 'textures')
    write(os.path.join(tex, 'block', 'line_wires.png'), strip_texture())
    write(os.path.join(tex, 'block', 'tension_clamp.png'), clamp_texture())
    for wid, (row, _, _) in ROWS.items():
        dump(box_model(ns, row) if wid in BOX else cross_model(ns, row), 'models', 'block', 'line', wid + '.json')
    dump(clamp_model(ns), 'models', 'block', 'line', 'tension_clamp.json')

    wire_png = ee_png('item/copper_wire.png')
    spool_png = ee_png('item/copper_wire_spool.png')
    for wid, (item, pal) in ITEMS.items():
        if item == 'copper_busbar':
            px = busbar_item()
        elif item == 'power_cable':
            px = recolor(ee_png('item/heavily_insulated_wire.png'), PAL['rubber'], lambda c: c[3] and not is_copper(c))
        elif item:
            px = recolor(wire_png, PAL[pal], is_copper)
            if wid in STRANDED:
                px = twist(px, PAL[pal], STRANDED[wid])
        if item:
            write(os.path.join(tex, 'item', item + '.png'), px)
            dump({'parent': 'minecraft:item/generated', 'textures': {'layer0': f'{ns}:item/{item}'}},
                 'models', 'item', item + '.json')
        if wid == 'copper_busbar':
            spool = recolor(ee_png('item/iron_bus_spool.png'), PAL['copper'], is_grey)
        else:
            spool = recolor(spool_png, PAL[pal], is_copper)
            if wid in STRANDED:
                spool = twist(spool, PAL[pal], STRANDED[wid])
        write(os.path.join(tex, 'item', wid + '_spool.png'), spool)
        dump({'parent': 'minecraft:item/generated', 'textures': {'layer0': f'{ns}:item/{wid}_spool'}},
             'models', 'item', wid + '_spool.json')
    write(os.path.join(tex, 'item', 'tension_clamp.png'), clamp_item())
    dump({'parent': 'minecraft:item/generated', 'textures': {'layer0': f'{ns}:item/tension_clamp'}},
         'models', 'item', 'tension_clamp.json')
    recipes(os.path.join(res, '..', '..', 'data'), ns)
