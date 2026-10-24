import type { Turn } from './blockModels';

/**
 * Части блоков Create, которые игра рисует кодом (Flywheel-визуалы и BlockEntityRenderer), а не моделью blockstate:
 * ремень, полувалы редуктора и муфт, вал в обшивке, голова пресса, крыльчатка вентилятора, шестерни насоса и жернова…
 * Модели частей — раздел pm файла block-models/create.json (scripts/mods/block-models.mjs, PARTIAL_NAMESPACES).
 * Правила — из Create 6.0.10 (AllBlockEntityTypes.visual, *Visual, BeltRenderer), положение — как у стоящей машины
 * (голова пресса поднята, рука раздатчика втянута, вращения нет).
 * Блока нет в реестре — только модель blockstate, как раньше.
 */

export interface PartRef {
  /** Модель-часть: 'create:block/shaft_half' */
  model: string;
  /** Повороты вокруг центра в порядке применения к вершине */
  turns: Turn[];
}

type Dir = 'up' | 'down' | 'north' | 'south' | 'east' | 'west';
type Axis = 'x' | 'y' | 'z';
const STEP: Record<Dir, [number, number, number]> = {
  up: [0, 1, 0],
  down: [0, -1, 0],
  north: [0, 0, -1],
  south: [0, 0, 1],
  west: [-1, 0, 0],
  east: [1, 0, 0],
};
const OPPOSITE: Record<Dir, Dir> = {
  up: 'down',
  down: 'up',
  north: 'south',
  south: 'north',
  west: 'east',
  east: 'west',
};
const AXIS_OF: Record<Dir, Axis> = { up: 'y', down: 'y', north: 'z', south: 'z', west: 'x', east: 'x' };
const POSITIVE: Record<Axis, Dir> = { x: 'east', y: 'up', z: 'south' };
const CLOCKWISE: Record<string, Dir> = { north: 'east', east: 'south', south: 'west', west: 'north' };

/**
 * Поворот, переводящий сторону from в to (RotatingInstance.rotateToFace → Quaternionf.rotationTo JOML):
 * перпендикулярные — 90° вокруг from × to, противоположные — 180° вокруг (fy, −fx, 0), а он нулевой — (0, fz, −fy).
 */
function faceTurn(from: Dir, to: Dir): Turn[] {
  if (from === to) return [];
  const [fx, fy, fz] = STEP[from];
  const [tx, ty, tz] = STEP[to];
  let c: [number, number, number];
  let deg = 90;
  if (from === OPPOSITE[to]) {
    c = fy || fx ? [fy, -fx, 0] : [0, fz, -fy];
    deg = 180;
  } else c = [fy * tz - fz * ty, fz * tx - fx * tz, fx * ty - fy * tx];
  const i = c.findIndex((v) => v !== 0);
  return [[(['x', 'y', 'z'] as const)[i], deg * Math.sign(c[i])]];
}
/** AngleHelper.horizontalAngle: south 0, east 90, north 180, west 270 */
const HORIZONTAL_ANGLE: Record<string, number> = { south: 0, east: 90, north: 180, west: 270 };

const part = (name: string, turns: Turn[] = []): PartRef => ({ model: `create:block/${name}`, turns });
const dirOf = (p: Map<string, string>, key = 'facing', fallback: Dir = 'north') => (p.get(key) ?? fallback) as Dir;
const axisOf = (p: Map<string, string>, fallback: Axis = 'y') => (p.get('axis') ?? fallback) as Axis;

/** Вал по оси (SingleAxisRotatingVisual.shaft: модель SHAFT стоит по Y) */
const shaft = (axis: Axis) => part('shaft', faceTurn('up', POSITIVE[axis]));
/** Полувал к стороне (SHAFT_HALF смотрит на юг) */
const half = (d: Dir) => part('shaft_half', faceTurn('south', d));
const halvesAlong = (axis: Axis) => [half(OPPOSITE[POSITIVE[axis]]), half(POSITIVE[axis])];

/** Ось вращения DirectionalAxisKineticBlock (раздатчик, механический поршень…) */
function directionalAxis(p: Map<string, string>): Axis {
  const piston = AXIS_OF[dirOf(p)];
  const first = p.get('axis_along_first') === 'true';
  if (piston === 'x') return first ? 'y' : 'z';
  if (piston === 'y') return first ? 'x' : 'z';
  return first ? 'x' : 'y';
}

/** Ремень (BeltRenderer.renderSafe + getBeltPartial; шкив — у начала и конца) */
function belt(p: Map<string, string>): PartRef[] {
  const slope = p.get('slope') ?? 'horizontal';
  const facing = dirOf(p, 'facing', 'south');
  const partName = p.get('part') ?? 'middle';
  const downward = slope === 'downward';
  const upward = slope === 'upward';
  const diagonal = downward || upward;
  const sideways = slope === 'sideways';
  let start = partName === 'start';
  let end = partName === 'end';
  if (downward || (slope === 'vertical' && STEP[facing].some((v) => v > 0))) [start, end] = [end, start];
  const turns: Turn[] = [
    ['x', !diagonal && slope !== 'horizontal' ? 90 : 0],
    ['z', sideways ? 90 : 0],
    ['y', HORIZONTAL_ANGLE[facing] + (upward ? 180 : 0) + (sideways ? 270 : 0)],
  ];
  const kind = start ? 'start' : end ? 'end' : 'middle';
  const out = diagonal
    ? [part(`belt/diagonal_${kind}`, turns)]
    : [part(`belt/${kind}_bottom`, turns), part(`belt/${kind}`, turns)];
  if (partName !== 'middle') {
    const d = sideways ? 'up' : CLOCKWISE[facing];
    const a = AXIS_OF[d];
    const t: Turn[] = [['x', 90]];
    if (a === 'x') t.push(['y', 90]);
    if (a === 'y') t.push(['x', 90]);
    out.push(part('belt_pulley', t));
  }
  return out;
}

const RULES: Record<string, (p: Map<string, string>) => PartRef[]> = {
  'create:belt': belt,
  // Замена в схеме на предмет ремня (у блока своего предмета нет) — тот же ремень
  'create:belt_connector': belt,
  'create:gearbox': (p) => (Object.keys(STEP) as Dir[]).filter((d) => AXIS_OF[d] !== axisOf(p)).map((d) => half(d)),
  'create:andesite_encased_shaft': (p) => [shaft(axisOf(p))],
  'create:brass_encased_shaft': (p) => [shaft(axisOf(p))],
  'create:encased_chain_drive': (p) => [shaft(axisOf(p))],
  'create:adjustable_chain_gearshift': (p) => [shaft(axisOf(p))],
  'create:metal_girder_encased_shaft': (p) => [shaft(axisOf(p))],
  'create:rotation_speed_controller': (p) => [shaft(axisOf(p, 'x'))],
  'create:sequenced_gearshift': (p) => halvesAlong(axisOf(p)),
  'create:clutch': (p) => halvesAlong(axisOf(p)),
  'create:gearshift': (p) => halvesAlong(axisOf(p)),
  'create:creative_motor': (p) => [half(dirOf(p))],
  'create:cuckoo_clock': (p) => [half(OPPOSITE[dirOf(p)])],
  'create:mechanical_piston': (p) => [shaft(directionalAxis(p))],
  'create:sticky_mechanical_piston': (p) => [shaft(directionalAxis(p))],
  'create:encased_fan': (p) => {
    const back = OPPOSITE[dirOf(p)];
    return [half(back), part('encased_fan/propeller', faceTurn('south', back))];
  },
  'create:mechanical_drill': (p) => [part('mechanical_drill/head', faceTurn('south', dirOf(p)))],
  'create:mechanical_pump': (p) => [part('mechanical_pump/cog', faceTurn('south', POSITIVE[AXIS_OF[dirOf(p)]]))],
  'create:millstone': () => [part('millstone/inner')],
  'create:crushing_wheel': (p) => [part('crushing_wheel/block', faceTurn('up', POSITIVE[axisOf(p)]))],
  'create:powered_shaft': (p) => [part('powered_shaft', faceTurn('up', POSITIVE[axisOf(p)]))],
  'create:mechanical_crafter': (p) => [part('cogwheel_shaftless', faceTurn('up', POSITIVE[AXIS_OF[dirOf(p)]]))],
  'create:mechanical_press': (p) => {
    const f = dirOf(p);
    return [shaft(AXIS_OF[f]), part('mechanical_press/head', [['y', HORIZONTAL_ANGLE[f]]])];
  },
  'create:mechanical_mixer': () => [
    part('cogwheel_shaftless'),
    part('mechanical_mixer/pole'),
    part('mechanical_mixer/head'),
  ],
  'create:deployer': (p) => {
    const f = dirOf(p);
    const rotatePole = (p.get('axis_along_first') === 'true') !== (AXIS_OF[f] === 'z');
    const y = HORIZONTAL_ANGLE[f] ?? 0;
    const x = f === 'up' ? 270 : f === 'down' ? 90 : 0;
    return [
      shaft(directionalAxis(p)),
      part('deployer/pole', [
        ['z', rotatePole ? 90 : 0],
        ['x', x],
        ['y', y],
      ]),
      part('deployer/hand_pointing', [
        ['x', x],
        ['y', y],
      ]),
    ];
  },
  ...Object.fromEntries(
    ['andesite', 'brass'].flatMap((m) => [
      [`create:${m}_encased_cogwheel`, encasedCog('cogwheel_shaftless')],
      [`create:${m}_encased_large_cogwheel`, encasedCog('large_cogwheel_shaftless')],
    ]),
  ),
};

/** Шестерня в обшивке (EncasedCogVisual): шестерня по оси и полувалы, где top_shaft / bottom_shaft */
function encasedCog(model: string) {
  return (p: Map<string, string>): PartRef[] => {
    const axis = axisOf(p);
    const out = [part(model, faceTurn('up', POSITIVE[axis]))];
    if (p.get('top_shaft') === 'true') out.push(half(POSITIVE[axis]));
    if (p.get('bottom_shaft') === 'true') out.push(half(OPPOSITE[POSITIVE[axis]]));
    return out;
  };
}

export const hasCodeParts = (id: string) => id in RULES;
export const codeParts = (id: string, p: Map<string, string>): PartRef[] => RULES[id]?.(p) ?? [];
