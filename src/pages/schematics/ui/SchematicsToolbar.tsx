import { ChevronDown, RotateCcw, Search, Sparkles, Star, Wand2 } from 'lucide-react';
import type { ReplaceFavorite } from '@/entities/schematic';
import { cx } from '@/shared/lib';
import { Button } from '@/shared/ui';
import type { SmartResult } from '../model/schematicFormat';
import type { ToolPanel } from '../model/schematicPrefs';
import section from '../SchematicsSection.module.css';
import styles from '../SchematicsPage.module.css';

interface Props {
  panel: ToolPanel;
  onTogglePanel: (panel: Exclude<ToolPanel, null>) => void;
  useAgent: boolean;
  progress: [number, number] | null;
  result: SmartResult | null;
  favorites: ReplaceFavorite[] | null;
  /** Сколько замен можно подставить из избранного */
  favPlanCount: number;
  filter: string;
  onFilter: (value: string) => void;
  replacedTypes: number;
  blocksCount: number;
  replaceCount: number;
  canApply: boolean;
  onRunSmart: () => void;
  onOpenApplyFavs: () => void;
  onReset: () => void;
}

/** Панель инструментов над списком блоков: умная замена, избранное, фильтр и счётчики */
export function SchematicsToolbar({
  panel,
  onTogglePanel,
  useAgent,
  progress,
  result,
  favorites,
  favPlanCount,
  filter,
  onFilter,
  replacedTypes,
  blocksCount,
  replaceCount,
  canApply,
  onRunSmart,
  onOpenApplyFavs,
  onReset,
}: Props) {
  return (
    <div className={styles.toolbar}>
      <span className={styles.toolSplit}>
        <Button
          size="sm"
          className={cx(panel === 'smart' && styles.active)}
          onClick={() => onTogglePanel('smart')}
          aria-expanded={panel === 'smart'}
          title="Правила замены и агент Gemini"
        >
          <Wand2 size={14} className={styles.aiIco} />
          Умная замена
          <ChevronDown size={13} className={cx(styles.chev, panel === 'smart' && styles.open)} />
        </Button>
        <Button
          variant="primary"
          size="sm"
          className={cx(useAgent && styles.agentRun)}
          onClick={onRunSmart}
          disabled={!canApply || !!progress}
          title={
            useAgent
              ? 'Подобрать замены агентом Gemini (настройки — «Умная замена»)'
              : 'Применить правила замены (настройки — «Умная замена»)'
          }
        >
          {useAgent ? <Sparkles size={14} /> : <Wand2 size={14} />}
          {progress ? `Агент думает… ${progress[0]}/${progress[1]}` : 'Применить'}
        </Button>
      </span>
      {result && panel !== 'smart' && (
        <Button variant="ghost" size="sm" onClick={() => onTogglePanel('smart')} title="Показать подробности">
          заменено {result.applied.size}
          {result.failed.length > 0 && <span className={styles.badCount}>· не удалось {result.failed.length}</span>}
        </Button>
      )}
      {favorites && (
        <span className={styles.toolSplit}>
          <Button
            size="sm"
            className={cx(panel === 'favs' && styles.active)}
            onClick={() => onTogglePanel('favs')}
            aria-expanded={panel === 'favs'}
            title="Избранные замены — общие для всех схем"
          >
            <Star size={14} className={cx(styles.favStar, styles.on)} />
            Избранное
            <span className="faint">{favorites.length}</span>
            <ChevronDown size={13} className={cx(styles.chev, panel === 'favs' && styles.open)} />
          </Button>
          <Button
            size="sm"
            disabled={favPlanCount === 0}
            onClick={onOpenApplyFavs}
            title="Подставить избранные замены в блоки загруженных схем, где замены ещё нет"
          >
            Подставить{favPlanCount > 0 && ` (${favPlanCount})`}
          </Button>
        </span>
      )}
      <label className={cx(section.search, section.searchTight)}>
        <Search size={15} className="faint" />
        <input placeholder="Фильтр блоков" value={filter} onChange={(e) => onFilter(e.target.value)} />
      </label>
      <span className={cx('faint', 'small', styles.nowrap)}>
        Заменено {replacedTypes} из {blocksCount}
      </span>
      {replaceCount > 0 && (
        <Button variant="ghost" size="sm" onClick={onReset}>
          <RotateCcw size={14} />
          Сбросить все
        </Button>
      )}
    </div>
  );
}
