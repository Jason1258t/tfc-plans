import { Download, FileTerminal, Save } from 'lucide-react';
import { useState } from 'react';
import { useNick } from '@/entities/user';
import { kubejsScriptsStore } from '@/entities/datapack';
import { SCRIPT_FILE_RE } from '@/lib/kubejsFix';
import { downloadScript } from '@/lib/kubejsScripts';
import { cx, timeAgo } from '@/shared/lib';
import type { KubejsScript } from '@/entities/datapack';
import { Button } from '@/shared/ui';
import styles from '../DatapacksPage.module.css';

/** Отметка «Ставить в мир» / «Ставить на сервер» с подсказкой */
export function InstallToggle({
  checked,
  label,
  where,
  onChange,
}: {
  checked: boolean;
  label: string;
  /** Куда ставит программа: «в мир», «на сервер» */
  where: string;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className={cx(styles.dpInstall, checked && styles.on)}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <b>{label}</b>
        <span className="faint small"> — программа tfc поставит его {where}; тестовые не отмечайте</span>
      </span>
    </label>
  );
}

/** Скрипт KubeJS: имя файла, текст, отметка «Ставить на сервер» */
export function ScriptEditor({
  script,
  scripts,
  onDeleted,
}: {
  script: KubejsScript;
  scripts: KubejsScript[];
  onDeleted: () => void;
}) {
  const nick = useNick();
  const [fileName, setFileName] = useState(script.fileName);
  const [text, setText] = useState(script.text);
  const [error, setError] = useState<string | null>(null);
  /** Текст, с которого начата правка: отличается от script.text — значит, скрипт изменили в другом окне */
  const [base, setBase] = useState(script.text);

  const update = (patch: Partial<KubejsScript>) =>
    kubejsScriptsStore.update(script.id, { ...patch, updatedBy: nick }).catch((e) => setError(String(e)));

  const nameValid = SCRIPT_FILE_RE.test(fileName);
  const nameTaken = scripts.some((s) => s.id !== script.id && s.fileName === fileName);
  const dirty = text !== base;
  const remoteChanged = script.text !== base;

  const saveName = () => {
    if (fileName === script.fileName) return;
    if (!nameValid || nameTaken) return;
    update({ fileName });
  };

  const remove = async () => {
    if (!confirm(`Удалить скрипт ${script.fileName}?`)) return;
    await kubejsScriptsStore.remove(script.id);
    onDeleted();
  };

  return (
    <div className={styles.dpEditor}>
      <section className={styles.dpMeta}>
        <div>
          <label className="label" htmlFor="kjs-name">
            Файл в <code>kubejs/server_scripts/</code>
          </label>
          <input
            id="kjs-name"
            className="input mono-input"
            value={fileName}
            onChange={(e) => setFileName(e.target.value.trim().toLowerCase())}
            onBlur={saveName}
          />
          {!nameValid && (
            <div className={cx(styles.dpFieldError, 'small')}>
              Только латиница, цифры, _ . - и .js на конце (например, <code>tfc_plans_recipes.js</code>)
            </div>
          )}
          {nameValid && nameTaken && (
            <div className={cx(styles.dpFieldError, 'small')}>Скрипт с таким именем уже есть</div>
          )}
        </div>
        <InstallToggle
          checked={!!script.install}
          label="Ставить на сервер"
          where="на сервер"
          onChange={(install) => update({ install })}
        />
      </section>

      <div className={styles.dpToolbar}>
        <span className="grow faint small">{dirty ? 'Есть несохранённые правки' : ''}</span>
        <Button onClick={() => downloadScript(text, script.fileName)}>
          <Download size={15} /> Скачать .js
        </Button>
        <Button
          variant="primary"
          disabled={!dirty || text.length > 200_000}
          onClick={() => {
            setBase(text);
            update({ text });
          }}
        >
          <Save size={15} /> Сохранить
        </Button>
      </div>
      {remoteChanged && (
        <div className={cx(styles.dpSaved, styles.error)}>
          <span>
            Скрипт изменил {script.updatedBy} {timeAgo(script.updatedAt)}
            {dirty ? ' — «Сохранить» затрёт его правку' : ''}.
          </span>
          <Button
            variant="ghost"
            size="sm"
            className={styles.dpSavedBtn}
            onClick={() => {
              setText(script.text);
              setBase(script.text);
            }}
          >
            Взять новую версию
          </Button>
        </div>
      )}
      {text.length > 200_000 && <div className="error-box">Скрипт длиннее 200 000 знаков — разбейте на несколько.</div>}
      {error && <div className="error-box">Не сохранилось: {error}</div>}

      <textarea
        className={cx('input mono', styles.dpScriptText)}
        spellCheck={false}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={24}
      />

      <footer className={cx(styles.dpFoot, 'faint', 'small')}>
        <span className="grow">
          <FileTerminal size={12} /> создал {script.author}, изменил {script.updatedBy} {timeAgo(script.updatedAt)}.
          Установка вручную: файл в <code>kubejs/server_scripts/</code> на сервере, затем <code>/reload</code>.
        </span>
        <Button size="sm" className={styles.dpDanger} onClick={remove}>
          Удалить скрипт
        </Button>
      </footer>
    </div>
  );
}
