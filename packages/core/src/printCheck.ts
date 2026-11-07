/**
 * Проверка печати схем пушкой Create (dev #303, #305): группы итога, причины и формат итога. Пишет инструмент
 * MCP schematic_print_check (scripts/mcp/tools/printcheck.mjs) и исполнитель на стенде, читает сайт.
 */

export type PrintGroup = 1 | 2 | 3 | 4;
export type PrintStatus = 'ok' | 'not_in_pack' | 'broken' | 'unclear';

/** Группы итога (худшая — итог схемы) */
export const PRINT_STATUS: Record<PrintGroup, { status: PrintStatus; text: string }> = {
  1: { status: 'ok', text: 'печатается полностью' },
  2: { status: 'not_in_pack', text: 'нет в сборке' },
  3: { status: 'broken', text: 'битое, чего редактор не видит' },
  4: { status: 'unclear', text: 'неясное — нужно разобраться' },
};

/** Причины: группа и текст для игрока */
export const PRINT_CODES: Record<string, [PrintGroup, string]> = {
  not_in_pack: [2, 'блока нет в сборке — замените его в редакторе схем'],
  not_loaded: [3, 'схема не загружается в пушку — пересохраните схему (старые или битые данные блоков)'],
  no_item: [3, 'у блока нет своего предмета — пушка его не ставит; замените блок'],
  wrong_state: [3, 'блок встаёт с другими свойствами'],
  lost_data: [3, 'теряются данные блок-сущности'],
  restart_replaces: [3, 'повторный запуск ставит блок заново — пушка считает готовый блок неверным'],
  missing: [4, 'блок не поставлен, причина неизвестна'],
  other_block: [4, 'на месте другой блок'],
  stuck: [4, 'пушка застряла'],
  overspend: [4, 'потрачено больше, чем нужно по схеме'],
  not_finished: [4, 'проверка не завершилась'],
  stand_error: [4, 'ошибка стенда или харнесса'],
};

/** Что делать игроку по причине (сайт показывает под причиной) */
export const PRINT_HINTS: Record<string, string> = {
  not_in_pack: 'Эти блоки отмечены в редакторе схемы как нераспознанные — замените их там.',
  not_loaded: 'Откройте схему в редакторе и сохраните заново: сайт при скачивании чинит старые данные копикатов.',
  no_item:
    'Замените блок в редакторе на ставящийся пушкой или поставьте его (сущность — рамку, стойку) руками после печати.',
  wrong_state: 'После печати проверьте эти блоки; без аддона Create: Schematic Fix повторный запуск их перестроит.',
  lost_data: 'Настройки блока (обшивка, содержимое) придётся выставить руками после печати.',
  restart_replaces: 'Не перезапускайте печать поверх готовой постройки без аддона Create: Schematic Fix.',
  not_finished:
    'Проверка повторится при следующем изменении схемы или сборки; если не пройдёт — сообщите в «Разработку».',
  stand_error: 'Ошибка проверки, а не схемы: сообщите в «Разработку».',
};

export interface PrintProblem {
  group: PrintGroup;
  code: string;
  text: string;
  /** id блока схемы; from — что стоит на его месте в мире */
  block: string | null;
  from?: string;
  cells: number;
  /** Пример клетки или кусок лога */
  example: string;
}

export interface PrintSite {
  mode: 'survival' | 'creative';
  group: PrintGroup;
  status: PrintStatus;
  required?: Record<string, number> | null;
  placed?: number | null;
  toPlace?: number | null;
  sec?: number | null;
  mismatch?: number | null;
  /** Точный расход (выживание): предмет → штук */
  spent?: Record<string, number> | null;
  restart?: { placed: number; sec: number; mismatch: number; spent: Record<string, number> | null } | null;
  problems: PrintProblem[];
}

export interface PrintSchematic {
  id: string;
  name: string;
  revision: string | null;
  size?: number[];
  status: PrintStatus;
  group: PrintGroup;
  sites: PrintSite[];
}
