import { ArrowLeft } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AddonHead, AddonInstall } from '../components/AddonsTab';
import { addonById } from '../lib/addons';
import '../components/BotanyTab.css';
import '../components/PowerTab.css';
import './ReferencePage.css';

const AddonArticle = lazy(() => import('../components/guides/AddonArticle'));
const AddonVersions = lazy(() => import('../components/guides/AddonVersions'));

/** Страница аддона /addons/<мод>: карточка (версия, скачать, как поставить), версии с ченджлогами и подробное описание-статья */
export function AddonPage() {
  const { id } = useParams();
  const a = addonById(id);
  return (
    <main className="ref-page">
      <Link className="btn ghost small power-back" to="/addons">
        <ArrowLeft size={14} /> Все аддоны
      </Link>
      {!a ? (
        <div className="empty">Аддона «{id}» нет — возможно, ссылка устарела</div>
      ) : (
        <div className="power addon-page">
          <section className="ref-card">
            <AddonHead a={a} title={a.name} />
            <p>{a.summary}</p>
            <AddonInstall a={a} />
          </section>
          <Suspense fallback={<div className="empty">Загружаю описание…</div>}>
            <AddonVersions key={a.id} addon={a} />
            <AddonArticle addon={a} />
          </Suspense>
        </div>
      )}
    </main>
  );
}
