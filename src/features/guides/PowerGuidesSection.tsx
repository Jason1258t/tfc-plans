import { useMemo } from 'react';
import { PUMP_IMPACT_KEY, useSettings, type PowerData, type Setting } from '@/lib/power';
import { powerScope } from '@/lib/powerGuideScope';
import { IeLoadPicker } from '@/features/reference-tabs';
import type { GuideKit } from './GuideBody';
import { GuidesSection } from './GuidesSection';
import { POWER_WIDGETS } from './powerWidgets';

type Get = (key: string) => Setting | null;

/**
 * Справочник → Гайды → Электричество. Отдельный чанк (lazy в GuidesTab): разборщик формул, YAML и редактор грузятся,
 * только когда открывают гайды.
 */
export default function PowerGuidesSection({
  data,
  ee,
  ie,
  att,
  guide,
  onGuide,
}: {
  data: PowerData;
  ee: Get;
  ie: Get;
  att: Get;
  guide: string | null;
  onGuide: (id: string | null) => void;
}) {
  const create = useSettings(data.create?.file, [{ key: PUMP_IMPACT_KEY, default: data.create?.pumpImpact ?? null }]);
  const rate = ee('wattFeTConversionRate')?.value ?? null;
  // Геттеры настроек новые на каждый показ — ключ из значений, чтобы не пересчитывать статью зря
  const fingerprint = JSON.stringify([
    data.ee?.keys?.map((k) => ee(k.key)?.value),
    data.ie?.keys?.map((k) => ie(k.key)?.value),
    data.att?.keys?.map((k) => att(k.key)?.value),
    create.get(PUMP_IMPACT_KEY)?.value,
  ]);
  const kit = useMemo<GuideKit>(
    () => ({
      scope: powerScope(data, { ee, ie, att, create: create.get }),
      widgets: POWER_WIDGETS,
      pickers: {
        'ie-loads': {
          label: 'из машин IE…',
          render: (onApply) => <IeLoadPicker data={data} ie={ie} att={att} rate={rate} onApply={onApply} />,
        },
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, fingerprint],
  );
  return (
    <GuidesSection
      section="power"
      kit={kit}
      guide={guide}
      onGuide={onGuide}
      intro="Как собрать типовые схемы — со схемами и калькуляторами на формулах из кода модов и настройках сервера."
    />
  );
}
