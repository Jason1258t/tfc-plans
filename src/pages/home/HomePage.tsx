import {
  ArrowRight,
  Bell,
  BookOpen,
  Boxes,
  Code2,
  FileText,
  Hammer,
  ListChecks,
  Map,
  Package,
  Search as SearchIcon,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search } from '@/shared/ui';
import { matchesNavigation, type NavigationSearchItem } from './model';
import styles from './HomePage.module.css';

type Group = 'game' | 'work' | 'extra';
interface NavigationItem extends NavigationSearchItem {
  to: string;
  icon: LucideIcon;
  group: Group;
}

const GROUPS: { id: Group; title: string }[] = [
  { id: 'game', title: 'Игра и знания' },
  { id: 'work', title: 'Работа группы' },
  { id: 'extra', title: 'Ещё' },
];

const ITEMS: NavigationItem[] = [
  {
    to: '/reference',
    title: 'Справочник',
    description: 'Руды, рецепты, предметы, еда, электричество и другие данные сборки.',
    keywords: 'мир ресурсы переработка рецепты предметы теги топливо ботаника мультиблоки вики',
    icon: BookOpen,
    group: 'game',
  },
  {
    to: '/reference?tab=items&sub=recipes',
    title: 'Предметы и рецепты',
    description: 'Как получить предмет, где он используется и в какие теги входит.',
    keywords: 'рецепты предметы теги получить использование крафт',
    icon: BookOpen,
    group: 'game',
  },
  {
    to: '/reference?tab=guides',
    title: 'Гайды',
    description: 'Пошаговые статьи, схемы и калькуляторы для механизмов сборки.',
    keywords: 'руководства обучение электричество машины добыча помощь',
    icon: Boxes,
    group: 'game',
  },
  {
    to: '/reference?tab=world&sub=map',
    title: 'Карта мира',
    description: 'Координаты, города, расстояния, климат и места задач.',
    keywords: 'география города точки маршрут атлас',
    icon: Map,
    group: 'game',
  },
  {
    to: '/addons',
    title: 'Аддоны',
    description: 'Моды, которые группа разрабатывает специально для этой сборки.',
    keywords: 'моды версии скачать обновления',
    icon: Package,
    group: 'game',
  },
  {
    to: '/tasks',
    title: 'Задачи',
    description: 'Общие планы, приоритеты, ресурсы и исполнители.',
    keywords: 'планы чеклист работа участники',
    icon: ListChecks,
    group: 'work',
  },
  {
    to: '/schematics',
    title: 'Схемы Create',
    description: 'Библиотека построек, замена блоков, слои и 3D-просмотр.',
    keywords: 'nbt чертежи механизмы постройки',
    icon: Boxes,
    group: 'work',
  },
  {
    to: '/datapacks',
    title: 'Датапаки',
    description: 'Изменение рецептов, файлы датапаков и скрипты KubeJS.',
    keywords: 'редактор сборки скрипты kubejs',
    icon: Wrench,
    group: 'work',
  },
  {
    to: '/docs',
    title: 'Документы',
    description: 'Файлы и вложения задач, схем и датапаков в одном месте.',
    keywords: 'файлы хранилище вложения',
    icon: FileText,
    group: 'work',
  },
  {
    to: '/builder',
    title: 'Конструктор построек',
    description: 'Сгенерировать здание и сохранить его как схему Create.',
    keywords: 'здания дома генератор nbt',
    icon: Hammer,
    group: 'extra',
  },
  {
    to: '/updates',
    title: 'Обновления сборки',
    description: 'Что изменилось в сборке и насколько свежи установленные моды.',
    keywords: 'лента версии freshness моды',
    icon: Bell,
    group: 'extra',
  },
  {
    to: '/dev',
    title: 'Разработка',
    description: 'Задачи разработчиков, краш-репорты и технические журналы.',
    keywords: 'разработчики ошибки логи отчеты',
    icon: Code2,
    group: 'extra',
  },
];

/** Точка входа: игровая справка и рабочие инструменты в одном навигационном указателе. */
export function HomePage() {
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const visible = useMemo(() => ITEMS.filter((item) => matchesNavigation(item, query)), [query]);

  return (
    <main className={styles.page}>
      <section className={styles.hero} aria-labelledby="home-title">
        <h1 id="home-title">TFC Studio</h1>
        <p>Задачи группы, игровая вики и инструменты для TerraFirmaCraft RealWorld.</p>
        <Search className={styles.search}>
          <SearchIcon size={18} className="faint" aria-hidden />
          <input
            aria-label="Поиск по разделам"
            placeholder="Что хотите найти: руды, схемы, рецепты…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && query.trim() && visible[0]) {
                event.preventDefault();
                navigate(visible[0].to);
              }
            }}
          />
        </Search>
        <p className="faint small">Поиск по разделам сайта. Id конкретного предмета ищите через Ctrl/Cmd+K.</p>
      </section>

      {visible.length === 0 ? (
        <div className="empty" role="status">
          Раздел не найден. Попробуйте другое слово или откройте справочник.
        </div>
      ) : (
        GROUPS.map((group) => {
          const items = visible.filter((item) => item.group === group.id);
          if (!items.length) return null;
          return (
            <section key={group.id} className={styles.section} aria-labelledby={`home-${group.id}`}>
              <h2 id={`home-${group.id}`}>{group.title}</h2>
              <div className={styles.grid}>
                {items.map((item) => (
                  <Link key={item.to} to={item.to} className={styles.card}>
                    <span className={styles.cardIcon} aria-hidden>
                      <item.icon size={22} strokeWidth={1.6} />
                    </span>
                    <span className={styles.cardText}>
                      <span className={styles.cardTitle}>{item.title}</span>
                      <span className={styles.cardDescription}>{item.description}</span>
                    </span>
                    <ArrowRight className={styles.cardArrow} size={17} aria-hidden />
                  </Link>
                ))}
              </div>
            </section>
          );
        })
      )}
    </main>
  );
}
