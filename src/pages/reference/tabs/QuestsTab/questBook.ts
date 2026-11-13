import { useEffect, useState } from 'react';
import type { Quest, QuestBook, QuestChapter } from '@tfc/core/ftbQuests';

/** Книга квестов FTB Quests (public/quests.json, сервер сборки — часть quests в npm run pack) */
let promise: Promise<QuestBook | null> | null = null;
let loaded: QuestBook | null | undefined;

function loadQuestBook() {
  promise ??= fetch(`${import.meta.env.BASE_URL}quests.json`, { cache: 'no-cache' })
    .then((r) => (r.ok ? (r.json() as Promise<QuestBook>) : null))
    .catch(() => null)
    .then((b) => (loaded = b));
  return promise;
}

/** undefined — грузится, null — файла нет */
export function useQuestBook(): QuestBook | null | undefined {
  const [book, setBook] = useState(loaded);
  useEffect(() => {
    if (book === undefined) loadQuestBook().then(setBook);
  }, [book]);
  return book;
}

export interface QuestHit {
  chapter: QuestChapter;
  quest: Quest;
}

/** Квест по id во всей книге (зависимости бывают между главами) */
export function questIndex(book: QuestBook): Map<string, QuestHit> {
  const m = new Map<string, QuestHit>();
  for (const chapter of book.chapters) for (const quest of chapter.quests) m.set(quest.id, { chapter, quest });
  return m;
}

const norm = (s: string) => s.toLowerCase().replaceAll('ё', 'е');

/** Поиск по названию, подзаголовку, описанию и предметам задач (id и названия) */
export function searchQuests(book: QuestBook, query: string, nameOf: (id: string) => string): QuestHit[] {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const out: QuestHit[] = [];
  for (const chapter of book.chapters)
    for (const quest of chapter.quests) {
      const refs = quest.tasks.flatMap((t) => (t.items ?? []).flatMap((r) => [r.id, nameOf(r.id)]));
      const hay = norm([quest.title, quest.subtitle ?? '', ...quest.desc, ...refs].join(' '));
      if (words.every((w) => hay.includes(w))) out.push({ chapter, quest });
    }
  return out;
}
