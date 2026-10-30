import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Role } from '@tfc/core/building/grid';
import { makeSpec } from '@tfc/core/building/presets';
import type { BuildingSpec } from '@tfc/core/building/spec';
import { libraryEntry, type Vec } from '@/entities/schematic';
import { blockEntry, itemName, useItems } from '@/shared/pack-data';
import { ErrorBox } from '@/shared/ui';
import { cx } from '@/shared/lib';
import { SchematicView3D } from '@/widgets/schematic-view';
import { useBlockColors } from '../model/blockColors';
import { ROLE_INFO } from '../model/roleInfo';
import { cellAt, cellsOf, useBuilding, type CellInfo } from '../model/useBuilding';
import { OutputPanel } from '../ui/OutputPanel';
import { ParamsPanel } from '../ui/ParamsPanel';
import { RolesPanel } from '../ui/RolesPanel';
import styles from './BuilderPage.module.css';

const NO_REPLACE = new Map<string, string>();

/**
 * Генератор построек: форма × стиль × тип здания, блоки по ролям, степень текстурирования. Постройка
 * пересобирается при каждой правке и показывается тем же 3D-видом, что и схемы; результат — схема Create.
 * `?from=<id>` — открыть схему библиотеки, сохранённую из генератора, с её параметрами.
 */
export function BuilderPage() {
  const items = useItems();
  const [params] = useSearchParams();
  const from = params.get('from');
  const [spec, setSpec] = useState<BuildingSpec>(() => makeSpec());
  const [name, setName] = useState('постройка');
  const [library, setLibrary] = useState<{ id: string; fileId: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hover, setHover] = useState<CellInfo | null>(null);
  const [shown, setShown] = useState<Role | null>(null);
  const [textured, setTextured] = useState(true);
  const { built, error, has } = useBuilding(spec, items, name);
  const colors = useBlockColors(items);

  // Открыть из библиотеки: параметры постройки из карточки схемы
  useEffect(() => {
    if (!from) return;
    let live = true;
    libraryEntry(from)
      .then((entry) => {
        if (!live) return;
        if (!entry?.building) throw new Error('у этой схемы нет параметров генератора');
        setSpec(entry.building);
        setName(entry.name);
        setLibrary({ id: entry.id, fileId: entry.fileId });
        setLoadError(null);
      })
      .catch((e) => live && setLoadError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [from]);

  const selected = useMemo<Vec[]>(() => (built && shown ? cellsOf(built, shown) : []), [built, shown]);

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div className="grow">
          <h1>Генератор построек</h1>
          <p className="muted">
            Форма, стиль и тип здания → схема Create. Блоки каждой роли (стены, углы, перемычки, скат…) выбираете вы;
            «Подобрать» предлагает похожие по семейству и цвету.
          </p>
        </div>
      </div>
      {loadError && <ErrorBox>Не открылась схема из библиотеки: {loadError}</ErrorBox>}
      <div className={styles.layout}>
        <aside className={styles.side}>
          <ParamsPanel key={library?.id ?? 'new'} spec={spec} onChange={setSpec} />
        </aside>
        <main className={styles.main}>
          <div className={styles.view}>
            {built && (
              <SchematicView3D
                schematic={built.schematic}
                replace={NO_REPLACE}
                textured={textured}
                selected={selected}
                onHover={(pos) => setHover(pos ? cellAt(built, pos) : null)}
              />
            )}
            {!built && !error && <div className={cx(styles.viewNote, 'faint')}>Собираю постройку…</div>}
            {hover && items && (
              <div className={cx(styles.hover, 'small')}>
                {ROLE_INFO[hover.role]?.name ?? hover.role}
                {hover.state && hover.state.Name !== 'minecraft:air' && (
                  <> · {itemName(blockEntry(items, hover.state.Name), hover.state.Name)}</>
                )}
                <span className="faint"> · {hover.pos.join(', ')}</span>
              </div>
            )}
            <label className={cx(styles.texturedToggle, 'small')}>
              <input type="checkbox" checked={textured} onChange={(e) => setTextured(e.target.checked)} />
              текстуры
            </label>
          </div>
          {error && <ErrorBox>{error}</ErrorBox>}
          {built && items && has && (
            <div className={styles.below}>
              <section>
                <h2>Роли и блоки</h2>
                <RolesPanel
                  spec={spec}
                  counts={built.gen.roles}
                  items={items}
                  has={has}
                  colors={colors}
                  shown={shown}
                  onShow={setShown}
                  onChange={(role, rs) => setSpec((s) => ({ ...s, roles: { ...s.roles, [role]: rs } }))}
                />
              </section>
              <section>
                <h2>Схема</h2>
                <OutputPanel
                  built={built}
                  spec={spec}
                  items={items}
                  name={name}
                  onName={setName}
                  library={library}
                  onSaved={setLibrary}
                />
              </section>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
