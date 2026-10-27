import { ArrowLeft } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { useParams } from 'react-router-dom';
import { AddonHead, AddonInstall } from '@/features/reference-tabs';
import { addonById } from '@/lib/addons';
import { ButtonLink, Card, contentStyles as content } from '@/shared/ui';
import shell from '@/pages/reference/ReferenceShell.module.css';

const AddonArticle = lazy(() => import('@/features/guides/AddonArticle'));
const AddonVersions = lazy(() => import('@/features/guides/AddonVersions'));

/** Страница аддона /addons/<мод>: карточка (версия, скачать, как поставить), версии с ченджлогами и подробное описание-статья */
export function AddonPage() {
  const { id } = useParams();
  const a = addonById(id);
  return (
    <main className={shell.page}>
      <ButtonLink variant="ghost" size="sm" className={content.back} to="/addons">
        <ArrowLeft size={14} /> Все аддоны
      </ButtonLink>
      {!a ? (
        <div className="empty">Аддона «{id}» нет — возможно, ссылка устарела</div>
      ) : (
        <div className={content.stack}>
          <Card>
            <AddonHead a={a} title={a.name} />
            <p>{a.summary}</p>
            <AddonInstall a={a} />
          </Card>
          <Suspense fallback={<div className="empty">Загружаю описание…</div>}>
            <AddonVersions key={a.id} addon={a} />
            <AddonArticle addon={a} />
          </Suspense>
        </div>
      )}
    </main>
  );
}
