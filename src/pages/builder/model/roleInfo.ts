import type { Role } from '@tfc/core/building/grid';
import type { Need } from '@tfc/core/building/similar';

/** Подписи ролей и какие формы нужны их блокам (без них подборщик блок не предложит) */
export const ROLE_INFO: Partial<Record<Role, { name: string; hint: string; need?: Need[] }>> = {
  foundation: { name: 'Фундамент', hint: 'нижний ряд под всем зданием' },
  wall: { name: 'Стена', hint: 'основная кладка; остальные роли стены берут её блоки, если выключены' },
  corner: { name: 'Углы', hint: 'вертикальные рёбра стен (с рустами — заходят на фасады через ряд)' },
  plinth: { name: 'Цоколь', hint: 'нижние ряды стены' },
  belt: { name: 'Пояса', hint: 'ряд стены на уровне перекрытий' },
  lintel: { name: 'Перемычки', hint: 'над окнами и дверью' },
  sill: { name: 'Подоконники', hint: 'под окнами' },
  jamb: { name: 'Откосы', hint: 'по бокам окон и двери' },
  frame: { name: 'Каркас', hint: 'фахверк: стойки, углы и пояса из брёвен' },
  infill: { name: 'Заполнение', hint: 'фахверк: между брёвнами каркаса' },
  gable: { name: 'Фронтоны', hint: 'треугольник стены под скатом' },
  parapet: { name: 'Парапет', hint: 'бортик плоской крыши' },
  chimney: { name: 'Труба', hint: 'дымоход сквозь крышу' },
  roof: { name: 'Скат', hint: 'ступени и плиты крыши', need: ['stairs', 'slab'] },
  eave: { name: 'Свес', hint: 'край крыши за стенами', need: ['stairs', 'slab'] },
  verge: { name: 'Торец ската', hint: 'боковой край крыши над фронтоном', need: ['stairs', 'slab'] },
  ridge: { name: 'Конёк', hint: 'верх крыши', need: ['slab'] },
  floor: { name: 'Перекрытия', hint: 'полы этажей' },
  ceiling: { name: 'Потолок', hint: 'верхнее перекрытие (пол чердака)' },
  glass: { name: 'Окна', hint: 'стекло или стеклянная панель' },
  lattice: { name: 'Переплёт', hint: 'решётка вместо стекла (отделка копикатами); без блоков — стекло' },
  door: { name: 'Дверь', hint: 'дверь (не дверь — будет проём)' },
};

/** Порядок в списке ролей */
export const ROLE_ORDER: Role[] = [
  'wall',
  'corner',
  'plinth',
  'belt',
  'lintel',
  'sill',
  'jamb',
  'frame',
  'infill',
  'gable',
  'parapet',
  'roof',
  'eave',
  'verge',
  'ridge',
  'chimney',
  'foundation',
  'floor',
  'ceiling',
  'glass',
  'lattice',
  'door',
];
