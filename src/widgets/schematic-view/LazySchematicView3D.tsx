import { Suspense, lazy } from 'react';
import { cx } from '@/shared/lib';
import type { SchematicView3DProps } from './SchematicView3D';
import styles from './SchematicView3D.module.css';

// three.js — отдельным куском, грузится только когда 3D действительно показывают
const SchematicView3D = lazy(() => import('./SchematicView3D'));

/** 3D-вид схемы с ленивой загрузкой; пока грузится — надпись на месте вида */
export function LazySchematicView3D(props: SchematicView3DProps) {
  return (
    <Suspense fallback={<div className={cx(styles.view3D, 'faint', 'small')}>Загружаю 3D…</div>}>
      <SchematicView3D {...props} />
    </Suspense>
  );
}
