import { createContext, useContext, type ReactNode } from 'react';

/** Обработка ссылок гайда (guide:, /раздел) — и для текста статьи, и для подписей калькуляторов */
export type GuideLink = (href: string, children: ReactNode) => ReactNode | null;

export const GuideLinkContext = createContext<GuideLink | undefined>(undefined);

export const useGuideLink = () => useContext(GuideLinkContext);

/** Статью сейчас правят (предпросмотр редактора): ошибки формул показываются подробно */
export const GuideEditingContext = createContext(false);

export const useGuideEditing = () => useContext(GuideEditingContext);
