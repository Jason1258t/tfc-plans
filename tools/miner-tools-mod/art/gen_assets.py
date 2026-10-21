"""Текстура пояса шахтёра 16×16: кожаный ремень дугой, железная пряжка, сумочка-сито из джутовой сетки."""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
import png

T = (0, 0, 0, 0)
# кожа (тёмная → светлая), железо, джут
L0, L1, L2, L3 = (58, 34, 20, 255), (96, 58, 32, 255), (134, 84, 46, 255), (168, 112, 64, 255)
I0, I1, I2 = (70, 70, 76, 255), (140, 140, 150, 255), (205, 205, 212, 255)
J0, J1, J2 = (92, 74, 44, 255), (150, 124, 78, 255), (196, 170, 118, 255)

px = [[T] * 16 for _ in range(16)]
def put(x, y, c):
    if 0 <= x < 16 and 0 <= y < 16: px[y][x] = c

# ремень: лента высотой 4 пикселя, слегка провисает к середине
for x in range(16):
    sag = [3, 3, 4, 4, 5, 5, 5, 6, 6, 5, 5, 5, 4, 4, 3, 3][x]
    put(x, sag, L0)
    put(x, sag + 1, L3 if x % 3 else L2)
    put(x, sag + 2, L2)
    put(x, sag + 3, L1)
    put(x, sag + 4, L0)
    if x % 4 == 1: put(x, sag + 2, L1)  # прострочка
# пряжка слева: рамка 5×7
for y in range(3, 10):
    for x in range(1, 6):
        edge = x in (1, 5) or y in (3, 9)
        if edge: put(x, y, I2 if (x == 1 or y == 3) else I1)
for y in range(4, 9): put(3, y, I1)  # язычок
put(5, 9, I0); put(1, 9, I0)
# сумочка-сито справа под ремнём: сетка джута
for y in range(10, 15):
    for x in range(9, 15):
        edge = x in (9, 14) or y == 14
        if edge: put(x, y, J0)
        else: put(x, y, J2 if (x + y) % 2 else J1)
put(9, 14, T); put(14, 14, T)
for x in range(10, 14): put(x, 10, L1)  # клапан
put(11, 11, I1)  # заклёпка

out = os.path.join(os.path.dirname(__file__), '..', 'src/main/resources/assets/miner_tools/textures/item/miner_belt.png')
png.write(out, px)
print('ok', out)
