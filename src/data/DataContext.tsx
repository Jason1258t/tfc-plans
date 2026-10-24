import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Artifact, Group, SiteUser, Task } from '../types';
import { subscribeFiles, type FileMeta } from '../lib/files';
import { artifactsStore } from '@/entities/artifact';
import { groupsStore } from '@/entities/group';
import { tasksStore } from '@/entities/task';
import { subscribeUsers, touchPresence } from './users';

interface Data {
  tasks: Task[];
  groups: Group[];
  artifacts: Artifact[];
  files: FileMeta[];
  /** Справочник заходивших на сайт (users/{ник}) */
  users: SiteUser[];
  /** Все известные ники: заходившие + авторы/исполнители задач, авторы документов и групп */
  people: SiteUser[];
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
  const [users, setUsers] = useState<SiteUser[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Каждый заход отмечает ник в справочнике участников (users/{ник})
  useEffect(() => {
    void touchPresence(nick);
  }, [nick]);

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
      subscribeUsers(setUsers, onError),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

  // «Люди» — не только заходившие браузером: агенты и игроки, назначенные на задачи, тоже видны
  // (у них lastSeen = 0 — «только в задачах»)
  const people = useMemo<SiteUser[]>(() => {
    const map = new Map<string, SiteUser>();
    for (const u of users) map.set(u.id, u);
    const add = (name?: string | null) => {
      if (!name || map.has(name)) return;
      map.set(name, { id: name, nick: name, uid: null, firstSeen: 0, lastSeen: 0 });
    };
    for (const t of tasks ?? []) {
      add(t.author);
      add(t.assignee);
    }
    for (const g of groups ?? []) add(g.author);
    for (const a of artifacts ?? []) {
      add(a.author);
      add(a.updatedBy);
    }
    return [...map.values()];
  }, [users, tasks, groups, artifacts]);

  const value = useMemo<Data>(
    () => ({
      tasks: tasks ?? [],
      groups: groups ?? [],
      artifacts: artifacts ?? [],
      files,
      users,
      people,
      loading: !tasks || !groups || !artifacts,
      error,
      nick,
    }),
    [tasks, groups, artifacts, files, users, people, error, nick],
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
