/**
 * Аддоны сборки — свои маленькие моды группы (исходники — tools/<мод>/ в репозитории, разработка — docs/addons.md).
 * Jar для скачивания лежат на хостинге в /addons/ (public/addons, в git не хранится — кладётся при сборке мода).
 */

export interface AddonBlock {
  id: string;
  name: string;
  /** Картинка «вид сверху» в /addons/ */
  image?: string;
  about: string;
  /** Рецепт верстака: три строки по три символа и ключ (предмет или #тег; иконка тега — первый предмет) */
  recipe?: { pattern: string[]; key: Record<string, { item: string; tag?: string }> };
}

export interface Addon {
  id: string;
  name: string;
  version: string;
  file: string;
  /** Папка исходников в репозитории */
  source: string;
  summary: string;
  needs: string;
  blocks: AddonBlock[];
  verified: string[];
  notVerified: string[];
}

const DIODE = { item: 'electroenergetics:diode' };
const CONNECTOR = { item: 'electroenergetics:connector' };
const PLATE = { item: 'create:iron_sheet', tag: 'c:plates/iron' };

export const ADDONS: Addon[] = [
  {
    id: 'ee_rectifier',
    name: 'EE Rectifiers — выпрямители',
    version: '1.1.0',
    file: '/addons/ee-rectifier-1.1.0.jar',
    source: 'tools/ee-rectifier-mod',
    summary:
      'Два блока для Create Electro Energetics: переменный ток на входе — ровный постоянный на выходе, например для электропомп, ламп и аккумуляторов. С версии 1.1 внутри нет диодов EE: блок берёт мощность с сети как нагрузка и отдаёт постоянное напряжение как генератор, поэтому не зависит от настройки сервера microTicks.',
    needs: 'Сервер и все игроки (новые блоки). NeoForge 21.1.219+, Create 6.0.10, Electro Energetics 1.1.2+.',
    blocks: [
      {
        id: 'ee_rectifier:three_phase_rectifier',
        name: 'Трёхфазный выпрямитель',
        image: '/addons/three_phase_rectifier.png',
        about:
          'Три медные клеммы — фазы трёхфазного щёточного узла (нейтраль не нужна), красная — «+», синяя — «−». На выходе — среднее идеального трёхфазного моста: 0,955 амплитуды линейного напряжения (≈ 1,65 амплитуды фазы), ровно, на любых оборотах. Сеть видит его как обычную нагрузку.',
        recipe: { pattern: ['CDC', 'DPD', 'DDD'], key: { C: CONNECTOR, D: DIODE, P: PLATE } },
      },
      {
        id: 'ee_rectifier:single_phase_rectifier',
        name: 'Однофазный выпрямитель',
        image: '/addons/single_phase_rectifier.png',
        about:
          'Две медные клеммы — фаза и нейтраль (в любом порядке), красная — «+», синяя — «−». На выходе — 0,64 амплитуды, вход усредняется за 2 секунды. На оборотах, кратных 64, фаза за тик поворачивается ровно на 180° или 360°, блок видит одну точку синусоиды и ошибается в напряжении — для однофазной сети предпочтителен трёхфазный выпрямитель.',
        recipe: { pattern: ['CDC', 'DPD', ' D '], key: { C: CONNECTOR, D: DIODE, P: PLATE } },
      },
    ],
    verified: [
      'Собирается и загружается на сервере NeoForge 21.1.219 вместе с Create 6.0.10 и Electro Energetics 1.1.2.',
      'Блоки ставятся во всех положениях, EE создаёт для них электрические устройства, при сломе — удаляет.',
      'Клеммы модели совпадают с точками крепления проводов во всех 12 положениях (6 сторон × крен) — проверка кодом EE и Minecraft.',
      'Версия 1.1 на тестовом сервере с настоящим трёхфазным генератором (ротор с 4 статорами, нагреватель 45 Ом, microTicks = 1): трёхфазный выпрямитель ровно на 1, 4, 16, 37, 64, 100, 128, 160 и 256 об/мин (например, 16 об/мин — 150 В при расчётных 152, 256 — 2329 В при 2439), разброс меньше 0,1 % (если на том же генераторе нет моста из отдельных диодов EE — тот сам вносит помехи в фазы, тогда до 5 %); со входа берёт столько же, сколько отдаёт (7898 Вт → 7898 Вт); генератор остановлен — выход в ноль.',
      'Перегрузка: нагрузка хочет вдвое больше, чем даёт генератор, — напряжение проседает со 150 до ~99 В и держится, без раскачки. Короткое замыкание выхода — сгорают провода (на сервере wiresBreak = true).',
      'Версия 1.0 (мост из диодов EE внутри) на генераторе была нестабильна при microTicks = 1 — так же, как мост из отдельных диодов EE; поэтому 1.1 сделана без диодов.',
    ],
    notVerified: [
      'В игре с игроком версию 1.1 не проверяли (версию 1.0 игрок проверил 2026-10-15: значение нестабильно — отсюда 1.1).',
      'Однофазный выпрямитель на оборотах, кратных 64, ошибается в напряжении (проверено, это предел однофазной сети при одном расчёте за тик).',
      'Несколько выпрямителей и других источников на одной шине постоянного тока; обратный ток в выход блока не запирается (у настоящего моста — запирается).',
      'Рецепт может изменить KubeJS сборки — сейчас он в моде, скрипты его не трогают.',
    ],
  },
  {
    id: 'ee_overheat',
    name: 'EE Heater Overheat — перегрев нагревателя',
    version: '1.0.0',
    file: '/addons/ee-overheat-1.0.0.jar',
    source: 'tools/ee-overheat-mod',
    summary:
      'Электронагреватель Electro Energetics при полном нагреве (≥ 0,9, около 6,8 кВт) даёт чаше Create уровень «перегрев» (superheated): сталь, каолин и другие superheated-рецепты идут на нагревателе.',
    needs: 'Сервер и все игроки. Electro Energetics 1.1+.',
    blocks: [],
    verified: ['Собирается.'],
    notVerified: ['В игре не проверялся ни разу.'],
  },
];

/** Документация по разработке аддонов — в репозитории */
export type AddonsSub = 'list' | 'guides';
export const ADDONS_SUBS: { id: AddonsSub; label: string }[] = [
  { id: 'list', label: 'Аддоны сборки' },
  { id: 'guides', label: 'Как написать свой' },
];

export const ADDONS_DEV_DOC = 'https://github.com/Jason1258t/tfc-plans/blob/main/docs/addons.md';
export const REPO_TREE = 'https://github.com/Jason1258t/tfc-plans/tree/main/';
