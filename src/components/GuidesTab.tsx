import { lazy, Suspense } from 'react';
import { usePower, useSettings, type PowerData } from '../lib/power';
import { cx } from '@/shared/lib';
import { GUIDES_SUBS, type GuidesSub } from './guides/guideMeta';
import './PowerTab.css';

const PowerGuidesSection = lazy(() => import('./guides/PowerGuidesSection'));
const AddonsGuidesSection = lazy(() => import('./guides/AddonsGuidesSection'));
const SiteGuidesSection = lazy(() => import('./guides/SiteGuidesSection'));
const MultiblockGuidesSection = lazy(() => import('./guides/MultiblockGuidesSection'));

/** Справочник → «Гайды»: все разделы гайдов. Адрес статьи — ?tab=guides[&sub=multiblocks|addons|site]&g=<id>. */
export function GuidesTab({
  sub,
  onSub,
  guide,
  onGuide,
}: {
  sub: GuidesSub;
  onSub: (s: GuidesSub) => void;
  guide: string | null;
  onGuide: (id: string | null) => void;
}) {
  return (
    <div className="botany">
      <nav className="botany-nav" aria-label="Разделы гайдов">
        {GUIDES_SUBS.map((s) => (
          <button key={s.id} className={cx(sub === s.id && 'active')} onClick={() => onSub(s.id)}>
            <span>{s.label}</span>
          </button>
        ))}
      </nav>
      <div className="botany-main power">
        {sub === 'addons' ? (
          <Suspense fallback={<div className="empty">Загружаю гайды…</div>}>
            <AddonsGuidesSection guide={guide} onGuide={onGuide} />
          </Suspense>
        ) : sub === 'multiblocks' ? (
          <Suspense fallback={<div className="empty">Загружаю гайды…</div>}>
            <MultiblockGuidesSection guide={guide} onGuide={onGuide} />
          </Suspense>
        ) : sub === 'site' ? (
          <Suspense fallback={<div className="empty">Загружаю гайды…</div>}>
            <SiteGuidesSection guide={guide} onGuide={onGuide} />
          </Suspense>
        ) : (
          <PowerGuidesTab guide={guide} onGuide={onGuide} />
        )}
      </div>
    </div>
  );
}

function PowerGuidesTab({ guide, onGuide }: { guide: string | null; onGuide: (id: string | null) => void }) {
  const data = usePower();
  return data === undefined ? (
    <div className="empty">Загружаю…</div>
  ) : data === null ? (
    <div className="empty">Данные по электричеству не собраны — выполните npm run mods</div>
  ) : (
    <PowerGuides data={data} guide={guide} onGuide={onGuide} />
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
