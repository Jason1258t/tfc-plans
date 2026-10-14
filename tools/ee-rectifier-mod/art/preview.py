"""Картинка «вид сверху» для сайта: верх плиты с клеммами, увеличение ×8. Запуск: python3 art/preview.py <папка>"""
import os
import sys

from gen_assets import LAYOUTS, RES
from png import read, write

out_dir = sys.argv[1] if len(sys.argv) > 1 else '.'
os.makedirs(out_dir, exist_ok=True)
TERM = {'phase': 0, 'plus': 4, 'minus': 8}
for name, (terminals, kinds) in LAYOUTS.items():
    tex = read(os.path.join(RES, 'textures', 'block', name + '.png'))
    top = [row[0:16] for row in tex[16:32]]
    for (cx, cz), k in zip(terminals, kinds):
        u = TERM[k]
        for z in range(4):
            for x in range(4):
                top[cz - 2 + z][cx - 2 + x] = tex[12 + z][u + x]
    s = 8
    write(os.path.join(out_dir, name + '.png'), [[p for p in row for _ in range(s)] for row in top for _ in range(s)])
print('готово:', out_dir)
