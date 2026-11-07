// KubeJS-харнесс schematic_print_check (scripts/mcp/tools/print-check.mjs): печать схем пушкой Create на стенде.
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

// Что отличается от схемы: { total, groups: [{ key, n, ex }] }
function ctCompare(level, site) {
  var p = new CT_Printer();
  p.loadSchematic(ctBlueprint(site.anchor, site.file), level, true);
  var groups = {};
  var total = 0;
  var guard = 0;
  var add = function (key, ex) {
    total++;
    if (!groups[key]) groups[key] = { key: key, n: 0, ex: ex };
    groups[key].n++;
  };
  while (p.advanceCurrentPos() && guard++ < 2000000) {
    p.shouldPlaceCurrent(level, (pos, state, be, toReplace) => {
      if (state.isAir()) return false;
      var at = ' @ ' + pos.toShortString();
      if (toReplace == state) {
        var wbe = level.getBlockEntity(pos);
        var a = be ? String(be.saveWithoutMetadata(level.registryAccess())) : '';
        var b = wbe ? String(wbe.saveWithoutMetadata(level.registryAccess())) : '';
        if (a != b)
          add('данные: ' + ctBlockId(state), 'схема ' + a.substring(0, 300) + ' | мир ' + b.substring(0, 300) + at);
        return false;
      }
      var ex = String(state) + ' | мир: ' + String(toReplace) + at;
      if (toReplace.isAir()) add('нет: ' + ctBlockId(state), ex);
      else if (toReplace.getBlock() == state.getBlock()) add('свойства: ' + ctBlockId(state), ex);
      else add('другой: ' + ctBlockId(state) + ' ← ' + ctBlockId(toReplace), ex);
      return false;
    });
  }
  var list = Object.keys(groups).map((k) => groups[k]);
  list.sort((x, y) => y.n - x.n);
  return { total: total, groups: list.slice(0, 25), more: Math.max(0, list.length - 25) };
}

// Сколько предметов нужно на всю схему (мир на месте пустой): { id: n }, INVALID — клеток без предмета
function ctRequired(level, site) {
  var p = new CT_Printer();
  p.loadSchematic(ctBlueprint(site.anchor, site.file), level, true);
  var req = {};
  var stacks = {};
  var guard = 0;
  var rq;
  while (p.advanceCurrentPos() && guard++ < 2000000) {
    if (!p.shouldPlaceCurrent(level)) continue;
    rq = p.getCurrentRequirement();
    if (rq.isInvalid()) {
      req['INVALID'] = (req['INVALID'] || 0) + 1;
      continue;
    }
    rq.getRequiredItems().forEach((sr) => {
      var id = ctItemId(sr.stack.getItem());
      if (!stacks[id]) stacks[id] = sr.stack.copyWithCount(1);
      req[id] = (req[id] || 0) + sr.stack.getCount();
    });
  }
  site.req = req;
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

// Бочки вокруг пушки пополняются из запаса по кругу (стаки TFC маленькие, всё сразу не влезает)
function ctRefill(level, site) {
  var ids = Object.keys(site.bank).filter((id) => site.bank[id] > 0);
  if (!ids.length) return;
  var k = site.rr || 0;
  CT_Dirs.forEach((d) => {
    var be = level.getBlockEntity(site.cannon.relative(CT_Direction.byName(d)));
    if (!be || !be.getContainerSize) return;
    for (var i = 0; i < be.getContainerSize(); i++) {
      if (!ids.length) return;
      if (!be.getItem(i).isEmpty()) continue;
      var id = ids[k % ids.length];
      var n = Math.min(site.bank[id], site.stacks[id].getMaxStackSize());
      be.setItem(i, site.stacks[id].copyWithCount(n));
      site.bank[id] -= n;
      site.given[id] += n;
      if (site.bank[id] <= 0) ids = ids.filter((x) => x != id);
      else k++;
    }
  });
  site.rr = k;
  var cbe = level.getBlockEntity(site.cannon);
  if (cbe && cbe.inventory.getStackInSlot(4).getCount() < 32)
    cbe.inventory.setStackInSlot(4, Item.of('minecraft:gunpowder', 64));
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
    spentBefore: {},
    lastPlaced: -1,
    lastChange: 0,
    t0: ct.tick,
  };
  if (!site.creative) {
    ctRequired(level, site);
    site.bank = {};
    Object.keys(site.req).forEach((id) => {
      if (!site.stacks[id]) return;
      site.given[id] = 0;
      // запас с излишком: повторный запуск тоже тратит
      site.bank[id] = Math.ceil(site.req[id] * (site.restart ? 2.2 : 1.1)) + 16;
    });
  }
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
  ctOut({ site: i, ev: 'start', anchor: String(site.anchor.toShortString()), required: site.req || null });
  return site;
}

function ctReport(level, site, be, label, extra) {
  var cmp = ctCompare(level, site);
  var out = {
    site: site.i,
    ev: 'report',
    label: label,
    placed: be.blocksPlaced,
    toPlace: be.blocksToPlace,
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
}

// Повторный запуск той же схемы поверх готовой постройки, как новая схема в слоте
function ctRelaunch(be, site) {
  be.inventory.setStackInSlot(1, CT_ItemStack.EMPTY);
  be.inventory.setStackInSlot(0, ctBlueprint(site.anchor, site.file));
  be.state = CT_State.RUNNING;
  site.lastPlaced = -1;
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
    return;
  }
  if (s.phase == 'stopped') {
    be.state = CT_State.RUNNING;
    s.phase = 'print';
    s.lastPlaced = -1;
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
          CT_AllConfigs.server().schematics.schematicannonDelay.set(CT_CFG.delay);
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
  if (ct.tick % 20 != 0) return;
  var level = event.server.overworld();
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
