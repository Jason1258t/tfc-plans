ItemEvents.modifyTooltips(event =>{
    // tfcr tooltip removed - mod not installed
    // event.add("tfcr:blue_steelcan0", Text.of("右键打开,获得8个群峦员工能量棒"))

    event.add("immersiveengineering:crate", Text.translatableWithFallback("tooltip.kubejs.crate", "Does not drop its contents when broken"))

    // KubeJS 1.21 中 addAdvanced 已移除，用静态多行 tooltip 替代
    event.add('tfcr:seed', [
        Text.translatableWithFallback("tooltip.kubejs.seed.0", "Right-click to open and draw a seed."),
        Text.translatableWithFallback("tooltip.kubejs.seed.1", "Rewards:"),
        Text.translatableWithFallback("tooltip.kubejs.seed.2", "10%%: carrot, potato, tomato seeds; bamboo; papyrus seeds"),
        Text.translatableWithFallback("tooltip.kubejs.seed.3", "5%%: jute, cabbage, onion, garlic, rice seeds; olive & red apple trees; hemp seeds; cranberry bush; cotton seeds")
    ])

    event.add("cold_sweat:goat_fur", Text.gray(Text.translatableWithFallback("tooltip.kubejs.goat_fur", "Obtained by hunting goats")))

    // 劣等合金惩罚机制的产物说明：合金窑里那些"XX→未知锭"的配方只在投入劣等锭时触发，JEI 看不出组件条件
    event.add("tfc:metal/ingot/unknown", [
        Text.gold(Text.translate("tooltip.kubejs.unknown_ingot.0")),
        Text.gray(Text.translate("tooltip.kubejs.unknown_ingot.1"))
    ])
})
