import type { AgentResult, RuleResult, Schematic } from '@/entities/schematic';

/** Итог умной замены: правила или агент — общая часть для панели и кнопки в панели инструментов */
export type SmartResult = ({ kind: 'rules' } & RuleResult) | ({ kind: 'agent' } & AgentResult);

/** Имя файла с заменами: «схема_tfc.nbt» */
export const outName = (name: string) => name.replace(/(\.nbt)?$/i, '_tfc.nbt');

/** Отпечаток замен одной схемы — понять, отличаются ли они от сохранённых в библиотеке */
export const replaceSig = (s: Schematic, replace: Map<string, string>) =>
  JSON.stringify([[...replace].filter(([from]) => s.counts.has(from)).sort(), s.shape, s.rev]);

/** Коротко о форме схемы — для свёрнутой строки файла */
export const shapeSummary = (shape: Schematic['shape']) =>
  [
    shape.crop && `обрезка ${shape.sides}/${shape.bottom}/${shape.top}`,
    shape.platform && `площадка ${shape.platformHeight}${shape.platformHollow ? ', пустая' : ''}`,
    shape.clearAir && 'очистка',
  ]
    .filter(Boolean)
    .join(' · ');

export const clampPad = (v: string) => Math.min(64, Math.max(0, Math.floor(Number(v)) || 0));
