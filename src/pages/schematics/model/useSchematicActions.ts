import { exportSchematic, invalidTargets, type Schematic } from '@/entities/schematic';
import { isBlock, type ItemIndex } from '@/shared/pack-data';
import { makePreview, saveToLibrary } from './schematicLibrary';
import { outName, replaceSig } from './schematicFormat';

function download(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

interface Args {
  items: ItemIndex | null;
  nick: string;
  replace: Map<string, string>;
  setSchematics: React.Dispatch<React.SetStateAction<Schematic[]>>;
  setSaving: React.Dispatch<React.SetStateAction<Record<string, 'saving' | string>>>;
  setSavedSig: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setExportError: React.Dispatch<React.SetStateAction<string | null>>;
}

/**
 * Скачивание схемы с заменами и сохранение в общую библиотеку: проверки (цели — блоки сборки, материал площадки),
 * превью с заменами, пометка «сохранено на этих заменах». Ошибки — строкой над списком схем.
 */
export function useSchematicActions({
  items,
  nick,
  replace,
  setSchematics,
  setSaving,
  setSavedSig,
  setExportError,
}: Args) {
  const downloadSchematic = async (s: Schematic, rep = replace) => {
    if (!items) return;
    const bad = invalidTargets(rep, items).filter((b) => s.counts.has(b.from));
    if (bad.length) {
      setExportError(
        `Не скачано: замены на то, что не ставится блоком (нет в сборке или это только предмет) — ${bad.map((b) => `${b.from} → ${b.to}`).join(', ')}`,
      );
      return;
    }
    if (s.shape.platform && !isBlock(items, s.shape.platformBlock)) {
      setExportError(`Не скачано: материала площадки ${s.shape.platformBlock} нет в сборке — выберите другой`);
      return;
    }
    setExportError(null);
    try {
      download(await exportSchematic(s, rep), outName(s.fileName));
    } catch (e) {
      setExportError(`Не скачано: ${e instanceof Error ? e.message : e}`);
    }
  };

  const save = async (s: Schematic) => {
    setSaving((m) => ({ ...m, [s.key]: 'saving' }));
    try {
      // Превью — с заменами, как схема будет выглядеть после скачивания
      const preview = items ? await makePreview(s, replace, items) : null;
      const { id, fileId } = await saveToLibrary(s, replace, nick, preview);
      setSchematics((list) =>
        list.map((x) =>
          x.key === s.key ? { ...x, libraryId: id, libraryFileId: fileId ?? x.libraryFileId, savedRev: s.rev } : x,
        ),
      );
      setSavedSig((m) => ({ ...m, [s.key]: replaceSig(s, replace) }));
      setSaving((m) => {
        const next = { ...m };
        delete next[s.key];
        return next;
      });
    } catch (e) {
      setSaving((m) => ({ ...m, [s.key]: `Не сохранено: ${e instanceof Error ? e.message : e}` }));
    }
  };

  return { downloadSchematic, save };
}
