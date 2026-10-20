/** Скрипты KubeJS на сайте (коллекция kubejsScripts): имена файлов, шаблон, скачивание */
import type { KubejsScript } from '../types';

/** Свободное имя файла: tfc_plans.js → tfc_plans_2.js, если такое уже есть */
export function freeScriptName(name: string, scripts: KubejsScript[], exceptId?: string) {
  const taken = new Set(scripts.filter((s) => s.id !== exceptId).map((s) => s.fileName));
  if (!taken.has(name)) return name;
  const base = name.replace(/\.js$/, '');
  let n = 2;
  while (taken.has(`${base}_${n}.js`)) n++;
  return `${base}_${n}.js`;
}

export function downloadScript(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const NEW_SCRIPT_TEXT = `// Скрипт для kubejs/server_scripts/ — после правки на сервере: /reload
ServerEvents.recipes((event) => {

});
`;
