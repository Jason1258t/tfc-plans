export interface NavigationSearchItem {
  title: string;
  description: string;
  keywords: string;
}

const normalize = (value: string) => value.toLocaleLowerCase('ru').replaceAll('ё', 'е');

/** Поиск по навигационному указателю, а не по содержимому статей. */
export function matchesNavigation(item: NavigationSearchItem, query: string): boolean {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  const haystack = normalize(`${item.title} ${item.description} ${item.keywords}`);
  return words.every((word) => haystack.includes(word));
}
