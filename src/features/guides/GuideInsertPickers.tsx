import { useEffect, useMemo, useState } from 'react';
import { schematicsStore, type SavedSchematic } from '@/entities/schematic';
import { itemName, ItemIcon, ItemPicker, RecipeGrid, useRecipes, type McItem } from '@/shared/pack-data';
import { Button, Input, Modal } from '@/shared/ui';
import styles from './Guides.module.css';

/**
 * Подбор вставок для редактора гайда без ручного id: рецепт — по предмету на выходе (видна сетка),
 * схема — из библиотеки по названию (видно превью). Готовая строка виджета уходит в текст.
 */

export function RecipeInsertPicker({ onInsert, onClose }: { onInsert: (line: string) => void; onClose: () => void }) {
  const catalog = useRecipes();
  const [item, setItem] = useState<McItem | null>(null);
  const list = useMemo(
    () => (catalog && item ? catalog.list.filter((r) => !r.removed && r.outputs.includes(item.i)) : []),
    [catalog, item],
  );
  return (
    <Modal title="Вставить рецепт" onClose={onClose} wide>
      <div className={styles.pickerBar}>
        <ItemPicker autoFocus onPick={setItem} placeholder="Что крафтим — предмет на выходе…" />
        {item && (
          <span className="small">
            <ItemIcon id={item.i} size={20} /> {itemName(item, item.i)}
          </span>
        )}
      </div>
      {!catalog && <div className="empty">Загружаю каталог рецептов…</div>}
      {catalog && item && !list.length && <div className="empty">Рецептов с этим предметом на выходе нет</div>}
      <ul className={styles.pickerList}>
        {list.map((r) => (
          <li key={r.i}>
            <div className={styles.pickerRowHead}>
              <code className="grow small">{r.i}</code>
              <span className="faint small">{r.t}</span>
              <Button size="sm" onClick={() => onInsert(`::craft recipe=${r.i}`)}>
                Вставить
              </Button>
            </div>
            <RecipeGrid
              recipe={r}
              compact
              fallback={<div className="faint small">не сетка крафта — виджет покажет только сообщение</div>}
            />
          </li>
        ))}
      </ul>
    </Modal>
  );
}

export function SchematicInsertPicker({
  onInsert,
  onClose,
}: {
  onInsert: (line: string) => void;
  onClose: () => void;
}) {
  const [list, setList] = useState<SavedSchematic[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => schematicsStore.subscribe(setList, (e) => setError(e.message)), []);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = (list ?? [])
    .filter((s) => {
      const hay = `${s.id} ${s.name} ${s.fileName} ${s.author} ${s.description ?? ''}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return (
    <Modal title="Вставить схему из библиотеки" onClose={onClose} wide>
      <div className={styles.pickerBar}>
        <Input autoFocus placeholder="Название, файл, автор…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {error && <div className="empty">Не удалось открыть библиотеку: {error}</div>}
      {!list && !error && <div className="empty">Загружаю библиотеку схем…</div>}
      {list && !shown.length && <div className="empty">Ничего не нашлось</div>}
      <ul className={styles.pickerList}>
        {shown.slice(0, 60).map((s) => (
          <li key={s.id} className={styles.pickerSchem}>
            {s.preview ? <img src={s.preview} alt="" /> : <span className={styles.pickerNoPreview} />}
            <span className="grow">
              <b>{s.name}</b>
              <span className="faint small">
                {' '}
                {s.size?.join('×') ?? '?'} · блоков {s.blocks} · {s.author}
              </span>
              {s.description && <div className="faint small">{s.description.split('\n')[0].slice(0, 160)}</div>}
            </span>
            <Button size="sm" onClick={() => onInsert(`::schematic id=${s.id} ver=${s.updatedAt} materials`)}>
              Вставить
            </Button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
