import { useEffect, useRef } from 'react';
import { REMOVE, type Schematic } from '@/lib/schematic';
import { editCells } from '@/lib/schematicEdit';
import type { Menu } from './useLayerPointer';

interface Args {
  s: Schematic;
  menu: Menu | null;
  setMenu: (menu: Menu | null) => void;
  selected: ReadonlySet<number>;
  clearSelection: () => void;
  changeCells: (next: Schematic) => void;
  undo: () => void;
  redo: () => void;
  sy: number;
  setY: React.Dispatch<React.SetStateAction<number>>;
  onClose: () => void;
}

/**
 * Клавиши редактора слоёв: Esc (окно → выделение → закрыть), Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y, Delete,
 * стрелки и PageUp/PageDown для слоёв. В поле ввода — только Esc.
 */
export function useLayerKeys({
  s,
  menu,
  setMenu,
  selected,
  clearSelection,
  changeCells,
  undo,
  redo,
  sy,
  setY,
  onClose,
}: Args) {
  /** Delete: убрать выделенное — одной правкой, её можно отменить (через ref — свежие схема и выделение) */
  const removeSelected = useRef(() => {});
  useEffect(() => {
    removeSelected.current = () => {
      changeCells(editCells(s, [...selected], REMOVE));
      clearSelection();
      setMenu(null);
    };
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest('input, textarea');
      if (e.key === 'Escape') {
        // Список выбора предмета закрывается сам (и гасит событие); здесь — окно замены, потом редактор
        e.preventDefault();
        if (menu) setMenu(null);
        else if (selected.size) clearSelection();
        else onClose();
        return;
      }
      if (typing) return;
      // По физической клавише: в русской раскладке e.key — «я» и «н»
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.code === 'KeyZ') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.code === 'KeyY') {
        e.preventDefault();
        redo();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected.size) {
        e.preventDefault();
        removeSelected.current();
      } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault();
        setY((v) => Math.min(sy - 1, v + 1));
        setMenu(null);
      } else if (e.key === 'ArrowDown' || e.key === 'PageDown') {
        e.preventDefault();
        setY((v) => Math.max(0, v - 1));
        setMenu(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu, selected, onClose, undo, redo, sy, setMenu, setY, clearSelection]);
}
