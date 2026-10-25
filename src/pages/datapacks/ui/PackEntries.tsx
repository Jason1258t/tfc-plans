import { AlertTriangle, Hash, ShieldAlert, Trash2 } from 'lucide-react';
import { tagFromPath, type RecipeCatalog } from '@/shared/pack-data';
import type { PackIssue } from '@/lib/datapack';
import type { Datapack, DatapackEntry } from '@/entities/datapack';
import { Button } from '@/shared/ui';
import { KIND_LABEL } from '../model/entryKind';
import styles from '../DatapacksPage.module.css';

interface Props {
  pack: Datapack;
  /** Замечания проверки перед экспортом */
  issues: PackIssue[];
  catalog: RecipeCatalog | null;
  /** entryId → номера правил KubeJS, которые удаляют этот рецепт */
  kjsHits: Map<string, number[]>;
  onEdit: (entry: DatapackEntry) => void;
  onRemove: (id: string) => void;
  onOpenTag: (entry: DatapackEntry) => void;
  onOpenConstructor: (entry: DatapackEntry) => void;
}

/** Файлы датапака: замечания проверки, пустое состояние и список записей */
export function PackEntries({ pack, issues, catalog, kjsHits, onEdit, onRemove, onOpenTag, onOpenConstructor }: Props) {
  return (
    <>
      {issues.length > 0 && (
        <div className={styles.dpIssues}>
          {issues.map((i, n) => (
            <div key={n}>
              <AlertTriangle size={13} /> <code>{i.path}</code> — {i.message}
            </div>
          ))}
        </div>
      )}

      {pack.entries.length === 0 ? (
        <div className="empty">
          Пока пусто. Добавьте рецепт по шаблону из сборки, замените/удалите существующий или создайте произвольный
          файл.
        </div>
      ) : (
        <ul className={styles.dpEntries}>
          {pack.entries.map((e) => (
            <li key={e.id} className={styles.dpEntry}>
              <span className={styles.dpKind} data-kind={e.kind}>
                {KIND_LABEL[e.kind]}
              </span>
              <button className={styles.dpEntryMain} onClick={() => onEdit(e)} title="Редактировать">
                <code className={styles.dpPath}>{e.path}</code>
                <span className="faint small">
                  {[e.recipeType, e.sourceRecipe && `из ${e.sourceRecipe}`, e.note].filter(Boolean).join(' · ')}
                </span>
              </button>
              {tagFromPath(e.path) && (
                <Button size="sm" onClick={() => onOpenTag(e)} title="Открыть в редакторе тегов">
                  <Hash size={13} /> Тег
                </Button>
              )}
              {kjsHits.has(e.id) && (
                <Button
                  size="sm"
                  className={styles.dpKjs}
                  onClick={() => onOpenConstructor(e)}
                  title={`Удаляется KubeJS: ${kjsHits
                    .get(e.id)!
                    .map((n) => {
                      const r = catalog!.kubejs!.rules[n];
                      return `${r.file}:${r.idLine ?? r.line}`;
                    })
                    .join(', ')}`}
                >
                  <ShieldAlert size={13} /> KubeJS удалит
                </Button>
              )}
              <Button
                size="sm"
                icon
                className={styles.dpDanger}
                onClick={() => onRemove(e.id)}
                aria-label={`Убрать ${e.path}`}
                title="Убрать из датапака"
              >
                <Trash2 size={14} />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
