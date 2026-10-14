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
    version: '1.0.0',
    file: '/addons/ee-rectifier-1.0.0.jar',
    source: 'tools/ee-rectifier-mod',
    summary:
      'Два блока для Create Electro Energetics: один блок вместо диодного моста. Переменный ток на входе — постоянный на выходе, например для электропомп.',
    needs: 'Сервер и все игроки (новые блоки). NeoForge 21.1.219+, Create 6.0.10, Electro Energetics 1.1.2+.',
    blocks: [
      {
        id: 'ee_rectifier:three_phase_rectifier',
        name: 'Трёхфазный выпрямитель',
        image: '/addons/three_phase_rectifier.png',
        about:
          'Три медные клеммы — фазы трёхфазного щёточного узла (нейтраль не нужна), красная — «+», синяя — «−». Внутри мост из шести диодов EE: на выходе 1,5–1,73 амплитуды фазы без провалов в ноль.',
        recipe: { pattern: ['CDC', 'DPD', 'DDD'], key: { C: CONNECTOR, D: DIODE, P: PLATE } },
      },
      {
        id: 'ee_rectifier:single_phase_rectifier',
        name: 'Однофазный выпрямитель',
        image: '/addons/single_phase_rectifier.png',
        about:
          'Две медные клеммы — фаза и нейтраль (в любом порядке), красная — «+», синяя — «−». Мост из четырёх диодов EE; напряжение дважды за период падает до нуля — для ровного тока поставьте конденсатор EE параллельно выходу.',
        recipe: { pattern: ['CDC', 'DPD', ' D '], key: { C: CONNECTOR, D: DIODE, P: PLATE } },
      },
    ],
    verified: [
      'Собирается и загружается на сервере NeoForge 21.1.219 вместе с Create 6.0.10 и Electro Energetics 1.1.2.',
      'Блоки ставятся во всех положениях, EE создаёт для них электрические устройства, при сломе — удаляет.',
      'Клеммы модели совпадают с точками крепления проводов во всех 12 положениях (6 сторон × крен) — проверка кодом EE и Minecraft.',
      'В симуляции EE на тестовом сервере (провода протянуты кодом): от батарей переменного тока 100 В на нагреватель 45 Ом трёхфазный даёт 125 В, однофазный — 79 В; открыты нужные диоды, полярность верная.',
      'С настоящим трёхфазным генератором на тестовом сервере (2026-10-15): блоки дают ровно те же числа, что мост из отдельных диодов EE. Ровное напряжение — только если фаза между расчётами цепи сдвигается мало: при настройке сервера microTicks = 1 (по умолчанию) это до ~4 об/мин, при 32 — почти до 256 об/мин. Иначе выход скачет — это свойство диодов EE, а не блока. Подробно и что делать — гайд «Помпа на переменном токе».',
    ],
    notVerified: [
      'В игре с игроком: установка катушкой провода, рецепт в JEI/EMI (вид и работу проверил игрок 2026-10-15: значение нестабильно — причина найдена, см. выше).',
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
export const ADDONS_DEV_DOC = 'https://github.com/Jason1258t/tfc-plans/blob/main/docs/addons.md';
export const REPO_TREE = 'https://github.com/Jason1258t/tfc-plans/tree/main/';
