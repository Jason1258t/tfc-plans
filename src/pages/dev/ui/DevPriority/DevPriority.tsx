import { PRIORITY_LABEL } from '../../model/api';
import styles from './DevPriority.module.css';

export function DevPriority({ value }: { value: number }) {
  const label = `Важность: ${PRIORITY_LABEL[value]}`;
  return <span className={styles.dot} data-priority={value} role="img" aria-label={label} title={label} />;
}
