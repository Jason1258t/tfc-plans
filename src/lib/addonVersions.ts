/**
 * Версии аддонов сборки: у каждой версии свой ченджлог «что изменилось с прошлой», статус и «что проверено».
 * Хранятся в Firestore addonVersions/{мод}@{версия} (правят все игроки, история — в revisions), jar версии — на
 * сервере сборки (VPS) файлом по sha256: заливает `tfc admin addon upload`, раздаёт `tfc pull addons`.
 *
 * Без импортов и только стираемый синтаксис TS: модуль читают и сайт, и Node (scripts/pack-release.mjs,
 * сервер сборки, MCP).
 */

export type AddonVersionStatus = 'draft' | 'released' | 'withdrawn';
export type AddonVersionChecked = 'game' | 'server' | 'code' | 'none';

export interface AddonVersionJar {
  file: string;
  sha256: string;
  size: number;
}

export interface AddonVersion {
  /** {мод}@{версия} */
  id: string;
  addon: string;
  version: string;
  /** Дата выпуска, ГГГГ-ММ-ДД */
  date: string;
  status: AddonVersionStatus;
  /** jar на сервере сборки; null — ещё не залит */
  jar: AddonVersionJar | null;
  /** Что изменилось с прошлой версии — для игроков, Markdown */
  changelog: string;
  checked: AddonVersionChecked;
  /** Как проверяли и что не проверено */
  checkedNote: string;
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
}

export interface AddonVersionRevision {
  id: string;
  changelog: string;
  status: AddonVersionStatus;
  checked: AddonVersionChecked;
  checkedNote: string;
  date: string;
  updatedBy: string;
  at: number;
}

export const ADDON_VERSIONS = 'addonVersions';

export const STATUS_LABEL: Record<AddonVersionStatus, string> = {
  draft: 'черновик',
  released: 'выпущена',
  withdrawn: 'отозвана',
};

export const STATUS_TITLE: Record<AddonVersionStatus, string> = {
  draft: 'Собрана и проверяется — tfc pull ставит её, только если назвать версию явно',
  released: 'Выпущена — её ставит tfc pull',
  withdrawn: 'Отозвана (сломана) — tfc pull её не ставит и откатывает на прошлую выпущенную',
};

export const addonVersionId = (addon: string, version: string) => `${addon}@${version}`;

/** Части версии: «2.3.10» → [2, 3, 10]; хвост после «-» или «+» (2.0.0-beta) — отдельно */
function parts(v: string): { nums: number[]; tail: string } {
  const m = /^v?([\d.]+)(.*)$/.exec(v.trim());
  if (!m) return { nums: [], tail: v };
  return { nums: m[1].split('.').filter(Boolean).map(Number), tail: m[2] };
}

/** Сравнение версий по числам: 2.3.10 > 2.3.9, 2.3 == 2.3.0; 2.0.0-beta < 2.0.0 */
export function compareVersions(a: string, b: string): number {
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d) return d;
  }
  if (x.tail === y.tail) return 0;
  if (!x.tail) return 1;
  if (!y.tail) return -1;
  return x.tail < y.tail ? -1 : 1;
}

/** Новые сверху */
export const sortVersions = <T extends { version: string }>(list: T[]): T[] =>
  [...list].sort((a, b) => compareVersions(b.version, a.version));

/** Последняя выпущенная версия (не черновик и не отозванная) */
export function latestReleased<T extends { version: string; status: AddonVersionStatus }>(list: T[]): T | null {
  return sortVersions(list.filter((v) => v.status === 'released'))[0] ?? null;
}

/**
 * Версии между «было» и «стало» для патчноута, новые сверху: from < v ≤ to, кроме черновиков. Без from (аддон
 * добавлен) — только to. Откат (to < from) — отозванные и пропущенные версии to < v ≤ from: что игроки теряют.
 */
export function versionsBetween<T extends { version: string; status: AddonVersionStatus }>(
  list: T[],
  from: string | null | undefined,
  to: string,
): { versions: T[]; rollback: boolean } {
  const live = list.filter((v) => v.status !== 'draft');
  if (!from) return { versions: live.filter((v) => compareVersions(v.version, to) === 0), rollback: false };
  const rollback = compareVersions(to, from) < 0;
  const [lo, hi] = rollback ? [to, from] : [from, to];
  return {
    versions: sortVersions(
      live.filter((v) => compareVersions(v.version, lo) > 0 && compareVersions(v.version, hi) <= 0),
    ),
    rollback,
  };
}

/** Ченджлог промежутка одним текстом — как ченджлоги Modrinth в записи об обновлении (### версия, текст) */
export function changelogText(versions: { version: string; date: string; changelog: string; status: string }[]) {
  return versions
    .map(
      (v) =>
        `### ${v.version}${v.date ? ` (${v.date})` : ''}${v.status === 'withdrawn' ? ' — отозвана' : ''}\n` +
        (v.changelog.trim() || '(ченджлога нет)'),
    )
    .join('\n\n');
}

interface ModChange {
  id: string;
  version: string;
  from?: string;
}

/**
 * Ченджлоги наших аддонов для записи об обновлении сборки: добавленные и обновлённые моды, у которых есть
 * карточка, — версии «было < v ≤ стало». Переименованный аддон (formerIds в карточке: убран ee_rectifier,
 * добавлен ee_extras) — от версии старого. Откат — снятые версии с пометкой. → { мод: текст }
 */
export function addonChangelogsFrom(
  mods: { added: ModChange[]; removed: ModChange[]; updated: ModChange[] },
  cards: { id: string; formerIds?: string[] }[],
  versions: { addon: string; version: string; date: string; status: AddonVersionStatus; changelog: string }[],
  cap = 3000,
): Record<string, string> {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const out: Record<string, string> = {};
  for (const m of [...mods.added, ...mods.updated]) {
    const c = byId.get(m.id);
    if (!c) continue;
    const list = versions.filter((v) => v.addon === m.id);
    if (!list.length) continue;
    let from = m.from ?? null;
    let renamed: string | null = null;
    if (!from)
      for (const old of c.formerIds ?? []) {
        const r = mods.removed.find((x) => x.id === old);
        if (r) {
          from = r.version;
          renamed = old;
        }
      }
    const { versions: vs, rollback } = versionsBetween(list, from, m.version);
    if (!vs.length) continue;
    const head = [
      renamed ? `Прежнее имя мода — ${renamed} ${from}.` : null,
      rollback ? `Откат: ${from} → ${m.version}. Ниже — версии, которые сняли (что пропадает):` : null,
    ].filter(Boolean);
    let text = [...head, changelogText(vs)].join('\n\n');
    if (text.length > cap) text = `${text.slice(0, cap)}\n…`;
    out[m.id] = text;
  }
  return out;
}
