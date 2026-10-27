import { createLiveList } from '@/shared/api';
import { subscribeFiles, type FileMeta } from './files';

/** Вложения задач и исходники схем: одна подписка, пока список нужен компонентам. */
export const useFiles = createLiveList<FileMeta>((onItems, onError) => subscribeFiles(onItems, onError));
