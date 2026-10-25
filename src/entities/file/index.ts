/** Файлы сайта: вложения задач и исходники схем. Снаружи — `@/entities/file`. */
export {
  downloadFile,
  fileBlob,
  fileUrl,
  filesEnabled,
  formatSize,
  MAX_FILE_SIZE,
  removeFile,
  subscribeFiles,
  uploadFile,
  type FileMeta,
} from './files';
export { startFiles, useFiles } from './store';
