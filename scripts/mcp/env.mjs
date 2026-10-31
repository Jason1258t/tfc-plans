/**
 * Переменные окружения MCP-серверов (tfc-pack и tfc-plans-dev). Не все агенты раскрывают в конфиге запись
 * `${VAR:-default}` — Kimi Work передаёт её как есть, — поэтому раскрываем сами.
 */
import os from 'node:os';

/** Значение переменной; нераскрытое `${VAR}` / `${VAR:-default}` раскрывается здесь, `~` в начале — домашний каталог */
export function envValue(name) {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  const value = raw
    .replace(/\$\{(\w+)(?::-([^}]*))?\}/g, (whole, v, def) => {
      const x = process.env[v]?.trim();
      // Сама переменная содержит свою же нераскрытую запись — значит, снаружи она не задана
      return x && x !== raw && !x.includes('${') ? x : (def ?? '');
    })
    .trim();
  return value ? value.replace(/^~(?=\/|$)/, os.homedir()) : undefined;
}

const NAMES = { claude: 'Claude', codex: 'Codex', gemini: 'Gemini', cursor: 'Cursor', opencode: 'OpenCode' };
Object.assign(NAMES, { deepseek: 'DeepSeek', kimi: 'Kimi' });

/** Подпись, когда агента не узнали: заметна в журнале, чтобы её исправили, а не приняли за Claude */
export const UNKNOWN_NICK = 'Агент?';

/**
 * Агент, запустивший сервер, — по его переменным окружения. Проверено на этом Mac: Claude Code (CLAUDECODE,
 * AI_AGENT=claude-code_…), Kimi Work (KIMI_*). Остальные метки — общепринятые, на запуске MCP не проверялись.
 */
function harnessNick() {
  const env = process.env;
  if (env.CLAUDECODE) return 'Claude';
  if (Object.keys(env).some((k) => k.startsWith('KIMI_'))) return 'Kimi';
  // AI_AGENT — общая метка нескольких агентов: «claude-code_2-1-308_agent», «codex», …
  const tag = env.AI_AGENT?.trim().toLowerCase();
  if (tag)
    return (
      NAMES[Object.keys(NAMES).find((k) => tag.startsWith(k))] ?? tag[0].toUpperCase() + tag.split(/[_\s]/)[0].slice(1)
    );
  if (env.CODEX_SANDBOX || env.CODEX_THREAD_ID) return 'Codex';
  if (env.GEMINI_CLI) return 'Gemini';
  if (env.CURSOR_AGENT || env.CURSOR_TRACE_ID) return 'Cursor';
  if (env.OPENCODE || env.OPENCODE_CLIENT) return 'OpenCode';
  return UNKNOWN_NICK;
}

/** Подпись записей: TFC_AGENT_NICK, иначе имя агента, который запустил сервер */
export const NICK = envValue('TFC_AGENT_NICK') || harnessNick();
if (NICK === UNKNOWN_NICK)
  console.error(
    `[tfc] агент не определён — записи подписываются «${UNKNOWN_NICK}»; задай TFC_AGENT_NICK (docs/agents.md)`,
  );
