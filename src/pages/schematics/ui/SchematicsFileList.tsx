import { BookmarkPlus, Box, Check, ChevronDown, Download, FileBox, Ruler, X } from 'lucide-react';
import { ItemIcon, ItemPicker, itemName, type ItemIndex } from '@/shared/pack-data';
import { changesIn, shapedSize, type Schematic } from '@/entities/schematic';
import { filesEnabled, formatSize } from '@/entities/file';
import { cx } from '@/shared/lib';
import { Button } from '@/shared/ui';
import { clampPad, outName, replaceSig, shapeSummary } from '../model/schematicFormat';
import section from '../SchematicsSection.module.css';
import styles from '../SchematicsPage/SchematicsPage.module.css';

interface Props {
  schematics: Schematic[];
  replace: Map<string, string>;
  items: ItemIndex | null;
  /** Схемы, у которых развёрнуты настройки формы */
  shapeOpen: Set<string>;
  /** key схемы → идёт сохранение в библиотеку / текст ошибки */
  saving: Record<string, 'saving' | string>;
  /** key схемы → замены на момент сохранения (галочка, пока их не меняли) */
  savedSig: Record<string, string>;
  /** key схемы, у которой выбирают материал площадки */
  pickingPlatform: string | null;
  onRemove: (key: string) => void;
  onToggleShape: (key: string) => void;
  onOpenLayers: (key: string) => void;
  onDownload: (s: Schematic) => void;
  onSave: (s: Schematic) => void;
  onSetShape: (key: string, patch: Partial<Schematic['shape']>) => void;
  onPickPlatform: (key: string | null) => void;
}

/** Список открытых схем: файл, кнопки (форма, 3D, скачать, в библиотеку) и настройки формы под строкой */
export function SchematicsFileList({
  schematics,
  replace,
  items,
  shapeOpen,
  saving,
  savedSig,
  pickingPlatform,
  onRemove,
  onToggleShape,
  onOpenLayers,
  onDownload,
  onSave,
  onSetShape,
  onPickPlatform,
}: Props) {
  return (
    <ul className={section.files}>
      {schematics.map((s) => {
        const ch = changesIn(s, replace);
        const shaped = shapedSize(s, replace);
        return (
          <li key={s.key} className={section.file}>
            <FileBox size={18} className="faint" />
            <span className="grow">
              <span className={section.fileName}>{s.fileName}</span>
              <span className="faint small">
                {formatSize(s.fileSize)}
                {s.size && ` · ${s.size.join('×')}`}
                {shaped && ` → ${shaped.join('×')}`} · {s.counts.size} типов блоков
                {ch.types > 0 && ` · изменено ${ch.types} (${ch.blocks} шт.)`}
                {ch.removed > 0 && ` · удаляется ${ch.removed} шт.`}
                {s.rev !== (s.savedRev ?? 0) && ' · правки по слоям'}
              </span>
            </span>
            <Button variant="ghost" size="sm" icon onClick={() => onRemove(s.key)} aria-label={`Убрать ${s.fileName}`}>
              <X size={15} />
            </Button>
            <div className={section.fileTools}>
              <Button
                size="sm"
                className={cx(shapeOpen.has(s.key) && styles.active)}
                onClick={() => onToggleShape(s.key)}
                aria-expanded={shapeOpen.has(s.key)}
                title="Обрезка краёв, отступы, площадка под схемой, очистка пространства"
              >
                <Ruler size={14} />
                Форма
                {shapeSummary(s.shape) && <span className="faint">: {shapeSummary(s.shape)}</span>}
                <ChevronDown size={13} className={cx(styles.chev, shapeOpen.has(s.key) && styles.open)} />
              </Button>
              <Button
                size="sm"
                onClick={() => onOpenLayers(s.key)}
                title="Схема в 3D; там же — вид сверху по слоям: посмотреть блоки, убрать или заменить отдельные"
              >
                <Box size={14} />
                3D
              </Button>
              <Button
                size="sm"
                onClick={() => onDownload(s)}
                disabled={!items}
                title={`Скачать как ${outName(s.fileName)}`}
              >
                <Download size={14} />
                Скачать
              </Button>
              {filesEnabled && (
                <Button
                  size="sm"
                  onClick={() => onSave(s)}
                  disabled={saving[s.key] === 'saving'}
                  title={
                    s.libraryId
                      ? 'Записать текущие замены в библиотеку'
                      : 'Сохранить схему с заменами в общую библиотеку'
                  }
                >
                  {s.libraryId && savedSig[s.key] === replaceSig(s, replace) ? (
                    <Check size={14} />
                  ) : (
                    <BookmarkPlus size={14} />
                  )}
                  {saving[s.key] === 'saving' ? 'Сохраняю…' : s.libraryId ? 'Обновить в библиотеке' : 'В библиотеку'}
                </Button>
              )}
              {saving[s.key] && saving[s.key] !== 'saving' && (
                <span className={cx(styles.saveError, 'small')}>{saving[s.key]}</span>
              )}
            </div>
            {shapeOpen.has(s.key) && (
              <div className={styles.shape}>
                <label
                  className={cx('toggle', section.smToggle)}
                  title="Убрать пустое место по краям: габарит — по крайним блокам, воздух не считается"
                >
                  <input
                    type="checkbox"
                    checked={s.shape.crop}
                    onChange={(e) => onSetShape(s.key, { crop: e.target.checked })}
                  />
                  Обрезать края
                </label>
                {(
                  [
                    ['sides', 'по бокам'],
                    ['bottom', 'снизу'],
                    ['top', 'сверху'],
                  ] as const
                ).map(([k, label]) => (
                  <label key={k} className={cx(styles.pad, 'small')}>
                    <span className="faint">Отступ {label}</span>
                    <input
                      type="number"
                      min={0}
                      max={64}
                      value={s.shape[k]}
                      disabled={!s.shape.crop}
                      onChange={(e) => onSetShape(s.key, { [k]: clampPad(e.target.value) })}
                    />
                  </label>
                ))}
                <label
                  className={cx('toggle', section.smToggle)}
                  title="Слои блока под всей схемой, ниже нижнего отступа"
                >
                  <input
                    type="checkbox"
                    checked={s.shape.platform}
                    onChange={(e) => onSetShape(s.key, { platform: e.target.checked })}
                  />
                  Площадка
                </label>
                {s.shape.platform && (
                  <>
                    <label className={cx(styles.pad, 'small')}>
                      <span className="faint">Высота</span>
                      <input
                        type="number"
                        min={1}
                        max={32}
                        value={s.shape.platformHeight}
                        onChange={(e) =>
                          onSetShape(s.key, {
                            platformHeight: Math.min(32, Math.max(1, Math.floor(Number(e.target.value)) || 1)),
                          })
                        }
                      />
                    </label>
                    {pickingPlatform === s.key ? (
                      <span className={styles.platformPick}>
                        <ItemPicker
                          small
                          blocksOnly
                          autoFocus
                          placeholder="Материал площадки…"
                          onPick={(it) => {
                            onSetShape(s.key, { platformBlock: it.i });
                            onPickPlatform(null);
                          }}
                        />
                        <Button variant="ghost" size="sm" icon onClick={() => onPickPlatform(null)} aria-label="Отмена">
                          <X size={15} />
                        </Button>
                      </span>
                    ) : (
                      <Button size="sm" onClick={() => onPickPlatform(s.key)} title={s.shape.platformBlock}>
                        <ItemIcon id={s.shape.platformBlock} size={18} tip={false} />
                        {itemName(items?.byId.get(s.shape.platformBlock), s.shape.platformBlock)}
                      </Button>
                    )}
                    <label
                      className={cx('toggle', section.smToggle)}
                      title="При высоте больше 1: сплошной только верхний слой, ниже — стенки по периметру, пустота внутри и без дна"
                    >
                      <input
                        type="checkbox"
                        checked={s.shape.platformHollow}
                        onChange={(e) => onSetShape(s.key, { platformHollow: e.target.checked })}
                      />
                      Пустая
                    </label>
                  </>
                )}
                <label
                  className={cx('toggle', section.smToggle)}
                  title="Записать воздух во все свободные клетки итогового объёма (и в отступы), чтобы при вставке схема расчищала место, а не оставляла то, что там было"
                >
                  <input
                    type="checkbox"
                    checked={s.shape.clearAir}
                    onChange={(e) => onSetShape(s.key, { clearAir: e.target.checked })}
                  />
                  Очистить пространство
                </label>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
