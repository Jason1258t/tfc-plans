import { unzip, type UnzipFileInfo } from 'fflate';

export const isDevReport = (name: string) => /\.report\.zip$/i.test(name);
export const reportTitle = (name: string) => name.replace(/\.report\.zip$/i, '');

export type ReportEntry = UnzipFileInfo & { index: number };

export function listReportEntries(data: Uint8Array): Promise<ReportEntry[]> {
  return new Promise((resolve, reject) => {
    if (data.length < 22) throw new Error('Файл не является ZIP-архивом.');
    const entries: ReportEntry[] = [];
    let index = 0;
    unzip(
      data,
      {
        filter: (entry) => {
          if (!entry.name.endsWith('/')) entries.push({ ...entry, index });
          index++;
          return false;
        },
      },
      (error) => (error ? reject(error) : resolve(entries)),
    );
  });
}

export const MAX_ENTRY_BYTES = 50 * 1024 * 1024;

export function readReportEntry(data: Uint8Array, entry: ReportEntry): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    if (entry.originalSize > MAX_ENTRY_BYTES || entry.size > MAX_ENTRY_BYTES)
      throw new Error('Файл слишком большой. Скачайте ZIP целиком.');
    let index = 0;
    unzip(data, { filter: () => index++ === entry.index }, (error, files) => {
      if (error) return reject(error);
      const bytes = Object.hasOwn(files, entry.name) ? files[entry.name] : undefined;
      if (!bytes || bytes.length !== entry.originalSize) return reject(new Error('Не удалось распаковать файл.'));
      resolve(new Uint8Array(bytes));
    });
  });
}

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  avif: 'image/avif',
  ico: 'image/x-icon',
};

export function reportImageType(name: string) {
  const ext = name.split('.').at(-1)?.toLowerCase() ?? '';
  return Object.hasOwn(IMAGE_TYPES, ext) ? IMAGE_TYPES[ext] : undefined;
}
