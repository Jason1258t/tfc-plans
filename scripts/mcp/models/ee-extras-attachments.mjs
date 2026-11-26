/** Геометрия дополнительных деталей EE Extras: CableCapGeometry/Render и PanelInlet/Geometry.
 * Узлы крышки зависят от мира: передаются реальные позиции выбранной пары после FACING/ROLL.
 * Это технический рендер позы, а не эмуляция доступности контактов и симуляции сети.
 */
import { DEG, Pose } from '../entityModels.mjs';
import { blockstatePath, loadModel, pickVariant, readJsonRes } from '../resources.mjs';

const add = (a, b) => a.map((v, i) => v + b[i]);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const mul = (a, k) => a.map((v) => v * k);
const dot = (a, b) => a.reduce((n, v, i) => n + v * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (v) => {
  const len = Math.hypot(...v);
  if (len < 1e-8) throw new Error('Деталь: нулевая ось или совпадающие контакты.');
  return mul(v, 1 / len);
};
const point = (p, label) => {
  if (
    !Array.isArray(p) ||
    p.length !== 3 ||
    p.some((n) => typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 16)
  )
    throw new Error(`${label}: нужны три конечных координаты в долях блока (±16).`);
  return p;
};
const emptyModel = (quads) => ({ elements: [], quads, textures: {}, display: {}, errors: [], missing: [], chain: [] });

export function capPart(cap) {
  if (
    !Array.isArray(cap.contacts) ||
    cap.contacts.length !== 2 ||
    cap.contacts.some((n) => !Number.isInteger(n) || n < 0) ||
    cap.contacts[0] === cap.contacts[1]
  )
    throw new Error('Крышка: contacts — два разных неотрицательных номера контактов.');
  if (!Array.isArray(cap.nodes) || cap.nodes.length !== 2)
    throw new Error('Крышка: nodes — две позиции выбранных контактов.');
  const [a, b] = cap.nodes.map((v) => point(v, 'Координаты контакта'));
  const span = sub(b, a),
    along = unit(span),
    mid = mul(add(a, b), 0.5);
  const normal = point(cap.outward, 'Нормаль крышки');
  const outward = unit(sub(normal, mul(along, dot(normal, along))));
  const x = mul(along, Math.hypot(...span) / 2 + 2.5 / 16);
  const y = mul(unit(cross(outward, along)), 3 / 16);
  const corners = (center) => [
    sub(sub(center, x), y),
    sub(add(center, x), y),
    add(add(center, x), y),
    add(sub(center, x), y),
  ];
  const top = corners(add(mid, mul(outward, 2.75 / 16)));
  const bottom = corners(sub(mid, mul(outward, 2.25 / 16)));
  // P — начало и две соседние вершины, как у Java quad; четвёртая восстанавливается растеризатором.
  const quad = (p, n, tex) => ({
    P: [p[0], p[1], p[3]].map((v) => mul(v, 16)),
    N: n,
    tex: `ee_extras:block/duplex_cap_${tex}`,
    uv: [0, 0, 16, 16],
  });
  const quads = [quad(top, outward, 'front'), quad([...bottom].reverse(), mul(outward, -1), 'side')];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    quads.push(quad([top[i], bottom[i], bottom[j], top[j]], unit(cross(sub(top[j], top[i]), outward)), 'side'));
  }
  return { model: emptyModel(quads), x: 0, y: 0 };
}

/** center — реальный ElectricalPanelSlot.center; поза идентична PanelInlet.render. */
export function panelPart(layers, inset, facing = 'north') {
  const center = point(inset.center, 'Центр слота');
  const angle = { north: 0, south: 180, west: 90, east: -90 }[facing];
  if (angle === undefined) throw new Error('Щиток: facing должен быть north/south/west/east.');
  const upper = center[1] > 0.5;
  const pose = new Pose()
    .t(0.5, 0.5, 0.5)
    .r('y', angle * DEG)
    .t(-0.5, -0.5, -0.5)
    .t(center[0], (upper ? 14.75 : 1.25) / 16, 15.9 / 16);
  if (!upper) pose.r('z', 180 * DEG);
  pose
    .r('x', -90 * DEG)
    .s(0.5, 0.5, 0.5)
    .t(-0.5, 0, -9.5 / 16);
  const id = 'electroenergetics:duplex_wire_termination';
  const bs = readJsonRes(layers, blockstatePath(id));
  if (!bs?.json) throw new Error(`Нет блокстейта ${id} для щитковой вставки.`);
  const v = pickVariant(bs.json, { facing: 'up', roll: 'false', flip: 'false' });
  return v.parts.map((p) => ({ model: loadModel(layers, p.model), x: p.x ?? 0, y: p.y ?? 0, affine: pose.m }));
}

export function attachmentParts(layers, { caps = [], panelInsets = [], state = {} }) {
  if (!Array.isArray(caps) || !Array.isArray(panelInsets) || caps.length > 32 || panelInsets.length > 32)
    throw new Error('Не более 32 крышек и 32 щитковых вставок.');
  return [...caps.map(capPart), ...panelInsets.flatMap((p) => panelPart(layers, p, state.facing ?? 'north'))];
}
