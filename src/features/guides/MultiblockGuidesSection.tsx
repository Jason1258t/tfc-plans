import { BASE_DOCS, BASE_VALUES } from '@/lib/guideScope';
import { MultiblockEmbed } from '@/features/reference-tabs';
import type { GuideKit } from './GuideBody';
import { GuidesSection } from './GuidesSection';
import { CraftingRecipe } from './CraftingRecipe';
import { PumpjackStructure } from './PumpjackStructure';

/** Имена формул — только общие; виджет раздела — структура мультиблока из вкладки «Мультиблоки» */
const KIT: GuideKit = {
  scope: { values: BASE_VALUES, docs: BASE_DOCS },
  widgets: {
    craft: {
      doc: 'сетка крафта с иконками из каталога: recipe=<id рецепта>',
      render: ({ params }) => <CraftingRecipe id={String(params.recipe ?? '')} />,
    },
    pumpjack: {
      doc: 'блочная схема малой и большой качалок CDG по слоям из присланных .nbt',
      render: () => <PumpjackStructure />,
    },
    multiblock: {
      doc: 'структура мультиблока: id=crusher (имя из адреса вкладки «Мультиблоки»); full — целиком, как в книге (экскаватор); materials — с таблицей материалов',
      render: ({ params }) => (
        <MultiblockEmbed
          id={String(params.id ?? '')}
          full={Boolean(params.full)}
          withMaterials={Boolean(params.materials)}
        />
      ),
    },
  },
};

/** Справочник → Гайды → «Мультиблоки»: сборка машин IE и аддонов. Отдельный чанк (lazy в GuidesTab). */
export default function MultiblockGuidesSection({
  guide,
  onGuide,
}: {
  guide: string | null;
  onGuide: (id: string | null) => void;
}) {
  return (
    <GuidesSection
      section="multiblocks"
      kit={KIT}
      guide={guide}
      onGuide={onGuide}
      intro="Как собирать большие машины Immersive Engineering и Advanced TFC Tech и что в них изменено для TFC, а ещё буровая установка Create и поиск жил для неё. Сами структуры IE по слоям — во вкладке «Мультиблоки»."
    />
  );
}
