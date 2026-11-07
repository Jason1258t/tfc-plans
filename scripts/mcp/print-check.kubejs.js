// KubeJS-харнесс schematic_print_check (scripts/mcp/tools/printcheck.mjs): печать схем пушкой Create на стенде.
// Инструмент дописывает сверху `var CT_CFG = {…}` и кладёт файл в kubejs/server_scripts оверлея; схемы —
// в schematics/uploaded/Test/. Команда `ct start` ставит площадки; итог — строки «[CT] R {json}» в
// logs/kubejs/server.log, конец — «[CT] ВСЁ» или «[CT] ОШИБКА». Rhino: в циклах только var, классы — Java.loadClass.
/* global CT_CFG */
const CT_State = Java.loadClass('com.simibubi.create.content.schematics.cannon.SchematicannonBlockEntity$State');
const CT_AllBlocks = Java.loadClass('com.simibubi.create.AllBlocks');
const CT_AllItems = Java.loadClass('com.simibubi.create.AllItems');
const CT_ADC = Java.loadClass('com.simibubi.create.AllDataComponents');
const CT_Printer = Java.loadClass('com.simibubi.create.content.schematics.SchematicPrinter');
const CT_AllConfigs = Java.loadClass('com.simibubi.create.infrastructure.config.AllConfigs');
const CT_BlockPos = Java.loadClass('net.minecraft.core.BlockPos');
const CT_Heightmap = Java.loadClass('net.minecraft.world.level.levelgen.Heightmap$Types');
const CT_ItemStack = Java.loadClass('net.minecraft.world.item.ItemStack');
const CT_Blocks = Java.loadClass('net.minecraft.world.level.block.Blocks');
const CT_Rotation = Java.loadClass('net.minecraft.world.level.block.Rotation');
const CT_Mirror = Java.loadClass('net.minecraft.world.level.block.Mirror');
const CT_Direction = Java.loadClass('net.minecraft.core.Direction');
const CT_Registries = Java.loadClass('net.minecraft.core.registries.BuiltInRegistries');
const CT_RL = Java.loadClass('net.minecraft.resources.ResourceLocation');
const CT_Integer = Java.loadClass('java.lang.Integer');
const CT_Dirs = ['north', 'south', 'east', 'west', 'down'];

var ct = null;

function ctLog(msg) {
  console.info('[CT] ' + msg);
}

function ctOut(obj) {
  console.info('[CT] R ' + JSON.stringify(obj));
}

function ctBlueprint(anchor, file) {
  var s = CT_AllItems.SCHEMATIC.asStack();
  s.set(CT_ADC.SCHEMATIC_FILE, file);
  s.set(CT_ADC.SCHEMATIC_OWNER, 'Test');
  s.set(CT_ADC.SCHEMATIC_ANCHOR, anchor);
  s.set(CT_ADC.SCHEMATIC_DEPLOYED, true);
  s.set(CT_ADC.SCHEMATIC_ROTATION, CT_Rotation.NONE);
  s.set(CT_ADC.SCHEMATIC_MIRROR, CT_Mirror.NONE);
  return s;
}

function ctBlockId(state) {
  return String(CT_Registries.BLOCK.getKey(state.getBlock()));
}

function ctItemId(item) {
  return String(CT_Registries.ITEM.getKey(item));
}

// Принтер со схемой площадки; null — схема не загрузилась (ошибка в latest.log: «Failed to load Schematic for Printing»)
function ctPrinter(level, site) {
  var p = new CT_Printer();
  p.loadSchematic(ctBlueprint(site.anchor, site.file), level, true);
  if (!p.isLoaded() || p.isErrored()) return null;
  return p;
}

// Состояние и блок-сущность схемы в текущей клетке принтера (null — стадия сущностей)
function ctTarget(p) {
  var t = null;
  p.handleCurrentTarget(
    (pos, state, be) => {
      t = { pos: pos, state: state, be: be };
    },
    () => {},
  );
  return t;
}

// Состояние, которое игра сама переписывает после установки (не данные постройки): флаги и счётчики тиков, фаза
// анимации. По итогам прогонов #305: NeedsSpeedUpdate у всех кинетических блоков Create, кулдаун воронки, счётчики
// печи TFC, угол и точка тяги станка-качалки. Сравниваются без них, на любой глубине (ExtraCogwheel и т. п.).
const CT_VOLATILE = ['NeedsSpeedUpdate', 'TransferCooldown', 'lastPlayerTick', 'lastMaxBurnTicks'];
const CT_VOLATILE_BY_BLOCK = {
  'createdieselgenerators:pumpjack_crank': ['Angle', 'BackPosX', 'BackPosY', 'BackPosZ'],
};

function ctStrip(tag, skip) {
  var c = tag.copy();
  c.getAllKeys()
    .toArray()
    .forEach((k) => {
      if (skip.indexOf(String(k)) >= 0) c.remove(k);
      else if (c.get(k).getId() == 10) c.put(k, ctStrip(c.get(k), skip));
    });
  return c;
}

// Ключи данных блок-сущности схемы, которых в мире нет или они другие (без CT_VOLATILE)
function ctLostKeys(level, sbe, wbe, block) {
  var ra = level.registryAccess();
  var skip = CT_VOLATILE.concat(CT_VOLATILE_BY_BLOCK[block] || []);
  var a = ctStrip(sbe.saveWithoutMetadata(ra), skip);
  var b = wbe ? ctStrip(wbe.saveWithoutMetadata(ra), skip) : null;
  var lost = [];
  a.getAllKeys().forEach((k) => {
    if (!b || !b.contains(k) || !a.get(k).equals(b.get(k))) lost.push(String(k));
  });
  return { lost: lost, a: String(a), b: b ? String(b) : '' };
}

// Что отличается от схемы, группами по виду и блоку: { total, groups: [{ kind, block, from, n, ex }] }
function ctCompare(level, site) {
  var p = ctPrinter(level, site);
  if (!p) return { total: 0, groups: [], error: 'not_loaded' };
  var groups = {};
  var total = 0;
  var guard = 0;
  var add = function (kind, block, from, ex) {
    var key = kind + ' ' + block + ' ' + from;
    total++;
    if (!groups[key]) groups[key] = { kind: kind, block: block, from: from, n: 0, ex: ex };
    groups[key].n++;
  };
  while (p.advanceCurrentPos() && guard++ < 4000000) {
    var t = ctTarget(p);
    if (!t) break;
    if (t.state.isAir()) continue;
    var w = level.getBlockState(t.pos);
    var at = ' @ ' + t.pos.toShortString();
    if (w != t.state) {
      var ex = String(t.state) + ' | мир: ' + String(w) + at;
      if (w.isAir()) add('missing', ctBlockId(t.state), '', ex);
      else if (w.getBlock() == t.state.getBlock()) add('state', ctBlockId(t.state), '', ex);
      else add('other', ctBlockId(t.state), ctBlockId(w), ex);
    } else if (t.be) {
      var d = ctLostKeys(level, t.be, level.getBlockEntity(t.pos), ctBlockId(t.state));
      if (d.lost.length)
        add(
          'data',
          ctBlockId(t.state),
          '',
          'ключи ' + d.lost.join(',') + ': схема ' + d.a.substring(0, 300) + ' | мир ' + d.b.substring(0, 300) + at,
        );
    }
  }
  var list = Object.keys(groups).map((k) => groups[k]);
  list.sort((x, y) => y.n - x.n);
  return { total: total, groups: list.slice(0, 40), more: Math.max(0, list.length - 40) };
}

// Сколько предметов нужно на всю схему (мир на месте пустой); клетки без своего предмета — по блокам
function ctRequired(level, site, p) {
  var req = {};
  var invalid = {};
  var stacks = {};
  var guard = 0;
  var rq;
  while (p.advanceCurrentPos() && guard++ < 4000000) {
    var t = ctTarget(p);
    if (t && t.state.isAir()) continue;
    if (!p.shouldPlaceCurrent(level)) continue;
    rq = p.getCurrentRequirement();
    if (rq.isInvalid()) {
      var b = t ? ctBlockId(t.state) : 'entity';
      invalid[b] = (invalid[b] || 0) + 1;
      continue;
    }
    rq.getRequiredItems().forEach((sr) => {
      var id = ctItemId(sr.stack.getItem());
      if (!stacks[id]) stacks[id] = sr.stack.copyWithCount(1);
      req[id] = (req[id] || 0) + sr.stack.getCount();
    });
  }
  site.req = req;
  site.invalid = invalid;
  site.stacks = stacks;
}

function ctCount(level, site) {
  var c = {};
  CT_Dirs.forEach((d) => {
    var be = level.getBlockEntity(site.cannon.relative(CT_Direction.byName(d)));
    if (!be || !be.getContainerSize) return;
    for (var i = 0; i < be.getContainerSize(); i++) {
      var s = be.getItem(i);
      if (s.isEmpty()) continue;
      var id = ctItemId(s.getItem());
      c[id] = (c[id] || 0) + s.getCount();
    }
  });
  return c;
}

// Бочки вокруг пушки пополняются из запаса (стаки TFC маленькие, всё сразу не влезает): пустая ячейка — предметом,
// которого в бочках меньше всего; нужный пушке сейчас (missingItem) — вне очереди, вытесняя самый частый
function ctRefill(level, site) {
  var cbe = level.getBlockEntity(site.cannon);
  if (cbe && cbe.inventory.getStackInSlot(4).getCount() < 32)
    cbe.inventory.setStackInSlot(4, Item.of('minecraft:gunpowder', 64));
  var slots = [];
  var have = {};
  CT_Dirs.forEach((d) => {
    var be = level.getBlockEntity(site.cannon.relative(CT_Direction.byName(d)));
    if (!be || !be.getContainerSize) return;
    for (var i = 0; i < be.getContainerSize(); i++) {
      var st = be.getItem(i);
      var id = st.isEmpty() ? null : ctItemId(st.getItem());
      slots.push({ be: be, i: i, id: id, n: st.getCount() });
      if (id) have[id] = (have[id] || 0) + st.getCount();
    }
  });
  var put = function (slot, id) {
    var n = Math.min(site.bank[id], site.stacks[id].getMaxStackSize());
    slot.be.setItem(slot.i, site.stacks[id].copyWithCount(n));
    site.bank[id] -= n;
    site.given[id] += n;
    have[id] = (have[id] || 0) + n;
    slot.id = id;
    slot.n = n;
  };
  var miss = cbe && cbe.missingItem && !cbe.missingItem.isEmpty() ? ctItemId(cbe.missingItem.getItem()) : null;
  if (miss && site.bank[miss] > 0 && !have[miss]) {
    var free = null;
    var top = null;
    for (var j = 0; j < slots.length; j++) {
      var sl = slots[j];
      if (!sl.id) {
        free = sl;
        break;
      }
      if (site.bank[sl.id] != null && (!top || have[sl.id] > have[top.id])) top = sl;
    }
    if (!free && top) {
      // самый частый предмет — обратно в запас
      site.bank[top.id] += top.n;
      site.given[top.id] -= top.n;
      have[top.id] -= top.n;
      top.be.setItem(top.i, CT_ItemStack.EMPTY);
      top.id = null;
      free = top;
    }
    if (free) put(free, miss);
  }
  slots.forEach((sl) => {
    if (sl.id) return;
    var best = null;
    Object.keys(site.bank).forEach((id) => {
      if (site.bank[id] <= 0) return;
      if (best == null || (have[id] || 0) < (have[best] || 0)) best = id;
    });
    if (best != null) put(sl, best);
  });
}

// Блоки палитры, которых нет в реестре сборки: { id: клеток }
function ctUnknown(blocks) {
  var out = {};
  Object.keys(blocks || {}).forEach((id) => {
    var rl = CT_RL.tryParse(id);
    if (!rl || !CT_Registries.BLOCK.containsKey(rl)) out[id] = blocks[id];
  });
  return out;
}

function ctStart(server, cfg, i) {
  var level = server.overworld();
  var x = cfg.x;
  var z = cfg.z;
  server.runCommandSilent(
    'forceload add ' + (x - 8) + ' ' + (z - 8) + ' ' + (x + cfg.size[0] + 1) + ' ' + (z + cfg.size[2] + 1),
  );
  for (var cx = (x - 8) >> 4; cx <= (x + cfg.size[0] + 1) >> 4; cx++)
    for (var cz = (z - 8) >> 4; cz <= (z + cfg.size[2] + 1) >> 4; cz++) level.getChunk(cx, cz);
  var y = level.getHeight(CT_Heightmap.WORLD_SURFACE, x, z);
  var site = {
    i: i,
    name: cfg.name,
    file: cfg.file,
    creative: cfg.creative,
    restart: cfg.restart,
    reset: cfg.reset,
    anchor: new CT_BlockPos(x, y, z),
    cannon: new CT_BlockPos(x - 6, y, z - 6),
    phase: 'print',
    given: {},
    bank: {},
    spentBefore: {},
    lastPlaced: -1,
    lastChange: ct.tick,
    maxPlaced: 0,
    maxToPlace: 0,
    t0: ct.tick,
  };
  var unknown = ctUnknown(cfg.blocks);
  var p = ctPrinter(level, site);
  if (!p) {
    ctOut({ site: i, ev: 'start', anchor: String(site.anchor.toShortString()), unknown: unknown, notLoaded: true });
    site.phase = 'done';
    return site;
  }
  ctRequired(level, site, p);
  if (!site.creative)
    Object.keys(site.req).forEach((id) => {
      site.given[id] = 0;
      // запас с излишком: повторный запуск тоже тратит
      site.bank[id] = Math.ceil(site.req[id] * (site.restart ? 2.2 : 1.1)) + 16;
    });
  if (cfg.prefill) {
    var top = Math.min(cfg.size[1], cfg.prefill.height) - 1;
    for (var yy = 0; yy <= top; yy++)
      server.runCommandSilent(
        'fill ' +
          x +
          ' ' +
          (y + yy) +
          ' ' +
          z +
          ' ' +
          (x + cfg.size[0] - 1) +
          ' ' +
          (y + yy) +
          ' ' +
          (z + cfg.size[2] - 1) +
          ' ' +
          cfg.prefill.block,
      );
  }
  level.setBlock(site.cannon, CT_AllBlocks.SCHEMATICANNON.getDefaultState(), 3);
  if (site.creative) level.setBlock(site.cannon.below(), CT_AllBlocks.CREATIVE_CRATE.getDefaultState(), 3);
  else {
    CT_Dirs.forEach((d) =>
      level.setBlock(site.cannon.relative(CT_Direction.byName(d)), CT_Blocks.BARREL.defaultBlockState(), 3),
    );
    ctRefill(level, site);
  }
  var be = level.getBlockEntity(site.cannon);
  be.inventory.setStackInSlot(0, ctBlueprint(site.anchor, site.file));
  be.replaceMode = cfg.replaceMode;
  be.skipMissing = false;
  be.state = CT_State.RUNNING;
  be.setChanged();
  ctOut({
    site: i,
    ev: 'start',
    anchor: String(site.anchor.toShortString()),
    unknown: unknown,
    required: site.req,
    invalid: site.invalid,
  });
  return site;
}

function ctReport(level, site, be, label, extra) {
  var cmp = ctCompare(level, site);
  var out = {
    site: site.i,
    ev: 'report',
    label: label,
    placed: Math.max(site.maxPlaced, be.blocksPlaced),
    toPlace: Math.max(site.maxToPlace, be.blocksToPlace),
    sec: Math.round((ct.tick - site.t0) / 20),
    mismatch: cmp.total,
    groups: cmp.groups,
    moreGroups: cmp.more,
  };
  if (extra) out.stall = extra;
  if (!site.creative) {
    var now = ctCount(level, site);
    var spent = {};
    Object.keys(site.given).forEach((id) => {
      var total = site.given[id] - (now[id] || 0);
      var u = total - (site.spentBefore[id] || 0);
      if (u) spent[id] = u;
      site.spentBefore[id] = total;
    });
    out.spent = spent;
  }
  ctOut(out);
  site.t0 = ct.tick;
  site.maxPlaced = 0;
  site.maxToPlace = 0;
}

// Повторный запуск той же схемы поверх готовой постройки, как новая схема в слоте
function ctRelaunch(be, site) {
  be.inventory.setStackInSlot(1, CT_ItemStack.EMPTY);
  be.inventory.setStackInSlot(0, ctBlueprint(site.anchor, site.file));
  be.state = CT_State.RUNNING;
  site.lastPlaced = -1;
  site.lastChange = ct.tick;
}

function ctSiteTick(level, s) {
  if (s.phase == 'done') return;
  var be = level.getBlockEntity(s.cannon);
  if (!be) {
    ctOut({ site: s.i, ev: 'error', msg: 'пушки нет на месте' });
    s.phase = 'done';
    return;
  }
  if (!s.creative) ctRefill(level, s);
  // «Пуск» после загрузки схемы
  if (be.state == CT_State.PAUSED && String(be.statusMsg) == 'ready' && s.phase != 'stopped') {
    be.state = CT_State.RUNNING;
    return;
  }
  // сброс посреди печати: «Стоп», через секунду «Пуск»
  if (
    s.phase == 'print' &&
    s.reset &&
    !s.didReset &&
    be.blocksToPlace > 0 &&
    be.blocksPlaced >= be.blocksToPlace * s.reset
  ) {
    ctOut({ site: s.i, ev: 'reset', placed: be.blocksPlaced, toPlace: be.blocksToPlace });
    be.state = CT_State.STOPPED;
    s.didReset = true;
    s.phase = 'stopped';
    s.maxPlaced = 0;
    s.maxToPlace = 0;
    return;
  }
  if (s.phase == 'stopped') {
    be.state = CT_State.RUNNING;
    s.phase = 'print';
    s.lastPlaced = -1;
    s.lastChange = ct.tick;
    return;
  }
  var done = be.state == CT_State.STOPPED && String(be.statusMsg) == 'finished';
  if (!done) {
    if (be.blocksPlaced != s.lastPlaced) {
      s.lastPlaced = be.blocksPlaced;
      s.lastChange = ct.tick;
    } else if (ct.tick - s.lastChange > CT_CFG.stall * 20) {
      var miss = be.missingItem && !be.missingItem.isEmpty() ? ctItemId(be.missingItem.getItem()) : '';
      ctReport(level, s, be, s.phase == 'again' ? 'restart' : 'print', {
        state: String(be.state),
        msg: String(be.statusMsg),
        missing: miss,
        sec: CT_CFG.stall,
      });
      s.phase = 'done';
    }
    return;
  }
  if (s.phase == 'print') {
    ctReport(level, s, be, s.didReset ? 'print-reset' : 'print');
    if (s.restart) {
      ctRelaunch(be, s);
      s.phase = 'again';
      return;
    }
  } else if (s.phase == 'again') ctReport(level, s, be, 'restart');
  s.phase = 'done';
}

ServerEvents.commandRegistry((event) => {
  var { commands: Commands } = event;
  event.register(
    Commands.literal('ct').then(
      Commands.literal('start').executes((ctx) => {
        var server = ctx.source.server;
        try {
          // Настройка типизирована дженериком: число из JS ушло бы как Double, и tickPrinter падает на (Integer) cast
          CT_AllConfigs.server().schematics.schematicannonDelay.set(CT_Integer.valueOf(CT_CFG.delay | 0));
          ct = { tick: 0, sites: [] };
          for (var i = 0; i < CT_CFG.sites.length; i++) ct.sites.push(ctStart(server, CT_CFG.sites[i], i));
          ctLog('старт');
        } catch (e) {
          ct = null;
          ctLog('ОШИБКА старта: ' + e);
        }
        return 1;
      }),
    ),
  );
});

ServerEvents.tick((event) => {
  if (!ct || ct.over) return;
  ct.tick++;
  var level = event.server.overworld();
  // счётчики пушки обнуляются в конце печати — берём максимум за проход, каждый тик
  for (var k = 0; k < ct.sites.length; k++) {
    var st = ct.sites[k];
    if (st.phase == 'done') continue;
    var cb = level.getBlockEntity(st.cannon);
    if (!cb) continue;
    if (cb.blocksPlaced > st.maxPlaced) st.maxPlaced = cb.blocksPlaced;
    if (cb.blocksToPlace > st.maxToPlace) st.maxToPlace = cb.blocksToPlace;
  }
  if (ct.tick % 20 != 0) return;
  try {
    for (var i = 0; i < ct.sites.length; i++) ctSiteTick(level, ct.sites[i]);
  } catch (e) {
    ct.over = true;
    ctLog('ОШИБКА тика: ' + e);
    return;
  }
  if (ct.sites.every((s) => s.phase == 'done')) {
    ct.over = true;
    ctLog('ВСЁ, тиков ' + ct.tick);
  }
});
