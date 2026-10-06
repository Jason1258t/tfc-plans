import { FileUp, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { itemName, useItems } from '../lib/items';
import { addMaterials, schematicMaterials, type SchematicMaterials } from '../lib/materials';
import { cx } from '../lib/util';
import type { ChecklistEntry } from '../types';
import { ItemIcon } from './ItemIcon';
import { Modal } from './Modal';
import './SchematicImport.css';

interface Props {
  checklist: ChecklistEntry[];
  onApply: (next: ChecklistEntry[]) => void;
  onClose: () => void;
}

/** Импорт материалов из .nbt-схем в чеклист задачи: несколько схем суммируются, есть множитель копий */
export function SchematicImport({ checklist, onApply, onClose }: Props) {
  const items = useItems();
  const inputRef = useRef<HTMLInputElement>(null);
  const [schems, setSchems] = useState<SchematicMaterials[]>([]);
  const [copies, setCopies] = useState(1);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async (files: FileList | File[]) => {
    setError(null);
    setBusy(true);
    const errors: string[] = [];
    const loaded: SchematicMaterials[] = [];
    for (const f of files) {
      try {
        loaded.push(await schematicMaterials(f, items));
      } catch (e) {
        errors.push(e instanceof Error ? e.message : `«${f.name}»: ${e}`);
      }
    }
    setSchems((list) => [...list, ...loaded]);
    // Нераспознанные по умолчанию не добавляем — их лучше проверить глазами
    setOff((s) => {
      const next = new Set(s);
      for (const sc of loaded) for (const m of sc.materials) if (!m.known) next.add(m.id);
      return next;
    });
    if (errors.length) setError(errors.join('\n'));
    setBusy(false);
  };

  // Сумма по всем схемам
  const total = useMemo(() => {
    const acc = new Map<string, { id: string; qty: number; known: boolean; from: Set<string> }>();
    for (const s of schems)
      for (const m of s.materials) {
        const e = acc.get(m.id) ?? { id: m.id, qty: 0, known: m.known, from: new Set<string>() };
        e.qty += m.qty;
        m.from.forEach((f) => e.from.add(f));
        acc.set(m.id, e);
      }
    return [...acc.values()].sort((a, b) => Number(b.known) - Number(a.known) || b.qty - a.qty);
  }, [schems]);

  const chosen = total.filter((m) => !off.has(m.id));
  const apply = () => {
    onApply(
      addMaterials(
        checklist,
        chosen.map((m) => ({ ...m, qty: m.qty * copies })),
        items,
      ),
    );
    onClose();
  };
  const toggle = (id: string) =>
    setOff((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Modal
      onClose={onClose}
      title="Материалы из схемы"
      footer={
        <>
          <span className="faint small grow">К ресурсам, которые уже есть в чеклисте, количество прибавится</span>
          <button className="btn ghost" onClick={onClose}>
            Отмена
          </button>
          <button className="btn primary" disabled={!chosen.length} onClick={apply}>
            Добавить {chosen.length ? `(${chosen.length})` : ''}
          </button>
        </>
      }
    >
      <div
        className="si"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files.length) load(e.dataTransfer.files);
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".nbt"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) load(e.target.files);
            e.target.value = '';
          }}
        />
        {schems.length === 0 ? (
          <button className="si-drop" onClick={() => inputRef.current?.click()} disabled={busy}>
            <FileUp size={22} />
            {busy ? 'Читаю схему…' : 'Выберите или перетащите .nbt-схемы Create'}
            <span className="faint small">
              Блоки посчитаются как предметы: двери и кровати — по одной, двойные плиты — по две
            </span>
          </button>
        ) : (
          <>
            <ul className="si-files">
              {schems.map((s, i) => (
                <li key={`${s.fileName}-${i}`}>
                  <span className="grow">
                    <b>{s.fileName}</b>
                    <span className="faint small">
                      {' '}
                      · {s.blocks.toLocaleString('ru-RU')} блоков
                      {s.skipped > 0 && ` · ${s.skipped} пропущено (жидкости, верхние половины)`}
                      {s.entities > 0 && ` · ${s.entities} сущностей не учтено`}
                    </span>
                  </span>
                  <button
                    className="btn ghost sm icon"
                    aria-label="Убрать схему"
                    onClick={() => setSchems((list) => list.filter((_, j) => j !== i))}
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
            <div className="row si-tools">
              <button className="btn sm" onClick={() => inputRef.current?.click()} disabled={busy}>
                <FileUp size={14} /> Ещё схема
              </button>
              <label className="row small si-copies">
                Копий
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={999}
                  value={copies}
                  onChange={(e) => setCopies(Math.max(1, Math.min(999, Math.floor(Number(e.target.value) || 1))))}
                />
              </label>
              <span className="grow" />
              <button className="btn ghost sm" onClick={() => setOff(new Set())}>
                Все
              </button>
              <button className="btn ghost sm" onClick={() => setOff(new Set(total.map((m) => m.id)))}>
                Ничего
              </button>
            </div>
            <ul className="si-list">
              {total.map((m) => (
                <li key={m.id} className={cx(off.has(m.id) && 'off', !m.known && 'unknown')}>
                  <label>
                    <input type="checkbox" checked={!off.has(m.id)} onChange={() => toggle(m.id)} />
                    <ItemIcon id={m.id} size={24} />
                    <span className="grow si-name">
                      <span>{m.known ? itemName(items?.byId.get(m.id), m.id) : 'Нет такого предмета в сборке'}</span>
                      <code className="faint small">
                        {m.id}
                        {m.from.size > 0 && ` ← ${[...m.from].join(', ')}`}
                      </code>
                    </span>
                    <span className="si-qty">×{(m.qty * copies).toLocaleString('ru-RU')}</span>
                  </label>
                </li>
              ))}
            </ul>
            {total.some((m) => !m.known) && (
              <p className="faint small" style={{ margin: 0 }}>
                Нераспознанные блоки по умолчанию выключены; если отметить — добавятся текстовыми пунктами.
              </p>
            )}
          </>
        )}
        {error && <div className="error-box">{error}</div>}
      </div>
    </Modal>
  );
}
