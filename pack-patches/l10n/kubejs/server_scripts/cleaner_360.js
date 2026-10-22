// ============================================================
// 群峦星360安全卫士 —— 定时清理掉落物
// 每 2 小时清理一次掉落物，清理前 60s / 30s / 10s / 5s 聊天栏广播提醒
// ============================================================

var GUARD_NAME = Text.translatableWithFallback('message.kubejs.cleaner.name', '[Item Cleaner] ')
var CLEAR_INTERVAL = 144000 // 2小时 = 2 * 60 * 60 * 20 tick
var WARNINGS = [
    [1200, '60'],
    [600, '30'],
    [200, '10'],
    [100, '5']
]
var cleanerTick = 0

// 向全体玩家发送聊天消息（前缀青色加粗 + 正文指定颜色）
function guardTell(server, msg, color) {
    try {
        server.players.forEach(function (p) {
            p.tell(Text.aqua(GUARD_NAME.copy()).bold(true).append(Text[color](msg).bold(false)))
        })
    } catch (err) {
        console.error('[Item Cleaner] broadcast failed: ' + err)
    }
}

ServerEvents.tick(function (event) {
    cleanerTick++
    var pos = cleanerTick % CLEAR_INTERVAL
    var remain = CLEAR_INTERVAL - pos

    // 到点清理：遍历所有维度的掉落物实体，逐一 discard 并计数
    // 注意：level.getEntities() 返回 LevelEntityGetter（不可迭代），必须用 ServerLevel.getAllEntities()
    //（kill 命令的返回值不可靠，会永远显示 0）
    // KJS7(2101.7.x) 正确取法：event.server 即 MinecraftServer，用原生 getAllLevels()
    // （event.server.levels 不存在；Utils.getServer() 也不存在——UtilsWrapper 没这个方法）
    if (pos === 0) {
        var count = 0
        try {
            var ItemEntityClass = Java.loadClass('net.minecraft.world.entity.item.ItemEntity')
            var levelIt = event.server.getAllLevels().iterator()
            while (levelIt.hasNext()) {
                var level = levelIt.next()
                try {
                    var entityIt = level.getAllEntities().iterator()
                    while (entityIt.hasNext()) {
                        var e = entityIt.next()
                        if (e && e instanceof ItemEntityClass && e.isAlive()) {
                            e.discard()
                            count++
                        }
                    }
                } catch (err2) {
                    console.error('[Item Cleaner] failed to clear dimension ' + level.dimension().location() + ': ' + err2)
                }
            }
        } catch (err) {
            console.error('[Item Cleaner] failed to clear dropped items: ' + err)
        }
        guardTell(event.server, Text.translatableWithFallback('message.kubejs.cleaner.done', 'Cleared %s dropped items.', '' + count), 'green')
        console.info('[Item Cleaner] dropped items cleared: ' + count)
        return
    }

    // 倒计时提醒
    for (var i = 0; i < WARNINGS.length; i++) {
        if (remain === WARNINGS[i][0]) {
            guardTell(event.server, Text.translatableWithFallback('message.kubejs.cleaner.warning', 'Dropped items will be cleared in %s seconds — pick up anything important!', WARNINGS[i][1]), 'yellow')
        }
    }
})
