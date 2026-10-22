"""
Текстуры, модели и состояния блоков Small Diesel. Запуск: python3 art/gen_assets.py
Модели — по образцу настоящих машин (art/kit.py: коробки с материалами граней, атлас собирается сам), «лицом вверх»,
положения — поворотами блокстейта, как у плит Electro Energetics:
- двигатель — горизонтальный одноцилиндровый дизель (как S195): ось коленвала — Y модели, вал выходит сверху (лицевая
  грань, его рисует блок-сущность), сторона −Z модели — верх, когда вал горизонтальный;
- генератор — дизель-генераторная установка на раме: дизель, генератор, клеммная коробка с «+» и «−» сверху.
Клеммы генератора — те же числа, что Terminals.CENTERS и Terminals.Y; совпадение с точками проводов во всех положениях
проверяет art/CheckNodes.java (./check-nodes.sh).
"""
import copy
import json
import os

import kit
from kit import BLUE, BRASS, DARK, DARKER, HI, RED, RUBBER, SOOT, Mat, Model, hexc

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(HERE, '..', 'src', 'main', 'resources', 'assets', 'small_diesel')
NS = 'small_diesel'

# Клеммы генератора (Terminals.java): «+» (12.25, 6), «−» (12.25, 10), центр на высоте 14
TERMINALS = [((12.25, 6), 'plus'), ((12.25, 10), 'minus')]
TERMINAL_Y = 14

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

PAINT = [hexc('263b2b'), hexc('3d5e44'), hexc('4a6f52')]  # заводская эмаль дизеля — тёмно-зелёная
ENGINE = kit.painted('engine', PAINT)
TANK = kit.painted('tank', [PAINT[0], hexc('4f7a58'), hexc('5c8a66')])
ENGINE_PLAIN = Mat('engine_plain', kit.noise([PAINT[1]] * 3 + [PAINT[2]]))
ENGINE_RIBS = kit.ribs('engine_ribs', [PAINT[2], PAINT[1], PAINT[0]], across=True)
IRON = kit.painted('iron', [hexc('2e302f'), hexc('4b4e4c'), hexc('575a58')])  # чугун маховика, рама
STEEL = kit.steel()
ALT_RIBS = kit.ribs('alt_ribs', [hexc('a8b3ab'), hexc('8f9691'), hexc('60635f')], across=True)
GRILLE = kit.mesh('grille', [hexc('707571'), hexc('1d1e1d'), hexc('595858')])
def radiator_core():
    """Радиатор, как у настоящих дизелей: окрашенная рамка, тёмная сердцевина — частые горизонтальные пластины
    охлаждения, едва заметные вертикальные трубки"""
    frame, fin, gap, tube = PAINT[0], hexc('454946'), hexc('2c2f2d'), hexc('505451')

    def paint(w, h, rng):
        def px(x, y):
            if x in (0, w - 1) or y in (0, h - 1):
                return frame
            if y % 2:
                return gap
            return tube if x % 4 == 2 else fin
        return kit.grid(w, h, px)
    return Mat('radiator', paint)


RADIATOR = radiator_core()
BRASS_M = Mat('brass', kit.noise(BRASS[1:4], BRASS[0]))
EXHAUST = Mat('exhaust', kit.noise(SOOT[1:], SOOT[0]))
FILTER = kit.ribs('filter', [hexc('3a3c3e'), hexc('2c2e30'), hexc('1c1d1f')], period=3, across=True)
PLATE = kit.nameplate('plate')
PLUS = kit.terminal('plus', RED)
MINUS = kit.terminal('minus', BLUE)
GLAND = Mat('gland', kit.noise(RUBBER[1:3], RUBBER[0]))


def flywheel_face():
    """Торец маховика: светлый обод, тёмный диск, четыре спицы, ступица (через неё выходит полувал Create)"""
    def draw(c):
        cx, cy = c.w // 2, c.h // 2
        c.rect(0, 0, c.w - 1, c.h - 1, hexc('8a8f8b'), fill=False)
        c.rect(1, 1, c.w - 2, c.h - 2, hexc('262827'))
        for x in range(1, c.w - 1):
            c.put(x, cy, hexc('5d615e'))
        for y in range(1, c.h - 1):
            c.put(cx, y, hexc('5d615e'))
        c.rect(cx - 1, cy - 1, cx, cy, hexc('a3a8a4'))
    return kit.drawn('flywheel', IRON, draw)


# ---------------------------------------------------------------- двигатель


def engine():
    """Горизонтальный одноцилиндровый дизель: картер вокруг оси, цилиндр к −X с радиатором на торце,
    топливный бак сверху с латунной крышкой, воздушный фильтр и глушитель с трубой на стороне +X, маховик у вала,
    рама-салазки снизу (сторона +Z)"""
    m = Model(64, 2100)
    # Салазки
    for y0, y1 in ((2, 4), (9.5, 11.5)):
        m.box([1, y0, 14.5], [15, y1, 16], IRON, cull=('south',))
    # Картер вокруг оси и крышка шестерён сзади
    m.box([5, 2, 4.5], [12.5, 12.5, 14.5], ENGINE)
    m.box([5.5, 1, 5.5], [12, 2, 13], ENGINE_PLAIN)
    # Цилиндр с рёбрами, головка, радиатор на торце
    m.box([2, 3.5, 4.5], [5, 10.5, 12], ENGINE_RIBS, up=ENGINE_PLAIN, down=ENGINE_PLAIN)
    m.box([0.5, 3, 3.5], [2, 11, 12.5], ENGINE, west=RADIATOR)
    m.box([1, 4, 12.5], [4.5, 6, 14.5], IRON)  # опора цилиндра
    # Бак сверху, крышка горловины
    m.box([2, 3, 1.5], [11.5, 11, 4.5], TANK)
    m.box([3.5, 5, 0.5], [5.5, 7, 1.5], BRASS_M)
    # Воздушный фильтр, глушитель и выхлопная труба, табличка
    m.box([11.5, 3, 2], [14.5, 6.5, 5], FILTER, up=ENGINE_PLAIN, down=ENGINE_PLAIN)
    m.box([12.5, 7, 4.5], [15, 11.5, 8], EXHAUST)
    m.box([13, 9, 1.5], [14.5, 10.5, 4.5], EXHAUST)
    m.box([12.5, 5.5, 9], [12.75, 9.5, 12.5], PLATE)
    # Маховик (стальной обод, спицы — на торце) у выхода вала
    m.box([3, 12.5, 4], [13, 15, 12], IRON, up=flywheel_face())
    m.box([4, 12.5, 3], [12, 14.95, 13], IRON)  # торец чуть ниже — без мерцания с первым
    return m


# ---------------------------------------------------------------- дизель-генератор


def genset():
    """Дизель-генераторная установка: рама с баком, дизель (радиатор на торце −X, блок, клапанная крышка,
    глушитель), генератор с рёбрами вдоль оси X и решёткой на торце, клеммная коробка с «+» и «−» и кабельным вводом"""
    m = Model(64, 2101)
    m.box([0.5, 0, 1.5], [15.5, 1.5, 14.5], IRON, cull=('down',))  # рама с топливным баком
    m.box([14, 1.5, 12], [15, 2.5, 13.5], BRASS_M)  # горловина бака
    # Дизель
    m.box([0.5, 1.5, 3], [2.5, 11, 13], ENGINE, west=RADIATOR)
    m.box([2.5, 1.5, 4], [9, 6.5, 12], ENGINE)  # картер
    m.box([3, 6.5, 4.5], [8.5, 10.5, 11.5], ENGINE_RIBS, up=ENGINE_PLAIN, down=None)  # блок цилиндров
    m.box([3.5, 10.5, 5], [8, 11.5, 11], ENGINE_PLAIN)  # клапанная крышка
    m.box([4, 6.5, 2.5], [6.5, 9, 4.5], FILTER, up=ENGINE_PLAIN, down=ENGINE_PLAIN)  # воздушный фильтр
    m.box([4, 11.5, 7.5], [7.5, 13, 10], EXHAUST)  # глушитель
    m.box([6.5, 13, 8], [7.5, 14.5, 9], EXHAUST)
    m.box([3, 2.5, 11.75], [6.5, 5, 12], PLATE)
    # Генератор — ось X, центр (y 6.5, z 8)
    m.box([9.05, 2.5, 3.5], [14.95, 10.5, 12.5], ALT_RIBS, east=STEEL, west=STEEL, up=STEEL, down=None)
    m.box([9, 1.5, 4.5], [15, 11.5, 11.5], ALT_RIBS, east=GRILLE, west=STEEL, down=None)
    # Клеммная коробка сверху, кабельный ввод сбоку
    m.box([10, 11.5, 4.5], [14.5, 12.5, 11.5], STEEL)
    m.box([9.75, 12.5, 4.25], [14.75, 13, 11.75], STEEL)
    m.box([14.75, 11.75, 7.25], [15.5, 12.5, 8.75], GLAND)
    lo = TERMINAL_Y - 1
    for (x, z), k in TERMINALS:
        m.box([x - 1, lo, z - 1], [x + 1, lo + 2, z + 1], PLUS if k == 'plus' else MINUS, name=k)
    return m


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

name = 'small_diesel_engine'
m = engine()
m.save(os.path.join(RES, 'textures', 'block', name + '.png'))
dump(m.json(f'{NS}:block/{name}', lying(DISPLAY, 45), NS), 'models', 'block', name + '.json')
dump({'parent': f'{NS}:block/{name}'}, 'models', 'item', name + '.json')
dump({'variants': {f'facing={f}': {'model': f'{NS}:block/{name}', **rot} for f, rot in ROT.items()}},
     'blockstates', name + '.json')

name = 'small_diesel_generator'
m = genset()
m.save(os.path.join(RES, 'textures', 'block', name + '.png'))
tex = f'{NS}:block/{name}'
# Иконка — с другой стороны (радиатор и дизель на виду, генератор сзади)
display = copy.deepcopy(DISPLAY)
display['gui'] = {'rotation': [30, 135, 0], 'scale': [0.625, 0.625, 0.625]}
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
print('готово:', os.path.normpath(RES))
