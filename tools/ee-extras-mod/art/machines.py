"""
Компактный генератор, выпрямители и инверторы — по образцу настоящих машин и шкафов (art/kit.py). Вызывается из
gen_assets.py. Модели «лицом вверх», как у плит EE: лицевая грань (FACING) — +Y, крен — art/kit.rolled.
Клеммы — в точках Layout (центры {x, z}, высота Tier.terminalY / Layout.GENERATOR_Y): совпадение проверяет
art/CheckNodes.java (./check-nodes.sh).
"""
import copy
import os

import kit
from kit import (BLUE, BRASS, COPPER, CORNER, DARK, DARKER, EDGE, FILL, HI, RED, RIM, RUBBER, Mat, Model, hexc, shade)

# ---------------------------------------------------------------- материалы

STEEL = kit.steel()
STEEL_PLAIN = kit.steel('steel_plain', border=False)
FRAME = kit.painted('frame', [hexc('3f4240'), hexc('5b5f5c'), hexc('686d69')])
RIBS = kit.ribs('ribs', [hexc('a8b3ab'), hexc('8f9691'), hexc('60635f')])
RIB = kit.Mat('rib', kit.noise([hexc('8f9691'), hexc('9aa49d')]))
GRILLE = kit.mesh('grille', [hexc('707571'), hexc('1d1e1d'), EDGE])
PLATE = kit.nameplate('plate')
GLAND = kit.Mat('gland', kit.noise(RUBBER[1:3], RUBBER[0]))
PLUS = kit.terminal('plus', RED)
MINUS = kit.terminal('minus', BLUE)
CU = kit.terminal('copper', COPPER)
CU_BAR = kit.Mat('copper_bar', kit.noise(COPPER[1:4], COPPER[0]))

# ---------------------------------------------------------------- компактный генератор

# Клеммы — те же числа, что Layout.COMPACT_GENERATOR и Layout.GENERATOR_Y: «+» (6.5, 0.5), «−» (9.5, 0.5) на высоте 8,5
GENERATOR = [((6.5, 0.5), 'plus'), ((9.5, 0.5), 'minus')]
GENERATOR_Y = 8.5


def compact_generator(seed):
    """Асинхронная машина общего вида (обдуваемая, на лапах): ось — Y модели (вал из задней грани, его рисует
    блок-сущность), рёбристый статор, подшипниковые щиты, кожух вентилятора с решёткой спереди, лапы на стороне +Z
    (на горизонтальном валу она внизу), клеммная коробка с «+» и «−» на стороне −Z (наверху)."""
    m = Model(64, seed)
    # Статор — ступенчатый «цилиндр» Ø10 с рёбрами вдоль оси
    m.box([3, 2, 4], [13, 13, 12], RIBS, up=STEEL_PLAIN, down=STEEL_PLAIN)
    m.box([4, 2, 3], [12, 13, 13], RIBS, up=STEEL_PLAIN, down=STEEL_PLAIN)
    for z in (5, 7.5, 10):  # рёбра по бокам
        m.box([2.25, 2.5, z], [3, 12.5, z + .75], RIB)
        m.box([13, 2.5, z], [13.75, 12.5, z + .75], RIB)
    for x in (4.5, 10.75):  # рёбра сверху, по сторонам клеммной коробки
        m.box([x, 2.5, 2.25], [x + .75, 12.5, 3], RIB)
    # Подшипниковый щит со стороны вала и крышка подшипника вокруг вала (отверстие 4×4 — под полувал Create)
    m.box([4, 1, 4], [12, 2, 12], STEEL)
    for a, b in (([5, 0, 5], [11, 1, 6]), ([5, 0, 10], [11, 1, 11]), ([5, 0, 6], [6, 1, 10]), ([10, 0, 6], [11, 1, 10])):
        m.box(a, b, FRAME, cull=('down',))
    # Кожух вентилятора с решёткой (лицевая сторона)
    m.box([3.5, 13, 4.5], [12.5, 15.5, 11.5], STEEL, up=GRILLE, down=None)
    m.box([4.5, 13, 3.5], [11.5, 15.45, 12.5], STEEL, up=GRILLE, down=None)  # торец чуть ниже — без мерцания
    # Лапы
    for y0, y1 in ((3, 5), (10, 12)):
        m.box([4, y0, 12], [12, y1, 15], FRAME)
        m.box([2.5, y0, 15], [13.5, y1, 16], FRAME, cull=('south',))
    # Табличка на боку
    m.box([13, 5, 6], [13.25, 9.5, 10], PLATE)
    # Клеммная коробка: корпус, крышка, кабельный ввод сбоку
    m.box([5, 5.5, 1.5], [11, 11.5, 3], STEEL)
    m.box([4.5, 5, 1], [11.5, 12, 1.5], STEEL)
    m.box([11.5, 7.5, 1.6], [12.5, 9.5, 2.9], GLAND)
    lo = GENERATOR_Y - 1
    for (x, z), k in GENERATOR:
        m.box([x - 1, lo, z - .5], [x + 1, lo + 2, z + .5], PLUS if k == 'plus' else MINUS, name=k)
    return m


# ---------------------------------------------------------------- выпрямители и инверторы

ALU = kit.Mat('alu', kit.noise([hexc('b9bec0'), hexc('c3c8ca'), hexc('aeb3b5')], hexc('7f8486'), hexc('6c7173')))
ALU_PLAIN = kit.Mat('alu_plain', kit.noise([hexc('b9bec0'), hexc('c3c8ca'), hexc('aeb3b5')]))
STRIP = kit.painted('strip', [hexc('2a2c2e'), hexc('4a4e52'), hexc('565b60')])  # клеммник (пластик)
CAB = kit.painted('cabinet', [hexc('7d807a'), hexc('b9bcb4'), hexc('c6c9c1')])  # шкаф, светло-серая эмаль
CAB_DARK = kit.painted('cabinet_dark', [hexc('2b2c2b'), hexc('3c3e3c'), hexc('474947')])  # цоколь, ручка
GLAZE = kit.glaze('glaze')
GREEN_LAMP, AMBER_LAMP = hexc('4fd16a'), hexc('f0b43c')
YELLOW, BLACK = hexc('e8c53a'), hexc('1c1c1c')
# Корпус модуля: у выпрямителя — графитовый, у инвертора (как у преобразователей частоты) — тёмно-синий
HOUSING = {
    False: [hexc('1f2022'), hexc('35383b'), hexc('414448')],
    True: [hexc('1b2433'), hexc('2c3a52'), hexc('364762')],
}


def comb(key):
    """Торец радиатора: рёбра через пиксель, внизу — основание"""
    light, dark, base = hexc('c3c8ca'), hexc('4c5052'), hexc('9fa4a6')

    def paint(w, h, rng):
        return kit.grid(w, h, lambda x, y: base if y == h - 1 else dark if x % 2 else light)
    return Mat(key, paint)


def glyphs(c, x, y, inverter, ink):
    """«~ › =» (выпрямитель) или «= › ~» (инвертор) с левого верхнего угла (x, y), 12×3"""
    tilde = [(0, 1), (1, 0), (2, 1), (3, 2), (4, 1)]
    equal = [(i, j) for i in range(3) for j in (0, 2)]
    arrow = [(0, 0), (1, 1), (0, 2)]
    left, right = (equal, tilde) if inverter else (tilde, equal)
    w_left = 3 if inverter else 5
    for gx, gy in left:
        c.put(x + gx, y + gy, ink)
    for gx, gy in arrow:
        c.put(x + w_left + 1 + gx, y + gy, ink)
    for gx, gy in right:
        c.put(x + w_left + 4 + gx, y + gy, ink)


def converter(name, terminals, kinds, inverter, seed):
    """Лёгкий: силовой модуль на алюминиевом радиаторе (рёбра видны с торцов), по краям — клеммники с перегородками,
    медные винтовые клеммы переменного тока и «+»/«−» в красной и синей изоляции; на крышке модуля — «~ › =» или «= › ~»"""
    m = Model(64, seed)
    house = HOUSING[inverter]
    m.box([0, 0, 0], [16, 2, 16], ALU_PLAIN, east=comb('comb'), west=comb('comb'),
          cull=('down', 'north', 'south', 'east', 'west'))
    lid = kit.drawn('lid_' + ('inv' if inverter else 'rect'), kit.painted('housing', house),
                    lambda c: (glyphs(c, 1, 1, inverter, HI), c.rect(c.w - 3, 1, c.w - 2, 1, GREEN_LAMP)))
    vents = kit.drawn('housing_vents', kit.painted('housing_side', house),
                      lambda c: [c.rect(2 + 3 * i, 1, 3 + 3 * i, c.h - 2, house[0]) for i in range(4)])
    m.box([1, 2, 5.5], [15, 6.5, 10.5], kit.painted('housing_side', house), up=lid, north=vents, south=vents)
    for row in (3, 13):
        marks = kit.drawn('strip_dc', STRIP, lambda c: (
            [c.put(5 + dx, 2 + dz, RED[3]) for dx, dz in ((0, -1), (-1, 0), (0, 0), (1, 0), (0, 1))],
            [c.put(9 + dx, 2, BLUE[3]) for dx in (-1, 0, 1)]))
        m.box([0.5, 2, row - 2], [15.5, 3.5, row + 2], STRIP, **({'up': marks} if row == 13 else {}))
        xs = sorted(x for (x, z), k in zip(terminals, kinds) if z == row)
        for wall in [0.75] + [(a + b) / 2 for a, b in zip(xs, xs[1:])] + [15.25]:
            if row == 13 and 1 < wall < 15:
                continue  # между «+» и «−» перегородки нет — там маркировка
            m.box([wall - .25, 3.5, row - 2], [wall + .25, 6, row + 2], STRIP)
    for (x, z), k in zip(terminals, kinds):
        mat = {'phase': CU, 'plus': PLUS, 'minus': MINUS}[k]
        top = kit.drawn('screw_' + k, mat, lambda c: c.put(1, 1, DARKER))
        m.box([x - 1.5, 3.5, z - 1.5], [x + 1.5, 6.5, z + 1.5], mat, name=k, up=top)
    return m


def door():
    """Дверь шкафа 14×9: притвор, табличка, лампы «сеть» и «работа» в оправах, жалюзи внизу"""
    def draw(c):
        c.rect(1, 1, c.w - 2, c.h - 1, hexc('7d807a'), fill=False)
        c.rect(2, 2, 6, 4, HI)
        c.rect(3, 3, 5, 3, DARK)
        for y, lamp in ((2, GREEN_LAMP), (4, AMBER_LAMP)):
            c.rect(c.w - 5, y, c.w - 4, y, BLACK)
            c.put(c.w - 5, y, lamp)
        for i, y in enumerate(range(c.h - 4, c.h - 1)):
            for x in range(3, c.w - 3):
                c.put(x, y, (hexc('d2d5cd'), hexc('8d9089'), hexc('5b5e58'))[i])
    return kit.drawn('door', CAB, draw)


def side(inverter):
    """Бок шкафа: у выпрямителя — жалюзи сверху и снизу, у инвертора — вентилятор за решёткой"""
    def draw(c):
        if inverter:
            x0, y0 = c.w // 2 - 3, c.h // 2 - 3
            c.rect(x0, y0, x0 + 6, y0 + 6, hexc('2b2c2b'))
            for y in range(y0 + 1, y0 + 6, 2):
                c.rect(x0 + 1, y, x0 + 5, y, hexc('6a6d68'))
            c.rect(x0 + 2, y0 + 2, x0 + 4, y0 + 4, hexc('2b2c2b'), fill=False)
            c.put(x0 + 3, y0 + 3, hexc('8d9089'))
        else:
            for y0 in (1, c.h - 4):
                for i, y in enumerate(range(y0, y0 + 3)):
                    for x in range(2, c.w - 2):
                        c.put(x, y, (hexc('d2d5cd'), hexc('8d9089'), hexc('5b5e58'))[i])
    return kit.drawn('side_' + ('inv' if inverter else 'rect'), CAB, draw)


def roof(inverter):
    """Крыша: знак «Осторожно, электрическое напряжение» и «~ › =» / «= › ~» под ним"""
    def draw(c):
        cx = c.w // 2
        for i in range(4):
            for x in range(cx - i, cx + i + 1):
                c.put(x, 4 + i, BLACK if i == 3 or abs(x - cx) == i else YELLOW)
        c.put(cx, 5, BLACK)
        c.put(cx, 6, BLACK)
        glyphs(c, cx - 6, 9, inverter, hexc('3c3e3c'))
    return kit.drawn('roof_' + ('inv' if inverter else 'rect'), CAB, draw)


def heavy_converter(name, terminals, kinds, inverter, seed):
    """Тяжёлый: напольный шкаф на цоколе — дверь с табличкой и лампами (+X), радиатор (−X), жалюзи или вентилятор
    (±Z), крыша со знаком, на ней проходные изоляторы с юбками и медными (красной «+», синей «−») шапками"""
    m = Model(64, seed)
    m.box([0.5, 0, 0.5], [15.5, 1, 15.5], CAB_DARK, cull=('down',))
    m.box([1, 1, 1], [15, 10, 15], CAB, east=door(), north=side(inverter), south=side(inverter), up=None,
          down=None)
    m.box([15, 3.5, 2.5], [15.5, 6.5, 3.5], CAB_DARK)  # ручка
    for i in range(8):  # радиатор
        z = 2 + i * 1.6
        m.box([0, 1.5, z], [1, 9.5, z + .6], ALU)
    m.box([0.5, 10, 0.5], [15.5, 10.75, 15.5], CAB, up=roof(inverter))
    for (x, z), k in zip(terminals, kinds):
        m.box([x - 1.5, 10.75, z - 1.5], [x + 1.5, 11.25, z + 1.5], CAB_DARK)
        m.box([x - 1, 11.25, z - 1], [x + 1, 13, z + 1], GLAZE)
        m.box([x - 1.5, 11.75, z - 1.5], [x + 1.5, 12.25, z + 1.5], GLAZE)
        mat = {'phase': CU, 'plus': PLUS, 'minus': MINUS}[k]
        m.box([x - 1, 13, z - 1], [x + 1, 15, z + 1], mat, name=k)
    return m


# ---------------------------------------------------------------- вывод


def emit(name, m, res, ns, dump, display, roll=True):
    """Текстура, модели (и с креном), предмет"""
    m.save(os.path.join(res, 'textures', 'block', name + '.png'))
    tex = f'{ns}:block/{name}'
    dump(m.json(tex, display, ns), 'models', 'block', name, 'block.json')
    if roll:
        rm = copy.copy(m)
        rm.els = kit.rolled(m.els)
        dump(rm.json(tex, display, ns), 'models', 'block', name, 'block_roll.json')


def lying_display(display):
    d = copy.deepcopy(display)
    d['gui'] = {'rotation': kit.lying(), 'scale': [0.625, 0.625, 0.625]}
    return d
