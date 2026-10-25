import { File as FileIcon, FileArchive, FileBox, FileCode, FileText, Image, Package } from 'lucide-react';
import type { ReactNode } from 'react';
import { fileKind, type FileKind } from '../lib/fileKinds';
import { cx } from '@/shared/lib';
import styles from './FileBadge.module.css';

const ICONS = {
  image: Image,
  schematic: FileBox,
  archive: FileArchive,
  mod: Package,
  code: FileCode,
  text: FileText,
  other: FileIcon,
};

/** Цветная точка вида файла — для фильтров и легенд */
export function FileKindDot({ kind }: { kind: FileKind }) {
  return <span className={styles.fkindDot} data-kind={kind} aria-hidden />;
}

interface Props {
  name: string;
  /** MIME-тип, если известен: по нему узнаются картинки без расширения */
  type?: string;
  /** Клик по имени (обычно — скачать); без него имя — просто текст */
  onOpen?: () => void;
  disabled?: boolean;
  /** Плотный вариант для списков внутри диалогов */
  compact?: boolean;
  /** Вторая строка под именем: размер, автор, привязка */
  children?: ReactNode;
}

/** Файл в списке: значок вида на цветной подложке и имя. Один вид везде, где сайт показывает файл */
export function FileBadge({ name, type, onOpen, disabled, compact, children }: Props) {
  const kind = fileKind({ name, type });
  const Icon = ICONS[kind];
  return (
    <span className={cx('fbadge', compact && styles.compact)}>
      <span className={styles.fkind} data-kind={kind}>
        <Icon size={compact ? 16 : 18} />
      </span>
      <span className={styles.fbadgeText}>
        {onOpen ? (
          <button type="button" className={styles.fbadgeName} onClick={onOpen} disabled={disabled} title="Скачать">
            {name}
          </button>
        ) : (
          <span className={styles.fbadgeName}>{name}</span>
        )}
        {children && <span className={styles.fbadgeMeta}>{children}</span>}
      </span>
    </span>
  );
}
