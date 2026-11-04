// Единая система пылей чистых металлов (dev-задача #212). Шаг 1: таблица металлов и перенаправление дублей.
// Основная пыль — destroy_extras:<металл>_dust. Новый металл — одна строка в METAL_DUSTS.
// Дубли (пыли IE и Destroy) перенаправляются на основную пыль, только если их предмет есть в сборке.
// Фильтр {} не покрывает часть рецептов (проверено на стенде), поэтому остальные id перечислены явно.

const METAL_DUSTS = [
    { metal: 'copper', dust: 'destroy_extras:copper_dust', aliases: ['immersiveengineering:dust_copper', 'destroy:copper_powder'] },
    { metal: 'iron', dust: 'destroy_extras:iron_dust', aliases: ['immersiveengineering:dust_iron', 'destroy:iron_powder'] },
    { metal: 'lead', dust: 'destroy_extras:lead_dust', aliases: ['immersiveengineering:dust_lead', 'destroy:lead_powder'] },
    { metal: 'nickel', dust: 'destroy_extras:nickel_dust', aliases: ['immersiveengineering:dust_nickel', 'destroy:nickel_powder'] },
    { metal: 'silver', dust: 'destroy_extras:silver_dust', aliases: ['immersiveengineering:dust_silver'] },
    { metal: 'gold', dust: 'destroy_extras:gold_dust', aliases: ['immersiveengineering:dust_gold'] },
    { metal: 'aluminum', dust: 'destroy_extras:aluminum_dust', aliases: ['immersiveengineering:dust_aluminum'] },
    { metal: 'uranium', dust: 'destroy_extras:uranium_dust', aliases: ['immersiveengineering:dust_uranium'] },
    { metal: 'zinc', dust: 'destroy_extras:zinc_dust', aliases: ['destroy:zinc_powder'] },
    { metal: 'chromium', dust: 'destroy_extras:chromium_dust', aliases: ['destroy:chromium_powder'] },
    { metal: 'tin', dust: 'destroy_extras:tin_dust', aliases: [] },
    { metal: 'bismuth', dust: 'destroy_extras:bismuth_dust', aliases: [] },
]

const LEFTOVER_INPUTS = {
    'destroy:mixing/stainless_steel_default': ['iron', 'nickel', 'chromium'],
    'destroy:mixing/stainless_steel_default_fluxed': ['iron', 'nickel', 'chromium'],
    'destroy:arc_furnace/stainless_steel_efficient': ['iron', 'nickel', 'chromium'],
    'destroy:arc_furnace/stainless_steel_efficient_fluxed': ['iron', 'nickel', 'chromium'],
    'immersiveengineering:crafting/constantan_mix': ['copper', 'nickel'],
    'immersiveengineering:crafting/electrum_mix': ['gold', 'silver'],
    'immersiveengineering:crafting/lead_white': ['lead'],
    'createdieselgenerators:compat/immersiveengineering/herbicide': ['copper'],
    'destroy:mixing/slime_ball': ['copper'],
}

const LEFTOVER_OUTPUTS = {
    'destroy:electrolysis/copper_electrolysis': 'copper',
    'destroy:electrolysis/iron_electrolysis': 'iron',
    'destroy:electrolysis/lead_electrolysis': 'lead',
    'destroy:electrolysis/nickel_electrolysis': 'nickel',
    'destroy:electrolysis/chromium_electrolysis': 'chromium',
    'destroy:electrolysis/zinc_electrolysis': 'zinc',
}

ServerEvents.recipes(event => {
    const byMetal = Object.fromEntries(METAL_DUSTS.map(row => [row.metal, row]))

    METAL_DUSTS.forEach(row => {
        if (!Item.exists(row.dust)) {
            console.warn(`[metal_dusts] основная пыль ${row.dust} не найдена, металл ${row.metal} пропущен`)
            return
        }
        row.aliases.forEach(alias => {
            if (!Item.exists(alias)) return
            event.replaceOutput({}, alias, row.dust)
            event.replaceInput({}, alias, '#c:dusts/' + row.metal)
        })
    })

    Object.entries(LEFTOVER_INPUTS).forEach(([recipeId, metals]) => {
        metals.forEach(metal => {
            const row = byMetal[metal]
            if (!Item.exists(row.dust)) return
            row.aliases.forEach(alias => {
                if (!Item.exists(alias)) return
                event.replaceInput({ id: recipeId }, alias, '#c:dusts/' + metal)
            })
        })
    })

    Object.entries(LEFTOVER_OUTPUTS).forEach(([recipeId, metal]) => {
        const row = byMetal[metal]
        if (!Item.exists(row.dust)) return
        row.aliases.forEach(alias => {
            if (!Item.exists(alias)) return
            event.replaceOutput({ id: recipeId }, alias, row.dust)
        })
    })
})
