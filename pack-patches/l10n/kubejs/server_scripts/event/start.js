PlayerEvents.loggedIn(event => {
    const {player, server} = event

    // 玩家首次登录
    if(!player.persistentData.logged) {
        player.persistentData.logged = true

        player.tell(Text.aqua("----------------------------------------"))
        player.tell(Text.translatableWithFallback("message.kubejs.welcome.0", "Welcome to TerraFirma: Rebirth!"))
        player.tell(Text.translatableWithFallback("message.kubejs.welcome.1", "A lightly-modded modpack built around TerraFirmaCraft on 1.21.1."))
        player.tell(Text.translatableWithFallback("message.kubejs.welcome.2", "This is TerraFirma Rebirth 2 · 1.0.0-release — stable and ready for long-term survival. Please report any bugs to the dev team."))
        player.tell(Text.aqua("----------------------------------------"))
        // 鸣谢名单
        player.tell(Text.gold(Text.translatableWithFallback("message.kubejs.credits.title", "——————— Credits ———————")))
        player.tell(Text.translatableWithFallback("message.kubejs.credits.code", "Code: %s", "XinZhi (Bilibili), Coin0804 (CurseForge)"))
        player.tell(Text.translatableWithFallback("message.kubejs.credits.feedback", "Feedback: %s", "zombie_boy"))
        player.tell(Text.translatableWithFallback("message.kubejs.credits.testers", "Testers: %s", "shiro, 墨乘风-, Lincoln, EchoesTFM, mingyue2024"))
        player.tell(Text.of("ChiDeXing, 一只小白给a, MPC托马斯_official, 蒋鸽咕咕咕, me107107"))
        player.tell(Text.translatableWithFallback("message.kubejs.credits.thanks", "Special Thanks: %s", "猪人喜欢朋友"))
        player.tell(Text.gold("———————————————————"))

        // 开局给予20分钟恩典
        player.potionEffects.add('cold_sweat:grace', 20*60*20)

        // 新手礼包（原 starterkit 模组发放的内容，模组已删，改由脚本发放）
        player.give('ftbquests:book')
        player.give('patchouli:guide_book[patchouli:book="tfc:field_guide"]')
        player.give('immersiveengineering:manual')
        player.give('cold_sweat:thermometer')
        server.runCommandSilent(`item replace entity ${player.username} armor.chest with sophisticatedbackpacks:backpack[sophisticatedcore:number_of_inventory_slots=27,sophisticatedcore:number_of_upgrade_slots=1]`)
        server.runCommandSilent(`item replace entity ${player.username} armor.legs with tfc_coldsweat:wool_leggings[cold_sweat:armor_insulation={insulation:[]}]`)
    }
})

ServerEvents.loaded(event => {
    event.server.runCommandSilent('gamerule reducedDebugInfo false')
})
