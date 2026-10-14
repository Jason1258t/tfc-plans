import { Download } from 'lucide-react';
import { ADDONS, ADDONS_DEV_DOC, REPO_TREE, type AddonBlock } from '../lib/addons';
import { itemName, useItems } from '../lib/items';
import { ItemIcon } from './ItemIcon';
import './PowerTab.css';

/** Справочник → Аддоны: свои моды группы — что делают, рецепты, скачать, как поставить, что проверено */
export function AddonsTab() {
  return (
    <div className="power">
      <section className="ref-card">
        <h2 className="power-h">Аддоны сборки</h2>
        <p className="small">
          Маленькие моды, которые группа сделала сама под эту сборку. Каждый ставится в папку <code>mods</code> —{' '}
          <b>на сервер и всем игрокам</b>, если добавляет блоки (иначе клиент не войдёт на сервер). Исходники и сборка —
          в репозитории сайта; как сделать свой —{' '}
          <a href={ADDONS_DEV_DOC} target="_blank" rel="noreferrer">
            «Разработка аддонов»
          </a>
          .
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
    </div>
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
