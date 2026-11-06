import { KeyRound } from 'lucide-react';
import { useAccess } from '@/shared/api';
import { Button, EmptyState } from '@/shared/ui';
import { KeyHint, KeyInput } from '../KeyInput';
import { useKeyLogin } from '../useKeyLogin';
import styles from './KeyRequired.module.css';

interface Props {
  /** Название раздела: «Задачи», «Документы», «Разработка» */
  section: string;
  children: React.ReactNode;
}

/** Раздел только для игроков: без ключа вместо него — форма ключа */
export function KeyRequired({ section, children }: Props) {
  const access = useAccess();
  const login = useKeyLogin();
  if (access === 'player') return <>{children}</>;
  if (access === 'loading') return <EmptyState>Загрузка…</EmptyState>;
  const submit = () => {
    if (login.key.trim()) void login.submit();
  };
  return (
    <main className={styles.page}>
      <form
        className={styles.card}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <KeyRound size={28} className="faint" aria-hidden />
        <h2 className={styles.title}>{section} — только для игроков</h2>
        <p className="muted">
          Этот раздел открывается ключом игрока. Без ключа доступны справочник, схемы, датапаки и аддоны — для
          просмотра.
        </p>
        <KeyInput id="key-section" value={login.key} onChange={login.setKey} error={login.error} autoFocus />
        <Button type="submit" variant="primary" disabled={login.busy || !login.key.trim()}>
          {login.busy ? 'Проверяю…' : 'Войти'}
        </Button>
        <KeyHint />
      </form>
    </main>
  );
}
