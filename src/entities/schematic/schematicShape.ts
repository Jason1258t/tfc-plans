/** Упрощённые формы блоков для вида сверху и 3D схемы; не зависит от three.js или данных моделей. */

/** Параллелепипед в долях блока: x0 y0 z0 x1 y1 z1 */
export type Box = [number, number, number, number, number, number];

export const FULL: Box = [0, 0, 0, 1, 1, 1];
export const px = (n: number) => n / 16;

/** Жидкость как блок: вода, лава, fluid/… модов (не «жидкостная труба» и т. п.) */
const FLUID = /(^|:)(water|lava)$|[:/]fluid\//;

/** Модель в jar — только часть блока, остальное рисует код игры (например, Create fluid pipe). */
const CODE_DRAWN = /(^|:)fluid_pipe$/;
export const drawnByCode = (id: string) => CODE_DRAWN.test(id);

export function shapeOf(id: string, p: Map<string, string>): Box[] {
  const name = id.split(':')[1] ?? id;
  const facing = p.get('facing') ?? p.get('horizontal_facing') ?? 'north';
  const axis =
    p.get('axis') ?? (facing === 'east' || facing === 'west' ? 'x' : facing === 'up' || facing === 'down' ? 'y' : 'z');
  /** Пластина у стороны side толщиной t */
  const plate = (side: string, t: number): Box =>
    side === 'north'
      ? [0, 0, 0, 1, 1, t]
      : side === 'south'
        ? [0, 0, 1 - t, 1, 1, 1]
        : side === 'west'
          ? [0, 0, 0, t, 1, 1]
          : side === 'east'
            ? [1 - t, 0, 0, 1, 1, 1]
            : side === 'down'
              ? [0, 0, 0, 1, t, 1]
              : [0, 1 - t, 0, 1, 1, 1];
  const opposite: Record<string, string> = {
    north: 'south',
    south: 'north',
    east: 'west',
    west: 'east',
    up: 'down',
    down: 'up',
  };
  /** Стержень вдоль оси шириной w (в пикселях) */
  const rod = (w: number): Box => {
    const a = px(8 - w / 2);
    const b = px(8 + w / 2);
    return axis === 'x' ? [0, a, a, 1, b, b] : axis === 'y' ? [a, 0, a, b, 1, b] : [a, a, 0, b, b, 1];
  };
  /** Диск поперёк оси: диаметр d, толщина t (в пикселях) */
  const disc = (d: number, t: number): Box => {
    const a = px(8 - d / 2);
    const b = px(8 + d / 2);
    const c = px(8 - t / 2);
    const e = px(8 + t / 2);
    return axis === 'x' ? [c, a, a, e, b, b] : axis === 'y' ? [a, c, a, b, e, b] : [a, a, c, b, b, e];
  };
  const arms = (w: number, y0: number, y1: number, on: (side: string) => boolean): Box[] => {
    const a = px(8 - w / 2);
    const b = px(8 + w / 2);
    const out: Box[] = [];
    if (on('north')) out.push([a, y0, 0, b, y1, a]);
    if (on('south')) out.push([a, y0, b, b, y1, 1]);
    if (on('west')) out.push([0, y0, a, a, y1, b]);
    if (on('east')) out.push([b, y0, a, 1, y1, b]);
    return out;
  };
  const conn = (side: string) => {
    const v = p.get(side);
    return !!v && v !== 'false' && v !== 'none';
  };

  if (FLUID.test(id)) return [[0, 0, 0, 1, px(14), 1]];
  if (name.endsWith('_slab') || name.includes('/slab/') || name.endsWith('slab')) {
    const t = p.get('type');
    return t === 'double' ? [FULL] : t === 'top' ? [[0, 0.5, 0, 1, 1, 1]] : [[0, 0, 0, 1, 0.5, 1]];
  }
  if (name.includes('stairs')) {
    const top = p.get('half') === 'top';
    const base: Box = top ? [0, 0.5, 0, 1, 1, 1] : [0, 0, 0, 1, 0.5, 1];
    const [y0, y1] = top ? [0, 0.5] : [0.5, 1];
    // Ступень — половина или четверть клетки: стороны, к которым она прижата
    const part = (sides: string[]): Box => {
      const x = sides.includes('west') ? [0, 0.5] : sides.includes('east') ? [0.5, 1] : [0, 1];
      const z = sides.includes('north') ? [0, 0.5] : sides.includes('south') ? [0.5, 1] : [0, 1];
      return [x[0], y0, z[0], x[1], y1, z[1]];
    };
    // Левая сторона — против часовой от facing (как StairBlock): у north — west
    const left: Record<string, string> = { north: 'west', west: 'south', south: 'east', east: 'north' };
    const back = opposite[facing] ?? 'south';
    const l = left[facing] ?? 'west';
    const r = opposite[l] ?? 'east';
    switch (p.get('shape')) {
      case 'outer_left':
        return [base, part([facing, l])];
      case 'outer_right':
        return [base, part([facing, r])];
      case 'inner_left':
        return [base, part([facing]), part([back, l])];
      case 'inner_right':
        return [base, part([facing]), part([back, r])];
      default:
        return [base, part([facing])];
    }
  }
  // Лестница-ладдер висит на стене позади себя (facing — куда смотрит); IE «покрытые лесами» — целый блок
  if (name.includes('ladder') && !name.includes('scaffold') && !/metal_ladder_(alu|steel)$/.test(name))
    return [plate(opposite[facing] ?? 'south', px(1))];
  // Create: шлюз на ремне — у края ремня, шлюз на блоке — на грани того блока, к которому прикреплён
  if (name.endsWith('_belt_funnel') && p.has('facing')) return [plate(facing, px(8))];
  if (name.endsWith('_funnel') && p.has('facing'))
    return [plate(opposite[facing] ?? 'south', facing === 'up' || facing === 'down' ? px(10) : px(5))];
  if (name === 'depot' || name.endsWith('_depot')) return [[0, 0, 0, 1, px(13), 1]];
  if (name === 'belt' || name === 'belt_connector') return [[0, 0, 0, 1, px(12), 1]];
  if (name.endsWith('chute')) return [[px(2), 0, px(2), px(14), 1, px(14)]];
  // Крепление верёвки (Simulated): узел у грани, к которой прикреплено; анкер TFC — столбик
  if (name === 'rope_connector') {
    const [a, b] = [px(3), px(13)];
    const s = opposite[facing] ?? 'down';
    const d = px(6);
    return [
      s === 'north'
        ? [a, a, 0, b, b, d]
        : s === 'south'
          ? [a, a, 1 - d, b, b, 1]
          : s === 'west'
            ? [0, a, a, d, b, b]
            : s === 'east'
              ? [1 - d, a, a, 1, b, b]
              : s === 'down'
                ? [a, 0, a, b, d, b]
                : [a, 1 - d, a, b, 1, b],
    ];
  }
  if (name.endsWith('rope_anchor')) return [[px(6), 0, px(6), px(10), 1, px(10)]];
  if (name === 'chest' || name === 'trapped_chest' || name.endsWith('_chest') || name.includes('/chest/'))
    return [[px(1), 0, px(1), px(15), px(14), px(15)]];
  if (name.includes('trapdoor')) {
    if (p.get('open') === 'true') return [plate(opposite[facing] ?? 'south', px(3))];
    return [plate(p.get('half') === 'top' ? 'up' : 'down', px(3))];
  }
  if (name.includes('door')) return [plate(opposite[facing] ?? 'south', px(3))];
  if (name.includes('fence_gate')) {
    const ns = facing === 'north' || facing === 'south';
    return [ns ? [0, px(5), px(7), 1, 1, px(9)] : [px(7), px(5), 0, px(9), 1, 1]];
  }
  if (name.includes('fence')) {
    return [[px(6), 0, px(6), px(10), 1, px(10)], ...arms(2, px(6), px(9), conn), ...arms(2, px(12), px(15), conn)];
  }
  if (name.endsWith('_wall') || name.includes('/wall/')) {
    return [[px(4), 0, px(4), px(12), 1, px(12)], ...arms(6, 0, px(14), conn)];
  }
  if (name.includes('pane') || name.endsWith('_bars') || name === 'iron_bars') {
    return [[px(7), 0, px(7), px(9), 1, px(9)], ...arms(2, 0, 1, conn)];
  }
  if (name.includes('carpet') || name.includes('rail') || name.includes('lily_pad')) return [[0, 0, 0, 1, px(1), 1]];
  if (name.includes('pressure_plate')) return [[px(1), 0, px(1), px(15), px(1), px(15)]];
  if (name === 'snow') return [[0, 0, 0, 1, px(2 * Number(p.get('layers') ?? 1)), 1]];
  if (name.includes('torch')) return [[px(7), 0, px(7), px(9), px(10), px(9)]];
  if (name.includes('lantern')) return [[px(5), 0, px(5), px(11), px(9), px(11)]];
  if (name.includes('chain')) return [rod(3)];
  if (name.includes('button')) return [[px(5), 0, px(6), px(11), px(2), px(10)]];
  if (/(^|\/|_)(shaft|axis)$/.test(name) || name.endsWith('_shaft') || name === 'shaft') return [rod(4)];
  if (name.includes('large_cogwheel')) return [disc(24, 4), rod(4)];
  if (name.includes('cogwheel')) return [disc(14, 4), rod(4)];
  // Труба с соединениями по сторонам (жидкостная труба Create): сердцевина и отводы к соединённым сторонам
  if (name.includes('pipe') && ['north', 'south', 'east', 'west', 'up', 'down'].some((d) => p.has(d))) {
    const [a, b] = [px(4), px(12)];
    const out: Box[] = [[a, a, a, b, b, b]];
    if (conn('north')) out.push([a, a, 0, b, b, a]);
    if (conn('south')) out.push([a, a, b, b, b, 1]);
    if (conn('west')) out.push([0, a, a, a, b, b]);
    if (conn('east')) out.push([b, a, a, 1, b, b]);
    if (conn('down')) out.push([a, 0, a, b, a, b]);
    if (conn('up')) out.push([a, b, a, b, 1, b]);
    return out;
  }
  if (name.includes('pipe') && !name.includes('pump')) return [rod(8)];
  if (
    /(flower|sapling|tulip|dandelion|poppy|orchid|allium|bluet|daisy|mushroom|candle|lever|fern|grass$|bush|crop|seed|sign|banner|head|skull|pot$)/.test(
      name,
    )
  )
    return [[px(4), 0, px(4), px(12), px(12), px(12)]];
  return [FULL];
}

/** Целый куб по упрощённой форме — в редакторе слоёв рисуется текстурой, остальное — моделью */
export const isFullCube = (id: string, props: Map<string, string>) => {
  const boxes = shapeOf(id, props);
  return boxes.length === 1 && boxes[0] === FULL;
};
