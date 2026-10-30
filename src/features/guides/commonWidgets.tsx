import { lazy, Suspense } from 'react';
import type { GuideKit } from './GuideBody';
import { RecipeEmbed } from './RecipeEmbed';

// Разбор NBT и просмотр схемы — своим чанком: нужен только статьям со схемой
const SchematicEmbed = lazy(() => import('./SchematicEmbed'));

const num = (v: unknown) => (typeof v === 'number' ? v : undefined);

/** Виджеты всех разделов гайдов: рецепт и схема из библиотеки. Свои виджеты раздела — в его kit. */
export const COMMON_WIDGETS: GuideKit['widgets'] = {
  craft: {
    doc: 'сетка крафта из каталога рецептов: recipe=<id рецепта> (кнопка «Рецепт…» над текстом подберёт id)',
    render: ({ params }) => <RecipeEmbed id={String(params.recipe ?? params.id ?? '')} />,
  },
  schematic: {
    doc: 'схема из библиотеки по слоям, с заменами и формой карточки: id=<id карточки> ver=<когда вставили> [layer=N — начальный слой] [materials — список материалов] (кнопка «Схема…» над текстом)',
    render: ({ params }) => (
      <Suspense fallback={<div className="empty">Загружаю схему…</div>}>
        <SchematicEmbed
          id={String(params.id ?? '')}
          ver={num(params.ver)}
          layer={num(params.layer)}
          withMaterials={Boolean(params.materials)}
        />
      </Suspense>
    ),
  },
};

/** Виджеты статьи: общие + раздела (у раздела можно переопределить общий) */
export const widgetsOf = (kit: GuideKit) => ({ ...COMMON_WIDGETS, ...kit.widgets });
