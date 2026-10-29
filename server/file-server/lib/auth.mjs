/** Проверка токенов Firebase — общая с сервером сборки (при установке install.sh кладёт сюда сам файл) */
// граница-ок: сервер ставится копированием папки без npm, install.sh кладёт сюда сам файл
export * from '../../pack-server/lib/firebase-auth.mjs';
