import styles from './Header.module.css';

export function BrandLogo() {
  return (
    <>
      <svg className={`${styles.brandLogo} ${styles.brandLogoFull}`} viewBox="0 0 120 120" aria-hidden="true">
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          <g className={styles.logoConstruction} strokeWidth="1">
            <path d="M12 60H108M60 12V108" strokeDasharray="3 5" />
            <circle cx="60" cy="60" r="46" />
            <path d="M20 101H100M20 97V105M100 97V105" />
          </g>
          <g stroke="currentColor" strokeWidth="2.4">
            <path d="M60 19L91 37L60 55L29 37Z" />
            <path d="M24 49L50 64V96L24 81Z" />
            <path d="M96 49L70 64V96L96 81Z" />
            <path d="M60 55V69M50 64L60 69L70 64" opacity=".65" />
          </g>
          <path d="M60 19L91 37L60 55Z" fill="#d98c62" fillOpacity=".2" stroke="#d98c62" strokeWidth="2.4" />
          <g fill="#d98c62">
            <circle cx="60" cy="19" r="3" />
            <circle cx="24" cy="49" r="3" />
            <circle cx="96" cy="49" r="3" />
          </g>
        </g>
      </svg>
      <svg className={`${styles.brandLogo} ${styles.brandLogoCompact}`} viewBox="0 0 120 120" aria-hidden="true">
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          <g stroke="currentColor" strokeWidth="5">
            <path d="M60 19L91 37L60 55L29 37Z" />
            <path d="M24 49L50 64V96L24 81Z" />
            <path d="M96 49L70 64V96L96 81Z" />
          </g>
          <path d="M60 19L91 37L60 55Z" fill="#d98c62" fillOpacity=".28" stroke="#d98c62" strokeWidth="5" />
        </g>
      </svg>
      <span className={styles.brandName}>
        <span className={styles.brandTitle}>TFC</span>
        <span className={styles.brandSubtitle}>STUDIO</span>
      </span>
    </>
  );
}
