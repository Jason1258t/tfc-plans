/** Датапак сайта: записи (рецепты и произвольные файлы) и скрипты KubeJS для сервера. */

/**
 * Файл датапака.
 * add — новый рецепт по шаблону; replace — переопределение существующего рецепта по тому же пути;
 * remove — отключение рецепта (`neoforge:conditions: [neoforge:false]`, как это делает сам TFC);
 * file — произвольный файл (например, реестр WoodenCog).
 */
export type DatapackEntryKind = 'add' | 'replace' | 'remove' | 'file';

export interface DatapackEntry {
  id: string;
  kind: DatapackEntryKind;
  /** Путь внутри zip: data/<ns>/recipe/<path>.json */
  path: string;
  /** Содержимое файла (JSON текстом) */
  content: string;
  /** Тип рецепта — для подсказки */
  recipeType?: string;
  /** Откуда взят шаблон/оригинал: id рецепта «ns:path» */
  sourceRecipe?: string;
  /** Отпечаток исходного рецепта на момент, когда его взяли (packages/core/src/hash.ts) — чтобы заметить, что мод его поменял */
  sourceHash?: string;
  note?: string;
}

export interface Datapack {
  id: string;
  name: string;
  /** namespace для новых рецептов: data/<namespace>/recipe/… */
  namespace: string;
  description: string;
  entries: DatapackEntry[];
  /** Предлагать для проверки в мире. Подтверждённые версии сборки закреплены отдельно в снимке сервера. */
  install?: boolean;
  author: string;
  updatedBy: string;
  createdAt: number;
  updatedAt: number;
}

export type NewDatapack = Omit<Datapack, 'id' | 'createdAt' | 'updatedAt'>;

/** Скрипт KubeJS для kubejs/server_scripts/ (из конструктора или написанный руками) */
export interface KubejsScript {
  id: string;
  /** Имя файла в server_scripts: латиница, цифры, _ . -, на конце .js */
  fileName: string;
  text: string;
  /** «Ставить на сервер»: программа tfc ставит только отмеченные */
  install?: boolean;
  author: string;
  updatedBy: string;
  createdAt: number;
  updatedAt: number;
}

export type NewKubejsScript = Omit<KubejsScript, 'id' | 'createdAt' | 'updatedAt'>;
