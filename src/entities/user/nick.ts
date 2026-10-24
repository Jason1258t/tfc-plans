import { create } from 'zustand';
import { readNick, writeNick } from '@/shared/lib/nick';

interface NickState {
  /** Ник, под которым человек зашёл (null — спросить) */
  nick: string | null;
  /** Сохранить ник в cookie и в состоянии */
  save: (nick: string) => void;
}

const store = create<NickState>((set) => ({
  nick: readNick(),
  save: (nick) => {
    writeNick(nick);
    set({ nick });
  },
}));

/** Ник текущего заходившего (пустая строка — ещё не выбран) */
export const useNick = () => store((s) => s.nick ?? '');

/** Сохранить ник: cookie и состояние */
export const useSaveNick = () => store((s) => s.save);
