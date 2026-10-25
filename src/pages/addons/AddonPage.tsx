import { ArrowLeft } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AddonHead, AddonInstall } from '@/features/reference-tabs';
import { addonById } from '@/lib/addons';
import '@/pages/reference/ReferenceShared.css';
import '@/features/reference-tabs/PowerShared.css';
import shell from '@/pages/reference/ReferenceShell.module.css';

const AddonArticle = lazy(() => import('@/features/guides/AddonArticle'));
const AddonVersions = lazy(() => import('@/features/guides/AddonVersions'));

/** Страница аддона /addons/<мод>: карточка (версия, скачать, как поставить), версии с ченджлогами и подробное описание-статья */
export function AddonPage() {
  const { id } = useParams();
  const a = addonById(id);
  return (
    <main className={shell.page}>
      <Link className="btn ghost small power-back" to="/addons">
        <ArrowLeft size={14} /> Все аддоны
      </Link>
      {!a ? (
        <div className="empty">Аддона «{id}» нет — возможно, ссылка устарела</div>
      ) : (
        <div className="power">
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
