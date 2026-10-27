import { useSearchParams } from 'react-router-dom';
import { AddonsTab } from '@/features/reference-tabs';
import shell from '@/pages/reference/ReferenceShell.module.css';

/** Свои моды группы и гайды «как написать свой». Прежний адрес — /reference?tab=addons. */
export function AddonsPage() {
  const [params, setParams] = useSearchParams();
  return (
    <main className={shell.page}>
      <div className={shell.head}>
        <div className="grow">
          <h1>Аддоны</h1>
          <p className="faint small">
            Маленькие моды, которые группа сделала сама под эту сборку, и как написать свой.
          </p>
        </div>
      </div>
      <AddonsTab
        sub={params.get('sub') === 'guides' ? 'guides' : 'list'}
        onSub={(k) => setParams(k === 'list' ? {} : { sub: k }, { replace: true })}
        guide={params.get('g')}
        onGuide={(g) => setParams(g ? { sub: 'guides', g } : { sub: 'guides' })}
      />
    </main>
  );
}
