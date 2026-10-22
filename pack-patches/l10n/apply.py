"""Перевод китайских сообщений сборки TerraFirma Rebirth на английский и русский.

Заменяет китайский текст в скриптах KubeJS на ключи перевода (Text.translatableWithFallback с английским
запасным текстом) и дописывает ключи в kubejs/assets/kubejs/lang/{en_us,ru_ru}.json.

  python3 apply.py <папка игры, где лежит kubejs/>

Каждая замена должна найтись ровно один раз — если сборка обновилась и скрипт поменялся, скрипт остановится
и скажет, где. Готовый результат для текущей версии сборки лежит рядом в kubejs/.
"""
import sys, os, json
W = sys.argv[1]
def patch(rel, pairs):
    p = os.path.join(W, rel)
    raw = open(p, 'rb').read().decode('utf-8')
    crlf = '\r\n' in raw
    s = raw.replace('\r\n', '\n')
    for old, new in pairs:
        n = s.count(old)
        assert n == 1, (rel, n, old[:80])
        s = s.replace(old, new)
    if crlf: s = s.replace('\n', '\r\n')
    open(p, 'wb').write(s.encode('utf-8'))

T = 'Text.translatableWithFallback'
SS = 'kubejs/server_scripts/'

patch(SS + 'cleaner_360.js', [
    ("var GUARD_NAME = '[群峦星360安全卫士] '", "var GUARD_NAME = " + T + "('message.kubejs.cleaner.name', '[Item Cleaner] ')"),
    ("[1200, '60秒'],\n    [600, '30秒'],\n    [200, '10秒'],\n    [100, '5秒']", "[1200, '60'],\n    [600, '30'],\n    [200, '10'],\n    [100, '5']"),
    ("p.tell(Text.aqua(GUARD_NAME).bold(true).append(Text[color](msg).bold(false)))",
     "p.tell(Text.aqua(GUARD_NAME.copy()).bold(true).append(Text[color](msg).bold(false)))"),
    ("console.error('[360卫士] 广播失败: ' + err)", "console.error('[Item Cleaner] broadcast failed: ' + err)"),
    ("console.error('[360卫士] 清理维度 ' + level.dimension().location() + ' 时出错: ' + err2)",
     "console.error('[Item Cleaner] failed to clear dimension ' + level.dimension().location() + ': ' + err2)"),
    ("console.error('[360卫士] 清理掉落物时出错: ' + err)", "console.error('[Item Cleaner] failed to clear dropped items: ' + err)"),
    ("guardTell(event.server, '已清理 ' + count + ' 个掉落物，世界更清爽了！', 'green')",
     "guardTell(event.server, " + T + "('message.kubejs.cleaner.done', 'Cleared %s dropped items.', '' + count), 'green')"),
    ("console.info('[360卫士] 本次清理掉落物: ' + count + ' 个')", "console.info('[Item Cleaner] dropped items cleared: ' + count)"),
    ("guardTell(event.server, '掉落物清理将于 ' + WARNINGS[i][1] + ' 后进行，请及时拾取重要物品！', 'yellow')",
     "guardTell(event.server, " + T + "('message.kubejs.cleaner.warning', 'Dropped items will be cleared in %s seconds — pick up anything important!', WARNINGS[i][1]), 'yellow')"),
])

patch(SS + 'portable_engine_fill.js', [
    ("[引擎灌燃料] ${item.id} 读取流体能力异常: ${e}", "[Engine refuel] ${item.id}: failed to read fluid capability: ${e}"),
    ("[引擎灌燃料] ${item.id} 读取槽位异常: ${readErr}", "[Engine refuel] ${item.id}: failed to read slot: ${readErr}"),
    ("[引擎灌燃料] 取引擎储罐失败: ${e}", "[Engine refuel] failed to get the engine tank: ${e}"),
    ("player.tell(Text.yellow('燃料罐已经满了 / The fuel tank is already full'))",
     "player.tell(Text.yellow(" + T + "('message.kubejs.engine.full', 'The fuel tank is already full')))"),
    ("player.tell(Text.yellow(`燃料罐空间不足，装不下这一桶（还差 ${fluidAmount - simFill} mB 空间） / Not enough tank space for this bucket (${fluidAmount - simFill} mB short)`))",
     "player.tell(Text.yellow(" + T + "('message.kubejs.engine.no_space', 'Not enough tank space for this bucket (%s mB short)', `${fluidAmount - simFill}`)))"),
    ("[引擎灌燃料] 点火异常: ${e}", "[Engine refuel] ignition failed: ${e}"),
    ("console.info(`[引擎灌燃料] ${player.name.string} 用 ${item.id} 给引擎加了 ${simFill} mB ${fluidId}${ignited ? '（已点火）' : ''}`)",
     "console.info(`[Engine refuel] ${player.name.string} added ${simFill} mB ${fluidId} with ${item.id}${ignited ? ' (ignited)' : ''}`)"),
    ("player.tell(Text.gold(ignited ? `已加入燃料：${simFill} mB，引擎点火！ / Fuel added: ${simFill} mB — engine ignited!` : `已加入燃料：${simFill} mB / Fuel added: ${simFill} mB`))",
     "player.tell(Text.gold(ignited\n        ? " + T + "('message.kubejs.engine.added_ignited', 'Fuel added: %s mB — engine ignited!', `${simFill}`)\n        : " + T + "('message.kubejs.engine.added', 'Fuel added: %s mB', `${simFill}`)))"),
    ("[引擎灌燃料] 续烧异常 @${arr[i]}: ${e}", "[Engine refuel] re-ignition failed @${arr[i]}: ${e}"),
    ("[引擎灌燃料] 引擎 @${arr[i]} 自动续烧", "[Engine refuel] engine @${arr[i]} re-ignited"),
])

VEINS = {
 'coal': ('煤矿脉', 'Coal Vein', 'Месторождение угля'),
 'saltpeter': ('硝石矿脉', 'Saltpeter Vein', 'Месторождение селитры'),
 'halite': ('盐矿脉', 'Halite Vein', 'Месторождение каменной соли'),
 'borax': ('硼砂矿脉', 'Borax Vein', 'Месторождение буры (боракс)'),
 'graphite': ('石墨矿脉', 'Graphite Vein', 'Месторождение графита'),
 'cinnabar': ('朱砂矿脉', 'Cinnabar Vein', 'Месторождение киновари'),
 'lapis': ('青金石矿脉', 'Lapis Lazuli Vein', 'Месторождение лазурита'),
 'native_copper': ('自然铜矿脉', 'Native Copper Vein', 'Месторождение самородной меди'),
 'malachite': ('孔雀石矿脉', 'Malachite Vein', 'Месторождение малахита'),
 'tetrahedrite': ('黝铜矿脉', 'Tetrahedrite Vein', 'Месторождение тетраэдрита'),
 'cassiterite': ('锡石矿脉', 'Cassiterite Vein', 'Месторождение касситерита'),
 'sphalerite': ('闪锌矿脉', 'Sphalerite Vein', 'Месторождение сфалерита'),
 'bismuthinite': ('辉铋矿脉', 'Bismuthinite Vein', 'Месторождение висмутина'),
 'garnierite': ('镍矿脉', 'Garnierite (Nickel) Vein', 'Месторождение гарниерита (никель)'),
 'hematite': ('赤铁矿脉', 'Hematite Vein', 'Месторождение гематита'),
 'limonite': ('褐铁矿脉', 'Limonite Vein', 'Месторождение лимонита'),
 'magnetite': ('磁铁矿脉', 'Magnetite Vein', 'Месторождение магнетита'),
 'native_gold': ('自然金矿脉', 'Native Gold Vein', 'Месторождение самородного золота'),
 'native_silver': ('自然银矿脉', 'Native Silver Vein', 'Месторождение самородного серебра'),
 'gems': ('稀有宝石矿脉', 'Rare Gem Vein', 'Месторождение редких самоцветов'),
 'chromite': ('铬铁矿脉', 'Chromite Vein', 'Месторождение хромита'),
 'bauxite': ('铝土矿脉', 'Bauxite Vein', 'Месторождение боксита'),
 'galena': ('方铅矿脉', 'Galena Vein', 'Месторождение галенита'),
 'uraninite': ('晶质铀矿脉', 'Uraninite Vein', 'Месторождение уранинита'),
 'titanium': ('钛矿脉', 'Titanium Ore Vein', 'Месторождение титановой руды'),
 'ancient_debris': ('远古残骸矿脉', 'Ancient Debris Vein', 'Месторождение древних обломков'),
 'quartz': ('石英矿脉', 'Nether Quartz Vein', 'Месторождение незер-кварца'),
}
cpairs = []
for vid, (zh, en, ru) in VEINS.items():
    if vid in ('ancient_debris', 'quartz'):
        cpairs.append(("vein(Text.of('%s')" % zh, "vein(%s('vein.kubejs.%s', '%s')" % (T, vid, en)))
    else:
        cpairs.append(("['%s'," % vid, "['%s'," % vid))  # sanity: id present once
        cpairs.append(("'%s'," % zh, "'%s'," % en))
cpairs.append(("vein(Text.of(name), icon)", "vein(" + T + "(`vein.kubejs.${id}`, name), icon)"))
patch(SS + 'recipes/create/create.js', cpairs)

patch(SS + 'event/lectern_controller_guard.js', [
    ("player.tell(Text.yellow('这台讲台里夹着无线红石遥控器，它无法这样使用。'))",
     "player.tell(Text.yellow(" + T + "('message.kubejs.lectern.has_controller', 'This lectern holds a Linked Controller, it can\\'t be used this way.')))"),
    ("player.tell(Text.gray('把讲台挖掉即可取回遥控器；遥控器可以固定在原版讲台上遥控，手持也能直接操控。'))",
     "player.tell(Text.gray(" + T + "('message.kubejs.lectern.take_back', 'Break the lectern to get the controller back. The controller works on a vanilla lectern or held in hand.')))"),
    ("player.tell(Text.yellow('无线红石遥控器无法固定在群峦讲台上。'))",
     "player.tell(Text.yellow(" + T + "('message.kubejs.lectern.not_tfc', 'A Linked Controller can\\'t be placed on a TFC lectern.')))"),
    ("player.tell(Text.gray('遥控器可以固定在原版讲台上遥控，手持也能直接操控。'))",
     "player.tell(Text.gray(" + T + "('message.kubejs.lectern.hint', 'The controller works on a vanilla lectern or held in hand.')))"),
])

patch(SS + 'event/nether.js', [
    ("player.setStatusMessage(Text.of('无法使用此物品右键黑曜石！ You cannot use this on obsidian!').red());",
     "player.setStatusMessage(" + T + "('message.kubejs.obsidian', 'You cannot use this on obsidian!').red());"),
])

patch(SS + 'event/start.js', [
    ('player.tell(Text.of("欢迎游玩《群峦：重生(TerraFirma: Rebirth)》！"))\n        player.tell(Text.of("Welcome to TerraFirma: Rebirth!"))',
     'player.tell(' + T + '("message.kubejs.welcome.0", "Welcome to TerraFirma: Rebirth!"))'),
    ('player.tell(Text.of("本整合包是以1.21.1的群峦传说为主题的轻量魔改整合包。"))\n        player.tell(Text.of("A lightly-modded modpack built around TerraFirmaCraft on 1.21.1."))',
     'player.tell(' + T + '("message.kubejs.welcome.1", "A lightly-modded modpack built around TerraFirmaCraft on 1.21.1."))'),
    ('player.tell(Text.of("当前为群峦重生2 · 1.0.0-release正式版本，已趋于稳定，推荐长期生存游玩，如遇bug烦请联系制作组。"))\n        player.tell(Text.of("This is TerraFirma Rebirth 2 · 1.0.0-release — stable and ready for long-term survival. Please report any bugs to the dev team."))',
     'player.tell(' + T + '("message.kubejs.welcome.2", "This is TerraFirma Rebirth 2 · 1.0.0-release — stable and ready for long-term survival. Please report any bugs to the dev team."))'),
    ('player.tell(Text.gold("——————— 鸣谢 Credits ———————"))',
     'player.tell(Text.gold(' + T + '("message.kubejs.credits.title", "——————— Credits ———————")))'),
    ('player.tell(Text.of("代码开发支持 Code: 心知 XinZhi (Bilibili), Coin0804 (CurseForge)"))',
     'player.tell(' + T + '("message.kubejs.credits.code", "Code: %s", "XinZhi (Bilibili), Coin0804 (CurseForge)"))'),
    ('player.tell(Text.of("宝贵修改意见 Feedback: zombie_boy"))',
     'player.tell(' + T + '("message.kubejs.credits.feedback", "Feedback: %s", "zombie_boy"))'),
    ('player.tell(Text.of("测试者名单 Testers: shiro, 墨乘风-, Lincoln, EchoesTFM, mingyue2024"))',
     'player.tell(' + T + '("message.kubejs.credits.testers", "Testers: %s", "shiro, 墨乘风-, Lincoln, EchoesTFM, mingyue2024"))'),
    ('player.tell(Text.of("特别鸣谢 Special Thanks: 猪人喜欢朋友"))',
     'player.tell(' + T + '("message.kubejs.credits.thanks", "Special Thanks: %s", "猪人喜欢朋友"))'),
])

patch(SS + 'event/sable_gravity_guard.js', [
    ("console.info('[重力拦截] 已取消在物理结构上放置: '", "console.info('[Gravity guard] cancelled placing on a physics structure: '"),
    ("console.error('[重力拦截] 出错: ' + err)", "console.error('[Gravity guard] error: ' + err)"),
])
patch(SS + 'event/worldborder.js', [
    ("console.info('[TFCR] 检测到默认世界边界，已设置为 ±42000（原版边界，仅首次生效）')",
     "console.info('[TFCR] default world border detected, set to ±42000 (vanilla border, first run only)')"),
])

patch('kubejs/client_scripts/tooltip.js', [
    ('Text.of("破坏不掉落内部物品 / Does not drop its contents when broken")',
     T + '("tooltip.kubejs.crate", "Does not drop its contents when broken")'),
    ('Text.of("右键打开，抽取一个种子。 / Right-click to open and draw a seed.")',
     T + '("tooltip.kubejs.seed.0", "Right-click to open and draw a seed.")'),
    ('Text.of("奖励列表 / Rewards:")', T + '("tooltip.kubejs.seed.1", "Rewards:")'),
    ('Text.of("10%：胡萝卜种子，马铃薯种子，西红柿种子，竹子，纸莎草种子 / 10%: carrot, potato, tomato seeds; bamboo; papyrus seeds")',
     T + '("tooltip.kubejs.seed.2", "10%%: carrot, potato, tomato seeds; bamboo; papyrus seeds")'),
    ('Text.of("5%：黄麻种子，卷心菜种子，洋葱种子，大蒜种子，水稻种子，橄榄树，红苹果树，工业大麻种子，蔓越莓灌木，棉花种子 / 5%: jute, cabbage, onion, garlic, rice seeds; olive & red apple trees; hemp seeds; cranberry bush; cotton seeds")',
     T + '("tooltip.kubejs.seed.3", "5%%: jute, cabbage, onion, garlic, rice seeds; olive & red apple trees; hemp seeds; cranberry bush; cotton seeds")'),
    ('Text.gray(Text.of("通过击杀山羊获得 / Obtained by hunting goats"))' if False else 'Text.gray("通过击杀山羊获得 / Obtained by hunting goats")',
     'Text.gray(' + T + '("tooltip.kubejs.goat_fur", "Obtained by hunting goats"))'),
])

EN = {
 'message.kubejs.cleaner.name': '[Item Cleaner] ',
 'message.kubejs.cleaner.warning': 'Dropped items will be cleared in %s seconds — pick up anything important!',
 'message.kubejs.cleaner.done': 'Cleared %s dropped items.',
 'message.kubejs.engine.full': 'The fuel tank is already full',
 'message.kubejs.engine.no_space': 'Not enough tank space for this bucket (%s mB short)',
 'message.kubejs.engine.added': 'Fuel added: %s mB',
 'message.kubejs.engine.added_ignited': 'Fuel added: %s mB — engine ignited!',
 'message.kubejs.lectern.has_controller': "This lectern holds a Linked Controller, it can't be used this way.",
 'message.kubejs.lectern.take_back': 'Break the lectern to get the controller back. The controller works on a vanilla lectern or held in hand.',
 'message.kubejs.lectern.not_tfc': "A Linked Controller can't be placed on a TFC lectern.",
 'message.kubejs.lectern.hint': 'The controller works on a vanilla lectern or held in hand.',
 'message.kubejs.obsidian': 'You cannot use this on obsidian!',
 'message.kubejs.welcome.0': 'Welcome to TerraFirma: Rebirth!',
 'message.kubejs.welcome.1': 'A lightly-modded modpack built around TerraFirmaCraft on 1.21.1.',
 'message.kubejs.welcome.2': 'This is TerraFirma Rebirth 2 · 1.0.0-release — stable and ready for long-term survival. Please report any bugs to the dev team.',
 'message.kubejs.credits.title': '——————— Credits ———————',
 'message.kubejs.credits.code': 'Code: %s',
 'message.kubejs.credits.feedback': 'Feedback: %s',
 'message.kubejs.credits.testers': 'Testers: %s',
 'message.kubejs.credits.thanks': 'Special Thanks: %s',
 'tooltip.kubejs.crate': 'Does not drop its contents when broken',
 'tooltip.kubejs.seed.0': 'Right-click to open and draw a seed.',
 'tooltip.kubejs.seed.1': 'Rewards:',
 'tooltip.kubejs.seed.2': '10%: carrot, potato, tomato seeds; bamboo; papyrus seeds',
 'tooltip.kubejs.seed.3': '5%: jute, cabbage, onion, garlic, rice seeds; olive & red apple trees; hemp seeds; cranberry bush; cotton seeds',
 'tooltip.kubejs.goat_fur': 'Obtained by hunting goats',
}
RU = {
 'message.kubejs.cleaner.name': '[Уборщик] ',
 'message.kubejs.cleaner.warning': 'Через %s с выброшенные предметы будут убраны — подберите всё важное!',
 'message.kubejs.cleaner.done': 'Убрано выброшенных предметов: %s.',
 'message.kubejs.engine.full': 'Топливный бак уже полон',
 'message.kubejs.engine.no_space': 'В баке не хватает места на это ведро (не хватает %s мБ)',
 'message.kubejs.engine.added': 'Залито топлива: %s мБ',
 'message.kubejs.engine.added_ignited': 'Залито топлива: %s мБ — двигатель запущен!',
 'message.kubejs.lectern.has_controller': 'В этой кафедре лежит контроллер частот — так им пользоваться нельзя.',
 'message.kubejs.lectern.take_back': 'Сломайте кафедру, чтобы забрать контроллер. Контроллер работает на ванильной кафедре или в руке.',
 'message.kubejs.lectern.not_tfc': 'Контроллер частот нельзя закрепить на кафедре TFC.',
 'message.kubejs.lectern.hint': 'Контроллер работает на ванильной кафедре или в руке.',
 'message.kubejs.obsidian': 'Этим предметом нельзя пользоваться на обсидиане!',
 'message.kubejs.welcome.0': 'Добро пожаловать в TerraFirma: Rebirth!',
 'message.kubejs.welcome.1': 'Лёгкая сборка вокруг TerraFirmaCraft на 1.21.1.',
 'message.kubejs.welcome.2': 'Это TerraFirma Rebirth 2 · 1.0.0-release — стабильная версия для долгого выживания. Об ошибках сообщайте авторам сборки.',
 'message.kubejs.credits.title': '——————— Благодарности ———————',
 'message.kubejs.credits.code': 'Код: %s',
 'message.kubejs.credits.feedback': 'Ценные советы: %s',
 'message.kubejs.credits.testers': 'Тестеры: %s',
 'message.kubejs.credits.thanks': 'Особая благодарность: %s',
 'tooltip.kubejs.crate': 'При разрушении содержимое не выпадает',
 'tooltip.kubejs.seed.0': 'ПКМ — открыть и вытянуть случайное семя.',
 'tooltip.kubejs.seed.1': 'Награды:',
 'tooltip.kubejs.seed.2': '10%: семена моркови, картофеля, томатов; бамбук; семена папируса',
 'tooltip.kubejs.seed.3': '5%: семена джута, капусты, лука, чеснока, риса; оливковое и красное яблоневое дерево; семена конопли; куст клюквы; семена хлопка',
 'tooltip.kubejs.goat_fur': 'Добывается охотой на коз',
}
for vid, (zh, en, ru) in VEINS.items():
    EN['vein.kubejs.' + vid] = en; RU['vein.kubejs.' + vid] = ru
for name, add in (('en_us', EN), ('ru_ru', RU)):
    p = os.path.join(W, 'kubejs/assets/kubejs/lang/%s.json' % name)
    d = json.load(open(p, encoding='utf-8'))
    d.update(add)
    open(p, 'w', encoding='utf-8').write(json.dumps(d, ensure_ascii=False, indent=2) + '\n')
print('ok', len(EN))
