import { lazy, Suspense } from 'react';
import type { CatalogPlace } from '@/features/guides/GuidesCatalog';

const GuidesCatalog = lazy(() => import('@/features/guides/GuidesCatalog'));

/** Справочник → «Гайды»: общий каталог; аддонные статьи остаются на странице аддонов. */
export function GuidesTab(props: CatalogPlace & { onPlace: (p: CatalogPlace) => void }) {
  return (
    <Suspense fallback={<div className="empty">Загружаю гайды…</div>}>
      <GuidesCatalog {...props} />
    </Suspense>
  );
}
