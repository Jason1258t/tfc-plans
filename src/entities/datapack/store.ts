import { createCollectionStore, createLocalStore, isPlayer, type CollectionStore } from '@/shared/api';
import type { Datapack, KubejsScript, NewDatapack, NewKubejsScript } from './types';

/** Общие датапаки сайта (`datapacks`): правка — только с ключом игрока */
const sharedDatapacks = createCollectionStore<Datapack, NewDatapack>('datapacks');
/** Временные датапаки без ключа: только в localStorage этого браузера, tfc pull их не видит */
const temporaryDatapacks = createLocalStore<Datapack, NewDatapack>('datapacks-temp');

let temporaryIds = new Set<string>();
temporaryDatapacks.subscribe((list) => (temporaryIds = new Set(list.map((p) => p.id))));

/**
 * Датапаки для редактора: общие + временные этого браузера. Без ключа новый датапак — временный
 * (его можно править и скачать ZIP, но не поставить через tfc pull); правка общего просит ключ.
 */
export const datapacksStore: CollectionStore<Datapack, NewDatapack> = {
  subscribe(cb, onError) {
    let shared: Datapack[] | null = null;
    let temporary: Datapack[] = [];
    const emit = () => shared && cb([...temporary, ...shared]);
    const stopTemporary = temporaryDatapacks.subscribe((list) => {
      temporary = list.map((p) => ({ ...p, temporary: true }));
      emit();
    });
    const stopShared = sharedDatapacks.subscribe((list) => {
      shared = list;
      emit();
    }, onError);
    return () => {
      stopTemporary();
      stopShared();
    };
  },
  add(data) {
    if (isPlayer()) return sharedDatapacks.add(data);
    return temporaryDatapacks.add({ ...data, install: false, installTarget: undefined });
  },
  update(id, patch) {
    if (!temporaryIds.has(id)) return sharedDatapacks.update(id, patch);
    // Временный в tfc pull не попадает — отметки установки ему не нужны
    const { install: _install, installTarget: _target, temporary: _temporary, ...rest } = patch;
    return temporaryDatapacks.update(id, rest);
  },
  async remove(ids) {
    const list = Array.isArray(ids) ? ids : [ids];
    const temporary = list.filter((id) => temporaryIds.has(id));
    const shared = list.filter((id) => !temporaryIds.has(id));
    if (temporary.length) await temporaryDatapacks.remove(temporary);
    if (shared.length) await sharedDatapacks.remove(shared);
  },
};

/** Временный датапак → общий на сайте (после входа с ключом); возвращает id нового */
export async function publishTemporaryDatapack(pack: Datapack, nick: string): Promise<string> {
  const { id, createdAt: _c, updatedAt: _u, temporary: _t, ...data } = pack;
  const newId = await sharedDatapacks.add({ ...data, install: false, author: nick, updatedBy: nick });
  await temporaryDatapacks.remove(id);
  return newId;
}

/** Скрипты KubeJS (`kubejsScripts`) */
export const kubejsScriptsStore = createCollectionStore<KubejsScript, NewKubejsScript>('kubejsScripts');
