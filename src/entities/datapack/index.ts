/** Датапак и скрипты KubeJS: модель и коллекции. Снаружи — `@/entities/datapack`. */
export type { Datapack, DatapackEntry, DatapackEntryKind, KubejsScript, NewDatapack, NewKubejsScript } from './types';
export {
  datapackInstallMode,
  datapackInstallPatch,
  type DatapackInstallMode,
  type DatapackInstallTarget,
} from '@tfc/core/datapackFiles';
export { datapacksStore, kubejsScriptsStore, publishTemporaryDatapack } from './store';
export { useDatapackDeployments } from './deployments';
export type { DatapackDeployment } from './deployments';
