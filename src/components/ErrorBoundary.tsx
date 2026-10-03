import { Component, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/** Вместо пустого экрана при падении рендера — сообщение и кнопка перезагрузки */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(error);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="crash">
        <h2>Что-то сломалось</h2>
        <p className="muted">
          Обычно помогает перезагрузка — например, если сайт обновился, пока вкладка была открыта.
        </p>
        <pre>{error.message}</pre>
        <button className="btn primary" onClick={() => location.reload()}>
          Перезагрузить
        </button>
      </div>
    );
  }
}
