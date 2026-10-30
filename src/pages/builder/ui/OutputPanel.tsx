import { Download, Library } from 'lucide-react';
import { useState } from 'react';
import type { BuildingSpec } from '@tfc/core/building/spec';
import { makePreview, saveToLibrary } from '@/entities/schematic';
import { useNick } from '@/entities/user';
import { ItemIcon, blockEntry, itemName, type ItemIndex } from '@/shared/pack-data';
import { Button, ButtonLink, ErrorBox, Input } from '@/shared/ui';
import type { Built } from '../model/useBuilding';
import styles from '../BuilderPage/BuilderPage.module.css';

interface Props {
  built: Built;
  spec: BuildingSpec;
  items: ItemIndex;
  name: string;
  onName: (name: string) => void;
  /** Запись библиотеки, в которую сохраняем (открыли из неё или уже сохранили), и её файл */
  library: { id: string; fileId: string } | null;
  onSaved: (library: { id: string; fileId: string }) => void;
}

/** Размер, материалы и выход: скачать .nbt, сохранить в библиотеку схем (с параметрами генератора) */
export function OutputPanel({ built, spec, items, name, onName, library, onSaved }: Props) {
  const nick = useNick();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const { painted, materials } = built.gen;
  const list = [...materials].sort((a, b) => b[1] - a[1]);
  const total = list.reduce((s, [, n]) => s + n, 0);

  const download = () => {
    const url = URL.createObjectURL(new Blob([built.bytes as BlobPart], { type: 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name || 'постройка'}.nbt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const save = async () => {
    if (!nick) return;
    setBusy(true);
    setError(null);
    try {
      const s = built.schematic;
      if (library) {
        // Запись уже есть — файл заменяется новым (rev ≠ savedRev → загрузка заново, прежний файл удаляется)
        s.libraryId = library.id;
        s.libraryFileId = library.fileId;
        s.rev = 1;
        s.savedRev = 0;
      }
      const preview = await makePreview(s, new Map(), items);
      const { id, fileId } = await saveToLibrary(s, new Map(), nick, preview, spec);
      onSaved({ id, fileId: fileId ?? library?.fileId ?? '' });
      setSavedAt(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.output}>
      <div className={styles.row}>
        <Input
          value={name}
          onChange={(e) => onName(e.target.value)}
          placeholder="Название"
          aria-label="Название постройки"
          className="grow"
        />
        <Button onClick={download}>
          <Download size={16} />
          Скачать .nbt
        </Button>
        <Button
          variant="primary"
          disabled={busy || !nick || !name.trim()}
          onClick={save}
          title={nick ? '' : 'Нужен ник'}
        >
          <Library size={16} />
          {busy ? 'Сохраняю…' : library ? 'Обновить в библиотеке' : 'В библиотеку'}
        </Button>
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      {savedAt && (
        <p className="small">
          Сохранено.{' '}
          <ButtonLink size="sm" to={`/schematics?id=${savedAt}`}>
            Открыть в схемах
          </ButtonLink>{' '}
          <span className="faint">— там можно перенести материалы в задачу и поправить блоки по слоям.</span>
        </p>
      )}
      <p className="faint small">
        {painted.X}×{painted.Y}×{painted.Z} · блоков {total} · у двери две клетки на один предмет, плиты и ступени —
        поштучно
      </p>
      <ul className={styles.materials}>
        {list.map(([id, n]) => (
          <li key={id}>
            <ItemIcon id={id} size={20} />
            <span className="grow">{itemName(blockEntry(items, id), id)}</span>
            <span className="small">{n}</span>
            <span className="faint small">
              {n >= 64 ? `${Math.floor(n / 64)}×64${n % 64 ? ` + ${n % 64}` : ''}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
