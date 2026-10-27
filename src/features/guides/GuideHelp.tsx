import { X } from 'lucide-react';
import { useState } from 'react';
import { cx } from '@/shared/lib';
import { Button, Input, Card } from '@/shared/ui';
import type { GuideKit } from './GuideBody';
import styles from './Guides.module.css';

const CALC_EXAMPLE = `\`\`\`calc
title: Калькулятор линии
inputs:
  kw:   { label: Мощность, default: 20, min: 0.1, unit: кВт }
  wire: { label: Провод, list: wires, default: heavily_insulated }
  k:    { label: Повысить в, default: 10, min: 1, max: 50, step: 0.5 }
  earth: { label: Обратно через землю, toggle: true }
let:
  i: kw * 1000 / (300 * k)
outputs:
  - label: Ток в проводе
    value: i
    fmt: 1 А
    bad: i > wire.maxI
    hint: "искрит с {{wire.warnI | 0 А}}"
  - label: Трансформатор
    text: "{{if(kw * 1000 <= trMax, 'хватит одноблочных', 'нужен магнитопровод')}}"
notes:
  - text: Провод голый — бьёт током при касании
    when: wire.insulation == 0
    bad: true
chart:
  values: "map(range(0, 19), t => sin(t * 40) * 100)"
  left: 1 тик
  right: 20 тиков
table:
  rows: wires
  columns:
    - { title: Провод, text: "[[{{row.item}}|icon]] {{row.label}}" }
    - { title: Ом на 100 м, value: row.ohmPerM * 100, fmt: 2, num: true }
footer: Мелкий текст под калькулятором
\`\`\``;

/** Справка редактора: вставки, калькулятор, имена формул и виджеты раздела */
export function GuideHelp({ kit, onClose }: { kit: GuideKit; onClose: () => void }) {
  const [q, setQ] = useState('');
  const names = Object.entries(kit.scope.docs).filter(
    ([k, d]) => !q || k.toLowerCase().includes(q.toLowerCase()) || d.doc.toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <Card as="div" className={styles.guideHelp}>
      <Button variant="ghost" className={cx('small', styles.guideHelpClose)} onClick={onClose} title="Закрыть справку">
        <X size={14} />
      </Button>
      <div className={styles.guideHelpCols}>
        <div>
          <h3>Вставки в тексте</h3>
          <ul className="small">
            <li>
              <code>{'{{ee.Voltages.wireMaxVoltage | В}}'}</code> — число из настроек сервера (со значком «сервер», если
              сервер поменял значение мода). После <code>|</code> — формат: знаков после запятой, <code>watts</code>,{' '}
              <code>pct</code>, единица: <code>{'{{x | 1 В}}'}</code>.
            </li>
            <li>
              <code>{'{{alternator(4, 64).emf | В}}'}</code> — любая формула (имена справа).
            </li>
            <li>
              <code>[[electroenergetics:stator]]</code> — предмет со значком; <code>[[id|icon]]</code> — только значок.
            </li>
            <li>
              <code>[текст](guide:id)</code> — ссылка на другой гайд (id — из адреса, <code>g=…</code>);{' '}
              <code>[текст](/reference?tab=guides)</code> — на раздел сайта.
            </li>
            <li>
              <code>&gt; текст</code> — плашка-заметка. Заголовки — <code>##</code>, таблицы — как в Markdown.
            </li>
            <li>
              Строка <code>::имя параметры</code> — виджет раздела (список ниже).
            </li>
            <li>
              Блок <code>```define</code> с «имя: формула» по строкам — свои имена для всей статьи (блок не виден).
            </li>
          </ul>
          <h3>Калькулятор</h3>
          <p className="small">
            Блок <code>```calc</code> в формате YAML. Поля ввода — <code>inputs</code> (число; выбор —{' '}
            <code>options</code> или <code>list</code>; <code>toggle</code> — галочка; <code>picker</code> — кнопка
            подбора), промежуточные — <code>let</code>, плашки — <code>outputs</code> (<code>value</code> +{' '}
            <code>fmt</code> или <code>text</code>; <code>hint</code>, <code>bad</code>, <code>warn</code>,{' '}
            <code>when</code>), ещё <code>notes</code>, <code>chart</code> (столбики), <code>table</code>,{' '}
            <code>footer</code>. Без полей ввода блок — просто таблица в тексте. Значения, которые начинаются с{' '}
            <code>{'{{'}</code> или <code>[</code>, и формулы с <code>a ? b : c</code> — в кавычках; в короткой записи{' '}
            <code>{'{ label: …, value: … }'}</code> запятая разделяет поля, поэтому формулу с запятой (
            <code>max(a, b)</code>) пишите в кавычках или отдельной строкой; вместо <code>?:</code> удобнее{' '}
            <code>if(условие, то, иначе)</code>.
          </p>
          <pre className={styles.guideHelpPre}>{CALC_EXAMPLE}</pre>
          <p className="small">
            Формулы: <code>+ - * / ^ %</code>, <code>== != &lt; &lt;= &gt; &gt;=</code>, <code>and or not</code>,{' '}
            <code>obj.поле</code>, <code>список[0]</code>, <code>x =&gt; x * 2</code>. Ошибка в формуле видна на месте,
            статья всё равно откроется.
          </p>
        </div>
        <div>
          <h3>Имена в формулах</h3>
          <Input placeholder="Найти…" value={q} onChange={(e) => setQ(e.target.value)} />
          <dl className={cx(styles.guideHelpNames, 'small')}>
            {names.map(([k, d]) => (
              <div key={k}>
                <dt>
                  <code>{d.sig}</code>
                </dt>
                <dd className="faint">{d.doc}</dd>
              </div>
            ))}
          </dl>
          <h3>Виджеты</h3>
          <dl className={cx(styles.guideHelpNames, 'small')}>
            {Object.entries(kit.widgets).map(([k, w]) => (
              <div key={k}>
                <dt>
                  <code>::{k}</code>
                </dt>
                <dd className="faint">{w.doc}</dd>
              </div>
            ))}
            {Object.entries(kit.pickers ?? {}).map(([k, p]) => (
              <div key={k}>
                <dt>
                  <code>picker: {k}</code>
                </dt>
                <dd className="faint">
                  у числового поля — кнопка «{p.label}» (значение в ваттах; у поля в кВт — в кВт)
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </Card>
  );
}
