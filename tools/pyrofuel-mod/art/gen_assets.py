"""Сборка анимаций из готовых тайлов и просмотр предметов; новые рисунки не перерисовывает."""
from pathlib import Path
import json
from png import read, write

ART = Path(__file__).resolve().parent
TEXTURES = ART.parent / 'src/main/resources/assets/pyrofuel/textures'
ITEMS = [
    'pyrocoke_mix', 'soaked_pyromass', 'raw_pyrocoke_briquette',
    'pyrocoke_briquette', 'stabilizing_additive', 'raw_pyrogel_bucket', 'pyrogel_bucket',
]

# Авторские PNG хранятся в ресурсах. Выпуск не должен возвращать старые процедурные значки.
for name in ITEMS:
    image = read(TEXTURES / 'item' / (name + '.png'))
    if len(image) != 16 or any(len(row) != 16 for row in image):
        raise ValueError(f'Ожидается готовая текстура 16×16: {name}')

for name in ('raw_pyrogel', 'pyrogel'):
    tile = read(ART / 'tiles' / (name + '.png'))
    if len(tile) != 16 or any(len(row) != 16 for row in tile):
        raise ValueError(f'Ожидается тайл 16×16: {name}')
    for variant, size in (('still', 16), ('flow', 32)):
        frames = []
        for frame in range(8):
            # Стоячая жидкость слегка колеблется, текущая движется на 2 пикселя за кадр.
            dx = (0, 1, 2, 3, 4, 3, 2, 1)[frame] if variant == 'still' else 0
            dy = frame * 2 if variant == 'flow' else 0
            for y in range(size):
                frames.append([tile[(y + dy) % 16][(x + dx) % 16] for x in range(size)])
        output = TEXTURES / 'fluid' / f'{name}_{variant}.png'
        output.parent.mkdir(parents=True, exist_ok=True)
        write(output, frames)
        output.with_suffix('.png.mcmeta').write_text(
            json.dumps({'animation': {'frametime': 4, 'interpolate': False}}) + '\n'
        )

# Увеличение без сглаживания — только технический просмотр готовых предметов.
canvas = [[(28, 30, 34, 255)] * (len(ITEMS) * 80) for _ in range(80)]
for i, name in enumerate(ITEMS):
    image = read(TEXTURES / 'item' / (name + '.png'))
    for y in range(16):
        for x in range(16):
            if image[y][x][3]:
                for dy in range(4):
                    for dx in range(4):
                        canvas[8 + y * 4 + dy][i * 80 + 8 + x * 4 + dx] = image[y][x]
write(ART / 'preview.png', canvas)
print('Готово: анимации пирогеля и просмотр; предметные PNG сохранены.')
