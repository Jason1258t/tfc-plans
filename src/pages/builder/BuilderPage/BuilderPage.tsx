import { useCallback, useEffect, useMemo, useState } from 'react';
import { Redo2, Undo2 } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import type { Role } from '@tfc/core/building/grid';
import { makeSpec } from '@tfc/core/building/presets';
import { libraryEntry, type Vec } from '@/entities/schematic';
import { blockEntry, itemName, useItems } from '@/shared/pack-data';
import { Button, ErrorBox } from '@/shared/ui';
import { cx } from '@/shared/lib';
import { SchematicView3D } from '@/entities/schematic';
import { useBlockColors } from '../model/blockColors';
import { ROLE_INFO } from '../model/roleInfo';
import { cellKey, editCells, editedCells, toSpecPos, type CellEdit } from '../model/edits';
import { cellAt, cellsOf, framedCells, useBuilding, type CellInfo } from '../model/useBuilding';
import { useHistory } from '../model/useHistory';
import { OutputPanel } from '../ui/OutputPanel';
import { ParamsPanel } from '../ui/ParamsPanel';
import { RolesPanel } from '../ui/RolesPanel';
import { SelectionPanel } from '../ui/SelectionPanel';
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
  const history = useHistory(() => makeSpec());
  const { value: spec, set: setSpec, undo, redo } = history;
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
        history.replace(entry.building);
        setName(entry.name);
        setLibrary({ id: entry.id, fileId: entry.fileId });
        setLoadError(null);
      })
      .catch((e) => live && setLoadError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
    // history.replace стабилен (useCallback)
  }, [from, history.replace]);

  // Выделение — в клетках сетки: сетка сдвинулась или сменила размер — выделение больше не про те клетки
  const [selection, setSelection] = useState<Vec[]>([]);
  const g = built?.gen.layout;
  const gridKey = g ? `${g.grid.X}x${g.grid.Y}x${g.grid.Z}:${g.ox},${g.oz}` : '';
  const [selKey, setSelKey] = useState(gridKey);
  if (selKey !== gridKey) {
    setSelKey(gridKey);
    setSelection([]);
  }
  const edited = useMemo(() => (built ? editedCells(spec, built.gen.layout) : new Set<string>()), [built, spec]);
  const lost = built?.gen.lost ?? [];
  const selected = useMemo<Vec[]>(
    () => (selection.length ? selection : built && shown ? cellsOf(built, shown) : []),
    [selection, built, shown],
  );

  const edit = useCallback(
    (e: CellEdit) => {
      if (!built || !selection.length) return;
      setSpec((s) => editCells(s, built.gen.layout, selection, e));
    },
    [built, selection, setSpec],
  );

  const pick = (pos: Vec | null, e: { shiftKey: boolean }) => {
    if (!pos) return !e.shiftKey && setSelection([]);
    const k = cellKey(pos);
    setSelection((sel) => {
      const has = sel.some((c) => cellKey(c) === k);
      if (e.shiftKey) return has ? sel.filter((c) => cellKey(c) !== k) : [...sel, pos];
      return has && sel.length === 1 ? [] : [pos];
    });
  };

  // Клавиши: Esc — снять выделение, Delete — воздух, Ctrl+Z / Ctrl+Shift+Z — отмена и повтор
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (t instanceof HTMLElement && (t.closest('input, select, textarea') || t.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (e.key === 'Escape') setSelection([]);
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        edit({ block: 'minecraft:air' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, edit]);

  const used = useMemo(
    () =>
      built
        ? [...built.gen.materials.keys()].sort((a, b) => built.gen.materials.get(b)! - built.gen.materials.get(a)!)
        : [],
    [built],
  );

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
        <Button
          variant="ghost"
          icon
          disabled={!history.canUndo}
          onClick={undo}
          aria-label="Отменить"
          title="Отменить (Ctrl+Z)"
        >
          <Undo2 size={16} />
        </Button>
        <Button
          variant="ghost"
          icon
          disabled={!history.canRedo}
          onClick={redo}
          aria-label="Повторить"
          title="Повторить (Ctrl+Shift+Z)"
        >
          <Redo2 size={16} />
        </Button>
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
                // Новый пресет — камера наводится заново (в остальных правках ракурс сохраняется)
                key={`${spec.form}|${spec.style}|${spec.type}`}
                schematic={built.schematic}
                replace={NO_REPLACE}
                textured={textured}
                selected={selected}
                onHover={(pos) => setHover(pos ? cellAt(built, pos) : null)}
                onPick={pick}
                onFrame={(inFrame, e) => {
                  const cells = framedCells(built, inFrame);
                  setSelection((sel) => {
                    if (!e.shiftKey) return cells;
                    const have = new Set(sel.map(cellKey));
                    return [...sel, ...cells.filter((c) => !have.has(cellKey(c)))];
                  });
                }}
              />
            )}
            {!built && !error && <div className={cx(styles.viewNote, 'faint')}>Собираю постройку…</div>}
            {hover && items && (
              <div className={cx(styles.hover, 'small')}>
                {ROLE_INFO[hover.role]?.name ?? hover.role}
                {hover.state && hover.state.Name !== 'minecraft:air' && (
                  <> · {itemName(blockEntry(items, hover.state.Name), hover.state.Name)}</>
                )}
                {edited.has(cellKey(hover.pos)) && <b> · правка</b>}
                <span className="faint"> · {toSpecPos(built!.gen.layout, hover.pos).join(', ')}</span>
              </div>
            )}
            <label className={cx(styles.texturedToggle, 'small')}>
              <input type="checkbox" checked={textured} onChange={(e) => setTextured(e.target.checked)} />
              текстуры
            </label>
          </div>
          <p className={cx('faint', 'small', styles.viewHint)}>
            Клик — выделить блок · Shift — добавить или снять · рамка ЛКМ — видимые блоки в рамке · «выделить» у роли —
            все её клетки · Delete — воздух · Esc — снять · зажатое колесо (или Alt+ЛКМ) — вращать · ПКМ — сдвиг ·
            колесо — масштаб
          </p>
          {error && <ErrorBox>{error}</ErrorBox>}
          {built && items && selection.length > 0 && (
            <SelectionPanel
              count={selection.length}
              edited={selection.filter((c) => edited.has(cellKey(c))).length}
              used={used}
              items={items}
              onEdit={edit}
              onClear={() => setSelection([])}
            />
          )}
          {spec.overrides.length > 0 && (
            <div className={cx(styles.row, 'small')}>
              <span className="grow">
                Правок по клеткам: {spec.overrides.length}
                {lost.length > 0 && (
                  <span className="faint"> · не на постройке {lost.length} (её изменили) — не применены</span>
                )}
              </span>
              {lost.length > 0 && (
                <Button
                  size="sm"
                  onClick={() => {
                    const gone = new Set(lost.map((o) => cellKey(o.pos)));
                    setSpec((s) => ({ ...s, overrides: s.overrides.filter((o) => !gone.has(cellKey(o.pos))) }));
                  }}
                >
                  Убрать неприменённые
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setSpec((s) => ({ ...s, overrides: [] }))}>
                Сбросить все правки
              </Button>
            </div>
          )}
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
                  onSelect={(role) => setSelection(cellsOf(built, role))}
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
