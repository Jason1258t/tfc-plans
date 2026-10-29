# Текстуры TFC Pyrofuel — задача №135

Дата: 2026-10-29. Встроенный Codex ImageGen, без CLI/API.

## Стиль и ориентиры

Согласованный подход: простые пиксельные формы, небольшая палитра, крупные функциональные
различия, без округлых бликов, мелкого шума и рисованного объёма. Правила закреплены в
`addon-dev/references/item-textures.md`.

Просмотрены и переданы генератору реальные текстуры из снимка сборки через MCP `texture_get`:

- `immersiveengineering:item/material_dust_coke` (IE 12.4.2-194): материал сухой смеси.
- `tfc:item/powder/graphite` (TFC 4.2.9): форма порошков и плотность деталей.
- `create:item/blaze_cake` (Create 6.0.10): сдержанная палитра готового топлива.
- `createdieselgenerators:item/diesel_bucket` (CDG 1.3.8): стандартная форма ведра.

## Подготовка

Выбранные исходники ImageGen сохранены в `sources/`. Пользователь выбрал исходный готовый
брикет с тремя оранжевыми включениями (приложение 2026-10-29); вариант с двумя крупными
включениями отклонён. Перегенерация рисунка не выполнялась.

Готовые предметные PNG — 32×32 RGBA, выбранный готовый брикет — 64×64 RGBA, в
`../src/main/resources/assets/pyrofuel/textures/item/`. Метаданные размеров и границ исходников —
`item-preparation.json`. Ранее уменьшение до 16×16 и фиксированных 5–11 цветов теряло контур,
грани и небольшие включения. Маски в моделях нет: один layer0, родитель item/generated.

Механическая подготовка: границы объекта по альфе ≥128, удаление только пустых полей;
вписать без изменения пропорций в (размер−4)² через Sharp nearest/contain, добавить 2 прозрачных
пикселя с каждой стороны. Альфа 0/255 с порогом 128. Адаптивная палитра до 16 цветов,
без дизеринга (Sharp palette=true, colours=16); затем экспорт PNG в RGBA 8 бит, чтобы
сборщик ресурсов мог его прочитать. У готового брикета 15 цветов, у остальных 15–16.

Жидкости: исходники `sources/*_tile.png` уменьшены без обрезки до 16×16 (`nearest`) и
приведены к палитрам из 4/5 цветов. Подготовленные тайлы — `tiles/`. `gen_assets.py`
собирает из них 8 кадров: still 16×128, flow 32×256; frametime=4, без интерполяции.
Стоячая жидкость мягко смещается по X, текущая — циклически по Y. Рисунки предметов
скрипт проверяет и сохраняет, а не рисует заново; поддерживаются размеры 16/32/64. Дополнительные библиотеки для сборки не нужны.

## Просмотр и ограничения

`preview.png` — все предметы с увеличением без сглаживания. `preview-comparison.png` —
старый и новый варианты, игровой размер и светлый/тёмный фон. `preview-fluids.png` —
тайлы 2×2 и кадры анимаций. Это технические изображения, не снимки клиента Minecraft.
В игре не проверялось. Рецепты и свойства топлива не менялись.
Подготовлено к следующему выпуску; опубликованная версия 1.0.0 не переиздавалась.

## Точные запросы

### pyrocoke_mix

Create ONE native Minecraft inventory PIXEL SPRITE of a dry PYROCOKE MIX powder heap for TFC Pyrofuel, an addon using Create and TerraFirmaCraft. Reference images are actual IE coke dust, TFC graphite powder and Create blaze cake: copy their SIMPLE flat-shaded angular item language, NOT detailed illustration. A low mound of dark charcoal coarse powder, three broad stepped clumps, with just 3 or 4 dull brick-red mineral grains embedded. Short irregular stepped outline, flat base, dark outline, charcoal flat regions with two lighter gray faces and muted red accents. No rounded rocks, sphere shading, bevels, glitter, metallic shine, glow, flames or dense noise. STRICT logical 16x16 pixel sprite enlarged nearest-neighbor for delivery; only about 8-10 flat colours total; each logical pixel a square. Object should occupy 13x9 logical pixels, centered with transparent margin; recognizable as loose powder, not a brick. Near-frontal view as native TFC powders. True transparent background, no cast shadow, floor, labels, text or other objects.

### soaked_pyromass

Create ONE native Minecraft inventory pixel sprite of SOAKED PYROMASS for TFC Pyrofuel. Reference 1 is the dry pyrocoke powder heap, reference 2 is TFC graphite powder. Show the next production stage: a cohesive low angular lump of charcoal powder bound with brown creosote. Broad stepped silhouette, flatter than a rock, 2 or 3 simple connected slab-like clumps, dark brown/burgundy flat front and muted warm brown top face, just TWO dull brick-red grains. It must read as a dense wet mass rather than loose grains, without glossy wet highlights. Keep simple native TFC/Create item language. Logical 16x16 grid enlarged nearest-neighbor, 7-9 flat colours, dark outline, no antialiasing, gradients, bevels, curved lump shading, shine, noise, sparks, glow or flames. Mound fills 13x8 logical pixels, near frontal slight top view. One complete isolated centered item, true transparent background with margin, no text, ground shadow or other objects.

### raw_pyrocoke_briquette

ONE native Minecraft inventory pixel-art sprite: an UNFIRED PYROCOKE BRIQUETTE for TFC Pyrofuel. Match simple TFC/Create reference item language, not detailed illustration. Object is one low PRESSED RECTANGULAR fuel brick, broad straight flat top, straight front and narrow right side, sharp 90 degree corners, seen slightly from above. Dark burgundy-brown charcoal material, 2 parallel straight shallow compression grooves across the flat top, only 2 tiny muted brick-red inclusions. Top one flat medium brown, front one flat darker brown, right one flat shadow colour, clean nearly-black one-pixel outline. STRICT 16x16 logical pixel grid delivered enlarged nearest-neighbor; 8 colours total, sparse simple planes. Shape about 13x9 logical pixels. NO round corners, pills, cylinders, beveled edges, shiny highlights, gradients, fine cracks, dense noise, glowing embers or flames. Entire isolated brick centered with true transparent margin, no ground shadow, text, labels or other objects. Reference dry mixture establishes charcoal/red materials; Create blaze cake is only an example of flat native item shading, do NOT draw cake.

### pyrocoke_briquette

Edit the referenced raw pyrocoke briquette into its FINISHED PYROCOKE BRIQUETTE variant for a native Minecraft TFC/Create item sprite. KEEP EXACT same simple rectangular pressed-brick silhouette, straight top grooves, viewing angle and proportions. Change brown material to flat dark charcoal gray (3 shades), change only the few red mineral inclusions into 3 small flat amber-orange inclusions so the finished fuel is distinguishable. Not lava, not burning: no flames, bloom, light cast, glow aura, shiny edges or all-over orange veins. Remove small noisy surface details, use big simple flat faces and clear dark outline. Logical 16x16 pixel sprite enlarged nearest-neighbor, 7-9 colours total including gray and orange, no antialiasing or gradients. One isolated complete item with transparent background, no text or ground shadow. First reference is the exact raw-briquette silhouette to preserve, second is Create native sprite colour treatment.

### stabilizing_additive

ONE native Minecraft inventory PIXEL SPRITE of MINERAL STABILIZING ADDITIVE powder for TFC Pyrofuel. Reference is TFC powder/graphite: match its modest angular mound silhouette and flat native sprite language, but use warm light limestone/beige mineral colour. One low loose powder heap of 3 stepped clumps, a few larger square pale grains at its foot. Clear dark taupe outline, 3 broad flat beige/tan regions, only 2 lighter cream grain accents. No glass crystals, gemstones, faceted shining rocks, smooth round mound, tiny noisy grains, glitter or glow. Logical 16x16 pixel grid enlarged nearest-neighbor, 6-8 flat colours total, no gradients or antialiasing. Mound about 13x8 logical pixels, simple near-frontal top view. One isolated complete centered item with true transparent background and margin. No bag, container, text, floor or cast shadow.

### raw_pyrogel_bucket

Edit the reference Create Diesel Generators diesel-bucket sprite into a RAW PYROGEL BUCKET sprite for TFC Pyrofuel. Keep the SAME standard Minecraft bucket silhouette and simple gray rim/sidewalls, same near-frontal angle, same flat pixel-art shading. Replace the yellow diesel contents ONLY with dark brown-burgundy thick liquid, using 3 flat shades and one small subdued clay-red surface patch. Native Minecraft logical 16x16 sprite enlarged nearest-neighbor, hard square pixels, 10-12 colours overall, gray steel rim, dark outline. Do not make a pail with a separate handle, realistic container, glowing potion, curves, decorative bevels, extra sparkles, liquid dripping or splashing. One simple familiar bucket of industrial fluid, transparent background with small margin, entire silhouette visible. No labels, text, floor or cast shadow. The reference is actual mod artwork: match its restrained style, use simple flat material regions and no smooth gradients.

### pyrogel_bucket

Edit reference 1, the RAW PYROGEL BUCKET native Minecraft sprite, to create the FINISHED PYROGEL BUCKET for TFC Pyrofuel. Preserve EXACT bucket silhouette, gray rim and gray sidewalls pixel for pixel in design. Change ONLY the brown-burgundy fluid contents to dark brick-red with 2 broad flat warm orange patches (not yellow). The second reference is Create blaze cake for the restrained red/orange fuel palette. Native 16x16 logical pixel sprite delivered enlarged nearest-neighbor, hard square pixel grid, 10-12 flat colours, same simple standard CDG bucket with no new handle or decoration. NO shine, glow bloom, flames, sparks, liquid splashing, tiny detail, gradients, rounded 3D rendering or antialiasing. One complete centered isolated item, true transparent background and margin. No text, floor or ground shadow.

### raw_pyrogel_tile

Create a SEAMLESS TILEABLE pixel-art FLUID TEXTURE for raw industrial pyrogel in a Minecraft Create/TFC addon. This is a flat surface texture filling the ENTIRE square canvas edge to edge, not an item or scene. Thick dark brown-burgundy liquid, a few broad horizontal stepped patches suggesting slow suspended sediment. Simple native Minecraft fluid language, strict 16x16 logical pixel tile enlarged nearest-neighbor. Only FOUR flat colors: very dark brown #301f21, brown #49302d, muted burgundy #633535, dull rust #7b4235. Large connected flat regions, about 4 to 6 broad patches total, no fine checker noise. Seamless on all four edges. No circular ripples, rounded waves, bubbles, swirls, gloss, sparkles, gradients, outlines around individual pixels, bevels, fire or glow. No transparency: fully opaque. No border, labels, text or perspective. Calm understated industrial suspension, not water or lava.

### pyrogel_tile

Edit the supplied RAW PYROGEL seamless fluid tile into a FINISHED PYROGEL fluid tile for native Minecraft Create/TFC style. Preserve its broad stepped horizontal patches and flat simple geometry. Change palette to FOUR muted brick-red/burgundy colors #391c26 #622733 #8c382e #b64b2d, with at most TWO small flat orange patches #e4772f. It must remain dark industrial fuel with sparse warm inclusions, not bright lava, magma, fire or magical liquid. Strict logical 16x16 pixel tile enlarged nearest-neighbor, no smooth gradients, round ripples, bubbles, gloss, sparkle, fine noise or outlines around each pixel. Fully opaque square surface tile filling entire image edge to edge, seamlessly repeating on all four sides. No border, object, perspective, text, label or surrounding background. Restrained broad colour regions, not detailed illustration.

### pyrocoke_briquette_revision — отклонено пользователем

Edit this finished pyrocoke fuel brick sprite. KEEP the simple rectangular pressed-brick shape, viewing angle, charcoal flat top/front/right planes and two straight top grooves. CHANGE the THREE TINY ORANGE SPECKS into TWO MUCH BROADER simple flat amber-orange rectangular inclusions in the FRONT FACE. Each orange inclusion must occupy about 2 by 2 logical pixels on the intended 16x16 sprite (about one sixth the brick width), so it remains visible after reduction to 16x16. Put one inclusion toward the left end and one toward the right end of the front face. Flat orange #d67824 with no highlight or border. Remove all the other small glowing dots. No shine, light emission, bloom, flames, cracks, fine noise or extra shading. Few large plain grey planes, simple dark outline. This is a native modest Minecraft Create/TFC inventory item sprite, not a detailed pixel-art illustration. Strict 16x16 logical grid enlarged nearest-neighbor, about 7 flat colours. Entire isolated complete brick on true transparent background.
