import { Input, Label } from '@/shared/ui';

interface Props {
  id: string;
  value: string;
  onChange: (value: string) => void;
  error: string | null;
  autoFocus?: boolean;
  /** Подпись поля; по умолчанию — «Ключ игрока» */
  label?: string;
}

/** Поле ключа `tfc_…`: скрытый ввод, браузер не предлагает сохранить как пароль сайта */
export function KeyInput({ id, value, onChange, error, autoFocus, label = 'Ключ игрока' }: Props) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="password"
        className="mono-input"
        value={value}
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
        placeholder="tfc_…"
        onChange={(e) => onChange(e.target.value)}
      />
      {error && (
        <div className="small" style={{ color: 'var(--danger)', marginTop: 4 }} role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

/** Откуда взять ключ — одна строка под полем */
export function KeyHint() {
  return (
    <p className="faint small" style={{ margin: 0 }}>
      Ключ выдаёт хост сервера (<code>tfc admin invite &lt;ник&gt;</code>) — тот же, что для программы{' '}
      <code>tfc login</code>. На сайте он не хранится: браузер просто запоминает, что вы вошли.
    </p>
  );
}
