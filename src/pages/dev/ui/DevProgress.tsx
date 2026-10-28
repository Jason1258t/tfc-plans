import styles from './DevProgress.module.css';

export function DevProgress({ done, total }: { done: number; total: number }) {
  if (!total) return null;
  const percent = Math.round((done / total) * 100);
  return (
    <span className={styles.progress} aria-label={`Выполнено ${done} из ${total} пунктов, ${percent}%`}>
      <svg className={styles.ring} viewBox="0 0 32 32" aria-hidden="true">
        <circle className={styles.track} cx="16" cy="16" r="13" />
        <circle
          className={styles.fill}
          cx="16"
          cy="16"
          r="13"
          pathLength="100"
          strokeDasharray={`${(done / total) * 100} 100`}
        />
      </svg>
      <span className={styles.numbers} aria-hidden="true">
        <strong>{percent}%</strong>
        <span>
          {done}/{total}
        </span>
      </span>
    </span>
  );
}
