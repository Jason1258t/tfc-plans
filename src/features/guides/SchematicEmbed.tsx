import { ExternalLink } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BlockStructureViewer, shapeFromNbt, type BlockShape } from '@/entities/block-structure';
import { libraryEntry, libraryParsed, schematicLink, type SavedSchematic } from '@/entities/schematic';
import { errorText } from '@/shared/lib';
import { useGuideEditing } from './guideLinks';
import styles from './Guides.module.css';

const date = (t: number) =>
  new Date(t).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

type State =
  | { s: 'wait' }
  | { s: 'missing' }
  | { s: 'error'; message: string; entry?: SavedSchematic }
  | { s: 'ok'; entry: SavedSchematic; shape: BlockShape };

/** Грузим, только когда виджет докрутили до экрана: файл схемы — несколько чтений Firestore */
function useNearScreen<T extends Element>() {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    if (typeof IntersectionObserver === 'undefined') return setNear(true);
    const io = new IntersectionObserver((list) => list.some((e) => e.isIntersecting) && setNear(true), {
      rootMargin: '400px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  return [ref, near] as const;
}

/**
 * Виджет гайда «::schematic id=<id карточки> [ver=<updatedAt>] [layer=N] [materials]»: схема из библиотеки
 * в общем просмотре по слоям — с заменами и формой карточки, как её скачивают. Инструкция — в тексте гайда,
 * здесь только вид. ver — какой была карточка, когда её вставили: изменилась — пометка «схему поменяли».
 */
export default function SchematicEmbed({
  id,
  ver,
  layer,
  withMaterials,
}: {
  id: string;
  ver?: number;
  layer?: number;
  withMaterials?: boolean;
}) {
  const editing = useGuideEditing();
  const [ref, near] = useNearScreen<HTMLDivElement>();
  const [loaded, setState] = useState<{ id: string; state: State } | null>(null);
  // Сменили id (правка в редакторе) — пока грузится новая, старую не показываем
  const state: State = loaded?.id === id ? loaded.state : { s: 'wait' };
  useEffect(() => {
    if (!near || !id) return;
    let live = true;
    const done = (st: State) => live && setState({ id, state: st });
    libraryEntry(id)
      .then(async (entry) => {
        if (!entry) return done({ s: 'missing' });
        try {
          done({ s: 'ok', entry, shape: shapeFromNbt(await libraryParsed(entry)) });
        } catch (e) {
          done({ s: 'error', message: errorText(e), entry });
        }
      })
      .catch((e) => done({ s: 'error', message: errorText(e) }));
    return () => {
      live = false;
    };
  }, [id, near]);

  if (!id) return <div className="empty">Нужен id карточки схемы: ::schematic id=…</div>;
  const entry = state.s === 'ok' || state.s === 'error' ? state.entry : undefined;
  const changed = !!entry && typeof ver === 'number' && entry.updatedAt !== ver;
  return (
    <div ref={ref} className={styles.structureEmbed} aria-label="Схема из библиотеки">
      <div className={styles.structureHead}>
        <div className="grow">
          <b>{entry?.name ?? 'Схема из библиотеки'}</b>
          {state.s === 'ok' && (
            <div className="faint small">
              {state.shape.size.join('×')} (ширина × высота × глубина) · блоков {state.shape.blocks.length}
              {entry!.replace.length > 0 && <> · с заменами из карточки: {entry!.replace.length}</>} · {entry!.author}
            </div>
          )}
        </div>
        <Link to={schematicLink(id)} className="small">
          <ExternalLink size={13} /> Карточка в библиотеке
        </Link>
      </div>
      {changed && (
        <p className={styles.structureNote} role="note">
          Схему в библиотеке поменяли после того, как её вставили в гайд: {date(entry!.updatedAt)}, {entry!.updatedBy}.
          Проверьте, что текст гайда ей соответствует.
          {editing && (
            <>
              {' '}
              Проверили — замените в строке виджета <code>ver={ver}</code> на <code>ver={entry!.updatedAt}</code>.
            </>
          )}
        </p>
      )}
      {state.s === 'wait' && <div className="empty">{near ? 'Загружаю схему…' : 'Схема загрузится при прокрутке'}</div>}
      {state.s === 'missing' && (
        <div className="empty" role="alert">
          Схемы «{id}» нет в библиотеке: её удалили или id с ошибкой.
        </div>
      )}
      {state.s === 'error' && (
        <div className="empty" role="alert">
          Не удалось открыть схему: {state.message}
        </div>
      )}
      {state.s === 'ok' && (
        <BlockStructureViewer
          key={`${id}|${entry!.updatedAt}`}
          shape={state.shape}
          initialLayer={layer !== undefined ? layer - 1 : undefined}
          withMaterials={withMaterials}
        />
      )}
    </div>
  );
}
