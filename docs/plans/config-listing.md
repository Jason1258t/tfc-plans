# Папка config/ сервера: что у нас есть

Перечень составлен скриптом по архиву `config.zip` от 2026-10-13 (сервер = ПК хоста). Значения настроек сюда не
выписаны — только имена файлов, число настроек и разделы. В базу сайта из этой папки импортированы только файлы с
пометкой «ИСПОЛЬЗУЕТСЯ» (и три случайных, отмечены); остальное лежит у хоста и подключается по мере надобности:
`npm run serverconfig -- config.zip --only <имя файла>`. Резервные копии `.bak` в перечень не включены.

Всего: 287 файлов и папок верхнего уровня.

## Уже используется сайтом

| Файл | Слой | Что внутри | Для чего может пригодиться |
| --- | --- | --- | --- |
| `tfc_real_world/` | папка | 6 файл(ов), 141 КБ | ИСПОЛЬЗУЕТСЯ (server.toml из serverconfig/): карта мира. Здесь — значения сборки и карты maps/*.png, отличающиеся от карт из jar |
| `tfc-common.toml` | общий | 5 настроек: general, calendar, debug | ИСПОЛЬЗУЕТСЯ: длина месяца по умолчанию (в мире перекрыта командой) |
| `tfc-server.toml` | сервер | 332 настроек: general, blocks, items, mechanics, weird | ИСПОЛЬЗУЕТСЯ: множитель роста культур. Ещё: сроки саженцев и цветения, порча еды, вместимость печей, горение факелов — пометки «на сервере изменено» в справочнике |

## Есть идея, как использовать

| Файл | Слой | Что внутри | Для чего может пригодиться |
| --- | --- | --- | --- |
| `advancedtfctech-server.toml` | сервер | 11 настроек: general, debug | машины Advanced TFC Tech |
| `aeronautics-server.toml` | сервер | 22 настроек: physics, blocks, kinetics | аэронавтика: подъёмная сила, топливо |
| `beneath-server.toml` | сервер | 1 настроек: general | Нижний мир TFC (Beneath) |
| `c2tfc-common.toml` | общий | 1 настроек | Create → TFC: перевод вращения (попал в базу случайно) |
| `chunky/` | папка | 2 файл(ов), 0 КБ | предгенерация мира: области → можно показать на карте, что уже сгенерировано |
| `coldsweat/` | папка | 6 файл(ов), 70 КБ | температура тела: что греет и холодит (блоки, предметы, утепление, биомы) → раздел «Температура» |
| `coldsweat_altitude-server.toml` | сервер | 7 настроек | температура по высоте |
| `computercraft-server.toml` | сервер | 38 настроек: execution, http, peripheral, turtle, term_sizes | ограничения компьютеров |
| `corpse-server.toml` | сервер | 10 настроек: corpse | трупы игроков: время хранения |
| `create_cold_sweat-server.toml` | сервер | 18 настроек: General | Create × Cold Sweat: обогрев механизмами |
| `create-common.toml` | общий | 1 настроек: worldgen | общие настройки Create (мир, генерация) |
| `create-server.toml` | сервер | 155 настроек: infrastructure, recipes, kinetics, fluids, logistics, schematics… | нагрузка и мощность механизмов (SU), лимиты → справочник Create |
| `createdieselgenerators-common.toml` | общий | 4 настроек: Common Config | общие настройки дизелей |
| `createdieselgenerators-server.toml` | сервер | 16 настроек: Server Configs | двигатели и топливо → к «Жидкому топливу» |
| `createoreexcavation-common.toml` | общий | 1 настроек | бурение жил: генерация |
| `createoreexcavation-server.toml` | сервер | 7 настроек | бурение жил → к «Рудам» |
| `cuisinetfc-common.toml` | общий | 4 настроек | Cuisine × TFC (попал в базу случайно) |
| `curios-server.toml` | сервер | 3 настроек: menu | слоты аксессуаров |
| `electroenergetics-server.toml` | сервер | 54 настроек: rotor, Resistances, Ratings, Voltages, trains, simulation | сопротивления устройств, в т.ч. нагревателя → пороги мощности нагревателя; справочник по электрике |
| `emi-accelerator/` | папка | 3 файл(ов), 400 КБ | кеш EMI — не нужно |
| `fancymenu/` | папка | 30 файл(ов), 28202 КБ | оформление главного меню, 28 МБ картинок — не нужно |
| `farmersdelight-common.toml` | общий | 20 настроек: settings, farming, overrides, world, crafting, debug | Farmer’s Delight: настройки готовки |
| `farmerstfc-common.toml` | общий | 4 настроек | Farmer’s Delight × TFC (попал в базу случайно) |
| `firmalife-server.toml` | сервер | 42 настроек: general, foodTraits | теплица, погреб, сыр, ульи → ботаника (теплица), еда |
| `firmalifehardcore-server.toml` | сервер | 20 настроек: server | усложнения Firmalife |
| `ftbquests/` | папка | 45 файл(ов), 1922 КБ | книга квестов: 36 глав, ~750 квестов, русский перевод → раздел «Квесты», привязка к задачам |
| `immersiveengineering-server.toml` | сервер | 152 настроек: wires, machines, ores, tools | мощности и расход машин IE, генераторы → справочник IE, «Жидкое топливо» |
| `immersivepetroleum-server.toml` | сервер | 13 настроек: Extraction, Refining, Generation, Miscellaneous | нефтяные резервуары, качалка → «Жидкое топливо» (снять пометку «не проверено») |
| `jei/` | папка | 13 файл(ов), 21 КБ | JEI: чёрный список (пустой), сортировка — клиент |
| `kaleidoscope_cookery-common.toml` | общий | 9 настроек: cookery | готовка Kaleidoscope |
| `kaleidoscope_tavern-common.toml` | общий | 7 настроек: tavern, vanilla bottle placement | таверна Kaleidoscope |
| `morepropulsion-server.toml` | сервер | 51 настроек: engine, turbofan, turbojet, afterburner, throttle, fuels… | двигатели |
| `neoforge-server.toml` | сервер | 5 настроек | служебное |
| `offroad-server.toml` | сервер | 6 настроек: blocks, kinetics | колёса |
| `precision-prospecting.toml` | — | 12 настроек: prospector-hammer, prospector-drill, mineral-prospector | разведка руд: точность и радиусы → «Руды» |
| `quest_enhance/` | папка | 2 файл(ов), 627 КБ | оформление книги квестов (картинки) — не нужно |
| `railways-server.toml` | сервер | 14 настроек: misc, semaphores, conductors, realism | железные дороги |
| `rocketnautics-server.toml` | сервер | 14 настроек: Thrusters, Jetpack, Space | ракеты: топливо, тяга |
| `sable-server.toml` | сервер | 2 настроек | физика Sable (корабли, дирижабли) |
| `seasonhud-server.toml` | сервер | 4 настроек: Season | показ сезона |
| `selling_bin-server.toml` | сервер | 1 настроек | цены продажи |
| `sophisticatedbackpacks-server.toml` | сервер | 141 настроек: server | рюкзаки: размеры, улучшения |
| `starterkit/` | папка | 13 файл(ов), 4 КБ | стартовые наборы → страница «с чем начинаешь» |
| `submarine_hull.json` | — | 1076 КБ | корпуса подлодок Create Submarine (1 МБ) — возможно, к схемам |
| `tfc_alloy_ext-server.toml` | сервер | 3 настроек: crucible, alloy | дополнительные сплавы → «Металлы» |
| `tfc_eratosthenes-common.toml` | общий | 3 настроек | проекция карты (серверная версия уже импортирована) |
| `tfc_ie_addon-server.toml` | сервер | 4 настроек: crucibleExternalHeater, misc | нагрев тигля внешним нагревателем IE (FE/тик, температура) → задача про нагреватели |
| `tfcambiental-common.toml` | общий | 10 настроек | температура тела (TFC Ambiental) |
| `tfcastikorcarts-common.toml` | общий | 15 настроек: general, cartInventories | повозки: вместимость, скорость |
| `tfccanes-server.toml` | сервер | 1 настроек | трости |
| `tfcsuperhammer-common.toml` | общий | 2 настроек | супер-молот |
| `tfctrough-common.toml` | общий | 23 настроек: poop, troughs | кормушки для животных |
| `tracks-server.toml` | сервер | 2 настроек: server | гусеницы |
| `waterflasks-common.toml` | общий | 5 настроек | фляги: объём |
| `weight/` | папка | 2 файл(ов), 1 КБ | веса предметов по спискам |
| `weight-server.toml` | сервер | 22 настроек | вес инвентаря → вес в карточке предмета |
| `woodencog-common.toml` | общий | 86 настроек: woodencog | температуры горелки Create в °C, таблица плотности и теплоёмкости материалов → вкладка «Металлы», нагрев в чаше |
| `worldborder.json5` | — | 2 КБ | граница мира → можно показать на карте |
| `xaero/` | папка | 15 файл(ов), 17 КБ | карта Xaero — клиент |

## Не импортировать

| Файл | Слой | Что внутри | Для чего может пригодиться |
| --- | --- | --- | --- |
| `CSC/` | папка | 29 файл(ов), 485 КБ | античит/проверка клиента: ключи, похожие на секреты — НЕ ИМПОРТИРОВАТЬ |
| `jmsharedmaps/` | папка | 5 файл(ов), 10556 КБ | общие карты JourneyMap: списки серверов с адресами — НЕ ИМПОРТИРОВАТЬ |
| `net_music_login_need.toml` | — | 1 настроек | поле cookie — НЕ ИМПОРТИРОВАТЬ |
| `voicechat/` | папка | 6 файл(ов), 8 КБ | голосовой чат — НЕ ИМПОРТИРОВАТЬ (сетевые настройки) |

## Остальные конфиги сервера и общие (применение пока не придумано)

| Файл | Слой | Что внутри | Для чего может пригодиться |
| --- | --- | --- | --- |
| `aeronautics_utility_objects-server.toml` | сервер | 45 настроек: damping_stress_bearing, hydraulic_rod, hydraulic_regulator, universal_joint |  |
| `aeroworks-common.toml` | общий | 11 настроек: gyroscope, mechanical_servo, stepper_servo, console |  |
| `alltheleaks.json` | — | 1 КБ |  |
| `astikorcartsredux-common.toml` | общий | 24 настроек: carts |  |
| `asyncparticles/` | папка | 2 файл(ов), 3 КБ |  |
| `barrels_2012-server.toml` | сервер | 4 настроек: general |  |
| `byepregen.toml` | — | 13 настроек: debug, worldgen, server, chunk-saving, lighting |  |
| `c2me.toml` | — | 33 настроек: fixes, vanillaWorldGenOptimizations, chunkSystem, generalOptimizations, noTickViewDistance, clientSideConfig… |  |
| `carryon-common.toml` | общий | 33 настроек: settings, whitelist, blacklist, customPickupConditions |  |
| `cccbridge/` | папка | 1 файл(ов), 0 КБ |  |
| `chat_heads.json5` | — | 1 КБ |  |
| `chatanimation.json` | — | 1 КБ |  |
| `climbable_ropes-server.toml` | сервер | 17 настроек: climbing, sliding, features, advanced |  |
| `collective.json5` | — | 1 КБ |  |
| `connector.json` | — | 1 КБ |  |
| `contact/` | папка | 4 файл(ов), 2 КБ |  |
| `copycats-common.toml` | общий | 50 настроек: features, feature_categories |  |
| `copycats-server.toml` | сервер | 3 настроек: stressValues |  |
| `CoroUtil/` | папка | 1 файл(ов), 0 КБ |  |
| `corpsecurioscompat-common.toml` | общий | 2 настроек: general |  |
| `create_aeronautics_automated_logistics-common.toml` | общий | 36 настроек: recording, playback, docking, limits, permissions, debug… |  |
| `create_aeronautics_throwable_rope_connector-common.toml` | общий | 10 настроек: throwing, launcher, mounted, general, visual |  |
| `create_compact_transmission-common.toml` | общий | 3 настроек |  |
| `create_connected-common.toml` | общий | 42 настроек: features, feature_categories |  |
| `create_connected-server.toml` | сервер | 25 настроек: stressValues |  |
| `create_flight_control-server.toml` | сервер | 13 настроек: sonicBoomTrigger, sonicBoomCloud, sonicBoomSound |  |
| `create_lnl-server.toml` | сервер | 2 настроек: kinetics |  |
| `create_pickywheels_tfc_wind-server.toml` | сервер | 4 настроек: windmills |  |
| `create_submarine-common.toml` | общий | 18 настроек: gameplay, hullStrength, mechanics, experimental, client |  |
| `createentitycontrol-common.toml` | общий | 24 настроек: blocks_limit |  |
| `createfastschematiccannon-common.toml` | общий | 6 настроек |  |
| `createpickywheels-common.toml` | общий | 25 настроек: waterwheels, windmills |  |
| `creativecore.json` | — | 1 КБ |  |
| `cuisinedelight-server.toml` | сервер | 6 настроек |  |
| `curios-common.toml` | общий | 1 настроек |  |
| `dndecor-server.toml` | сервер | 113 настроек: kinetics |  |
| `drivebywire-common.toml` | общий | 1 настроек |  |
| `dynamic_fps.json` | — | 1 КБ |  |
| `e33chat/` | папка | 1 файл(ов), 6 КБ |  |
| `e33chat-server.toml` | сервер | 7 настроек |  |
| `emi.css` | — | 10 КБ |  |
| `enchdesc.json` | — | 2 КБ |  |
| `entityculling.json` | — | 2 КБ |  |
| `euphoria_patcher/` | папка | 2 файл(ов), 3 КБ |  |
| `fabric/` | папка | 1 файл(ов), 0 КБ |  |
| `ferritecore-mixin.toml` | — | 12 настроек |  |
| `flowing_fluids.json` | — | 2 КБ |  |
| `fml.toml` | — | 14 настроек: dependencyOverrides |  |
| `ftbbackups3-server.snbt` | сервер | 3 КБ |  |
| `ftbchunks-world.snbt` | — | 9 КБ |  |
| `ftbteams-server.snbt` | сервер | 1 КБ |  |
| `ftbxmodcompat.snbt` | — | 1 КБ |  |
| `functionalstorage/` | папка | 2 файл(ов), 2 КБ |  |
| `global_packs.toml` | — | 8 настроек: resourcepacks, datapacks |  |
| `imblocker.json` | — | 1 КБ |  |
| `immediatelyfast.json` | — | 1 КБ |  |
| `immersive_aircraft.json` | — | 1 КБ |  |
| `immersiveengineering-startup.toml` | запуск | 7 настроек: debug, compat |  |
| `iris-excluded.json` | — | 1 КБ |  |
| `iris.properties` | — | 1 КБ |  |
| `ixeris.toml` | — | 16 настроек: bufferedRawInput |  |
| `jade/` | папка | 5 файл(ов), 13 КБ |  |
| `jammies-common.toml` | общий | 1 настроек: Jammies Config |  |
| `jecharacters-extra.json` | — | 1 КБ |  |
| `jei-server.toml` | сервер | 3 настроек: cheat mode |  |
| `jmsharedmaps-common.toml` | общий | 3 настроек |  |
| `jmsharedmaps-server.toml` | сервер | 2 настроек |  |
| `journeymap-server.toml` | сервер | 2 настроек: admins |  |
| `jupiter.json` | — | 1 КБ |  |
| `kaleidoscopetfctavern-common.toml` | общий | 2 настроек: growth |  |
| `kiwi-common.yaml` | общий | 1 КБ |  |
| `konkrete/` | папка | 4 файл(ов), 1 КБ |  |
| `krypton_fnp.yaml` | — | 1 КБ |  |
| `ktfcc-common.toml` | общий | 5 настроек |  |
| `l2configs/` | папка | 1 файл(ов), 0 КБ |  |
| `lambdynlights.toml` | — | 852 настроек: light_sources, debug, adaptive_ticking |  |
| `ldfix-common.toml` | общий | 5 настроек: aerodynamics |  |
| `lightspeed-common.toml` | общий | 8 настроек: startup, compatibility |  |
| `lithium.properties` | — | 1 КБ |  |
| `maplink/` | папка | 5 файл(ов), 3 КБ |  |
| `modernfix-common.toml` | общий | 1 настроек |  |
| `modernfix-mixins.properties` | — | 5 КБ |  |
| `ModernUI/` | папка | 4 файл(ов), 16 КБ |  |
| `moonlight-common.toml` | общий | 4 настроек: general |  |
| `morered-server.toml` | сервер | 1 настроек: General Settings |  |
| `MouseTweaks.cfg` | — | 1 КБ |  |
| `neoforge-common.toml` | общий | 3 настроек |  |
| `net_music_list.toml` | — | 18 настроек |  |
| `netmusic-common.toml` | общий | 14 настроек: general, sophisticated_backpacks |  |
| `NoChatReports/` | папка | 5 файл(ов), 1 КБ |  |
| `nowheel.json` | — | 1 КБ |  |
| `oei/` | папка | 1 файл(ов), 0 КБ |  |
| `oelib/` | папка | 2 файл(ов), 1 КБ |  |
| `opticore.json` | — | 1 КБ |  |
| `packetfixer.properties` | — | 1 КБ |  |
| `playerrevive.json` | — | 2 КБ |  |
| `railways-common.toml` | общий | 2 настроек |  |
| `randomoptimization-common.toml` | общий | 5 настроек |  |
| `rocketnautics_ships/` | папка | 0 файл(ов), 0 КБ |  |
| `RuOK.toml` | — | 54 настроек |  |
| `sable_fix_mod-common.toml` | общий | 5 настроек: duplicationFixes, compatibility |  |
| `sable_schematic_api-server.toml` | сервер | 14 настроек: camera, manuscript, filmPrinter, projector, honeyWelder |  |
| `sable-common.toml` | общий | 14 настроек |  |
| `sable-schematic-api-film-printer.toml` | — | 1 настроек: filmPrinter |  |
| `sable-schematic-api-honey-welder.toml` | — | 2 настроек: honeyWelder |  |
| `sable-schematic-api-projector.toml` | — | 7 настроек: projector |  |
| `sablecollisiondamage-common.toml` | общий | 12 настроек |  |
| `sablecollisiondamage.toml` | — | 12 настроек |  |
| `sablefloaters-common.toml` | общий | 4 настроек |  |
| `scalablelux.properties` | — | 1 КБ |  |
| `simulated-server.toml` | сервер | 58 настроек: kinetics, assembly, physics, blocks, equipment |  |
| `simulatedcoasters-common.toml` | общий | 4 настроек |  |
| `simurail-server.toml` | сервер | 43 настроек: blocks, physics, compat |  |
| `skinlayers.json` | — | 1 КБ |  |
| `sodium-extra-options.json` | — | 2 КБ |  |
| `sodium-extra.properties` | — | 1 КБ |  |
| `sodium-fingerprint.json` | — | 1 КБ |  |
| `sodium-mixins.properties` | — | 1 КБ |  |
| `sodium-options.json` | — | 1 КБ |  |
| `sophisticatedbackpacks-common.toml` | общий | 1 настроек: common |  |
| `sophisticatedcore-common.toml` | общий | 1 настроек: common |  |
| `sound_physics_remastered/` | папка | 4 файл(ов), 116 КБ |  |
| `spark/` | папка | 4 файл(ов), 2 КБ |  |
| `ssrd-common.toml` | общий | 1 настроек |  |
| `starcatcher-server.toml` | сервер | 24 настроек |  |
| `starterkit.json5` | — | 1 КБ |  |
| `survivorsabilities-common.toml` | общий | 1 настроек |  |
| `terrablender.toml` | — | 12 настроек: general, end |  |
| `tfc_aeronautics-common.toml` | общий | 11 настроек |  |
| `tfcrf-common.toml` | общий | 1 настроек |  |
| `tfcsbu-common.toml` | общий | 5 настроек |  |
| `tfcvolcanoes-startup.toml` | запуск | 53 настроек: General |  |
| `tipsmod.json` | — | 1 КБ |  |
| `titanium/` | папка | 2 файл(ов), 1 КБ |  |
| `towed-server.toml` | сервер | 1 настроек: server |  |
| `transition.json` | — | 1 КБ |  |
| `travelerstitles-neoforge-1_21.toml` | — | 49 настроек: Traveler's Titles |  |
| `trender.json` | — | 1 КБ |  |
| `varitem_config/` | папка | 1 файл(ов), 0 КБ |  |
| `voxy-config.json` | — | 1 КБ |  |
| `vss-server-config.json` | сервер | 2 КБ |  |
| `wabbanodecompanion/` | папка | 1 файл(ов), 0 КБ |  |
| `warypredators-common.toml` | общий | 66 настроек: predators, rammers, defenders |  |
| `waterworks-server.toml` | сервер | 49 настроек: physicsApi |  |
| `watut-common.toml` | общий | 2 настроек: general |  |
| `watut-item-arm-adjustments.json` | — | 3 КБ |  |
| `watut-server.toml` | сервер | 21 настроек: general |  |
| `xaerohud.txt` | — | 1 КБ |  |
| `xaeropatreon.txt` | — | 1 КБ |  |

## Клиентские (серверу и сайту не нужны)

`acceleratedrendering-client.toml`, `advancedtfctech-client.toml`, `aero_cam_sync-client.toml`, `aeroworks-client.toml`, `ambience_mini-client.toml`, `apple_crates_client.toml`, `astikorcartsredux-client.toml`, `better-advanced-tooltips-client.toml`, `betteradvancements-client.toml`, `blockrunner-client.toml`, `carryon-client.toml`, `catalyst-client.toml`, `climbable_ropes-client.toml`, `colorwheel-client.toml`, `computercraft-client.toml`, `copycats-client.toml`, `create_aeronautics_automated_logistics-client.toml`, `create_submarine_client_state.json`, `create-client.toml`, `createdieselgenerators-client.toml`, `creativecore-client.json`, `cuisinedelight-client.toml`, `curios-client.toml`, `dashpanels-client.toml`, `electroenergetics-client.toml`, `fancytabsections-client.toml`, `farmersdelight-client.toml`, `flywheel-client.toml`, `ftbbackups3-client.snbt`, `ftbchunks-client.snbt`, `ftblibrary-client.snbt`, `ftbquests-client.snbt`, `immersiveengineering-client.toml`, `immersivepetroleum-client.toml`, `jammies-client.toml`, `jecharacters-client.toml`, `jmi-client.toml`, `journeymaptfcintegration-client.toml`, `kaleidoscope_cookery-client.toml`, `kiwi-client.yaml`, `ldlib2-client.toml`, `libtooltips-client.toml`, `liubai-client.toml`, `moonlight-client.toml`, `morered-client.toml`, `neoforge-client.toml`, `patchouli-client.toml`, `playerrevive-client.json`, `ponder-client.toml`, `quest_enhance-client.toml`, `railways-client.toml`, `rocketnautics-client.toml`, `sable-client.toml`, `sablecleanup-client.toml`, `sablejade-client.toml`, `schematician-client.toml`, `seasonhud-client.toml`, `selling_bin-client.toml`, `simulated-client.toml`, `sodiumdynamiclights-client.toml`, `sophisticatedcore-client.toml`, `starcatcher-client.toml`, `tfc_eratosthenes-client.toml`, `tfc-client.toml`, `tfcagedalcohol-client.toml`, `tfcambiental-client.toml`, `tfcgenviewer-client.toml`, `tfcvolcanoes-client.toml`, `tinymultiblocklib-client.toml`, `vss-client-config.json`, `waterworks-client.toml`, `watut-client.toml`

