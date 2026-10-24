import { Download, ExternalLink, RefreshCw, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  buildReport,
  sourceFound,
  STATUS_LABEL,
  STATUS_ORDER,
  type FreshMod,
  type FreshReport,
  type FreshStatus,
  type ManifestMod,
} from './model/freshness';
import { cx, timeAgo } from '@/shared/lib';
import './UpdatesPage.css';
import './FreshnessPage.css';

/** Переключатель «Лента / Свежесть модов» — общий для двух страниц обновлений */
export function UpdatesNav() {
  return (
    <nav className="seg upd-nav">
      <NavLink to="/updates" end>
        Лента обновлений
      </NavLink>
      <NavLink to="/freshness">Свежесть модов</NavLink>
    </nav>
  );
}

type Filter = 'outdated' | 'all' | FreshStatus;
const OUTDATED: FreshStatus[] = ['red', 'orange', 'yellow', 'unknown'];

const SOURCE_LABEL = { modrinth: 'Modrinth', curseforge: 'CurseForge', git: 'Гит сборки', own: 'наш аддон' } as const;

const fmtDate = (d?: string) => (d ? new Date(d).toLocaleDateString('ru-RU') : '');

/** Свежесть сборки: насколько моды отстают от новейших версий под 1.21.1 NeoForge (отчёт — scripts/freshness.mjs) */
export function FreshnessPage() {
  const [report, setReport] = useState<FreshReport | null | undefined>(undefined);
  const [filter, setFilter] = useState<Filter>('outdated');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/pack-freshness.json')
      .then((r) => (r.ok && r.headers.get('content-type')?.includes('json') ? r.json() : null))
      .then((r: FreshReport | null) => setReport(r?.mods ? r : null))
      .catch(() => setReport(null));
  }, []);

  /** Перепроверка в браузере: Modrinth и гит сборки заново, CurseForge — из отчёта (ключ в браузер не попадает) */
  const recheck = async () => {
    setBusy(true);
    setError(null);
    try {
      let mods: ManifestMod[] | undefined = report?.mods.map((m) => ({
        id: m.id,
        name: m.name,
        version: m.version,
        jar: m.jar,
        sha1: m.sha1,
        cf: m.cf,
      }));
      if (!mods) {
        const r = await fetch('/pack-manifest.json');
        if (!r.ok) throw new Error('снимок сборки pack-manifest.json не найден');
        mods = ((await r.json()) as { mods: ManifestMod[] }).mods;
      }
      const next = await buildReport(mods, {
        ownIds: report?.mods.filter((m) => m.status === 'own').map((m) => m.id),
        curseforgeKnown: report ? sourceFound(report, 'curseforge') : undefined,
        gitKnown: report ? sourceFound(report, 'git') : undefined,
        curseforgeState: report?.sources.curseforge,
        manifestBuiltAt: report?.manifestBuiltAt,
      });
      if (next.sources.modrinth.state === 'error') throw new Error(next.sources.modrinth.note);
      setReport(next);
    } catch (e) {
      setError(`Не удалось проверить: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const download = () => {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 1)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `pack-freshness-${new Date(report.generatedAt).toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const shown = useMemo(() => {
    if (!report) return [];
    const w = q.trim().toLowerCase();
    return report.mods.filter(
      (m) =>
        (filter === 'all' || (filter === 'outdated' ? OUTDATED.includes(m.status) : m.status === filter)) &&
        (!w || `${m.id} ${m.name} ${m.jar}`.toLowerCase().includes(w)),
    );
  }, [report, filter, q]);

  const outdated = report ? OUTDATED.reduce((n, s) => n + report.counts[s], 0) : 0;

  return (
    <main className="upd-page fresh-page">
      <UpdatesNav />
      <div className="upd-head">
        <h1>Свежесть сборки</h1>
        <p className="faint small">
          Новейшие версии модов под Minecraft 1.21.1 NeoForge с Modrinth, CurseForge и{' '}
          <a href="https://github.com/GranniXXie/TerraFirmaRebirth" target="_blank" rel="noreferrer">
            гита разработчиков сборки
          </a>{' '}
          (по файлу jar, не по названию). Цвет — по первой отличающейся цифре версии x.y.z:{' '}
          <span className="fresh-chip red">x</span> <span className="fresh-chip orange">y</span>{' '}
          <span className="fresh-chip yellow">z</span>. Цвет считается по последнему релизу, беты показаны рядом.
          Совместимость с нашими скриптами и датапаками здесь не проверяется.
        </p>
      </div>

      {report === undefined ? (
        <div className="empty">Загружаю…</div>
      ) : (
        <>
          <div className="fresh-meta">
            <div className="grow faint small">
              {report ? (
                <>
                  Проверено {timeAgo(report.generatedAt)} · модов {report.mods.length}
                  {(['modrinth', 'curseforge', 'git'] as const).map((k) => {
                    const s = report.sources[k];
                    if (!s) return null;
                    return (
                      <span key={k} className={cx(s.state !== 'ok' && 'fresh-warn')}>
                        {' '}
                        · {SOURCE_LABEL[k]}:{' '}
                        {s.state === 'ok'
                          ? `найдено ${s.found ?? 0}`
                          : s.state === 'skipped'
                            ? `пропущен${s.note ? ` (${s.note})` : ''}`
                            : `ошибка (${s.note})`}
                      </span>
                    );
                  })}
                </>
              ) : (
                'Отчёт ещё не собран (npm run freshness) — можно проверить Modrinth прямо отсюда.'
              )}
            </div>
            <button className="btn sm" onClick={() => void recheck()} disabled={busy}>
              <RefreshCw size={14} className={cx(busy && 'spin')} />
              {busy ? 'Проверяю…' : 'Перепроверить Modrinth и гит'}
            </button>
            {report && (
              <button className="btn sm ghost" onClick={download}>
                <Download size={14} />
                Скачать отчёт (JSON)
              </button>
            )}
          </div>
          {error && <div className="error small">{error}</div>}

          {report && (
            <>
              <div className="fresh-bar">
                <div className="seg fresh-filter" role="tablist">
                  <FilterBtn on={filter === 'outdated'} onClick={() => setFilter('outdated')} n={outdated}>
                    Устаревшие
                  </FilterBtn>
                  {STATUS_ORDER.filter((s) => report.counts[s]).map((s) => (
                    <FilterBtn key={s} on={filter === s} onClick={() => setFilter(s)} n={report.counts[s]}>
                      <span className={cx('fresh-dot', s)} />
                      {STATUS_LABEL[s]}
                    </FilterBtn>
                  ))}
                  <FilterBtn on={filter === 'all'} onClick={() => setFilter('all')} n={report.mods.length}>
                    Все
                  </FilterBtn>
                </div>
                <div className="fresh-search">
                  <Search size={15} className="faint" />
                  <input
                    className="input"
                    value={q}
                    placeholder="Мод, id или jar"
                    onChange={(e) => setQ(e.target.value)}
                  />
                </div>
              </div>
              {shown.length ? (
                <ul className="fresh-list">
                  {shown.map((m) => (
                    <ModRow key={m.id} mod={m} />
                  ))}
                </ul>
              ) : (
                <div className="empty">Ничего не подходит</div>
              )}
            </>
          )}
        </>
      )}
    </main>
  );
}

function FilterBtn({
  on,
  onClick,
  n,
  children,
}: {
  on: boolean;
  onClick: () => void;
  n: number;
  children: React.ReactNode;
}) {
  return (
    <button role="tab" aria-pressed={on} aria-selected={on} onClick={onClick}>
      {children}
      <span className="count">{n}</span>
    </button>
  );
}

function ModRow({ mod: m }: { mod: FreshMod }) {
  const days =
    m.latest?.date && m.current?.date
      ? Math.round((Date.parse(m.latest.date) - Date.parse(m.current.date)) / 864e5)
      : 0;
  return (
    <li className={cx('fresh-row', m.status)}>
      <span className={cx('fresh-dot', m.status)} title={STATUS_LABEL[m.status]} />
      <div className="fresh-main">
        <div className="fresh-name">
          <b>{m.project?.title ?? m.name}</b> <code className="faint">{m.id}</code>
        </div>
        <div className="fresh-ver">
          <span>{m.current?.version ?? m.version}</span>
          {m.latest && m.status !== 'ok' && (
            <>
              {' → '}
              {m.latest.url ? (
                <a href={m.latest.url} target="_blank" rel="noreferrer">
                  {m.latest.version}
                </a>
              ) : (
                <span>{m.latest.version}</span>
              )}
              {m.latest.type && m.latest.type !== 'release' && <span className="tag">{m.latest.type}</span>}
            </>
          )}
          {m.beta && (
            <span className="faint">
              {' '}
              · есть {m.beta.type}{' '}
              {m.beta.url ? (
                <a href={m.beta.url} target="_blank" rel="noreferrer">
                  {m.beta.version}
                </a>
              ) : (
                m.beta.version
              )}
            </span>
          )}
        </div>
        <div className="faint small">
          {m.status === 'missing'
            ? `Нет ни на Modrinth, ни на CurseForge (или файл собран вручную) · ${m.jar}`
            : m.status === 'own'
              ? `Аддон сборки из tools/ · ${m.jar}`
              : [
                  m.latest?.date && m.status !== 'ok' && `вышла ${fmtDate(m.latest.date)}`,
                  days > 0 && m.status !== 'ok' && `на ${days} дн. новее нашей`,
                  m.status === 'ok' && m.current?.date && `наша версия от ${fmtDate(m.current.date)}`,
                  m.jar,
                ]
                  .filter(Boolean)
                  .join(' · ')}
        </div>
        {m.newDeps?.length ? (
          <div className="fresh-deps small">
            Новые обязательные зависимости:{' '}
            {m.newDeps.map((d, i) => (
              <span key={d.name}>
                {i > 0 && ', '}
                {d.url ? (
                  <a href={d.url} target="_blank" rel="noreferrer">
                    {d.name}
                  </a>
                ) : (
                  d.name
                )}
              </span>
            ))}
          </div>
        ) : null}
        {m.note && <div className="faint small">{m.note}</div>}
      </div>
      {m.project?.url && m.source && m.source !== 'own' && (
        <a className="btn ghost sm fresh-src" href={m.project.url} target="_blank" rel="noreferrer">
          {SOURCE_LABEL[m.source]}
          <ExternalLink size={12} />
        </a>
      )}
    </li>
  );
}
