import { createContext, useContext, type ReactNode } from 'react';

/** Обработка ссылок гайда (guide:, /раздел) — и для текста статьи, и для подписей калькуляторов */
export type GuideLink = (href: string, children: ReactNode) => ReactNode | null;

export const GuideLinkContext = createContext<GuideLink | undefined>(undefined);

export const useGuideLink = () => useContext(GuideLinkContext);
