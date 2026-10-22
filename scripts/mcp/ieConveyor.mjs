/**
 * Конвейеры IE как предмет (загрузчик immersiveengineering:models/conveyor). Отдельной модели или картинки у предмета
 * нет: ModelConveyor.overrideList отдаёт тот же ModelConveyor, а без мира getQuads берёт умолчания — направление NORTH
 * (ClientUtils.rotateTo(NORTH) — без поворота), горизонтально, длина 1, лента неактивна (текстура *_off), без покраски
 * и крышки (cover = AIR), стенки — IConveyorModelRender.shouldRenderWall (без конвейера — true), оба угла.
 * Перенесено из IE 1.21.1-12.4.2: ModelConveyor.getBaseConveyor, ModelUtils.createBakedQuad / createBakedBox,
 * *ConveyorRender.modifyQuads (instance = null), поворот GUI — TRANSFORMATION_MAP (Matrix4: scale 0.625, Ry −45°,
 * Rz −20°, Rx 20°; Matrix4 умножает справа).
 *
 * conveyorParts(type) → { quads, panel, gui } или null: quads — грани для renderModel (пиксели блока 0–16, uv 0–16),
 * panel — у редстоун-конвейера модель панели (ie_obj, только группа «panel»), gui — матрица 3×3 вида.
 */

const IE = 'immersiveengineering:block/conveyor/';
const SIDE = `${IE}casing_side`; // rl_casing[1]
const WALLS = `${IE}casing_walls`; // rl_casing[2]
const FULL = `${IE}casing_full`; // rl_casing[3]

// Нормали граней по Direction (затенение берёт заявленное направление грани, а не её положение)
const DIR = {
  down: [0, -1, 0],
  up: [0, 1, 0],
  north: [0, 0, -1],
  south: [0, 0, 1],
  west: [-1, 0, 0],
  east: [1, 0, 0],
};

const v3 = (x, y, z) => [x, y, z];

/**
 * ModelUtils.createBakedQuad: вершины [0..3] получают uv (u0, v0), (u0, v1), (u1, v1), (u1, v0) — invert меняет только
 * порядок обхода. Грань для renderModel: начало uv (вершина 0), конец по u (вершина 3), конец по v (вершина 1).
 */
function quad(vs, dir, tex, uv, mat = null) {
  const p = vs.map((v) => (mat ? mat(v) : v).map((c) => c * 16));
  return { P: [p[0], p[3], p[1]], uv, N: DIR[dir], tex };
}

/** ModelUtils.createBakedBox: грани куба from–to; tex(dir) — текстура или null (грани нет) */
function box(from, to, mat, tex, pre = (v) => v) {
  const out = [];
  const m = (v) => mat(pre(v));
  const [fx, fy, fz] = from;
  const [tx, ty, tz] = to;
  const add = (vs, dir, uv) => {
    const t = tex(dir);
    if (t) out.push(quad(vs, dir, t, uv, m));
  };
  let vs = [v3(fx, fy, fz), v3(fx, fy, tz), v3(tx, fy, tz), v3(tx, fy, fz)];
  add(vs, 'down', [fx * 16, 16 - fz * 16, tx * 16, 16 - tz * 16]);
  vs = vs.map(([x, , z]) => v3(x, ty, z));
  add(vs, 'up', [fx * 16, fz * 16, tx * 16, tz * 16]);
  vs = [v3(tx, ty, fz), v3(tx, fy, fz), v3(fx, fy, fz), v3(fx, ty, fz)];
  add(vs, 'north', [fx * 16, 16 - ty * 16, tx * 16, 16 - fy * 16]);
  vs = vs.map(([x, y]) => v3(x, y, tz));
  add(vs, 'south', [tx * 16, 16 - ty * 16, fx * 16, 16 - fy * 16]);
  vs = [v3(fx, ty, tz), v3(fx, fy, tz), v3(fx, fy, fz), v3(fx, ty, fz)];
  add(vs, 'west', [tz * 16, 16 - ty * 16, fz * 16, 16 - fy * 16]);
  vs = vs.map(([, y, z]) => v3(tx, y, z));
  add(vs, 'east', [16 - tz * 16, 16 - ty * 16, 16 - fz * 16, 16 - fy * 16]);
  return out;
}

/** ModelConveyor.getBaseConveyor(NORTH, length 1, HORIZONTAL, corners [true, true]) — порядок граней как в коде */
function baseConveyor(belt, walls, mat = null) {
  const Q = (vs, dir, tex, uv) => quad(vs, dir, tex, uv, mat);
  const ring = (x0, x1, y) => [v3(x0, y, 0), v3(x0, y, 1), v3(x1, y, 1), v3(x1, y, 0)];
  const wring = (x0, x1, y) => [v3(x0, y, 0.0625), v3(x0, y, 0.9375), v3(x1, y, 0.9375), v3(x1, y, 0.0625)];
  const bottom = ring(0, 1, 0);
  const bottomBelt = ring(0.0625, 0.9375, 0);
  const top = ring(0, 1, 0.125);
  const topBelt = ring(0.0625, 0.9375, 0.125);
  const corner = ring(0, 1, 0.1875);
  const cornerBelt = ring(0.0625, 0.9375, 0.1875);
  const wallOuter = wring(0, 1, 0.125);
  const wallInner = wring(0.0625, 0.9375, 0.125);
  const wallOuterTop = wring(0, 1, 0.1875);
  const wallInnerTop = wring(0.0625, 0.9375, 0.1875);
  const top2 = WALLS; // topTexture без покраски — casing_walls
  const q = [
    Q(bottomBelt, 'down', belt, [1, 0, 15, 16]),
    Q(bottom, 'down', WALLS, [0, 0, 16, 16]),
    Q(top, 'up', belt, [0, 16, 16, 0]),
    Q([bottom[0], bottom[1], top[1], top[0]], 'west', SIDE, [0, 0, 2, 16]),
    Q([bottom[2], bottom[3], top[3], top[2]], 'east', SIDE, [0, 0, 2, 16]),
    Q([bottomBelt[0], topBelt[0], topBelt[3], bottomBelt[3]], 'north', belt, [1, 2, 15, 0]),
    Q([bottom[0], top[0], top[3], bottom[3]], 'north', WALLS, [0, 2, 16, 0]),
    Q([bottomBelt[1], topBelt[1], topBelt[2], bottomBelt[2]], 'south', belt, [1, 0, 15, 2]),
    Q([bottom[1], top[1], top[2], bottom[2]], 'south', WALLS, [0, 0, 16, 2]),
  ];
  // Углы: [0] — у южного края (вершины 1, 2), [1] — у северного (3, 0)
  for (const [a, b, ua, ub] of [
    [1, 2, [0, 1, 1, 0], [15, 1, 16, 0]],
    [3, 0, [0, 16, 1, 15], [15, 16, 16, 15]],
  ])
    q.push(
      Q([wallOuterTop[a], corner[a], cornerBelt[a], wallInnerTop[a]], 'up', top2, ua),
      Q([wallOuterTop[b], corner[b], cornerBelt[b], wallInnerTop[b]], 'up', top2, ub),
      Q([top[a], corner[a], cornerBelt[a], topBelt[a]], 'south', WALLS, [0, 2, 1, 3]),
      Q([top[b], corner[b], cornerBelt[b], topBelt[b]], 'south', WALLS, [15, 2, 16, 3]),
      Q([wallOuter[a], wallOuterTop[a], wallInnerTop[a], wallInner[a]], 'south', WALLS, [0, 2, 1, 3]),
      Q([wallOuter[b], wallOuterTop[b], wallInnerTop[b], wallInner[b]], 'south', WALLS, [15, 2, 16, 3]),
      Q([wallOuter[a], top[a], corner[a], wallOuterTop[a]], 'west', SIDE, [0, 2, 1, 3]),
      Q([wallInner[a], topBelt[a], cornerBelt[a], wallInnerTop[a]], 'east', SIDE, [15, 2, 16, 3]),
      Q([top[b], wallOuter[b], wallOuterTop[b], corner[b]], 'east', SIDE, [15, 2, 16, 3]),
      Q([topBelt[b], wallInner[b], wallInnerTop[b], cornerBelt[b]], 'west', SIDE, [0, 2, 1, 3]),
    );
  if (walls[0])
    q.push(
      Q([wallOuterTop[0], wallOuterTop[1], wallInnerTop[1], wallInnerTop[0]], 'up', top2, [0, 15, 1, 1]),
      Q([wallOuter[0], wallOuter[1], wallOuterTop[1], wallOuterTop[0]], 'west', SIDE, [2, 15, 3, 1]),
      Q([wallInner[0], wallInner[1], wallInnerTop[1], wallInnerTop[0]], 'east', SIDE, [2, 15, 3, 1]),
    );
  if (walls[1])
    q.push(
      Q([wallOuterTop[2], wallOuterTop[3], wallInnerTop[3], wallInnerTop[2]], 'up', top2, [15, 15, 16, 1]),
      Q([wallInner[3], wallInner[2], wallInnerTop[2], wallInnerTop[3]], 'west', SIDE, [2, 15, 3, 1]),
      Q([wallOuter[3], wallOuter[2], wallOuterTop[2], wallOuterTop[3]], 'east', SIDE, [2, 15, 3, 1]),
    );
  return q;
}

/** SplitConveyorRender.modifyQuads: дно casing_full, перегородка-«клин» split_wall поверх ленты */
function splitQuads(q) {
  const W = `${IE}split_wall`;
  q[0] = quad([v3(0.0625, 0, 0), v3(0.0625, 0, 1), v3(0.9375, 0, 1), v3(0.9375, 0, 0)], 'down', FULL, [1, 0, 15, 16]);
  q.push(
    quad(
      [v3(0.0625, 0.1875, 0), v3(0.0625, 0.1875, 1), v3(0.9375, 0.1875, 1), v3(0.9375, 0.1875, 0)],
      'up',
      W,
      [1, 16, 15, 0],
    ),
  );
  q[5] = quad(
    [v3(0.0625, 0, 0), v3(0.0625, 0.1875, 0), v3(0.9375, 0.1875, 0), v3(0.9375, 0, 0)],
    'north',
    SIDE,
    [1, 16, 15, 13],
  );
  for (let i = 0; i < 8; i++) {
    const z = (i + 1) * 0.0625;
    const f = [v3(0.0625, 0.125, z), v3(0.0625, 0.1875, z), v3(0.9375, 0.1875, z), v3(0.9375, 0.125, z)];
    q.push(quad(f, 'north', W, [1, 16 - i - 1, 15, 16 - i]));
    if (i < 7) {
      const u = 8 - i;
      for (const x of [0.5 + z, 0.5 - z])
        q.push(
          quad([v3(x, 0.125, 0), v3(x, 0.125, 0.5), v3(x, 0.1875, 0.5), v3(x, 0.1875, 0)], 'north', W, [
            u - 1,
            16,
            u,
            8,
          ]),
        );
    }
  }
}

/** ExtractConveyorRender.modifyQuads без конвейера: направление забора SOUTH, выдвижение 0 */
function extractQuads(q) {
  // Matrix4(SOUTH): поворот 180° вокруг Y через центр блока
  const south = ([x, y, z]) => [1 - x, y, 1 - z];
  const steel = 'immersiveengineering:block/metal/storage_steel';
  const casing = 'immersiveengineering:block/wooden_device/turntable_bottom';
  const casingTex = (d) => (d === 'north' || d === 'south' ? steel : casing);
  const shift = ([x, y, z]) => [x, y - 0.25, z - 0.625];
  q.push(...box([0.0625, 0.375, 0.625], [0.1875, 1, 1], south, casingTex, shift));
  q.push(...box([0.8125, 0.375, 0.625], [0.9375, 1, 1], south, casingTex, shift));
  q.push(...box([0.1875, 0.875, 0.625], [0.8125, 1, 1], south, casingTex, shift));
  const asm = 'immersiveengineering:block/multiblocks/assembler';
  const pane = (z) => [v3(0.8125, 0.625, z), v3(0.8125, 0.125, z), v3(0.1875, 0.125, z), v3(0.1875, 0.625, z)];
  q.push(quad(pane(0.03125), 'north', asm, [15.25, 13.25, 12.75, 15.25], south));
  q.push(quad(pane(0.0625), 'south', asm, [12.75, 13.25, 15.25, 15.25], south));
  for (let i = 0; i < 5; i++) {
    const off = i * 0.125;
    q.push(
      ...box(
        [0.203125 + off, 0.1875, 0.09375],
        [0.296875 + off, 0.625, 0.125],
        south,
        () => 'immersiveengineering:block/stripcurtain',
      ),
    );
  }
}

/** Матрица 3×3 (строки) из произведения поворотов вокруг осей (радианы, правая тройка) */
function rot(axis, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  if (axis === 'x') return [1, 0, 0, 0, c, -s, 0, s, c];
  if (axis === 'y') return [c, 0, s, 0, 1, 0, -s, 0, c];
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}
function mul3(a, b) {
  const o = new Array(9).fill(0);
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
  return o;
}
const D = Math.PI / 180;
// TRANSFORMATION_MAP[GUI] без масштаба (генератор сам вписывает рисунок)
const GUI = mul3(mul3(rot('y', -45 * D), rot('z', -20 * D)), rot('x', 20 * D));

/** Тип конвейера (conveyorType) → грани предмета */
export function conveyorParts(type) {
  const name = String(type ?? '').replace(/^immersiveengineering:/, '');
  const off = {
    basic: 'off',
    redstone: 'off',
    extract: 'off',
    dropper: 'dropper_off',
    splitter: 'split_off',
    vertical: 'vertical_off',
  }[name];
  if (!off) return null;
  const belt = `${IE}${off}`;
  // VerticalConveyorRender.modifyBaseRotationMatrix: T(0, 1, 0) · Rx(90°) — лента встаёт стенкой на север
  const vertical = name === 'vertical' ? ([x, y, z]) => [x, 1 - z, y] : null;
  // SplitConveyorRender.shouldRenderWall — false; остальные без конвейера — true
  const q = baseConveyor(belt, name === 'splitter' ? [false, false] : [true, true], vertical);
  if (name === 'splitter') splitQuads(q);
  if (name === 'extract') extractQuads(q);
  // RedstoneConveyorRender: панель справа (instance = null), модель dynamic/conveyor_redstone_panel, поворот
  // BlockModelRotation.by(0, 180 + 180) — без поворота; лампа — только у включённого
  const panel =
    name === 'redstone' ? { model: 'immersiveengineering:dynamic/conveyor_redstone_panel', groups: ['panel'] } : null;
  return { quads: q, panel, gui: GUI };
}
