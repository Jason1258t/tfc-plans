import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Artifact, Group, Task } from '../types';
import { subscribeFiles, type FileMeta } from '../lib/files';
import { artifactsStore, groupsStore, tasksStore } from './store';

interface Data {
  tasks: Task[];
  groups: Group[];
  artifacts: Artifact[];
  files: FileMeta[];
  loading: boolean;
  error: string | null;
  nick: string;
}

const Ctx = createContext<Data | null>(null);

export function DataProvider({ nick, children }: { nick: string; children: ReactNode }) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [artifacts, setArtifacts] = useState<Artifact[] | null>(null);
  const [files, setFiles] = useState<FileMeta[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onError = (e: Error) => setError(e.message);
    const unsubs = [
      tasksStore.subscribe((t) => setTasks(t.map(normalizeTask)), onError),
      groupsStore.subscribe(
        (g) => setGroups([...g].sort((a, b) => a.order - b.order || a.createdAt - b.createdAt)),
        onError,
      ),
      artifactsStore.subscribe(setArtifacts, onError),
      subscribeFiles(setFiles, onError),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

  const value = useMemo<Data>(
    () => ({
      tasks: tasks ?? [],
      groups: groups ?? [],
      artifacts: artifacts ?? [],
      files,
      loading: !tasks || !groups || !artifacts,
      error,
      nick,
    }),
    [tasks, groups, artifacts, files, error, nick],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Подстраховка от документов, созданных старыми версиями приложения */
function normalizeTask(t: Task): Task {
  return {
    ...t,
    description: t.description ?? '',
    status: t.status ?? 'todo',
    priority: t.priority ?? 1,
    rating: t.rating ?? 1000,
    checklist: t.checklist ?? [],
    groupId: t.groupId ?? null,
  };
}

export function useData(): Data {
  const v = useContext(Ctx);
  if (!v) throw new Error('useData вне DataProvider');
  return v;
}
