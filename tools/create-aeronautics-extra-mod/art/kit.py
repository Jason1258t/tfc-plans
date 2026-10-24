"""
Набор для моделей «как настоящее оборудование»: модель из коробок, у каждой грани — свой материал, текстура-атлас
собирается сама (один тексель на пиксель модели, одинаковые грани делят один участок). Крен (поворот на 90° вокруг
оси блока, как Layout.roll) — rolled(): коробки, грани и наклоны переносятся без ручного пересчёта.
Тот же файл — в small-diesel-mod/art/kit.py (держать одинаковыми).
"""
import math
import random

from png import write

CLEAR = (0, 0, 0, 0)
SIDES = ('north', 'east', 'south', 'west', 'up', 'down')


def hexc(h, a=255):
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)


def shade(c, k):
    """Светлее (k > 1) или темнее (k < 1)"""
    return tuple(max(0, min(255, round(v * k))) for v in c[:3]) + (c[3],)


def face_size(face, a, b):
    """Ширина и высота грани в пикселях (для боковых граней высота — по Y модели, сверху вниз)"""
    dx, dy, dz = (b[i] - a[i] for i in range(3))
    return {'north': (dx, dy), 'south': (dx, dy), 'east': (dz, dy), 'west': (dz, dy), 'up': (dx, dz), 'down': (dx, dz)}[face]


class Mat:
    """Материал: paint(w, h, rng) → строки цветов h×w. Ключ — для общего участка атласа у одинаковых граней."""

    def __init__(self, key, paint):
        self.key = key
        self.paint = paint


class Model:
    def __init__(self, size=64, seed=1):
        self.size = size
        self.px = [[CLEAR] * size for _ in range(size)]
        self.rng = random.Random(seed)
        self.cache = {}
        self.cx = self.cy = self.row = 0
        self.els = []

    def region(self, mat, w, h):
        """Участок атласа под грань w×h с материалом mat → uv"""
        tw, th = max(1, math.ceil(w - 1e-6)), max(1, math.ceil(h - 1e-6))
        key = (mat.key, tw, th)
        if key not in self.cache:
            if self.cx + tw > self.size:
                self.cx, self.cy, self.row = 0, self.cy + self.row, 0
            if self.cy + th > self.size:
                raise SystemExit(f'атлас {self.size}px переполнен ({mat.key} {tw}×{th}) — увеличьте size')
            rows = mat.paint(tw, th, self.rng)
            for y in range(th):
                for x in range(tw):
                    self.px[self.cy + y][self.cx + x] = rows[y][x]
            self.cache[key] = (self.cx, self.cy)
            self.cx += tw
            self.row = max(self.row, th)
        x0, y0 = self.cache[key]
        k = 16 / self.size
        return [x0 * k, y0 * k, (x0 + w) * k, (y0 + h) * k]

    def box(self, a, b, mat, name=None, cull=(), **per_face):
        """Коробка от a до b; mat — материал всех граней, per_face — свой материал грани (None — грани нет);
        cull — грани у края блока (cullface)"""
        faces = {}
        for f in SIDES:
            m = per_face.get(f, mat)
            if m is None:
                continue
            w, h = face_size(f, a, b)
            if w <= 0 or h <= 0:
                continue
            faces[f] = {'texture': '#0', 'uv': self.region(m, w, h)}
            if f in cull:
                faces[f]['cullface'] = f
        el = {'from': list(a), 'to': list(b), 'faces': faces}
        if name:
            el = {'name': name, **el}
        self.els.append(el)
        return el

    def save(self, path):
        write(path, self.px)

    def json(self, tex, display, credit):
        return {'credit': credit, 'textures': {'0': tex, 'particle': tex}, 'elements': self.els, 'display': display}


# ---------------------------------------------------------------- крен

ROLL_FACE = {'north': 'east', 'east': 'south', 'south': 'west', 'west': 'north', 'up': 'up', 'down': 'down'}


def roll_point(p):
    """(x, y, z) → (16 − z, y, x): так же, как Layout.roll для центров клемм"""
    return [16 - p[2], p[1], p[0]]


def rolled(els):
    """Те же коробки, повёрнутые на 90° вокруг оси Y модели (крен)"""
    out = []
    for el in els:
        a, b = roll_point(el['from']), roll_point(el['to'])
        n = dict(el)
        n['from'] = [min(a[i], b[i]) for i in range(3)]
        n['to'] = [max(a[i], b[i]) for i in range(3)]
        faces = {}
        for f, d in el['faces'].items():
            d = dict(d)
            if f in ('up', 'down'):
                d['rotation'] = (d.get('rotation', 0) + (90 if f == 'up' else 270)) % 360
            if 'cullface' in d:
                d['cullface'] = ROLL_FACE[d['cullface']]
            faces[ROLL_FACE[f]] = d
        n['faces'] = faces
        if 'rotation' in el:
            r = dict(el['rotation'])
            r['origin'] = roll_point(r['origin'])
            if r['axis'] == 'x':
                r['axis'] = 'z'
            elif r['axis'] == 'z':
                r['axis'], r['angle'] = 'x', -r['angle']
            n['rotation'] = r
        out.append(n)
    return out


# ---------------------------------------------------------------- вид в инвентаре


def _rx(a):
    c, s = math.cos(a), math.sin(a)
    return [[1, 0, 0], [0, c, -s], [0, s, c]]


def _ry(a):
    c, s = math.cos(a), math.sin(a)
    return [[c, 0, s], [0, 1, 0], [-s, 0, c]]


def _mul(p, q):
    return [[sum(p[i][k] * q[k][j] for k in range(3)) for j in range(3)] for i in range(3)]


def euler_xyz(m):
    """Углы (x, y, z) в градусах: m = Rx·Ry·Rz (как Quaternionf.rotationXYZ в ItemTransform)"""
    b = math.asin(max(-1, min(1, m[0][2])))
    a = math.atan2(-m[1][2], m[2][2])
    c = math.atan2(-m[0][1], m[0][0])
    return [round(math.degrees(v), 2) for v in (a, b, c)]


def lying(view_x=30, view_y=-135, tilt=90):
    """Поворот для display: модель «лицом вверх» (ось по Y) положена на бок — ось горизонтально, сторона −Z модели
    вверх, как стоит блок, поставленный на горизонтальный вал; потом обычный вид иконки (30°, −135°)"""
    m = _mul(_mul(_rx(math.radians(view_x)), _ry(math.radians(view_y))), _rx(math.radians(tilt)))
    return euler_xyz(m)


# ---------------------------------------------------------------- материалы

FILL = [hexc(c) for c in ['8f9691'] * 5 + ['9aa49d'] * 4 + ['a8b3ab']]
RIM, EDGE, CORNER = hexc('828784'), hexc('595858'), hexc('494848')
DARK, DARKER, HI = hexc('60635f'), hexc('505351'), hexc('b4c1b8')
COPPER = [hexc(c) for c in ['b26247', 'c87456', 'd67b5b', 'e3826c']]
RED = [hexc(c) for c in ['7a2420', '9c2f27', 'b8392d', 'd4503f']]
BLUE = [hexc(c) for c in ['1f2a44', '2b3a5e', '3a4d78', '4d6394']]
BRASS = [hexc(c) for c in ['7a5418', 'a8772a', 'd0a046', 'eecb6e']]
CERAMIC = [hexc(c) for c in ['5a2f1e', '7a4128', '96522f', 'b46a42']]
RUBBER = [hexc(c) for c in ['18171a', '232125', '2d2b2f', '3a383c']]
SOOT = [hexc(c) for c in ['2b2a2a', '363434', '403e3d', '4a4746']]


def grid(w, h, fn):
    return [[fn(x, y) for x in range(w)] for y in range(h)]


def noise(pal, border=None, corner=None):
    """Шум из палитры, по краю — рамка"""
    def paint(w, h, rng):
        def px(x, y):
            edge = border and (x in (0, w - 1) or y in (0, h - 1)) and w > 2 and h > 2
            if edge and corner and x in (0, w - 1) and y in (0, h - 1):
                return corner
            return border if edge else rng.choice(pal)
        return grid(w, h, px)
    return paint


def steel(key='steel', border=True):
    return Mat(key, noise(FILL, EDGE if border else None, CORNER))


def painted(key, pal, border=None):
    """Окрашенный металл: pal — тёмный, основной, светлый"""
    cols = [pal[1]] * 5 + [shade(pal[1], 1.06)] * 3 + [pal[2]]
    return Mat(key, noise(cols, border or pal[0], shade(pal[0], .85)))


def solid(key, c):
    return Mat(key, lambda w, h, rng: grid(w, h, lambda x, y: c))


def ribs(key, pal, period=2, across=False):
    """Рёбра охлаждения: полосы вдоль высоты грани (across — поперёк), светлое ребро и тёмная впадина"""
    light, mid, dark = pal

    def paint(w, h, rng):
        def px(x, y):
            i = y if across else x
            if period == 2:
                return dark if i % 2 else rng.choice((light, mid))
            return dark if i % period == period - 1 else light if i % period == 0 else mid
        return grid(w, h, px)
    return Mat(key, paint)


def louvre(key, pal):
    """Жалюзи вентиляции: наклонные пластины (блик сверху, щель под ней), рамка"""
    light, mid, dark, frame = pal

    def paint(w, h, rng):
        def px(x, y):
            if x in (0, w - 1) or y in (0, h - 1):
                return frame
            return (light, mid, dark)[(y - 1) % 3]
        return grid(w, h, px)
    return Mat(key, paint)


def mesh(key, pal):
    """Сетка решётки (вентилятор за ней): частые отверстия, рамка"""
    bar, hole, frame = pal

    def paint(w, h, rng):
        def px(x, y):
            if x in (0, w - 1) or y in (0, h - 1):
                return frame
            return hole if x % 2 and y % 2 else bar
        return grid(w, h, px)
    return Mat(key, paint)


def terminal(key, pal):
    """Медный (или в цветной изоляции) контакт: тёмный край, блик"""
    def paint(w, h, rng):
        def px(x, y):
            if (x in (0, w - 1)) and (y in (0, h - 1)) and w > 2 and h > 2:
                return pal[0]
            if (x in (0, w - 1) or y in (0, h - 1)) and w > 2 and h > 2:
                return pal[1]
            return pal[3] if (x, y) == (1, 1) or (w <= 2 and (x, y) == (0, 0)) else pal[2]
        return grid(w, h, px)
    return Mat(key, paint)


def nameplate(key, base=HI, ink=DARKER, rim=EDGE):
    """Табличка: светлая пластина, строки «текста»"""
    def paint(w, h, rng):
        def px(x, y):
            if x in (0, w - 1) or y in (0, h - 1):
                return rim
            if y % 2 == 0 and 1 < x < w - 2 and rng.random() < .7:
                return ink
            return base
        return grid(w, h, px)
    return Mat(key, paint)


def glaze(key, pal=CERAMIC):
    """Глазурь изолятора: блик слева, тень справа"""
    def paint(w, h, rng):
        def px(x, y):
            if x == 0:
                return pal[3]
            if x == w - 1:
                return pal[0]
            return pal[2] if x == 1 else pal[1]
        return grid(w, h, px)
    return Mat(key, paint)


class Canvas:
    """Грань для рисования вручную: фон из материала, потом прямоугольники и точки"""

    def __init__(self, rows):
        self.rows = rows
        self.h, self.w = len(rows), len(rows[0])

    def put(self, x, y, c):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.rows[y][x] = c

    def rect(self, x0, y0, x1, y1, c, fill=True):
        """Включительно; fill=False — только рамка"""
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                if fill or x in (x0, x1) or y in (y0, y1):
                    self.put(x, y, c)


def drawn(key, base, draw):
    """Материал: фон base (Mat), поверх — draw(canvas)"""
    def paint(w, h, rng):
        c = Canvas(base.paint(w, h, rng))
        draw(c)
        return c.rows
    return Mat(key, paint)
