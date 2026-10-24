/**
 * Временный общий выход типов: сами типы разрезаны по сущностям и лежат в `src/entities/<сущность>/types.ts`.
 * Новому коду — импорт оттуда (`@/entities/task`); этот файл удалится, когда остальные потребители переедут
 * (ветки `fsd-entities` и страниц). Реэкспорт идёт из внутренних файлов, а не через `index.ts`, чтобы импорт типов
 * не подтягивал хранилища коллекций (у них побочный эффект — подключение к Firestore).
 */
export type { ChecklistEntry, NewTask, Priority, Task, TaskPlace, TaskStatus } from './entities/task/types';
export { PRIORITIES, STATUSES } from './entities/task/types';
export type { Group, NewGroup } from './entities/group/types';
export type { SiteUser } from './entities/user/types';
export type { Artifact, NewArtifact } from './entities/artifact/types';
export type { Guide, GuideChecked, GuideRevision } from './entities/guide/types';
export type {
  Datapack,
  DatapackEntry,
  DatapackEntryKind,
  KubejsScript,
  NewDatapack,
  NewKubejsScript,
} from './entities/datapack/types';
export type {
  NewReplaceFavorite,
  NewSavedSchematic,
  ReplaceFavorite,
  SavedSchematic,
} from './entities/schematic/types';
