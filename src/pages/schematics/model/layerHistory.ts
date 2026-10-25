import { useCallback, useState } from 'react';
import { canRedo, canUndo, redoEdit, undoEdit } from '@/lib/schematicEdit';
import type { Schematic } from '@/lib/schematic';

/**
 * Действие редактора для отмены/повтора: правка клеток (снимки — в schematicEdit) или общая замена
 * из окна (до и после; null — замены нет). Список — на схему, переживает закрытие редактора.
 */
export type Action = { kind: 'cells' } | { kind: 'global'; id: string; before: string | null; after: string | null };
const actionLog = new WeakMap<Schematic['parsed'], { undo: Action[]; redo: Action[] }>();
const MAX_ACTIONS = 200;

function logOf(s: Schematic) {
  let l = actionLog.get(s.parsed);
  if (!l) actionLog.set(s.parsed, (l = { undo: [], redo: [] }));
  return l;
}

/** Новое действие: в отмену, повтор сбрасывается */
function recordAction(s: Schematic, a: Action) {
  const l = logOf(s);
  l.undo.push(a);
  if (l.undo.length > MAX_ACTIONS) l.undo.shift();
  l.redo = [];
}

/** Снять действие из отмены (или повтора) и переложить в другой список */
function takeAction(s: Schematic, dir: 'undo' | 'redo') {
  const l = logOf(s);
  const a = (dir === 'undo' ? l.undo : l.redo).pop();
  if (a) (dir === 'undo' ? l.redo : l.undo).push(a);
  return a;
}

/**
 * История редактора слоёв: правка клеток идёт через снимки schematicEdit, общие замены — через свой список.
 * Возвращает списки для кнопок и функции правки/отмены/повтора.
 */
export function useLayerHistory(
  s: Schematic,
  replace: Map<string, string>,
  onChange: (s: Schematic) => void,
  onSetTarget: (id: string, to: string | null) => void,
  closeMenu: () => void,
) {
  const [, bumpLog] = useState(0);
  const { undo: undoList, redo: redoList } = logOf(s);
  const record = (a: Action) => {
    recordAction(s, a);
    bumpLog((n) => n + 1);
  };
  /** Правка клеток — через историю схемы */
  const changeCells = (next: Schematic) => {
    if (next === s) return;
    record({ kind: 'cells' });
    onChange(next);
  };
  const setGlobal = (id: string, after: string | null) => {
    const before = replace.get(id) ?? null;
    if (before === after) return;
    record({ kind: 'global', id, before, after });
    onSetTarget(id, after);
  };

  const step = useCallback(
    (dir: 'undo' | 'redo') => {
      const a = takeAction(s, dir);
      if (!a) return;
      closeMenu();
      bumpLog((n) => n + 1);
      if (a.kind === 'global') onSetTarget(a.id, dir === 'undo' ? a.before : a.after);
      else if (dir === 'undo' ? canUndo(s) : canRedo(s)) onChange(dir === 'undo' ? undoEdit(s) : redoEdit(s));
    },
    [s, onChange, onSetTarget, closeMenu],
  );
  const undo = useCallback(() => step('undo'), [step]);
  const redo = useCallback(() => step('redo'), [step]);

  return { undoList, redoList, changeCells, setGlobal, undo, redo, canRevert: canUndo(s) };
}
