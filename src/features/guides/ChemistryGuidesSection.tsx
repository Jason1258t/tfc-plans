import { BASE_DOCS, BASE_VALUES } from '@/lib/guideScope';
import type { GuideKit } from './GuideBody';
import { GuidesSection } from './GuidesSection';

/** Своих имён и виджетов у раздела нет — только общие функции формул */
const KIT: GuideKit = { scope: { values: BASE_VALUES, docs: BASE_DOCS }, widgets: {} };

/** Справочник → «Все гайды» → «Химия»: цепочки Destroy и аддонов сборки. Отдельный чанк (lazy в GuidesTab). */
export default function ChemistryGuidesSection({
  guide,
  onGuide,
}: {
  guide: string | null;
  onGuide: (id: string | null) => void;
}) {
  return (
    <GuidesSection
      section="chemistry"
      kit={KIT}
      guide={guide}
      onGuide={onGuide}
      intro="С чего начать химию, как собрать машины и что можно получить: раствор для травления, кислоты, масла, пластики. Начните со статьи «С чего начать»."
    />
  );
}
