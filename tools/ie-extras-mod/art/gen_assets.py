"""
Ресурсы IE Extras. Запуск: python3 art/gen_assets.py (из папки мода; IE берётся из libs/ — сначала ./libs.sh)

Аналоговый нагреватель — в стиле внешнего нагревателя IE: та же стальная рамка. Лицевая грань (греющая) — решётка
внешнего нагревателя IE (в модели — текстуры IE), задняя — его же розетка питания, боковые — своя текстура: рамка IE
и шкальный прибор на тёмной панели. Горизонтальные положения — поворотом модели «лицом на север», вверх и вниз — свои модели.
"""
import json
import os
import zipfile

import png

HERE = os.path.dirname(os.path.abspath(__file__))
MOD = os.path.join(HERE, '..')
RES = os.path.join(MOD, 'src', 'main', 'resources', 'assets', 'ie_extras')
IE_TEX = 'assets/immersiveengineering/textures/block/metal_device/'


def ie_texture(name):
    libs = os.path.join(MOD, 'libs')
    jar = next(f for f in os.listdir(libs) if f.startswith('ImmersiveEngineering-'))
    with zipfile.ZipFile(os.path.join(libs, jar)) as z:
        data = z.read(IE_TEX + name + '.png')
    tmp = os.path.join(MOD, 'build', 'ie_' + name + '.png')
    os.makedirs(os.path.dirname(tmp), exist_ok=True)
    open(tmp, 'wb').write(data)
    return png.read(tmp)


def hexc(h):
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 255)


# Боковая панель 10×10 (x, y = 3…12): шкальный прибор со стрелкой и под ним полоска «цвета каления»
SIDE = [
    '..........',
    '..rrrrrr..',
    '.rfmffmfr.',
    '.rmffffnr.',
    '.rffffnfr.',
    '.rfffhffr.',
    '.rrrrrrrr.',
    '..........',
    '.gyoORRW..',
    '..........',
]


def side_texture():
    """Рамка IE (из розетки внешнего нагревателя), на тёмной панели — шкальный прибор и шкала температур"""
    px = [list(r) for r in ie_texture('furnace_heater_socket')]
    panel = px[8][4]  # тёмно-синяя панель IE
    colors = {
        'r': hexc('9a9a9a'), 'f': hexc('e3dcc6'), 'm': hexc('3a3a3a'), 'n': hexc('c0392b'), 'h': hexc('202020'),
        'g': hexc('6e6e6e'), 'y': hexc('8c1c13'), 'o': hexc('c0392b'), 'O': hexc('e67e22'), 'R': hexc('f5b041'),
        'W': hexc('fdf2c5'),
    }
    for dy, row in enumerate(SIDE):
        for dx, ch in enumerate(row):
            px[3 + dy][3 + dx] = colors.get(ch, panel)
    return px


SIDE_TEX = 'ie_extras:block/analog_heater_side'
SOCKET = 'immersiveengineering:block/metal_device/furnace_heater_socket'
FRONT = {False: 'immersiveengineering:block/metal_device/furnace_heater',
         True: 'immersiveengineering:block/metal_device/furnace_heater_active'}
# Решётка (греющая грань) и розетка по положению модели; вертикальные — свои модели без поворота, чтобы прибор на боках
# стоял шкалой вверх (у поворота x боковые текстуры легли бы набок)
LAYOUTS = {'': ('north', 'south'), '_up': ('up', 'down'), '_down': ('down', 'up')}


def model(layout, lit):
    front, back = LAYOUTS[layout]
    tex = {f: SIDE_TEX for f in ('north', 'south', 'east', 'west', 'up', 'down')}
    tex[front] = FRONT[lit]
    tex[back] = SOCKET
    return {'parent': 'minecraft:block/cube', 'textures': {'particle': SIDE_TEX, **tex}}


ROT = {
    'north': ('', {}),
    'east': ('', {'y': 90}),
    'south': ('', {'y': 180}),
    'west': ('', {'y': 270}),
    'up': ('_up', {}),
    'down': ('_down', {}),
}


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write('\n')


def main():
    os.makedirs(os.path.join(RES, 'textures', 'block'), exist_ok=True)
    png.write(os.path.join(RES, 'textures', 'block', 'analog_heater_side.png'), side_texture())
    for layout in LAYOUTS:
        for lit in (False, True):
            name = 'analog_heater' + layout + ('_on' if lit else '')
            write_json(os.path.join(RES, 'models', 'block', name + '.json'), model(layout, lit))
    write_json(os.path.join(RES, 'models', 'item', 'analog_heater.json'), {'parent': 'ie_extras:block/analog_heater'})
    variants = {}
    for lit in ('false', 'true'):
        for facing, (layout, rot) in ROT.items():
            m = 'ie_extras:block/analog_heater' + layout + ('_on' if lit == 'true' else '')
            variants[f'facing={facing},lit={lit}'] = {'model': m, **rot}
    write_json(os.path.join(RES, 'blockstates', 'analog_heater.json'), {'variants': variants})
    print('готово: ресурсы ie_extras')


if __name__ == '__main__':
    main()
