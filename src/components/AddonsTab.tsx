import { ChevronRight, Download } from 'lucide-react';
import { lazy, Suspense, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ADDONS,
  ADDONS_DEV_DOC,
  ADDONS_SUBS,
  REPO_TREE,
  addonImage,
  type Addon,
  type AddonBlock,
  type AddonsSub,
} from '../lib/addons';
import { itemName, useItems, ItemIcon } from '@/shared/pack-data';
import { cx } from '@/shared/lib';
import './PowerTab.css';

const AddonsGuidesSection = lazy(() => import('./guides/AddonsGuidesSection'));

/** Страница «Аддоны»: свои моды группы и гайды «как написать свой» */
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

/** Свои моды группы — коротко; подробно (блоки, рецепты, что проверено) — на странице аддона */
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
          <AddonHead a={a} title={<Link to={`/addons/${a.id}`}>{a.name}</Link>} />
          <AddonPreview a={a} />
          <p>{a.summary}</p>
          <AddonInstall a={a} />
          <Link className="btn ghost small" to={`/addons/${a.id}`}>
            Подробнее: блоки, рецепты, что проверено <ChevronRight size={14} />
          </Link>
        </section>
      ))}
    </>
  );
}

/** Заголовок карточки аддона: название, версия, исходники, скачать */
export function AddonHead({ a, title }: { a: Addon; title: ReactNode }) {
  return (
    <div className="ref-card-head">
      <div className="grow">
        <h2 className="power-h">{title}</h2>
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
  );
}

/** Кому ставить и как — одинаково в списке и на странице аддона */
export function AddonInstall({ a }: { a: Addon }) {
  return (
    <>
      <p className="faint small">Ставить: {a.needs}</p>
      <p className="faint small">
        Программой: <code>tfc pull addons {a.id}</code>
        {a.replaces?.length ? <> — заодно уберёт (с копией) {a.replaces.join(', ')}</> : null}
      </p>
    </>
  );
}

/** Картинки блоков в ряд — в списке вместо полного описания */
function AddonPreview({ a }: { a: Addon }) {
  const pics = a.blocks.filter((b) => b.image);
  if (!pics.length) return null;
  return (
    <div className="addon-preview">
      {pics.map((b) => (
        <img
          key={b.id}
          src={addonImage(a, b.image!)}
          alt={b.name}
          title={b.name}
          width={48}
          height={48}
          className="power-pixel"
        />
      ))}
    </div>
  );
}

/** Блок аддона: картинка, название, id, рецепт. Описание — текстом статьи после виджета ::addon-block */
export function AddonBlockCard({ a, b }: { a: Addon; b: AddonBlock }) {
  const items = useItems();
  return (
    <div className="power-addon-row power-addon-block">
      {b.image && <img src={addonImage(a, b.image)} alt={`${b.name}, вид сверху`} className="power-pixel" />}
      <div className="grow">
        <b>{b.name}</b> <span className="faint small">{b.id}</span>
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
                  title={k ? (k.tag ? `#${k.tag}` : (k.name ?? itemName(items?.byId.get(k.item), k.item))) : ''}
                >
                  {k?.image ? (
                    <img
                      src={addonImage(a, k.image)}
                      alt={k.name ?? k.item}
                      width={28}
                      height={28}
                      className="power-pixel"
                    />
                  ) : (
                    k && <ItemIcon id={k.item} size={28} tip={false} />
                  )}
                </span>
              );
            }),
          )}
        </div>
      )}
    </div>
  );
}
