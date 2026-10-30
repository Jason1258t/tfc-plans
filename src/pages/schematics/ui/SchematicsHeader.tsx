import { Upload, Wand2 } from 'lucide-react';
import { Button, ButtonLink } from '@/shared/ui';
import styles from '../SchematicsPage/SchematicsPage.module.css';

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
      <ButtonLink to="/builder" title="Собрать постройку по форме, стилю и материалам">
        <Wand2 size={16} />
        Генератор построек
      </ButtonLink>
      <Button variant="primary" data-tour="schem-open" onClick={() => inputRef.current?.click()}>
        <Upload size={16} />
        Открыть .nbt
      </Button>
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
