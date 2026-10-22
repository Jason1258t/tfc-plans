/**
 * Immersive Engineering 1.21.1-12.4.2: что предмет рисует кодом.
 *   conf_sides — куб из текстур <base_name>_<сторона>_none (конденсаторы и т. п.);
 *   basic_split — мультиблоки (коксовая и доменная печь, плавильня): BakedBasicSplitModel без SUBMODEL_OFFSET (предмет)
 *     отдаёт всю inner_model целиком, display — от модели предмета;
 *   models/coresample — образец породы без данных (ModelCoresample, minerals = null): столбик 4×16×4 из камня;
 *     getTransforms — NO_TRANSFORMS (таблица transformationMap в коде не используется) — вид спереди без поворота;
 *   models/conveyor — конвейеры (ieConveyor.mjs): тот же ModelConveyor с умолчаниями предмета;
 *   potion_bucket — ведро NeoForge с жидкостью immersiveengineering:potion цвета пустого зелья
 *     (PotionContents.BASE_POTION_COLOR — у предмета без зелья);
 *   objCallbacks — инструменты (ie_obj с callbacks): видимые группы OBJ без улучшений и насадок, как в JEI, из
 *     shouldRenderGroup / getTextureReplacement / getRenderColor классов client.models.obj.callback.item.*Callbacks.
 */
import { conveyorParts } from './ieConveyor.mjs';
import { bucketSpecs } from './neoforge.mjs';

/** Модель из поля загрузчика, display — от модели предмета */
function inner(ctx, part, ref, what) {
  const m = part.model;
  const c = ctx.inlineModel(ref);
  if (!c?.chain.length) {
    ctx.warn(`${m.id}: нет ${what}`);
    return [];
  }
  c.display = { ...c.display, ...m.display };
  return ctx.expand([{ ...part, model: c }]);
}

function confSides(ctx, part) {
  // <base_name>_<сторона>_none (по коду IE — side_top_bottom, side_top, all_same…)
  const m = part.model;
  const base = m.loaderJson?.base_name;
  const pick = (...ids) => ids.find((id) => ctx.has(id)) ?? ids[ids.length - 1];
  const side = pick(`${base}_side_none`, `${base}_none`);
  const textures = {
    up: pick(`${base}_up_none`, `${base}_top_none`, side),
    down: pick(`${base}_down_none`, `${base}_bottom_none`, side),
    side,
  };
  const faces = Object.fromEntries(
    ['north', 'south', 'east', 'west', 'up', 'down'].map((f) => [
      f,
      { texture: f === 'up' ? '#up' : f === 'down' ? '#down' : '#side' },
    ]),
  );
  return [
    {
      ...part,
      model: {
        ...m,
        textures: { ...m.textures, ...textures },
        elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces }],
      },
    },
  ];
}

function coresample(ctx, part) {
  const f = (uv) => ({ uv, texture: '#stone' });
  return [
    {
      ...part,
      model: {
        ...part.model,
        loader: null,
        textures: { stone: 'minecraft:block/stone' },
        display: { gui: { rotation: [0, 0, 0] } },
        elements: [
          {
            from: [6, 0, 6],
            to: [10, 16, 10],
            faces: {
              down: f([6, 6, 10, 10]),
              up: f([6, 6, 10, 10]),
              north: f([0, 0, 4, 16]),
              east: f([4, 0, 8, 16]),
              south: f([8, 0, 12, 16]),
              west: f([12, 0, 16, 16]),
            },
          },
        ],
      },
    },
  ];
}

function conveyor(ctx, part) {
  const m = part.model;
  const c = conveyorParts(m.loaderJson?.conveyorType);
  if (!c) {
    ctx.warn(`${m.id}: конвейер ${m.loaderJson?.conveyorType} — тип не перенесён`);
    return [];
  }
  const display = { gui: { matrix: c.gui } };
  const out = [{ ...part, model: { ...m, loader: null, quads: c.quads, display } }];
  if (c.panel) {
    const pm = ctx.loadModel(c.panel.model);
    if (pm.chain.length) out.push({ ...part, model: { ...pm, display, objGroups: c.panel.groups } });
  }
  return out;
}

export default {
  name: 'Immersive Engineering',
  loaders: {
    'immersiveengineering:conf_sides': confSides,
    'immersiveengineering:basic_split': (ctx, part) =>
      inner(ctx, part, part.model.loaderJson?.inner_model, 'inner_model'),
    'immersiveengineering:models/coresample': coresample,
    'immersiveengineering:models/conveyor': conveyor,
  },
  flat: {
    'immersiveengineering:potion_bucket': (ctx, model) => ({
      specs: bucketSpecs(ctx, model, { still: 'immersiveengineering:block/fluid/potion_still', tint: 0xff385dc6 }),
      fluid: 'immersiveengineering:potion',
      wanted: 'immersiveengineering:potion',
    }),
  },
  objCallbacks: {
    // DrillCallbacks: без головки — только рама и рукоять
    'immersiveengineering:drill': { show: (g) => g === 'drill_frame' || g === 'drill_grip' },
    // ChemthrowerCallbacks: base, grip, cage, tanks, tank; large_tank и multi_tank — с улучшениями
    'immersiveengineering:chemthrower': { show: (g) => ['base', 'grip', 'cage', 'tanks', 'tank'].includes(g) },
    // RailgunCallbacks: всё, кроме прицела и ускорителя (barrel_top виден без ускорителя)
    'immersiveengineering:railgun': { show: (g) => g !== 'upgrade_scope' && g !== 'upgrade_speed' },
    // RevolverCallbacks: frame, cylinder, barrel, cosmetic_compensator; все материалы — текстура item/revolvers/revolver
    'immersiveengineering:revolver': {
      show: (g) => ['frame', 'cylinder', 'barrel', 'cosmetic_compensator'].includes(g),
      texture: 'immersiveengineering:item/revolvers/revolver',
    },
    // ShieldCallbacks: всё, кроме вспышки и электрошока
    'immersiveengineering:shield': { show: (g) => g !== 'flash' && g !== 'shock' },
    // BuzzsawCallbacks: без диска и улучшений — корпус и прочее, что не перечислено
    'immersiveengineering:buzzsaw': {
      show: (g) =>
        !['blade', 'upgrade_lube', 'upgrade_launcher', 'upgrade_waterproof'].includes(g) &&
        !/^upgrade_blades\d$/.test(g),
    },
    // PowerpackCallbacks (проход 0): без знамён, антенны, индукции и катушки Теслы
    'immersiveengineering:powerpack': {
      show: (g) =>
        !['banner', 'big_banner', 'banner_post', 'antenna', 'induction', 'induction_tubes', 'tesla_coil'].includes(g),
    },
    // FluorescentTubeCallbacks: трубка — белый × 0.3 (не горит), остальное — 0.067
    'immersiveengineering:fluorescent_tube': { show: () => true, tint: (g) => (g === 'tube' ? 0x4d4d4d : 0x111111) },
  },
};
