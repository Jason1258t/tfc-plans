import { Download, FileCode2, FilePen, FilePlus2, FileTerminal, Hash, Paperclip, Save } from 'lucide-react';
import styles from '../DatapacksPage.module.css';

interface Props {
  /** В датапаке есть рецепты — их можно выгрузить KubeJS-скриптом */
  canExportScript: boolean;
  /** В датапаке есть файлы — из них собирается zip */
  canExportZip: boolean;
  canAttach: boolean;
  canSaveAsFile: boolean;
  /** Идёт сохранение zip в «Документы» */
  savingBusy: boolean;
  onTemplate: () => void;
  onExisting: () => void;
  onOpenTags: () => void;
  onAddFile: () => void;
  onExportScript: () => void;
  onAttach: () => void;
  onSaveAsFile: () => void;
  onExportZip: () => void;
}

/** Кнопки датапака: добавить запись, выгрузить, приложить к задаче */
export function PackToolbar({
  canExportScript,
  canExportZip,
  canAttach,
  canSaveAsFile,
  savingBusy,
  onTemplate,
  onExisting,
  onOpenTags,
  onAddFile,
  onExportScript,
  onAttach,
  onSaveAsFile,
  onExportZip,
}: Props) {
  return (
    <div className={styles.dpToolbar}>
      <button className="btn" onClick={onTemplate}>
        <FilePlus2 size={15} /> Рецепт по шаблону
      </button>
      <button className="btn" onClick={onExisting}>
        <FilePen size={15} /> Заменить / удалить рецепт
      </button>
      <button className="btn" onClick={onOpenTags}>
        <Hash size={15} /> Тег
      </button>
      <button className="btn" onClick={onAddFile}>
        <FileCode2 size={15} /> Файл
      </button>
      <span className="grow" />
      <button
        className="btn"
        onClick={onExportScript}
        disabled={!canExportScript}
        title="Рецепты датапака как KubeJS-скрипт (event.custom): удаления KubeJS на них не действуют"
      >
        <FileTerminal size={15} /> KubeJS-скрипт
      </button>
      <button className="btn" onClick={onAttach} disabled={!canAttach}>
        <Paperclip size={15} /> К задаче
      </button>
      <button
        className="btn"
        onClick={onSaveAsFile}
        disabled={!canSaveAsFile || savingBusy}
        title="Положить zip в «Документы» (общее хранилище файлов) без привязки к задаче"
      >
        <Save size={15} /> {savingBusy ? 'Сохраняю…' : 'Сохранить как файл'}
      </button>
      <button className="btn primary" onClick={onExportZip} disabled={!canExportZip}>
        <Download size={15} /> Скачать .zip
      </button>
    </div>
  );
}
