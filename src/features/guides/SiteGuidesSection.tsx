import { BASE_DOCS, BASE_VALUES } from '@/lib/guideScope';
import type { GuideKit } from './GuideBody';
import { GuidesSection } from './GuidesSection';

/** Своих имён и виджетов у раздела нет — только общие функции формул */
const KIT: GuideKit = { scope: { values: BASE_VALUES, docs: BASE_DOCS }, widgets: {} };

/** Справочник → Гайды → «О сайте»: что умеет сайт и как им пользоваться. Отдельный чанк (lazy в GuidesTab). */
export default function SiteGuidesSection({
  guide,
  onGuide,
}: {
  guide: string | null;
  onGuide: (id: string | null) => void;
}) {
  return (
    <GuidesSection
      section="site"
      kit={KIT}
      guide={guide}
      onGuide={onGuide}
      checks={false}
      intro="Что умеет этот сайт и как им пользоваться: задачи, схемы Create, датапаки, поиск предметов, справочник."
    />
  );
}
