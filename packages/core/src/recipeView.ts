/**
 * Раскладка рецепта «как в JEI»: что на входе, на станции и на выходе, с количеством, шансом, жидкостями,
 * температурой, временем и энергией. Общая для сайта (каталог рецептов, вставки гайдов) и MCP recipe_get.
 *
 * Правила — реестром по модам (тип рецепта → разбор его JSON). Поля и станции взяты из категорий JEI самих модов
 * (TFC `compat.jei.category.*`, Create, IE, Firmalife, FD, Kaleidoscope), см. план к dev-задаче #173.
 * Неизвестный тип с обычными полями входа/выхода разбирается «по общим полям» (guessed), прочее — null:
 * сайт тогда показывает JSON, как раньше. Сетки крафта (pattern/key) — не здесь, а в craftGrid сайта.
 */

/** Слот раскладки: предмет (JSON ингредиента — сайт сам раскроет теги) или жидкость */
export interface ViewSlot {
  /** Ингредиент или стек как в JSON рецепта: «id», { item }, { tag }, массив вариантов, обёртки TFC/NeoForge */
  item?: unknown;
  /** Жидкость: id или «#тег», объём в мБ */
  fluid?: { id: string; amount?: number };
  count?: number;
  /** Вероятность 0..1 (побочный выход) */
  chance?: number;
  /** Роль слота, если она не очевидна: «форма», «инструмент», «почва», «добавка» */
  role?: string;
  /** Пояснение к выходу: «тот же предмет, что на входе» и т. п. */
  note?: string;
}

export interface ViewFact {
  label: string;
  value: string;
}

export interface ViewStep {
  label: string;
  slots?: ViewSlot[];
}

export interface RecipeView {
  station: string;
  /** Предмет станции (катализатор JEI) — иконка; нет — только подпись */
  stationIcon?: string;
  inputs: ViewSlot[];
  outputs: ViewSlot[];
  facts: ViewFact[];
  /** Порядок действий: ковка, стеклодувка, сборка Create */
  steps?: ViewStep[];
  /** Узор: кнаппинг, шитьё — строки, «#» — закрашенная клетка */
  pattern?: { rows: string[]; filled: string; empty: string };
  /** Разобрано по общим полям, а не правилом мода */
  guessed?: boolean;
}

type J = Record<string, unknown>;
type Rule = (j: J) => RecipeView | null;

const obj = (v: unknown): J | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as J) : undefined);
const numOf = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const strOf = (v: unknown) => (typeof v === 'string' ? v : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);

// ---------------------------------------------------------------- форматы величин

const fmtNum = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });

/** Тики → секунды реального времени */
export function fmtTicks(ticks: number): string {
  const s = ticks / 20;
  if (s < 60) return `${fmtNum(s)} с`;
  if (s >= 3600) {
    const h = Math.floor(s / 3600);
    const m = Math.round((s - h * 3600) / 60);
    return m ? `${h} ч ${m} мин` : `${h} ч`;
  }
  const m = Math.floor(s / 60);
  const rest = Math.round(s - m * 60);
  return rest ? `${m} мин ${rest} с` : `${m} мин`;
}

/** Тики календаря TFC → игровое время (1000 тиков — игровой час, как ICalendar.getTimeDelta) */
export function fmtGameTime(ticks: number): string {
  const totalMin = Math.round((ticks / 1000) * 60);
  const days = Math.floor(totalMin / (24 * 60));
  const h = Math.floor((totalMin % (24 * 60)) / 60);
  const m = totalMin % 60;
  const parts = [days && `${days} дн`, h && `${h} ч`, m && `${m} мин`].filter(Boolean);
  return `${parts.join(' ') || '0 мин'} игрового времени`;
}

const fmtTemp = (t: number) => `${fmtNum(t)} °C`;
const fmtRf = (rf: number) => `${fmtNum(rf)} RF`;
const fmtPct = (p: number) => `${fmtNum(p * 100)} %`;

/** Ярусы TFC (Tooltips.tier: I — медь … VI — красная и синяя сталь) */
const TIER = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI'];
const TIER_METAL = ['', 'медь', 'бронза', 'кованое железо', 'сталь', 'чёрная сталь', 'красная/синяя сталь'];
export const fmtTier = (t: number) =>
  t >= 0 && t < TIER.length ? `${TIER[t]}${TIER_METAL[t] ? ` (${TIER_METAL[t]})` : ''}` : String(t);

const fact = (label: string, value: string | undefined): ViewFact[] => (value ? [{ label, value }] : []);

// ---------------------------------------------------------------- слоты

/** Жидкость: «id», { fluid, amount }, { id }, { tag }, составной ингредиент NeoForge/Create */
export function fluidOf(v: unknown): ViewSlot['fluid'] | undefined {
  if (typeof v === 'string') return { id: v };
  if (Array.isArray(v)) return fluidOf(v[0]);
  const o = obj(v);
  if (!o) return undefined;
  const amount = numOf(o.amount);
  const inner =
    o.fluid ??
    o.id ??
    (typeof o.tag === 'string' ? `#${o.tag}` : undefined) ??
    (typeof o.fluid_tag === 'string' ? `#${o.fluid_tag}` : undefined) ??
    o.ingredients ??
    o.fluids ??
    o.ingredient;
  const f = typeof inner === 'string' ? { id: inner } : inner !== undefined ? fluidOf(inner) : undefined;
  if (!f) return undefined;
  const a = amount ?? f.amount;
  return a !== undefined ? { ...f, amount: a } : f;
}

const fluidSlot = (v: unknown, role?: string): ViewSlot[] => {
  const f = fluidOf(v);
  return f ? [{ fluid: f, ...(role ? { role } : {}) }] : [];
};

/** Входной предмет: сам ингредиент и количество (TFC/IE sized: { count, … }, IE { basePredicate, count }) */
export function inSlot(v: unknown, role?: string): ViewSlot[] {
  if (v === undefined || v === null || (Array.isArray(v) && !v.length)) return [];
  const o = obj(v);
  let item: unknown = v;
  let count: number | undefined;
  if (o) {
    count = numOf(o.count);
    if (o.basePredicate !== undefined) item = o.basePredicate;
    else if (count !== undefined && o.ingredient !== undefined && !o.type) item = o.ingredient;
  }
  return [{ item, ...(count && count > 1 ? { count } : {}), ...(role ? { role } : {}) }];
}

const inSlots = (v: unknown, role?: string) => arr(v).flatMap((x) => inSlot(x, role));

/** Модификаторы ItemStackProvider TFC, которые меняют смысл выхода */
function providerNote(mods: unknown): string | undefined {
  const types = arr(mods)
    .map((m) => strOf(obj(m)?.type))
    .filter(Boolean) as string[];
  if (types.includes('tfc:copy_input')) return 'тот же предмет, что на входе';
  if (types.some((t) => /empty_bowl|empty_jar/.test(t))) return 'остаётся пустая ёмкость';
  return undefined;
}

/**
 * Выход: «id», { id|item, count }, ItemStackProvider TFC { stack, modifiers }, IE { output, chance } / { tag } /
 * { basePredicate, count }, FD { item: { id, count }, chance }, Create { id, count, chance }.
 */
export function outSlot(v: unknown, role?: string): ViewSlot[] {
  if (v === undefined || v === null) return [];
  if (typeof v === 'string') return [{ item: v, ...(role ? { role } : {}) }];
  if (Array.isArray(v)) return v.flatMap((x) => outSlot(x, role));
  const o = obj(v);
  if (!o) return [];
  const chance = numOf(o.chance);
  const extra = { ...(chance !== undefined && chance < 1 ? { chance } : {}), ...(role ? { role } : {}) };
  if (o.output !== undefined) return outSlot(o.output, role).map((s) => ({ ...s, ...extra }));
  if (o.stack !== undefined || o.modifiers !== undefined) {
    const note = providerNote(o.modifiers);
    if (o.stack === undefined)
      return [{ ...(note ? { note } : { note: 'предмет задают модификаторы мода' }), ...extra }];
    return outSlot(o.stack, role).map((s) => ({ ...s, ...(note ? { note } : {}), ...extra }));
  }
  const inner = obj(o.item);
  if (inner) return outSlot(inner, role).map((s) => ({ ...s, ...extra }));
  const count = numOf(o.count);
  const item =
    o.basePredicate ??
    (o.id !== undefined || o.item !== undefined ? (o.id ?? o.item) : o.tag !== undefined ? { tag: o.tag } : undefined);
  if (item === undefined) return [];
  return [{ item, ...(count && count > 1 ? { count } : {}), ...extra }];
}

/** Create: выход с amount — жидкость; иначе предмет */
const createOut = (v: unknown) =>
  arr(v).flatMap((x) => (numOf(obj(x)?.amount) !== undefined ? fluidSlot(x) : outSlot(x)));
/** Create: вход с amount — жидкость (FluidIngredient: fluid / tag / compound) */
const createIn = (v: unknown) =>
  arr(v).flatMap((x) => (numOf(obj(x)?.amount) !== undefined ? fluidSlot(x) : inSlot(x)));

/** Одинаковые входы подряд (Create, котёл: по одному предмету в JSON) — в один слот с количеством */
function merge(slots: ViewSlot[]): ViewSlot[] {
  const res: ViewSlot[] = [];
  const keys: string[] = [];
  for (const s of slots) {
    const key = JSON.stringify({ ...s, count: undefined });
    const i = s.fluid || s.chance !== undefined ? -1 : keys.indexOf(key);
    if (i >= 0) res[i] = { ...res[i], count: (res[i].count ?? 1) + (s.count ?? 1) };
    else {
      res.push(s);
      keys.push(key);
    }
  }
  return res;
}

const view = (station: string, stationIcon: string | undefined, rest: Partial<RecipeView>): RecipeView => ({
  station,
  ...(stationIcon ? { stationIcon } : {}),
  inputs: rest.inputs ?? [],
  // Одинаковые выходы подряд (Create: две плиты — два элемента results) — одним слотом с количеством
  outputs: merge(rest.outputs ?? []),
  facts: rest.facts ?? [],
  ...(rest.steps?.length ? { steps: rest.steps } : {}),
  ...(rest.pattern ? { pattern: rest.pattern } : {}),
});

// ---------------------------------------------------------------- minecraft

const cooking =
  (station: string, icon: string): Rule =>
  (j) =>
    view(station, icon, {
      inputs: inSlot(j.ingredient),
      outputs: outSlot(j.result),
      facts: [
        ...fact('время', numOf(j.cookingtime) !== undefined ? fmtTicks(numOf(j.cookingtime)!) : undefined),
        ...fact('опыт', numOf(j.experience) ? fmtNum(numOf(j.experience)!) : undefined),
      ],
    });

const MINECRAFT: Record<string, Rule> = {
  stonecutting: (j) =>
    view('Камнерез', 'minecraft:stonecutter', { inputs: inSlot(j.ingredient), outputs: outSlot(j.result) }),
  smelting: cooking('Печь', 'minecraft:furnace'),
  blasting: cooking('Плавильная печь', 'minecraft:blast_furnace'),
  smoking: cooking('Коптильня', 'minecraft:smoker'),
  campfire_cooking: cooking('Костёр', 'minecraft:campfire'),
  smithing_transform: (j) =>
    view('Кузнечный стол', 'minecraft:smithing_table', {
      inputs: [...inSlot(j.template, 'шаблон'), ...inSlot(j.base, 'основа'), ...inSlot(j.addition, 'добавка')],
      outputs: outSlot(j.result),
    }),
  smithing_trim: (j) =>
    view('Кузнечный стол', 'minecraft:smithing_table', {
      inputs: [...inSlot(j.template, 'шаблон'), ...inSlot(j.base, 'основа'), ...inSlot(j.addition, 'добавка')],
      outputs: [{ note: 'та же броня с отделкой' }],
    }),
};

// ---------------------------------------------------------------- TFC

const CHISEL_MODE: Record<string, string> = { 'tfc:smooth': 'гладкий', 'tfc:slab': 'плита', 'tfc:stair': 'ступени' };

const ANVIL_ACTION: Record<string, string> = {
  hit: 'удар',
  draw: 'протяжка',
  punch: 'пробивка',
  bend: 'загиб',
  upset: 'осадка',
  shrink: 'сжатие',
};
const ANVIL_ORDER: Record<string, string> = {
  last: 'последним',
  second_last: 'предпоследним',
  third_last: 'третьим с конца',
  not_last: 'не последним',
  any: 'в любом месте',
};
/** Правило ковки TFC (ForgeRule): «hit_last» → «удар — последним» */
export function anvilRule(rule: string): string {
  const [, action, order] = /^([a-z]+)_(.+)$/.exec(rule) ?? [];
  return action && ANVIL_ACTION[action] ? `${ANVIL_ACTION[action]} — ${ANVIL_ORDER[order] ?? order}` : rule;
}

/** Операции стеклодувки TFC (GlassOperation) */
const GLASS_OP: Record<string, string> = {
  blow: 'выдуть (трубка)',
  roll: 'раскатать (ткань)',
  stretch: 'вытянуть',
  pinch: 'сжать (щипцы)',
  flatten: 'расплющить (лопатка)',
  saw: 'отпилить (пила)',
  table_pour: 'вылить на стол',
  basin_pour: 'вылить в чашу',
};
const glassOp = (op: string) => {
  const [ns, path] = op.split(':');
  if (GLASS_OP[path]) return GLASS_OP[path];
  // Остальное — порошки-добавки: tfc:soda_ash, tfc:copper, tfc_ie_addon:lead
  return `добавить порошок: ${path.replace(/_/g, ' ')}${ns !== 'tfc' ? ` (${ns})` : ''}`;
};

/** Чем кнаппают: data/<ns>/tfc/knapping_type/*.json — input (тег и количество) и icon */
const KNAPPING: Record<string, { name: string; icon: string; tag: string; count: number }> = {
  'tfc:clay': { name: 'Лепка из глины', icon: 'minecraft:clay_ball', tag: 'tfc:clay_knapping', count: 5 },
  'tfc:fire_clay': {
    name: 'Лепка из огнеупорной глины',
    icon: 'tfc:fire_clay',
    tag: 'tfc:fire_clay_knapping',
    count: 5,
  },
  'tfc:leather': { name: 'Раскрой кожи', icon: 'minecraft:leather', tag: 'tfc:leather_knapping', count: 1 },
  'tfc:rock': { name: 'Обработка камня', icon: 'tfc:rock/loose/granite', tag: 'tfc:rock_knapping', count: 2 },
  'tfc:goat_horn': { name: 'Резьба по рогу', icon: 'tfc:goat_horn', tag: 'tfc:goat_horn_knapping', count: 1 },
  'firmalife:pumpkin': { name: 'Резьба по тыкве', icon: 'tfc:pumpkin', tag: 'firmalife:pumpkin_knapping', count: 1 },
};

const potRule =
  (station: string): Rule =>
  (j) =>
    view(station, 'tfc:pot', {
      inputs: merge([...inSlots(j.ingredients), ...fluidSlot(j.fluid_ingredient)]),
      outputs: [
        ...outSlot(j.item_output),
        ...fluidSlot(j.fluid_output),
        ...outSlot(j.unsealed_result, 'открытая банка'),
        ...outSlot(j.sealed_result, 'закрытая банка'),
      ],
      facts: [
        ...fact('кипятить', numOf(j.duration) !== undefined ? fmtTicks(numOf(j.duration)!) : undefined),
        ...fact('нагрев от', numOf(j.temperature) !== undefined ? fmtTemp(numOf(j.temperature)!) : undefined),
      ],
    });

const barrelFacts = (j: J) => [
  ...fact(
    'выдержка',
    numOf(j.duration) !== undefined
      ? numOf(j.duration)! < 0
        ? 'пока бочка закрыта'
        : fmtGameTime(numOf(j.duration)!)
      : undefined,
  ),
];

const TFC: Record<string, Rule> = {
  heating: (j) =>
    view('Нагрев (костёр, кузня)', 'tfc:firepit', {
      inputs: inSlot(j.ingredient),
      outputs:
        j.result_item === undefined && j.result_fluid === undefined
          ? [{ note: 'сгорает, ничего не остаётся' }]
          : [...outSlot(j.result_item), ...fluidSlot(j.result_fluid)],
      facts: [
        ...fact('температура', numOf(j.temperature) !== undefined ? fmtTemp(numOf(j.temperature)!) : undefined),
        ...(j.use_durability ? fact('выход', 'по оставшейся прочности') : []),
      ],
    }),
  collapse: (j) =>
    view('Обрушение блока', undefined, {
      inputs: inSlot(j.ingredient),
      outputs: outSlot(j.result),
      facts: fact('когда', 'блок без опоры обваливается'),
    }),
  landslide: (j) =>
    view('Оползень', undefined, {
      inputs: inSlot(j.ingredient),
      outputs: outSlot(j.result),
      facts: fact('когда', 'сыпучий блок съезжает со склона'),
    }),
  chisel: (j) =>
    view('Долото', 'tfc:metal/chisel/bronze', {
      inputs: inSlot(j.ingredient),
      outputs: [...outSlot(j.result), ...outSlot(j.item_output, 'отходы')],
      facts: fact('режим', CHISEL_MODE[strOf(j.mode) ?? ''] ?? strOf(j.mode)),
    }),
  anvil: (j) =>
    view('Наковальня', 'tfc:metal/anvil/bronze', {
      inputs: inSlot(j.ingredient),
      outputs: outSlot(j.result),
      facts: [
        ...fact('наковальня, ярус от', numOf(j.tier) !== undefined ? fmtTier(numOf(j.tier)!) : undefined),
        ...(j.apply_bonus || j.apply_forging_bonus ? fact('бонус ковки', 'да') : []),
      ],
      steps: arr(j.rules).map((r) => ({ label: anvilRule(String(r)) })),
    }),
  welding: (j) =>
    view('Сварка на наковальне', 'tfc:metal/anvil/bronze', {
      inputs: [
        ...inSlot(j.first_input),
        ...inSlot(j.second_input),
        { item: { tag: 'tfc:welding_flux' }, role: 'флюс' },
      ],
      outputs: outSlot(j.result),
      facts: [
        ...fact(
          'наковальня, ярус от',
          numOf(j.tier) !== undefined && numOf(j.tier)! >= 0 ? fmtTier(numOf(j.tier)!) : undefined,
        ),
        ...fact('нагрев', 'обе заготовки — до температуры сварки'),
      ],
    }),
  barrel_sealed: (j) =>
    view('Бочка, закрытая', 'tfc:wood/barrel/maple', {
      inputs: [...inSlot(j.input_item), ...fluidSlot(j.input_fluid)],
      outputs:
        j.output_item === undefined && j.output_fluid === undefined
          ? outSlot(j.on_seal).map((o) => ({ ...o, note: 'тот же предмет, пока бочка закрыта' }))
          : [...outSlot(j.output_item), ...fluidSlot(j.output_fluid)],
      facts: barrelFacts(j),
    }),
  barrel_instant: (j) =>
    view('Бочка, сразу', 'tfc:wood/barrel/maple', {
      inputs: [...inSlot(j.input_item), ...fluidSlot(j.input_fluid)],
      outputs: [...outSlot(j.output_item), ...fluidSlot(j.output_fluid)],
    }),
  barrel_instant_fluid: (j) =>
    view('Бочка, смешивание жидкостей', 'tfc:wood/barrel/maple', {
      inputs: [...fluidSlot(j.primary_fluid), ...fluidSlot(j.added_fluid, 'добавить')],
      outputs: fluidSlot(j.output_fluid),
    }),
  pot: potRule('Котелок'),
  pot_jam: potRule('Котелок: варенье'),
  soup_pot: potRule('Котелок: суп'),
  casting: (j) =>
    view('Литьё в форму', 'tfc:ceramic/ingot_mold', {
      inputs: [...inSlot(j.mold, 'форма'), ...fluidSlot(j.fluid)],
      outputs: outSlot(j.result),
      facts: fact('форма бьётся', numOf(j.break_chance) ? fmtPct(numOf(j.break_chance)!) : undefined),
    }),
  knapping: (j) => {
    const type = strOf(j.knapping_type) ?? '';
    const k = KNAPPING[type];
    // ingredient рецепта сужает вход (обсидиан, порода); иначе — вход типа кнаппинга
    const input = j.ingredient ?? (k ? { tag: k.tag } : undefined);
    const rows = arr(j.pattern).filter((r): r is string => typeof r === 'string');
    return view(k?.name ?? `Кнаппинг (${type})`, k?.icon, {
      inputs: input !== undefined ? [{ item: input, ...(k && k.count > 1 ? { count: k.count } : {}) }] : [],
      outputs: outSlot(j.result),
      facts: fact('края', j.outside_slot_required === false ? 'можно оставить' : undefined),
      pattern: rows.length ? { rows, filled: 'оставить', empty: 'вырезать' } : undefined,
    });
  },
  quern: (j) => view('Жернов', 'tfc:quern', { inputs: inSlot(j.ingredient), outputs: outSlot(j.result) }),
  glassworking: (j) =>
    view('Стеклодувка', 'tfc:blowpipe', {
      inputs: inSlot(j.batch, 'шихта'),
      outputs: outSlot(j.result),
      steps: arr(j.operations).map((op) => ({ label: glassOp(String(op)) })),
    }),
  alloy: (j) =>
    view('Сплав (тигель, сосуд)', 'tfc:crucible', {
      inputs: arr(j.contents).flatMap((c) => {
        const o = obj(c);
        const f = fluidOf(o?.fluid);
        if (!o || !f) return [];
        return [{ fluid: f, role: `${fmtNum((numOf(o.min) ?? 0) * 100)}–${fmtNum((numOf(o.max) ?? 0) * 100)} %` }];
      }),
      outputs: fluidSlot(j.result),
    }),
  sewing: (j) => {
    const stitches = arr(j.stitches).filter((r): r is string => typeof r === 'string');
    return view('Швейный стол', 'tfc:wood/sewing_table/oak', {
      inputs: [
        { item: { tag: 'tfc:sewing_needles' }, role: 'игла' },
        { item: { tag: 'tfc:sewing_light_cloth' }, role: 'светлая ткань' },
        { item: { tag: 'tfc:sewing_dark_cloth' }, role: 'тёмная ткань' },
      ],
      outputs: outSlot(j.result),
      pattern: stitches.length ? { rows: stitches, filled: 'стежок', empty: '' } : undefined,
      steps: arr(j.squares)
        .filter((r): r is string => typeof r === 'string')
        .map((row, n) => ({ label: `ряд ${n + 1}: ${row.replace(/B/g, '■').replace(/W/g, '□')}` })),
    });
  },
  loom: (j) =>
    view('Ткацкий станок', 'tfc:wood/loom/oak', {
      inputs: inSlot(j.ingredient),
      outputs: outSlot(j.result),
      facts: fact('шагов', numOf(j.steps) !== undefined ? String(numOf(j.steps)) : undefined),
    }),
  scraping: (j) =>
    view('Выскабливание ножом', undefined, {
      inputs: [...inSlot(j.ingredient), { item: { tag: 'c:tools/knife' }, role: 'инструмент' }],
      outputs: [...outSlot(j.result), ...outSlot(j.result_item)],
    }),
  bloomery: (j) =>
    view('Блумери', 'tfc:bloomery', {
      inputs: [...inSlot(j.ingredient), ...inSlot(j.catalyst, 'топливо'), ...fluidSlot(j.fluid)],
      outputs: outSlot(j.result),
      facts: fact('время', numOf(j.duration) !== undefined ? fmtGameTime(numOf(j.duration)!) : undefined),
    }),
  blast_furnace: (j) =>
    view('Доменная печь TFC', 'tfc:blast_furnace', {
      inputs: [...fluidSlot(j.fluid), ...inSlot(j.catalyst, 'флюс')],
      outputs: fluidSlot(j.result),
    }),
};

// ---------------------------------------------------------------- Create

const createTime = (j: J) => {
  const t = numOf(j.processing_time) ?? numOf(j.processingTime);
  return fact('время', t !== undefined ? fmtTicks(t) : undefined);
};
const HEAT: Record<string, string> = { heated: 'нагрев (горелка)', superheated: 'сильный нагрев (горелка с топливом)' };
const createSimple =
  (station: string, icon: string, extra?: (j: J) => ViewFact[]): Rule =>
  (j) =>
    view(station, icon, {
      inputs: merge(createIn(j.ingredients)),
      outputs: createOut(j.results),
      facts: [...createTime(j), ...(extra?.(j) ?? [])],
    });
const basin = (station: string, icon: string) =>
  createSimple(station, icon, (j) => fact('нагрев', HEAT[strOf(j.heat_requirement ?? j.heatRequirement) ?? '']));

const CREATE: Record<string, Rule> = {
  cutting: createSimple('Механическая пила', 'create:mechanical_saw'),
  crushing: createSimple('Дробильные колёса', 'create:crushing_wheel'),
  milling: createSimple('Жёрнов Create', 'create:millstone'),
  pressing: createSimple('Механический пресс', 'create:mechanical_press'),
  splashing: createSimple('Промывка (вентилятор + вода)', 'create:encased_fan'),
  haunting: createSimple('Призрачная обработка (вентилятор + огонь душ)', 'create:encased_fan'),
  filling: createSimple('Заливка (дозатор)', 'create:spout'),
  emptying: createSimple('Слив (сливной лоток)', 'create:item_drain'),
  sandpaper_polishing: createSimple('Шлифовка наждачкой', 'create:sand_paper'),
  mixing: basin('Смешивание (миксер + чаша)', 'create:mechanical_mixer'),
  compacting: basin('Прессование в чаше', 'create:mechanical_press'),
  deploying: (j) => {
    const ins = createIn(j.ingredients);
    if (ins[1]) ins[1] = { ...ins[1], role: j.keep_held_item ? 'в руке, не тратится' : 'в руке' };
    return view('Автономный активатор', 'create:deployer', { inputs: ins, outputs: createOut(j.results) });
  },
  item_application: (j) => {
    const ins = createIn(j.ingredients);
    if (ins[1]) ins[1] = { ...ins[1], role: j.keep_held_item ? 'в руке, не тратится' : 'в руке' };
    return view('Применение предмета (ПКМ по блоку)', undefined, { inputs: ins, outputs: createOut(j.results) });
  },
  sequenced_assembly: (j) => {
    const results = arr(j.results);
    // chance у результатов сборки — веса: доля = вес / сумма весов (SequencedAssemblyRecipe.rollResult)
    const total = results.reduce<number>((s, r) => s + (numOf(obj(r)?.chance) ?? 1), 0);
    const outputs = results.flatMap((r) => {
      const w = numOf(obj(r)?.chance) ?? 1;
      return outSlot({ ...obj(r), chance: undefined }).map((s) =>
        results.length > 1 ? { ...s, chance: w / total } : s,
      );
    });
    const loops = numOf(j.loops) ?? 1;
    const STEP: Record<string, string> = {
      'create:deploying': 'активатор',
      'create:pressing': 'пресс',
      'create:filling': 'дозатор',
      'create:cutting': 'пила',
    };
    return view('Последовательная сборка', 'create:mechanical_press', {
      inputs: inSlot(j.ingredient),
      outputs,
      facts: [
        ...fact('повторов цикла', loops > 1 ? String(loops) : undefined),
        ...fact('заготовка', 'полуфабрикат между шагами'),
      ],
      steps: arr(j.sequence).map((s) => {
        const o = obj(s) ?? {};
        const t = strOf(o.type) ?? '';
        // Первый ингредиент шага — сам полуфабрикат, его не показываем
        const added = createIn(o.ingredients).slice(1);
        return { label: STEP[t] ?? t, slots: added };
      }),
    });
  },
};

// ---------------------------------------------------------------- Immersive Engineering

const ieFacts = (j: J) => [
  ...fact('энергия', numOf(j.energy) !== undefined ? fmtRf(numOf(j.energy)!) : undefined),
  ...fact('время', numOf(j.time) !== undefined ? fmtTicks(numOf(j.time)!) : undefined),
];
const ieSecondaries = (v: unknown) => arr(v).flatMap((s) => outSlot(s));

const IE: Record<string, Rule> = {
  crusher: (j) =>
    view('Дробилка IE', 'immersiveengineering:crusher', {
      inputs: inSlot(j.input),
      outputs: [...outSlot(j.result), ...ieSecondaries(j.secondaries)],
      facts: ieFacts(j),
    }),
  sawmill: (j) =>
    view('Лесопилка IE', 'immersiveengineering:sawmill', {
      inputs: inSlot(j.input),
      outputs: [
        ...outSlot(j.stripped, 'после окорки'),
        ...outSlot(j.result),
        ...ieSecondaries(j.strippingSecondaries).map((s) => ({ ...s, role: 'опилки окорки' })),
        ...ieSecondaries(j.secondaryOutputs),
      ],
      facts: ieFacts(j),
    }),
  cloche: (j) =>
    view('Садовая теплица (клош)', 'immersiveengineering:cloche', {
      inputs: [
        ...inSlot(j.input, 'семена'),
        ...(arr(j.soil).length ? [{ item: j.soil, role: 'почва' }] : []),
        ...fluidSlot(j.fluid),
      ],
      outputs: outSlot(j.results),
      facts: fact('рост', numOf(j.time) !== undefined ? fmtTicks(numOf(j.time)!) : undefined),
    }),
  metal_press: (j) =>
    view('Металлический пресс', 'immersiveengineering:metal_press', {
      inputs: [...inSlot(j.input), ...inSlot(j.mold, 'форма')],
      outputs: outSlot(j.result),
      facts: ieFacts(j),
    }),
  arc_furnace: (j) =>
    view('Дуговая печь', 'immersiveengineering:arc_furnace', {
      inputs: [...inSlot(j.input), ...inSlots(j.additives, 'добавка')],
      outputs: [...outSlot(j.results), ...ieSecondaries(j.secondaries), ...outSlot(j.slag, 'шлак')],
      facts: ieFacts(j),
    }),
  alloy: (j) =>
    view('Печь для сплавов', 'immersiveengineering:alloy_smelter', {
      inputs: [...inSlot(j.input0), ...inSlot(j.input1)],
      outputs: outSlot(j.result),
      facts: ieFacts(j),
    }),
  blueprint: (j) =>
    view('Инженерный верстак (чертёж)', 'immersiveengineering:workbench', {
      inputs: inSlots(j.inputs),
      outputs: outSlot(j.result),
      facts: fact('чертёж', strOf(j.category)),
    }),
  fermenter: (j) =>
    view('Ферментер', 'immersiveengineering:fermenter', {
      inputs: inSlot(j.input),
      outputs: [...fluidSlot(j.fluid), ...outSlot(j.result)],
      facts: ieFacts(j),
    }),
  squeezer: (j) =>
    view('Пресс-отжим', 'immersiveengineering:squeezer', {
      inputs: inSlot(j.input),
      outputs: [...fluidSlot(j.fluid), ...outSlot(j.result)],
      facts: ieFacts(j),
    }),
  bottling_machine: (j) =>
    view('Разливочная машина', 'immersiveengineering:bottling_machine', {
      inputs: [...inSlots(j.inputs ?? j.input), ...fluidSlot(j.fluid)],
      outputs: outSlot(j.results),
      facts: ieFacts(j),
    }),
  mixer: (j) =>
    view('Смеситель IE', 'immersiveengineering:mixer', {
      inputs: [...fluidSlot(j.fluid), ...inSlots(j.inputs)],
      outputs: fluidSlot(j.result),
      facts: ieFacts(j),
    }),
  refinery: (j) =>
    view('Нефтезавод', 'immersiveengineering:refinery', {
      inputs: [...fluidSlot(j.input0), ...fluidSlot(j.input1), ...inSlot(j.catalyst, 'катализатор')],
      outputs: fluidSlot(j.result),
      facts: ieFacts(j),
    }),
  coke_oven: (j) =>
    view('Коксовая печь', 'immersiveengineering:coke_oven', {
      inputs: inSlot(j.input),
      outputs: [
        ...outSlot(j.result),
        ...(numOf(j.creosote) ? [{ fluid: { id: 'immersiveengineering:creosote', amount: numOf(j.creosote) } }] : []),
      ],
      facts: ieFacts(j),
    }),
  blast_furnace: (j) =>
    view('Доменная печь IE', 'immersiveengineering:blast_furnace', {
      inputs: inSlot(j.input),
      outputs: [...outSlot(j.result), ...outSlot(j.slag, 'шлак')],
      facts: ieFacts(j),
    }),
  hammer_crushing: (j) =>
    view('Инженерный молот', 'immersiveengineering:hammer', { inputs: inSlot(j.input), outputs: outSlot(j.result) }),
};

// ---------------------------------------------------------------- прочие моды

const RNR: Record<string, Rule> = {
  mattock: (j) =>
    view('Кирка-мотыга', 'rnr:metal/mattock/bronze', {
      inputs: inSlot(j.ingredient),
      outputs: outSlot(j.result),
      facts: fact('режим', CHISEL_MODE[strOf(j.mode) ?? ''] ?? strOf(j.mode)),
    }),
  block_mod: (j) =>
    view('Укладка на блок (ПКМ)', undefined, {
      inputs: [{ item: j.input_block, role: 'блок в мире' }, ...inSlot(j.input_item, 'в руке')],
      outputs: outSlot(j.output_block),
    }),
};

const KALEIDO_COOKERY: Record<string, Rule> = {
  pot: (j) =>
    view('Вок', 'kaleidoscope_cookery:pot', {
      inputs: merge([...inSlots(j.ingredients), ...inSlot(j.carrier, 'посуда')]),
      outputs: outSlot(j.result),
      facts: fact('время', numOf(j.time) !== undefined ? fmtTicks(numOf(j.time)!) : undefined),
    }),
  stockpot: (j) =>
    view('Кастрюля', 'kaleidoscope_cookery:stockpot', {
      inputs: merge([...inSlots(j.ingredients), ...fluidSlot(j.soup_base, 'основа'), ...inSlot(j.carrier, 'посуда')]),
      outputs: outSlot(j.result),
      facts: fact('время', numOf(j.time) !== undefined ? fmtTicks(numOf(j.time)!) : undefined),
    }),
  millstone: (j) =>
    view('Каменная мельница', 'kaleidoscope_cookery:millstone', {
      inputs: inSlot(j.ingredient),
      outputs: outSlot(j.result),
    }),
  chopping_board: (j) =>
    view('Разделочная доска', undefined, {
      inputs: inSlot(j.ingredient),
      outputs: outSlot(j.result),
      facts: fact('ударов ножом', numOf(j.cut_count) !== undefined ? String(numOf(j.cut_count)) : undefined),
    }),
  steamer: (j) =>
    view('Пароварка', 'kaleidoscope_cookery:steamer', { inputs: inSlot(j.ingredient), outputs: outSlot(j.result) }),
};

/** Инструмент FD по действию (item_ability / tool_action): «axe_dig» → тег топоров */
const FD_TOOL: Record<string, string> = {
  axe: 'minecraft:axes',
  knife: 'c:tools/knife',
  shovel: 'minecraft:shovels',
  hoe: 'minecraft:hoes',
  pickaxe: 'minecraft:pickaxes',
  shears: 'c:tools/shear',
};
const fdTool = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(fdTool);
  const o = obj(v);
  const action = strOf(o?.action);
  if (!o || !action || !/item_ability|tool_action/.test(strOf(o.type) ?? '')) return v;
  const tag = FD_TOOL[action.split('_')[0]];
  return tag ? { tag } : v;
};

const FARMERSDELIGHT: Record<string, Rule> = {
  cutting: (j) =>
    view('Разделочная доска', 'farmersdelight:cutting_board', {
      inputs: [...inSlots(j.ingredients), ...inSlot(fdTool(j.tool), 'инструмент')],
      outputs: outSlot(j.result),
    }),
  cooking: (j) =>
    view('Кастрюля FD', 'farmersdelight:cooking_pot', {
      inputs: merge([...inSlots(j.ingredients), ...inSlot(j.container, 'посуда')]),
      outputs: outSlot(j.result),
      facts: fact('время', numOf(j.cookingtime) !== undefined ? fmtTicks(numOf(j.cookingtime)!) : undefined),
    }),
};

const FIRMALIFE: Record<string, Rule> = {
  vat: (j) =>
    view('Чан', 'firmalife:vat', {
      inputs: [...inSlot(j.input_item), ...fluidSlot(j.input_fluid)],
      outputs: [...outSlot(j.output_item), ...fluidSlot(j.output_fluid), ...outSlot(j.jar_output, 'в банки')],
      facts: [
        ...fact('нагрев от', numOf(j.temperature) !== undefined ? fmtTemp(numOf(j.temperature)!) : undefined),
        ...fact('время', numOf(j.length) !== undefined ? fmtTicks(numOf(j.length)!) : undefined),
      ],
    }),
  oven: (j) =>
    view('Печь Firmalife', 'firmalife:brick_oven_top', {
      inputs: inSlot(j.ingredient),
      outputs: outSlot(j.result),
      facts: [
        ...fact('температура', numOf(j.temperature) !== undefined ? fmtTemp(numOf(j.temperature)!) : undefined),
        ...fact('время', numOf(j.duration) !== undefined ? fmtTicks(numOf(j.duration)!) : undefined),
      ],
    }),
  drying: (j) =>
    view('Сушильная циновка', 'firmalife:drying_mat', { inputs: inSlot(j.ingredient), outputs: outSlot(j.result) }),
  smoking: (j) => view('Коптильня Firmalife', undefined, { inputs: inSlot(j.ingredient), outputs: outSlot(j.result) }),
  mixing_bowl: (j) =>
    view('Миска для смешивания', 'firmalife:mixing_bowl', {
      inputs: merge([...inSlots(j.item_ingredients), ...arr(j.fluid_ingredients).flatMap((f) => fluidSlot(f))]),
      outputs: [...outSlot(j.result_item), ...fluidSlot(j.result_fluid)],
    }),
  stomping: (j) =>
    view('Давильня (прыгать)', 'firmalife:wood/stomping_barrel/oak', {
      inputs: inSlot(j.ingredient),
      outputs: outSlot(j.result),
    }),
  centrifuge: (j) => view('Центрифуга', undefined, { inputs: inSlot(j.ingredient), outputs: outSlot(j.result) }),
};

const GLASS_WORKSHOP: Record<string, Rule> = {
  pressing: (j) =>
    view('Стеклянный пресс', 'tfc_glass_workshop:glass_press', {
      inputs: [
        ...inSlot(j.input, 'шихта'),
        ...inSlot(j.mold, 'форма'),
        ...arr(j.powders).map((p) => ({ item: `tfc:powder/${String(p)}`, role: 'порошок' })),
      ],
      outputs: outSlot(j.result),
      facts: fact('стекло не холоднее', numOf(j.min_temp) !== undefined ? fmtTemp(numOf(j.min_temp)!) : undefined),
    }),
};

const KALEIDO_TAVERN: Record<string, Rule> = {
  barrel: (j) =>
    view('Бочка таверны', 'kaleidoscope_tavern:barrel', {
      inputs: merge([...inSlots(j.ingredients), ...fluidSlot(j.fluid), ...inSlot(j.carrier, 'посуда')]),
      outputs: outSlot(j.result),
      facts: fact('выдержка за порцию', numOf(j.unit_time) !== undefined ? fmtTicks(numOf(j.unit_time)!) : undefined),
    }),
};

const JAMMIES: Record<string, Rule> = {
  jar_sealing: (j) =>
    view('Закатка банки', undefined, {
      inputs: [...inSlot(j.jar), ...inSlot(j.lid, 'крышка')],
      outputs: outSlot(j.result),
    }),
  jar_unsealing: (j) => view('Открыть банку', undefined, { inputs: inSlot(j.jar), outputs: outSlot(j.result) }),
};

const MORERED: Record<string, Rule> = {
  soldering: (j) =>
    view('Паяльный стол', 'morered:soldering_table', {
      inputs: merge(inSlots(j.ingredients)),
      outputs: outSlot(j.result),
    }),
};

const ATT: Record<string, Rule> = {
  thresher: (j) =>
    view('Молотилка', 'advancedtfctech:thresher', {
      inputs: inSlot(j.input),
      outputs: [...outSlot(j.result), ...outSlot(j.secondary_output)],
      facts: ieFacts(j),
    }),
  grist_mill: (j) =>
    view('Мельница', 'advancedtfctech:grist_mill', {
      inputs: inSlot(j.input),
      outputs: outSlot(j.result),
      facts: ieFacts(j),
    }),
  beamhouse: (j) =>
    view('Дубильный чан', 'advancedtfctech:beamhouse', {
      inputs: [...inSlot(j.input), ...fluidSlot(j.fluid)],
      outputs: outSlot(j.result),
      facts: ieFacts(j),
    }),
  fleshing_machine: (j) =>
    view('Мездрильная машина', 'advancedtfctech:fleshing_machine', {
      inputs: inSlot(j.input),
      outputs: outSlot(j.result),
      facts: ieFacts(j),
    }),
  power_loom: (j) =>
    view('Механический ткацкий станок', 'advancedtfctech:power_loom', {
      inputs: [...inSlots(j.inputs), ...inSlot(j.secondary_input, 'катушка')],
      outputs: [...outSlot(j.result), ...outSlot(j.secondary_output)],
      facts: ieFacts(j),
    }),
};

const DIESEL: Record<string, Rule> = {
  wire_cutting: createSimple('Кусачки для проводов', 'createdieselgenerators:wire_cutters'),
  hammering: createSimple('Молот', 'createdieselgenerators:hammer'),
  basin_fermenting: basin('Брожение в чаше', 'create:basin'),
  bulk_fermenting: basin('Бродильный бак', 'createdieselgenerators:bulk_fermenter'),
  compression_molding: (j) =>
    view('Компрессионное литьё', 'create:mechanical_press', {
      inputs: [...merge(createIn(j.ingredients)), ...inSlot(j.mold, 'форма')],
      outputs: createOut(j.results),
      facts: fact('нагрев', HEAT[strOf(j.heat_requirement) ?? '']),
    }),
};

/** Реестр: пространство имён типа → правила по пути типа */
const MODS: Record<string, Record<string, Rule>> = {
  minecraft: MINECRAFT,
  tfc: TFC,
  create: CREATE,
  immersiveengineering: IE,
  rnr: RNR,
  kaleidoscope_cookery: KALEIDO_COOKERY,
  kaleidoscope_tavern: KALEIDO_TAVERN,
  farmersdelight: FARMERSDELIGHT,
  firmalife: FIRMALIFE,
  tfc_glass_workshop: GLASS_WORKSHOP,
  jammies: JAMMIES,
  morered: MORERED,
  advancedtfctech: ATT,
  createdieselgenerators: DIESEL,
};

// ---------------------------------------------------------------- общий разбор

const IN_KEYS = ['ingredient', 'ingredients', 'input', 'inputs', 'input_item', 'item_input', 'item_ingredients'];
const OUT_KEYS = ['result', 'results', 'output', 'outputs', 'output_item', 'result_item', 'item_output'];
const FLUID_IN = ['input_fluid', 'fluid_ingredient', 'fluid_input', 'fluid_ingredients'];
const FLUID_OUT = ['output_fluid', 'result_fluid', 'fluid_output'];

/** Тип мода без правила: берём обычные поля входа/выхода, если они есть и разобрались */
function guess(type: string, j: J): RecipeView | null {
  const inputs = [
    ...IN_KEYS.flatMap((k) => inSlots(j[k])),
    ...FLUID_IN.flatMap((k) => arr(j[k]).flatMap((f) => fluidSlot(f))),
  ];
  const outputs = [...OUT_KEYS.flatMap((k) => outSlot(j[k])), ...FLUID_OUT.flatMap((k) => fluidSlot(j[k]))];
  if (!inputs.length || !outputs.length) return null;
  const time =
    numOf(j.processing_time) ?? numOf(j.processingTime) ?? numOf(j.time) ?? numOf(j.duration) ?? numOf(j.cookingtime);
  return {
    ...view(type, undefined, {
      inputs: merge(inputs),
      outputs,
      facts: [
        ...fact('время', time !== undefined ? fmtTicks(time) : undefined),
        ...fact('энергия', numOf(j.energy) !== undefined ? fmtRf(numOf(j.energy)!) : undefined),
        ...fact('температура', numOf(j.temperature) !== undefined ? fmtTemp(numOf(j.temperature)!) : undefined),
      ],
    }),
    guessed: true,
  };
}

/** Есть ли у типа своё правило (для статистики и подписи «по общим полям») */
export function hasViewRule(type: string): boolean {
  const [ns, path] = type.split(':');
  return !!MODS[ns]?.[path];
}

/**
 * Раскладка рецепта по типу и JSON. null — сетка крафта (её рисует craftGrid), заглушка-удаление или тип,
 * который не разобрать: показывать как раньше. Ошибка разбора — тоже null, не падаем.
 */
export function recipeView(r: { t: string; j: Record<string, unknown> }): RecipeView | null {
  if (!r.t || (Array.isArray(r.j.pattern) && r.j.key) || (/craft/.test(r.t) && Array.isArray(r.j.ingredients)))
    return null;
  const [ns, path] = r.t.split(':');
  try {
    const rule = MODS[ns]?.[path];
    const v = rule ? rule(r.j) : guess(r.t, r.j);
    return v && (v.inputs.length || v.outputs.length) ? v : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- текстом (MCP recipe_get)

/** Ингредиент коротко: id, #тег, варианты через «/» */
function ingText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(ingText).filter(Boolean).join(' / ');
  const o = obj(v);
  if (!o) return '?';
  if (typeof o.item === 'string') return o.item;
  if (typeof o.id === 'string') return o.id;
  if (typeof o.tag === 'string') return `#${o.tag}`;
  const inner = o.ingredient ?? o.children ?? o.ingredients ?? o.items ?? o.base;
  if (inner !== undefined) {
    const t = arr(inner)
      .filter((c) => !/not_rotten|has_trait|lacks_trait/.test(strOf(obj(c)?.type) ?? ''))
      .map(ingText);
    return t.join(' + ') || '?';
  }
  return strOf(o.type) ?? '?';
}

export function slotText(s: ViewSlot): string {
  const what = s.fluid
    ? `${s.fluid.id}${s.fluid.amount !== undefined ? ` ${s.fluid.amount} мБ` : ''}`
    : s.item !== undefined
      ? ingText(s.item)
      : (s.note ?? '?');
  const tail = [
    s.count && s.count > 1 ? `×${s.count}` : '',
    s.chance !== undefined ? `шанс ${fmtPct(s.chance)}` : '',
    s.role ?? '',
    s.item !== undefined && s.note ? s.note : '',
  ].filter(Boolean);
  return tail.length ? `${what} (${tail.join(', ')})` : what;
}

/** Раскладка строками: станция, вход, выход, условия, шаги, узор */
export function recipeViewLines(v: RecipeView): string[] {
  const out = [
    `раскладка (как в JEI): ${v.station}${v.stationIcon ? ` [${v.stationIcon}]` : ''}${v.guessed ? ' — по общим полям' : ''}`,
    `  вход: ${v.inputs.map(slotText).join('; ') || '—'}`,
    `  выход: ${v.outputs.map(slotText).join('; ') || '—'}`,
  ];
  if (v.facts.length) out.push(`  условия: ${v.facts.map((f) => `${f.label} ${f.value}`).join('; ')}`);
  v.steps?.forEach((s, i) =>
    out.push(`  шаг ${i + 1}: ${s.label}${s.slots?.length ? ` — ${s.slots.map(slotText).join('; ')}` : ''}`),
  );
  if (v.pattern)
    out.push(`  узор («#» — ${v.pattern.filled}):`, ...v.pattern.rows.map((r) => `    ${r.replace(/ /g, '.')}`));
  return out;
}
