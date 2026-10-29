import { useEffect, useState } from 'react';

/** Подтверждённая версия из опубликованного снимка; живые правки карточки её не заменяют. */
export interface DatapackDeployment {
  id: string;
  name: string;
  path: string;
  sha256: string;
  contentHash: string;
  sourceUpdatedAt: number;
  confirmedAt: number;
  confirmedBy: string;
}

let pending: Promise<DatapackDeployment[] | null> | null = null;
export function useDatapackDeployments() {
  const [deployments, setDeployments] = useState<DatapackDeployment[] | null>(null);
  useEffect(() => {
    let active = true;
    pending ??= fetch(`${import.meta.env.BASE_URL}kubejs.json`)
      .then(async (r) =>
        r.ok && r.headers.get('content-type')?.includes('json') ? ((await r.json()).datapacks ?? []) : null,
      )
      .catch(() => null);
    pending.then((value) => {
      if (active) setDeployments(value);
    });
    return () => {
      active = false;
    };
  }, []);
  return deployments;
}
