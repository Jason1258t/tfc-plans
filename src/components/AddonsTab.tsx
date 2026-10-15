import { Download } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { ADDONS, ADDONS_DEV_DOC, ADDONS_SUBS, REPO_TREE, type AddonBlock, type AddonsSub } from '../lib/addons';
import { itemName, useItems } from '../lib/items';
import { cx } from '../lib/util';
import { ItemIcon } from './ItemIcon';
import './PowerTab.css';

const AddonsGuidesSection = lazy(() => import('./guides/AddonsGuidesSection'));

/** Справочник → Аддоны: свои моды группы и гайды «как написать свой» */
export function AddonsTab({
  sub,
  onSub,
  guide,
  onGuide,
}: {
  sub: AddonsSub;
  onSub: (s: AddonsSub) => void;
  guide: string | null;
  onGuide: (id: string | null) => void;
}) {
  return (
    <div className="botany">
      <nav className="botany-nav" aria-label="Разделы аддонов">
        {ADDONS_SUBS.map((s) => (
          <button key={s.id} className={cx(sub === s.id && 'active')} onClick={() => onSub(s.id)}>
            <span>{s.label}</span>
          </button>
        ))}
      </nav>
      <div className="botany-main power">
        {sub === 'guides' ? (
          <Suspense fallback={<div className="empty">Загружаю гайды…</div>}>
            <AddonsGuidesSection guide={guide} onGuide={onGuide} />
          </Suspense>
        ) : (
          <AddonList onGuides={() => onSub('guides')} />
        )}
      </div>
    </div>
  );
}

/** Свои моды группы — что делают, рецепты, скачать, как поставить, что проверено */
function AddonList({ onGuides }: { onGuides: () => void }) {
  return (
    <>
      <section className="ref-card">
        <h2 className="power-h">Аддоны сборки</h2>
        <p className="small">
          Маленькие моды, которые группа сделала сама под эту сборку. Каждый ставится в папку <code>mods</code> —{' '}
          <b>на сервер и всем игрокам</b>, если добавляет блоки (иначе клиент не войдёт на сервер). Исходники и сборка —
          в репозитории сайта. Как сделать свой —{' '}
          <button type="button" className="power-link" onClick={onGuides}>
            гайды
          </button>{' '}
          (с нуля) и{' '}
          <a href={ADDONS_DEV_DOC} target="_blank" rel="noreferrer">
            заметки разработчика
          </a>{' '}
          (сборка, проверка на сервере разработки).
        </p>
      </section>
      {ADDONS.map((a) => (
        <section key={a.id} className="ref-card">
          <div className="ref-card-head">
            <div className="grow">
              <h2 className="power-h">{a.name}</h2>
              <span className="faint small">
                {a.id} · версия {a.version} ·{' '}
                <a href={REPO_TREE + a.source} target="_blank" rel="noreferrer">
                  исходники
                </a>
              </span>
            </div>
            <a className="btn small" href={a.file} download>
              <Download size={14} /> Скачать jar
            </a>
          </div>
          <p>{a.summary}</p>
          <p className="faint small">Ставить: {a.needs}</p>
          {a.blocks.map((b) => (
            <AddonBlockCard key={b.id} b={b} />
          ))}
          <div className="small">
            <b>Проверено</b>
            <ul>
              {a.verified.map((v) => (
                <li key={v}>{v}</li>
              ))}
            </ul>
            <b>Не проверено</b>
            <ul className="faint">
              {a.notVerified.map((v) => (
                <li key={v}>{v}</li>
              ))}
            </ul>
          </div>
        </section>
      ))}
    </>
  );
}

function AddonBlockCard({ b }: { b: AddonBlock }) {
  const items = useItems();
  return (
    <div className="power-addon-row power-addon-block">
      {b.image && <img src={b.image} alt={`${b.name}, вид сверху`} className="power-pixel" />}
      <div className="grow">
        <b>{b.name}</b> <span className="faint small">{b.id}</span>
        <p className="small">{b.about}</p>
      </div>
      {b.recipe && (
        <div className="power-recipe" aria-label={`Рецепт: ${b.name}`}>
          {b.recipe.pattern.flatMap((row, y) =>
            [...row.padEnd(3)].map((ch, x) => {
              const k = b.recipe!.key[ch];
              return (
                <span
                  key={`${x}-${y}`}
                  className="power-recipe-cell"
                  title={k ? (k.tag ? `#${k.tag}` : itemName(items?.byId.get(k.item), k.item)) : ''}
                >
                  {k && <ItemIcon id={k.item} size={28} tip={false} />}
                </span>
              );
            }),
          )}
        </div>
      )}
    </div>
  );
}
