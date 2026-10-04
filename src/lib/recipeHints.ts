import { doc, getDoc, setDoc } from 'firebase/firestore';
import { authReady, db } from '../firebase';

/** Подсказка по заполнению рецептов одного типа (коллекция recipeHints) */
export interface RecipeHint {
  type: string;
  title: string;
  /** Markdown */
  body: string;
  /** claude — первичное наполнение, agent — сгенерировано на сайте, manual — правка человека */
  source: 'claude' | 'agent' | 'manual';
  updatedBy: string;
  updatedAt: number;
}

export const hintsEnabled = Boolean(db);

/** id документа = тип рецепта; «:» и «/» в id Firestore недопустимы (см. scripts/seed-recipe-hints.mjs) */
export const hintDocId = (type: string) => type.replaceAll(':', '__').replaceAll('/', '--');

const cache = new Map<string, RecipeHint | null>();

export async function getHint(type: string): Promise<RecipeHint | null> {
  if (!db) return null;
  if (cache.has(type)) return cache.get(type)!;
  await authReady;
  const snap = await getDoc(doc(db, 'recipeHints', hintDocId(type)));
  const hint = snap.exists() ? (snap.data() as RecipeHint) : null;
  cache.set(type, hint);
  return hint;
}

export async function saveHint(hint: Omit<RecipeHint, 'updatedAt'>): Promise<RecipeHint> {
  if (!db) throw new Error('Подсказки хранятся в Firebase — он не подключён');
  await authReady;
  const full = { ...hint, updatedAt: Date.now() };
  await setDoc(doc(db, 'recipeHints', hintDocId(hint.type)), full);
  cache.set(hint.type, full);
  return full;
}
