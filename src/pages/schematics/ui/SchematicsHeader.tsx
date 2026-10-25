import { Upload } from 'lucide-react';
import styles from '../SchematicsPage.module.css';

interface Props {
  inputRef: React.RefObject<HTMLInputElement | null>;
  onFiles: (files: File[]) => void;
}

/** Шапка страницы схем: заголовок, пояснение и кнопка открытия .nbt (скрытый input здесь же) */
export function SchematicsHeader({ inputRef, onFiles }: Props) {
  return (
    <div className={styles.head}>
      <div className="grow">
        <h1>Замена блоков в схемах</h1>
        <p className="muted">
          Схемы Create (.nbt) для принтера: замените блоки на те, что есть в сборке. Всё происходит в браузере — файлы
          никуда не загружаются.
        </p>
      </div>
      <button className="btn primary" data-tour="schem-open" onClick={() => inputRef.current?.click()}>
        <Upload size={16} />
        Открыть .nbt
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".nbt"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) onFiles([...e.target.files]);
          e.target.value = '';
        }}
      />
    </div>
  );
}
