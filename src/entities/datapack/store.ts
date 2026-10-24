import { createCollectionStore } from '@/shared/api';
import type { Datapack, KubejsScript, NewDatapack, NewKubejsScript } from './types';

/** Коллекции датапаков (`datapacks`) и скриптов KubeJS (`kubejsScripts`) */
export const datapacksStore = createCollectionStore<Datapack, NewDatapack>('datapacks');
export const kubejsScriptsStore = createCollectionStore<KubejsScript, NewKubejsScript>('kubejsScripts');
