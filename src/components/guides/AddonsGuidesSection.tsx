import { BASE_DOCS, BASE_VALUES } from '../../lib/guideScope';
import type { GuideKit } from './GuideBody';
import { GuidesSection } from './GuidesSection';

/** Своих имён и виджетов у раздела нет — только общие функции формул */
const KIT: GuideKit = { scope: { values: BASE_VALUES, docs: BASE_DOCS }, widgets: {} };

/** Справочник → Аддоны → Гайды: как написать свой мод для сборки. Отдельный чанк (lazy в AddonsTab). */
export default function AddonsGuidesSection({
  guide,
  onGuide,
}: {
  guide: string | null;
  onGuide: (id: string | null) => void;
}) {
  return (
    <GuidesSection
      section="addons"
      kit={KIT}
      guide={guide}
      onGuide={onGuide}
      intro="Как написать свой мод (аддон) для сборки с нуля: для тех, кто умеет программировать, но модов ещё не делал."
    />
  );
}
