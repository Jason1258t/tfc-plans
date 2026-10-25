import { Component, type ReactNode } from 'react';
import { cx } from '@/shared/lib';
import styles from './Guides.module.css';

/** Сломанный калькулятор или виджет не роняет статью: ошибка — на его месте */
export class BlockBoundary extends Component<
  { children: ReactNode; text: string },
  { error: Error | null; text: string }
> {
  state = { error: null as Error | null, text: this.props.text };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  // Текст блока поправили (редактор) — пробуем снова
  static getDerivedStateFromProps(props: { text: string }, state: { error: Error | null; text: string }) {
    return props.text !== state.text ? { error: null, text: props.text } : null;
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <div className={cx(styles.guideErrors, 'small')}>⚠ Блок не показан: {this.state.error.message}</div>;
  }
}
