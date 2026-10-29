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
    if len(image) not in (16, 32, 64) or any(len(row) != len(image) for row in image):
        raise ValueError(f'Ожидается готовая квадратная текстура 16/32/64: {name}')

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

# Просмотр целого PNG: размер картинки не должен обрезать более крупные текстуры.
canvas = [[(28, 30, 34, 255)] * (len(ITEMS) * 144) for _ in range(144)]
for i, name in enumerate(ITEMS):
    image = read(TEXTURES / 'item' / (name + '.png'))
    size = len(image)
    for y in range(128):
        for x in range(128):
            pixel = image[y * size // 128][x * size // 128]
            if pixel[3]:
                canvas[8 + y][i * 144 + 8 + x] = pixel
write(ART / 'preview.png', canvas)
print('Готово: анимации пирогеля и просмотр; предметные PNG сохранены.')
