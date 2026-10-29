# Прямоугольные кассеты — этап задачи №135

Дата: 2026-10-29. Встроенный Codex ImageGen, без CLI/API.

Ориентир — сам `create_aeronautics_extra:onboard_computer`, его изображение
`../icons/onboard_computer.png` просмотрено и передано генератору. Для генераторной кассеты
дополнительно передан новый рисунок аккумулятора, чтобы сохранить общий корпус.

Уточнение пользователя: простые формы в стиле основного блока. Плоские прямоугольные панели,
графитовый корпус и тонкая латунная рамка. Без округлых машин, сложной передачи изгибов,
декоративных бликов, мелкого шума и лишней детализации. Аккумулятор узнаётся по квадратным
клеммам и индикатору, генератор — по двум прямоугольным медным обмоткам и сердечнику.

## Исходники и подготовка

Исходники ImageGen: `sources/battery_module.png`, `sources/generator_module.png`, 1199×1312 RGBA.
Готовые игровые PNG: `../src/main/resources/assets/create_aeronautics_extra/textures/item/`, 32×32.
У каждого — 12 цветов с прозрачностью. Готовые PNG сохраняются при запуске `gen_assets.py`.

Механическая подготовка: по альфе ≥128 определены границы объекта, удалены пустые поля.
Sharp: вписать в 28×28 без изменения пропорций (`nearest`, `contain`), добавить по 2 прозрачных
пикселя со всех сторон. Альфа 0/255, порог 128. Ближайший цвет палитры, без дизеринга.
Общая палитра: #141719 #1e2124 #33383d #3f454b #7a5418 #a8772a #d0a046.
Аккумулятор дополнительно: #e0473a #445d8b #2f8a4e #7cf09a.
Генератор дополнительно: #b26247 #e3826c #676d70 #969895.

## Запрос: аккумулятор

Create ONE small Minecraft inventory PIXEL SPRITE: a BATTERY CASSETTE that plugs into the onboard computer in the reference image. Reference is the EXACT host block: copy its simple BOX GEOMETRY, dark graphite flat panels, thin brass trim and two square red/blue terminals. The module should look like a spare removable rectangular cassette from the side bays of that block. Design: a single rectangular graphite case, flat dark front panel, narrow brass perimeter rail, two SQUARE red/blue contacts on its top edge, a tiny horizontal green rectangular charge slit. Nearly frontal orthographic view with only a 2-pixel-wide right side and top visible. Absolutely straight edges and right angle corners, no rounded shoulders, curves, cylindrical cells, bulging ribs or angled bevels. Few large simple flat color regions, about 10-12 colors: black outline, 3 dark graphite shades, 2 subdued brass shades, red, blue and muted green. No metal sparkle, specular highlights, gradient shading, worn speckles, noise, small rivets or ornamental details. Volume ONLY from single flat darker right plane, not light effects. Looks like a modest native Create Electro Energetics component, NOT a detailed pixel illustration. STRICT 32x32 logical pixel canvas, enlarged nearest-neighbor, each logical pixel uniform color. Centered complete sprite with rectangular silhouette, object 22 pixels wide and 24 pixels tall, transparent margin. True transparent background, no text, labels, logos, floor or cast shadow. One item only.

## Запрос: генератор

Create ONE Minecraft inventory pixel sprite of a GENERATOR CASSETTE insert for the onboard computer. Reference 1 is the exact host block; reference 2 is its new BATTERY CASSETTE. Create the matching GENERATOR in the SAME SIMPLE rectangular case, near-frontal orthographic view with narrow right face and top. Match reference 2's straight-edged silhouette and slim brass rail, but replace battery terminals and charge slit with a visible rectangular electrical assembly: TWO broad rectangular copper winding packs left and right of ONE vertical flat gray steel core bar, a small square dark socket in the lower middle. The copper packs consist of only 3 broad horizontal flat bands each, all right angles. Top of the cassette is plain dark graphite, NO red/blue terminals. Dark graphite case, thin muted brass perimeter frame as in host computer, restrained copper #b26247 #d67b5b, gray steel. The object must look like a removable functional cartridge, not a machine statue. No cylinder, no rotor wheel, no circular hole, no round shaft, no curved corner, no bulging winding, no bolts, no bevels, no ornate gold border. All major geometry is rectangular, simple planes and right angles. STRICT 32x32 logical pixel canvas enlarged nearest-neighbor, hard clean grid edges, 12-14 flat colors total. Minimal flat shading: one darker side, no gradient, glints, specular highlights, worn texture, noise, tiny decorative pixels or highly detailed illustration. Keep big clear functional shapes. Center complete object 22 pixels wide and 24 pixels tall with transparent margin, same proportions as battery. True transparent background, one item, no text, numbers, logos, scene or cast shadow.

## Просмотр

`preview-modules.png`: бортовой компьютер, предыдущий вариант, новый PNG 32×32,
увеличение ×4, тёмный и светлый фон. Увеличение без сглаживания.
Это проверка рисунка, не снимок клиента Minecraft. В игре не проверялось.
Подготовлено к следующему выпуску; опубликованная версия 1.0.0 не переиздавалась.
