"""
Текстуры, модели и состояния блоков Create Aeronautics Extra. Запуск: python3 art/gen_assets.py
Модели — из коробок с материалами граней (art/kit.py, тот же, что у Small Diesel и EE Extras), «лицом вверх»,
положения — поворотами блокстейта, как у плит Electro Energetics:
- бортовой компьютер — приборный шкаф: лицевая панель с экраном и лампами — +Y модели (FACING), фланец с отверстием
  под полувал Create — снизу (вал рисует блок-сущность), отсеки модулей — по бокам ±X, клеммная коробка с «+» и «−» —
  на стороне −Z (наверху, когда блок стоит валом вбок).
Клеммы — те же числа, что Terminals.CENTERS и Terminals.Y; совпадение с точками проводов во всех положениях проверяет
art/CheckNodes.java (./check-nodes.sh).
Предметы-модули — плоские иконки 16×16 (item/generated).
"""
import copy
import json
import os

import kit
from kit import BLUE, BRASS, COPPER, DARKER, EDGE, RED, RUBBER, Mat, Model, hexc, shade
from png import write

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(HERE, '..', 'src', 'main', 'resources', 'assets', 'create_aeronautics_extra')
NS = 'create_aeronautics_extra'

# Клеммы (Terminals.java): «+» (5.5, 1.5), «−» (10.5, 1.5), центр на высоте 9
TERMINALS = [((5.5, 1.5), 'plus'), ((10.5, 1.5), 'minus')]
TERMINAL_Y = 9

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

# ---------------------------------------------------------------- материалы

# Корпус — графитовая эмаль приборов, окантовка — латунь Create
BODY_PAL = [hexc('1e2124'), hexc('33383d'), hexc('3f454b')]
BODY = kit.painted('body', BODY_PAL)
BODY_PLAIN = Mat('body_plain', kit.noise([BODY_PAL[1]] * 3 + [BODY_PAL[2]]))
BRASS_M = kit.painted('brass', [BRASS[0], BRASS[2], BRASS[3]])
FLANGE = kit.painted('flange', [hexc('2b2d2c'), hexc('4b4e4c'), hexc('575a58')])
STEEL = kit.steel()
LOUVRE = kit.louvre('louvre', [BODY_PAL[2], BODY_PAL[1], hexc('121416'), BODY_PAL[0]])
PLATE = kit.nameplate('plate', base=BRASS[3], ink=BRASS[0], rim=BRASS[1])
PLUS = kit.terminal('plus', RED)
MINUS = kit.terminal('minus', BLUE)
GLAND = Mat('gland', kit.noise(RUBBER[1:3], RUBBER[0]))

SCREEN_BG, SCREEN_DIM, SCREEN_HI = hexc('0f2a1a'), hexc('2f8a4e'), hexc('7cf09a')
LAMP_RED, LAMP_GREEN, LAMP_AMBER = hexc('e0473a'), hexc('4fd16a'), hexc('f0b43c')


def bay():
    """Крышка отсека модуля: рамка, утопленная панель, латунная ручка-защёлка по центру"""
    def draw(c):
        c.rect(0, 0, c.w - 1, c.h - 1, BODY_PAL[0], fill=False)
        c.rect(1, 1, c.w - 2, c.h - 2, BODY_PAL[1])
        mid = c.w // 2
        c.rect(mid - 1, c.h // 2 - 1, mid + 1, c.h // 2, BRASS[2])
        c.put(mid - 1, c.h // 2 - 1, BRASS[3])
        c.rect(1, c.h - 2, 2, c.h - 2, LAMP_GREEN)  # лампа «модуль вставлен»
    return kit.drawn('bay', BODY_PLAIN, draw)


def panel():
    """Лицевая панель 13×13 (строка 0 — сторона −Z модели, то есть верх у блока на горизонтальном валу): латунная
    рамка, экран с графиком и строками, ряд ламп, кнопки"""
    def draw(c):
        c.rect(0, 0, c.w - 1, c.h - 1, BRASS[1], fill=False)
        c.rect(1, 1, c.w - 2, c.h - 2, BODY_PAL[1])
        # Экран
        c.rect(2, 2, 10, 7, SCREEN_BG)
        c.rect(2, 2, 10, 7, hexc('0a1a10'), fill=False)
        for x, y in ((3, 6), (4, 5), (5, 5), (6, 4), (7, 4), (8, 3), (9, 4)):
            c.put(x, y, SCREEN_HI)
        for x in range(3, 10, 2):  # строки текста пунктиром
            c.put(x, 3 if x < 6 else 6, SCREEN_DIM)
        # Лампы
        for x, col in ((3, LAMP_GREEN), (5, LAMP_AMBER), (7, LAMP_RED)):
            c.put(x, 9, col)
            c.put(x, 10, shade(col, .6))
        # Кнопки и тумблер
        c.rect(9, 9, 10, 10, hexc('121416'))
        c.put(9, 9, BRASS[3])
        c.rect(3, 11, 9, 11, BRASS[0])
    return kit.drawn('panel', BODY_PLAIN, draw)


BAY = bay()
PANEL = panel()


def computer():
    m = Model(64, 2410)
    # Фланец крепления с отверстием 4×4 под полувал Create (как у компактного генератора EE Extras)
    for a, b in (([2, 0, 2], [14, 1.5, 6]), ([2, 0, 10], [14, 1.5, 14]), ([2, 0, 6], [6, 1.5, 10]), ([10, 0, 6], [14, 1.5, 10])):
        m.box(a, b, FLANGE, cull=('down',))
    # Шкаф: бока — жалюзи, сзади (+Z, внизу у горизонтального блока) — табличка
    m.box([2.5, 1.5, 2.5], [13.5, 13, 14.5], BODY, east=LOUVRE, west=LOUVRE, up=None, down=BODY_PLAIN)
    m.box([4, 4, 14.5], [12, 9, 14.75], PLATE)
    # Отсеки модулей: по два на боку
    for y0, y1 in ((2.5, 7.5), (8, 13)):
        m.box([2, y0, 4], [2.5, y1, 13], BAY)
        m.box([13.5, y0, 4], [14, y1, 13], BAY)
    # Лицевая рамка и панель
    m.box([1.5, 13, 2], [14.5, 15, 15], BRASS_M, up=PANEL)
    # Клеммная коробка на стороне −Z, кабельный ввод сбоку
    m.box([3.5, 7, 2], [12.5, 11, 2.5], STEEL)
    m.box([12.5, 8, 2], [13.5, 10, 2.5], GLAND)
    lo = TERMINAL_Y - 1
    for (x, z), k in TERMINALS:
        m.box([x - 1, lo, z - .5], [x + 1, lo + 2, z + .5], PLUS if k == 'plus' else MINUS, name=k)
    return m


# ---------------------------------------------------------------- иконки модулей 16×16

T = (0, 0, 0, 0)


def icon(rows, pal):
    return [[pal[ch] if ch != '.' else T for ch in row] for row in rows]


GENERATOR_ICON = [
    '................',
    '..bbbbbbbbbbbb..',
    '.bsssssssssssdb.',
    '.bsccccccccccdb.',
    '.bscrrrrrrrrcdb.',
    '.bscrmmmmmmrcdb.',
    '.bscrmsSSsmrcdb.',
    '.bscrmSkkSmrcdb.',
    '.bscrmSkkSmrcdb.',
    '.bscrmsSSsmrcdb.',
    '.bscrmmmmmmrcdb.',
    '.bscrrrrrrrrcdb.',
    '.bsccccccccccdb.',
    '.bddddddddddddb.',
    '..bbbbbbbbbbbb..',
    '................',
]
GENERATOR_PAL = {
    'b': BODY_PAL[0], 's': BODY_PAL[2], 'd': BODY_PAL[1], 'c': COPPER[1], 'r': COPPER[3],
    'm': hexc('6c7173'), 'S': hexc('b9bec0'), 'k': hexc('2b2d2c'),
}

BATTERY_ICON = [
    '................',
    '...pp......nn...',
    '...PP......NN...',
    '.bbbbbbbbbbbbbb.',
    '.bhhhhhhhhhhhhb.',
    '.bssssssssssssb.',
    '.bsBBBBBBBBBBsb.',
    '.bsBggggggggBsb.',
    '.bsBggggggggBsb.',
    '.bsBBBBBBBBBBsb.',
    '.bssssssssssssb.',
    '.bsllllllllllsb.',
    '.bssssssssssssb.',
    '.bddddddddddddb.',
    '.bbbbbbbbbbbbbb.',
    '................',
]
BATTERY_PAL = {
    'b': BODY_PAL[0], 'h': BRASS[2], 's': BODY_PAL[2], 'd': BODY_PAL[1], 'B': BRASS[1], 'g': LAMP_GREEN,
    'l': BRASS[0], 'p': RED[3], 'P': RED[1], 'n': BLUE[3], 'N': BLUE[1],
}


# ---------------------------------------------------------------- вывод


def dump(obj, *path):
    full = os.path.join(RES, *path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, 'w') as f:
        json.dump(obj, f, indent=2)


def lying(display, view_y=-135):
    d = copy.deepcopy(display)
    d['gui'] = {'rotation': kit.lying(view_y=view_y), 'scale': [0.625, 0.625, 0.625]}
    return d


os.makedirs(os.path.join(RES, 'textures', 'block'), exist_ok=True)
os.makedirs(os.path.join(RES, 'textures', 'item'), exist_ok=True)

name = 'onboard_computer'
m = computer()
m.save(os.path.join(RES, 'textures', 'block', name + '.png'))
tex = f'{NS}:block/{name}'
# Иконка — лёжа на валу, панелью к зрителю
display = lying(DISPLAY, 45)
dump(m.json(tex, display, NS), 'models', 'block', name, 'block.json')
m.els = kit.rolled(m.els)
dump(m.json(tex, display, NS), 'models', 'block', name, 'block_roll.json')
dump({'parent': f'{NS}:block/{name}/block'}, 'models', 'item', name + '.json')
variants = {}
for facing, rot in ROT.items():
    for logged in ('dry', 'oillogged', 'waterlogged'):
        for rolled in (False, True):
            variants[f'facing={facing},logged_state={logged},roll={str(rolled).lower()}'] = {
                'model': f'{NS}:block/{name}/' + ('block_roll' if rolled else 'block'), **rot}
dump({'variants': variants}, 'blockstates', name + '.json')

for item, rows, pal in (('generator_module', GENERATOR_ICON, GENERATOR_PAL), ('battery_module', BATTERY_ICON, BATTERY_PAL)):
    write(os.path.join(RES, 'textures', 'item', item + '.png'), icon(rows, pal))
    dump({'parent': 'minecraft:item/generated', 'textures': {'layer0': f'{NS}:item/{item}'}}, 'models', 'item', item + '.json')

print('готово:', os.path.normpath(RES))
