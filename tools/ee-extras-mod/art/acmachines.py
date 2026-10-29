"""
Преобразователи частоты и синхронизаторы (2.4) — в стиле выпрямителей и инверторов (art/machines.py): лёгкий — силовой
модуль на радиаторе, тяжёлый — напольный шкаф, промышленный — шкаф в два блока (верх — с проходными изоляторами и
устройством EE, низ — дверь и радиаторы). Все клеммы медные: ряд z = 3 — вход (у синхронизатора — генератор), z = 13 —
выход (сеть), как Layout.AC_THREE / AC_SINGLE. У синхронизатора на гранях ±X — красные контакты сигнала: +X (со
стороны последней клеммы ряда генератора) — «быстрее», −X — «медленнее» (SynchronizerBlock.fasterFace).
Вызывается из gen_assets.py.
"""
import kit
from kit import DARK, DARKER, HI, Mat, Model, hexc
from machines import (ALU, ALU_PLAIN, BLACK, CAB, CAB_DARK, CU, GLAZE, GREEN_LAMP, AMBER_LAMP, STRIP, YELLOW, comb,
                      side)

THREE = [(3, 3), (8, 3), (13, 3), (3, 13), (8, 13), (13, 13)]
SINGLE = [(3, 3), (13, 3), (3, 13), (13, 13)]
LAYOUTS = {
    'three_phase_frequency_converter': THREE,
    'single_phase_frequency_converter': SINGLE,
    'three_phase_synchronizer': THREE,
    'single_phase_synchronizer': SINGLE,
}
# Корпус: преобразователь частоты — тёмно-зелёный, синхронизатор — тёмно-бордовый
HOUSING = {
    'fc': [hexc('17261f'), hexc('25402f'), hexc('2e4b39')],
    'sync': [hexc('2a1719'), hexc('482629'), hexc('542d30')],
}
REDSTONE = [hexc('4a0000'), hexc('8e0d0d'), hexc('d11919'), hexc('ff4040')]


def sync_kind(name):
    return 'sync' if name.endswith('synchronizer') else 'fc'


def tilde(c, x, y, ink):
    for gx, gy in [(0, 1), (1, 0), (2, 1), (3, 2), (4, 1)]:
        c.put(x + gx, y + gy, ink)


def fc_glyph(c, x, y, ink):
    """«~ › ~» 15×3"""
    tilde(c, x, y, ink)
    for gx, gy in [(0, 0), (1, 1), (0, 2)]:
        c.put(x + 6 + gx, y + gy, ink)
    tilde(c, x + 10, y, ink)


def dial(c, cx, cy, ink, face):
    """Циферблат синхроскопа 7×7: круг, метка «0» сверху, стрелка вправо-вверх (генератор чуть быстрее)"""
    for dx in range(-3, 4):
        for dy in range(-3, 4):
            r = dx * dx + dy * dy
            if r <= 9:
                c.put(cx + dx, cy + dy, ink if r >= 7 else face)
    c.put(cx, cy - 2, YELLOW)
    c.put(cx, cy, ink)
    c.put(cx + 1, cy - 1, ink)
    c.put(cx + 2, cy - 2, hexc('d11919'))


def lid(kind, house):
    def draw(c):
        if kind == 'fc':
            fc_glyph(c, 1, 1, HI)
        else:
            dial(c, c.w // 2, c.h // 2, HI, house[0])
            c.rect(1, 1, 1, 1, GREEN_LAMP)
        c.rect(c.w - 3, 1, c.w - 2, 1, GREEN_LAMP if kind == 'fc' else AMBER_LAMP)
    return kit.drawn('lid_' + kind, kit.painted('housing_' + kind, house), draw)


def contact(m, x, y0, y1, z, faster):
    """Красный контакт сигнала на грани ±X: «быстрее» — две полоски, «медленнее» — одна"""
    mat = kit.terminal('redstone', REDSTONE)
    for i in range(2 if faster else 1):
        zz = z - (0.75 if faster else 0) + i * 1.5
        m.box([x - .25, y0, zz - .5], [x + .25, y1, zz + .5], mat)


def light(name, terminals, seed):
    """Лёгкий: как выпрямитель (machines.converter) — радиатор, модуль посередине, медные клеммы в клеммниках"""
    kind = sync_kind(name)
    house = HOUSING[kind]
    m = Model(64, seed)
    m.box([0, 0, 0], [16, 2, 16], ALU_PLAIN, east=comb('comb'), west=comb('comb'),
          cull=('down', 'north', 'south', 'east', 'west'))
    side_mat = kit.painted('housing_side_' + kind, house)
    vents = kit.drawn('housing_vents_' + kind, side_mat,
                      lambda c: [c.rect(2 + 3 * i, 1, 3 + 3 * i, c.h - 2, house[0]) for i in range(4)])
    m.box([1, 2, 5.5], [15, 6.5, 10.5], side_mat, up=lid(kind, house), north=vents, south=vents)
    for row in (3, 13):
        m.box([0.5, 2, row - 2], [15.5, 3.5, row + 2], STRIP)
        xs = sorted(x for x, z in terminals if z == row)
        for wall in [0.75] + [(a + b) / 2 for a, b in zip(xs, xs[1:])] + [15.25]:
            m.box([wall - .25, 3.5, row - 2], [wall + .25, 6, row + 2], STRIP)
    for x, z in terminals:
        top = kit.drawn('screw_phase', CU, lambda c: c.put(1, 1, DARKER))
        m.box([x - 1.5, 3.5, z - 1.5], [x + 1.5, 6.5, z + 1.5], CU, name='phase', up=top)
    if kind == 'sync':
        contact(m, 15.25, 3, 5.5, 8, True)
        contact(m, 0.75, 3, 5.5, 8, False)
    return m


def door(kind):
    """Дверь шкафа: табличка, у синхронизатора — циферблат синхроскопа, лампы, жалюзи внизу"""
    def draw(c):
        c.rect(1, 1, c.w - 2, c.h - 1, hexc('7d807a'), fill=False)
        if kind == 'sync':
            dial(c, 5, 4, hexc('3c3e3c'), hexc('e8e8e0'))
        else:
            c.rect(2, 2, 6, 4, HI)
            c.rect(3, 3, 5, 3, DARK)
        for y, lamp in ((2, GREEN_LAMP), (4, AMBER_LAMP)):
            c.rect(c.w - 5, y, c.w - 4, y, BLACK)
            c.put(c.w - 5, y, lamp)
        for i, y in enumerate(range(c.h - 4, c.h - 1)):
            for x in range(3, c.w - 3):
                c.put(x, y, (hexc('d2d5cd'), hexc('8d9089'), hexc('5b5e58'))[i])
    return kit.drawn('door_' + kind, CAB, draw)


def roof(kind):
    """Крыша: знак «Осторожно, электрическое напряжение» и «~ › ~» или циферблат"""
    def draw(c):
        cx = c.w // 2
        for i in range(4):
            for x in range(cx - i, cx + i + 1):
                c.put(x, 4 + i, BLACK if i == 3 or abs(x - cx) == i else YELLOW)
        c.put(cx, 5, BLACK)
        c.put(cx, 6, BLACK)
        if kind == 'fc':
            fc_glyph(c, cx - 7, 9, hexc('3c3e3c'))
    return kit.drawn('roof_' + kind, CAB, draw)


def bushings(m, terminals, y):
    """Проходные изоляторы на крыше (y — верх крыши): юбки и медные шапки, центр шапки — y + 3,25 (= Tier 14)"""
    for x, z in terminals:
        m.box([x - 1.5, y, z - 1.5], [x + 1.5, y + .5, z + 1.5], CAB_DARK)
        m.box([x - 1, y + .5, z - 1], [x + 1, y + 2.25, z + 1], GLAZE)
        m.box([x - 1.5, y + 1, z - 1.5], [x + 1.5, y + 1.5, z + 1.5], GLAZE)
        m.box([x - 1, y + 2.25, z - 1], [x + 1, y + 4.25, z + 1], CU, name='phase')


def heavy(name, terminals, seed):
    """Тяжёлый: шкаф на цоколе, как у инвертора — дверь (+X), радиатор (−X), вентилятор (±Z), крыша с изоляторами"""
    kind = sync_kind(name)
    m = Model(64, seed)
    m.box([0.5, 0, 0.5], [15.5, 1, 15.5], CAB_DARK, cull=('down',))
    m.box([1, 1, 1], [15, 10, 15], CAB, east=door(kind), north=side(True), south=side(True), up=None, down=None)
    m.box([15, 3.5, 2.5], [15.5, 6.5, 3.5], CAB_DARK)
    for i in range(8):
        z = 2 + i * 1.6
        m.box([0, 1.5, z], [1, 9.5, z + .6], ALU)
    m.box([0.5, 10, 0.5], [15.5, 10.75, 15.5], CAB, up=roof(kind))
    bushings(m, terminals, 10.75)
    if kind == 'sync':
        contact(m, 15.25, 7, 9.5, 12.5, True)
        contact(m, 0.75, 7, 9.5, 12.5, False)
    return m


def industrial_top(name, terminals, seed):
    """Промышленный, верх: продолжение шкафа (без цоколя), рёбра радиатора по ±Z во всю высоту, крыша с изоляторами"""
    kind = sync_kind(name)
    m = Model(64, seed)
    panel = kit.drawn('upper_panel_' + kind, CAB, lambda c: (
        c.rect(1, 0, c.w - 2, c.h - 1, hexc('7d807a'), fill=False),
        c.rect(2, 2, 6, 4, HI), c.rect(3, 3, 5, 3, DARK)))
    m.box([1, 0, 1], [15, 10, 15], CAB, east=panel, up=None, down=None, cull=())
    for zf in (0, 15):
        for i in range(7):
            x = 2 + i * 2
            m.box([x, 0, zf], [x + .6, 9.5, zf + 1], ALU)
    for i in range(6):
        z = 2.5 + i * 2
        m.box([0, 0, z], [1, 9.5, z + .6], ALU)
    m.box([0.5, 10, 0.5], [15.5, 10.75, 15.5], CAB, up=roof(kind))
    bushings(m, terminals, 10.75)
    if kind == 'sync':
        contact(m, 15.25, 6, 9, 12.5, True)
        contact(m, 0.75, 6, 9, 12.5, False)
    return m


def industrial_base(name, seed):
    """Промышленный, низ: цоколь, большая дверь (+X), рёбра радиатора по ±Z и −X"""
    kind = sync_kind(name)
    m = Model(64, seed)
    m.box([0.5, 0, 0.5], [15.5, 1, 15.5], CAB_DARK, cull=('down',))
    m.box([1, 1, 1], [15, 16, 15], CAB, east=door(kind), north=side(True), south=side(True), up=None, down=None)
    m.box([15, 6, 2.5], [15.5, 10, 3.5], CAB_DARK)
    for zf in (0, 15):
        for i in range(7):
            x = 2 + i * 2
            m.box([x, 1.5, zf], [x + .6, 16, zf + 1], ALU)
    for i in range(6):
        z = 2.5 + i * 2
        m.box([0, 1.5, z], [1, 16, z + .6], ALU)
    return m


def generate(res, ns, dump, blockstate, display, emit):
    import os
    for i, (name, terminals) in enumerate(LAYOUTS.items()):
        seed = 1500 + i * 10
        variants = [(name, light(name, terminals, seed)), ('heavy_' + name, heavy(name, terminals, seed + 1))]
        if name.startswith('three_phase'):
            variants.append(('industrial_' + name, industrial_top(name, terminals, seed + 2)))
        for block, m in variants:
            emit(block, m, res, ns, dump, display)
            dump({'parent': f'{ns}:block/{block}/block'}, 'models', 'item', block + '.json')
            dump(blockstate(block), 'blockstates', block + '.json')
        if name.startswith('three_phase'):
            base = 'industrial_' + name + '_base'
            m = industrial_base(name, seed + 3)
            emit(base, m, res, ns, dump, display, roll=False)
            dump({'variants': {f'logged_state={s}': {'model': f'{ns}:block/{base}/block'}
                               for s in ('dry', 'oillogged', 'waterlogged')}}, 'blockstates', base + '.json')
    os.makedirs(os.path.join(res, 'textures', 'block'), exist_ok=True)
