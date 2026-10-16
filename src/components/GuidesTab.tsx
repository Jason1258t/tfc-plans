import { lazy, Suspense } from 'react';
import { usePower, useSettings, type PowerData } from '../lib/power';
import './PowerTab.css';

const PowerGuidesSection = lazy(() => import('./guides/PowerGuidesSection'));

/** Разделы гайдов справочника; гайды аддонов — на странице «Аддоны» */
const SECTIONS = [{ id: 'power', label: 'Электричество' }] as const;

/** Справочник → «Гайды»: типовые схемы со схемами и калькуляторами. Адрес статьи — ?tab=guides&g=<id>. */
export function GuidesTab({ guide, onGuide }: { guide: string | null; onGuide: (id: string | null) => void }) {
  const data = usePower();
  return (
    <div className="botany">
      <nav className="botany-nav" aria-label="Разделы гайдов">
        {SECTIONS.map((s) => (
          <button key={s.id} className="active" onClick={() => onGuide(null)}>
            <span>{s.label}</span>
          </button>
        ))}
      </nav>
      <div className="botany-main power">
        {data === undefined ? (
          <div className="empty">Загружаю…</div>
        ) : data === null ? (
          <div className="empty">Данные по электричеству не собраны — выполните npm run mods</div>
        ) : (
          <PowerGuides data={data} guide={guide} onGuide={onGuide} />
        )}
      </div>
    </div>
  );
}

/** Формулам гайдов нужны настройки обоих модов — как во вкладке «Электричество» */
function PowerGuides({
  data,
  guide,
  onGuide,
}: {
  data: PowerData;
  guide: string | null;
  onGuide: (id: string | null) => void;
}) {
  const ee = useSettings(data.ee?.file, data.ee?.keys);
  const ie = useSettings(data.ie?.file, data.ie?.keys);
  const att = useSettings(data.att?.file, data.att?.keys);
  return (
    <Suspense fallback={<div className="empty">Загружаю гайды…</div>}>
      <PowerGuidesSection data={data} ee={ee.get} ie={ie.get} att={att.get} guide={guide} onGuide={onGuide} />
    </Suspense>
  );
}
