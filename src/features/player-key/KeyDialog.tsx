import { closeKeyRequest, useKeyRequest } from '@/shared/api';
import { Button, Modal } from '@/shared/ui';
import { KeyHint, KeyInput } from './KeyInput';
import { useKeyLogin } from './useKeyLogin';

/** Окно ключа: открывается, когда без ключа нажали то, что сохраняет данные (requestKey) */
export function KeyDialog() {
  const [asking, reason] = useKeyRequest();
  if (!asking) return null;
  return <KeyDialogBody reason={reason} />;
}

function KeyDialogBody({ reason }: { reason: string | null }) {
  const login = useKeyLogin();
  const submit = () => {
    if (login.key.trim()) void login.submit();
  };
  return (
    <Modal
      onClose={closeKeyRequest}
      narrow
      title="Нужен ключ игрока"
      footer={
        <>
          <span className="grow" />
          <Button variant="ghost" onClick={closeKeyRequest}>
            Отмена
          </Button>
          <Button variant="primary" disabled={login.busy || !login.key.trim()} onClick={submit}>
            {login.busy ? 'Проверяю…' : 'Войти'}
          </Button>
        </>
      }
    >
      <p className="muted" style={{ margin: 0 }}>
        {reason ? `«${reason}»: сохранять` : 'Сохранять'} что-либо на сайте могут только игроки сервера. Без ключа можно
        смотреть справочник, схемы и датапаки, а датапак создать временный — только в этом браузере.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <KeyInput id="key-request" value={login.key} onChange={login.setKey} error={login.error} autoFocus />
      </form>
      <KeyHint />
    </Modal>
  );
}
