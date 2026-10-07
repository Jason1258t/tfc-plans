import { defineConfig } from 'firestore-files/rules';

/**
 * Вложения задач (пакет firestore-files). Этот же конфиг читает генератор правил:
 * после правки — `npm run rules:files`, затем `npm run deploy:rules`.
 * Функции signedIn() и nick() объявлены в firestore.rules выше блока пакета.
 */
export default defineConfig({
  collection: 'files',
  maxFileSize: 25 * 1024 * 1024,
  chunkSize: 700 * 1024,
  rules: {
    read: 'signedIn()',
    write: 'signedIn()',
    delete: 'signedIn()',
    validate: 'nick($new.author) && ($new.taskId == null || $new.taskId is string)',
  },
});
