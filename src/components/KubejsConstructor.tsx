import { Check, Copy, Download, FilePlus2, Save, ShieldOff, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useNick } from '@/entities/user';
import { kubejsScriptsStore } from '@/entities/datapack';
import { filterToJs, kubejsHits, ruleIsIdOnly, type KjsRule } from '@/shared/pack-data';
import { kubejsScript, liftPatch, scriptFileName, targetFromJson } from '../lib/kubejsFix';
import { downloadScript, freeScriptName } from '../lib/kubejsScripts';
import type { KubejsScript } from '@/entities/datapack';
import { Modal } from '@/shared/ui';
import './KubejsConstructor.css';

interface Props {
  /** Рецепт, который режет KubeJS: id, JSON и все правила сборки */
  recipeId: string;
  json: Record<string, unknown>;
  rules: KjsRule[];
  /** namespace для нового id (датапак) */
  namespace: string;
  /** Создать рецепт с другим id в датапаке; нет — кнопка не показывается */
  onNewEntry?: (id: string, json: Record<string, unknown>) => void;
  onClose: () => void;
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn ghost sm"
      onClick={() =>
        navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        })
      }
    >
      {done ? <Check size={13} /> : <Copy size={13} />} {done ? 'Скопировано' : 'Копировать'}
    </button>
  );
}

/**
 * Рецепт удаляется скриптом KubeJS — два пути:
 * 1) снять ограничение: готовая правка скрипта сборки (строку удалить или добавить в фильтр not: { id });
 * 2) новый рецепт на его основе: другой id в датапаке (если фильтр только по id) или KubeJS-скрипт с event.custom.
 */
export function KubejsConstructor({ recipeId, json, rules, namespace, onNewEntry, onClose }: Props) {
  const hits = useMemo(() => kubejsHits(rules, targetFromJson(recipeId, json)), [rules, recipeId, json]);
  const removing = hits.removed.map((n) => rules[n]);
  const maybe = hits.maybe.map((n) => rules[n]);
  const idOnly = removing.length > 0 && removing.every(ruleIsIdOnly);

  const [newId, setNewId] = useState(() => `${namespace}:${recipeId.split(':')[1] ?? 'recipe'}`);
  const idValid = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(newId);
  const newHits = useMemo(
    () => (idValid ? kubejsHits(rules, targetFromJson(newId, json)) : null),
    [rules, newId, json, idValid],
  );
  const script = kubejsScript([{ id: newId, json }], `Рецепт ${recipeId} без удаления KubeJS`);
  const fileName = scriptFileName(newId.split(':')[1] ?? '');

  const nick = useNick();
  const [scripts, setScripts] = useState<KubejsScript[] | null>(null);
  useEffect(() => kubejsScriptsStore.subscribe(setScripts), []);
  /** Сохранённый на сайте скрипт: id и имя файла */
  const [saved, setSaved] = useState<{ id: string; fileName: string } | null>(null);

  /** В коллекцию скриптов сайта; файл с тем же именем — заменить текст или сохранить под новым именем */
  const saveScript = async () => {
    if (!scripts) return;
    const same = scripts.find((s) => s.fileName === fileName);
    if (
      same &&
      confirm(`На сайте уже есть ${fileName} — заменить его текст? «Отмена» — сохранить под другим именем.`)
    ) {
      await kubejsScriptsStore.update(same.id, { text: script, updatedBy: nick });
      setSaved({ id: same.id, fileName });
      return;
    }
    const name = freeScriptName(fileName, scripts);
    const id = await kubejsScriptsStore.add({
      fileName: name,
      text: script,
      install: false,
      author: nick,
      updatedBy: nick,
    });
    setSaved({ id, fileName: name });
  };

  return (
    <Modal onClose={onClose} title="Рецепт режет KubeJS" wide>
      <section className="kjs-section">
        <p className="faint small">
          <code>{recipeId}</code> удаляется скриптами сборки — в игре его не будет, даже если положить в датапак.
        </p>
        <ul className="kjs-rules">
          {removing.map((r, i) => (
            <li key={i}>
              <code className="kjs-loc">
                {r.file}:{r.line}
              </code>
              <code className="kjs-code">{r.code}</code>
              <span className="faint small">фильтр: {filterToJs(r.filter)}</span>
            </li>
          ))}
          {maybe.map((r, i) => (
            <li key={`m${i}`} className="kjs-maybe">
              <code className="kjs-loc">
                {r.file}:{r.line}
              </code>
              <code className="kjs-code">{r.code}</code>
              <span className="faint small">фильтр не разобрать без игры — может задевать</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="kjs-section">
        <h3>
          <ShieldOff size={16} /> Снять ограничение
        </h3>
        <p className="faint small">
          Правка скриптов сборки (<code>kubejs/server_scripts</code>) — у всех, кто играет на сервере, затем{' '}
          <code>/reload</code>. Подходит, если удаление было лишним.
        </p>
        {removing.map((r, i) => {
          const p = liftPatch(r, recipeId);
          return (
            <div key={i} className="kjs-patch">
              {p.kind === 'delete-line' ? (
                <>
                  <div className="small">
                    Удалить строку <b>{p.line}</b> в <code>{p.file}</code>:
                  </div>
                  <pre className="kjs-diff">
                    <span className="del">- {p.code}</span>
                  </pre>
                </>
              ) : (
                <>
                  <div className="small">
                    Исключить рецепт из фильтра в <code>{p.file}</code>, строка <b>{p.line}</b>
                    {p.generated &&
                      ' — фильтр собирается в коде (цикл, переменные), вставьте not: { id } туда, где он строится'}
                    :
                  </div>
                  <pre className="kjs-diff">
                    <span className="del">- {p.before}</span>
                    {'\n'}
                    <span className="add">+ {p.after}</span>
                  </pre>
                  <CopyButton text={p.after} />
                </>
              )}
            </div>
          );
        })}
      </section>

      <section className="kjs-section">
        <h3>
          <Wand2 size={16} /> Новый рецепт на его основе
        </h3>
        <label className="kjs-id">
          <span className="label">id нового рецепта</span>
          <input className="input mono-input" value={newId} onChange={(e) => setNewId(e.target.value.trim())} />
        </label>
        {newHits && (
          <p className={newHits.removed.length ? 'kjs-bad small' : 'kjs-ok small'}>
            {newHits.removed.length
              ? `С этим id рецепт тоже удалится: ${newHits.removed.map((n) => `${rules[n].file}:${rules[n].line}`).join(', ')} — как датапак не подойдёт, только KubeJS-скрипт ниже.`
              : 'С этим id ни одно удаление KubeJS рецепт не задевает.'}
          </p>
        )}

        <div className="kjs-way">
          <div className="grow">
            <b>Датапак, другой id</b>
            <p className="faint small">
              {idOnly
                ? 'Удаление здесь только по id — рецепт с другим id в датапаке останется.'
                : 'Фильтр шире id (по выходу, типу или моду) — датапак под него попадёт при любом id.'}
            </p>
          </div>
          {onNewEntry && (
            <button
              className="btn"
              disabled={!idValid || !newHits || newHits.removed.length > 0}
              onClick={() => onNewEntry(newId, json)}
            >
              <FilePlus2 size={14} /> В датапак
            </button>
          )}
        </div>

        <div className="kjs-way">
          <div className="grow">
            <b>KubeJS-скрипт</b>
            <p className="faint small">
              Работает при любом фильтре: рецепты, добавленные скриптом, удаления не трогают. Файл — в{' '}
              <code>kubejs/server_scripts/</code> на сервере.
            </p>
          </div>
          <CopyButton text={script} />
          <button className="btn" disabled={!idValid} onClick={() => downloadScript(script, fileName)}>
            <Download size={14} /> .js
          </button>
          <button
            className="btn"
            disabled={!idValid || !scripts}
            onClick={saveScript}
            title="Сохранить в «Скрипты KubeJS» на сайте — оттуда его поставит программа tfc"
          >
            <Save size={14} /> На сайт
          </button>
        </div>
        {saved && (
          <p className="kjs-ok small">
            Сохранён как <code>{saved.fileName}</code> —{' '}
            <Link to={`/datapacks?script=${saved.id}`}>открыть в «Скриптах KubeJS»</Link>. Чтобы программа tfc поставила
            его на сервер, отметьте там «Ставить на сервер».
          </p>
        )}
        <pre className="kjs-script">{script}</pre>
      </section>
    </Modal>
  );
}
