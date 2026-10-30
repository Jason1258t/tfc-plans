import { FileBox } from 'lucide-react';
import styles from '../SchematicsPage/SchematicsPage.module.css';

/** Пустая страница схем: большая дропзона вместо списка файлов */
export function SchematicsDropzone({ onClick }: { onClick: () => void }) {
  return (
    <button className={styles.drop} data-tour="schem-drop" onClick={onClick}>
      <FileBox size={32} />
      <span>Перетащите сюда .nbt-схемы или нажмите, чтобы выбрать</span>
      <span className="faint small">Можно несколько файлов сразу — замены применятся ко всем</span>
    </button>
  );
}
