import { useState } from 'react';
import { BlockStructureEmbed } from '@/features/reference-tabs';
import { Segmented } from '@/shared/ui';
import { PUMPJACK_STRUCTURES } from './pumpjackStructures';

/** Обе схемы игрока — в том же просмотре по слоям, что экскаватор. */
export function PumpjackStructure() {
  const [size, setSize] = useState<'small' | 'big'>('small');
  return (
    <section aria-label="Блочная схема станка-качалки">
      <Segmented
        label="Размер качалки"
        value={size}
        onChange={setSize}
        options={[
          { value: 'small', label: 'Малая' },
          { value: 'big', label: 'Большая' },
        ]}
      />
      <BlockStructureEmbed
        title={size === 'small' ? 'Малая качалка · oil_pump_small' : 'Большая качалка · oil_pump_big'}
        shape={PUMPJACK_STRUCTURES[size]}
        initialLayer={PUMPJACK_STRUCTURES[size].size[1] - 2}
      />
      <p className="faint small">
        Схематичный вид блоков из присланных .nbt: тяните, чтобы повернуть, переключайте слои снизу вверх. Тройник,
        скважину, отвод и вращение нужно добавить отдельно. Ориентацию деталей проверяйте по инструкции.
      </p>
    </section>
  );
}
