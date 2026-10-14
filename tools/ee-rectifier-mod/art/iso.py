"""
Объёмная иконка для сайта — как в инвентаре Minecraft: модель блока (кубы с гранями из текстуры) под поворотом
gui из модели (30° / −135°), три видимые стороны, затенение граней как в игре. Без Pillow: свой растеризатор с
буфером глубины. Запуск: python3 art/iso.py <папка> [размер]
"""
import json
import math
import os
import sys

from gen_assets import LAYOUTS, RES
from png import read, write

SHADE = {'up': 1.0, 'down': 0.5, 'north': 0.8, 'south': 0.8, 'east': 0.6, 'west': 0.6}


def rot(v, rx, ry):
    """Поворот вокруг Y на ry, затем вокруг X на rx (градусы), как display.rotation [x, y, 0]. Знак Y — как в
    Minecraft: при −135° северная грань (лицо печи) видна слева"""
    x, y, z = v
    a = math.radians(-ry)
    x, z = x * math.cos(a) + z * math.sin(a), -x * math.sin(a) + z * math.cos(a)
    b = math.radians(rx)
    y, z = y * math.cos(b) - z * math.sin(b), y * math.sin(b) + z * math.cos(b)
    return (x, y, z)


def face_quad(f, t, name):
    """Углы грани: начало (u0, v0), направление u и направление v — по правилам UV Minecraft"""
    (x0, y0, z0), (x1, y1, z1) = f, t
    return {
        'up': ((x0, y1, z0), (x1, y1, z0), (x0, y1, z1)),
        'down': ((x0, y0, z1), (x1, y0, z1), (x0, y0, z0)),
        'north': ((x1, y1, z0), (x0, y1, z0), (x1, y0, z0)),
        'south': ((x0, y1, z1), (x1, y1, z1), (x0, y0, z1)),
        'west': ((x0, y1, z0), (x0, y1, z1), (x0, y0, z0)),
        'east': ((x1, y1, z1), (x1, y1, z0), (x1, y0, z1)),
    }[name]


def render(model, tex, size):
    disp = model['display']['gui']
    rx, ry, _ = disp['rotation']
    th = len(tex)
    tw = len(tex[0])
    img = [[(0, 0, 0, 0)] * size for _ in range(size)]
    depth = [[-1e9] * size for _ in range(size)]
    # Масштаб: куб 16³ после поворота умещается в картинку с полем
    scale = size / (16 * 1.75)

    def proj(p):
        x, y, z = rot((p[0] - 8, p[1] - 8, p[2] - 8), rx, ry)
        return (size / 2 + x * scale, size / 2 - y * scale, z)

    for el in model['elements']:
        for name, face in el['faces'].items():
            o, pu, pv = face_quad(el['from'], el['to'], name)
            O, U, V = proj(o), proj(pu), proj(pv)
            du = (U[0] - O[0], U[1] - O[1], U[2] - O[2])
            dv = (V[0] - O[0], V[1] - O[1], V[2] - O[2])
            det = du[0] * dv[1] - du[1] * dv[0]
            if abs(det) < 1e-9:
                continue
            # Видна, если нормаль смотрит на зрителя (+z после поворота): u × v в экранных координатах (y вниз)
            if det > 0:
                continue
            u0, v0, u1, v1 = face['uv']
            r = face.get('rotation', 0)
            xs = [O[0], U[0], V[0], U[0] + dv[0]]
            ys = [O[1], U[1], V[1], U[1] + dv[1]]
            for py in range(max(0, int(min(ys))), min(size, int(max(ys)) + 1)):
                for px in range(max(0, int(min(xs))), min(size, int(max(xs)) + 1)):
                    qx, qy = px + 0.5 - O[0], py + 0.5 - O[1]
                    s = (qx * dv[1] - qy * dv[0]) / det
                    t = (du[0] * qy - du[1] * qx) / det
                    if not (0 <= s < 1 and 0 <= t < 1):
                        continue
                    z = O[2] + s * du[2] + t * dv[2]
                    if z <= depth[py][px]:
                        continue
                    a, b = s, t
                    for _ in range(r // 90):  # поворот текстуры грани по часовой
                        a, b = b, 1 - a
                    tx = int((u0 + (u1 - u0) * a) / 16 * tw)
                    ty = int((v0 + (v1 - v0) * b) / 16 * th)
                    c = tex[min(th - 1, max(0, ty))][min(tw - 1, max(0, tx))]
                    if c[3] == 0:
                        continue
                    k = SHADE[name]
                    depth[py][px] = z
                    img[py][px] = (int(c[0] * k), int(c[1] * k), int(c[2] * k), 255)
    return img


if __name__ == '__main__':
    out_dir = sys.argv[1] if len(sys.argv) > 1 else '.'
    size = int(sys.argv[2]) if len(sys.argv) > 2 else 256
    os.makedirs(out_dir, exist_ok=True)
    for name in LAYOUTS:
        with open(os.path.join(RES, 'models', 'block', name, 'block.json')) as f:
            model = json.load(f)
        tex = read(os.path.join(RES, 'textures', 'block', name + '.png'))
        write(os.path.join(out_dir, name + '.png'), render(model, tex, size))
    print('готово:', out_dir)
