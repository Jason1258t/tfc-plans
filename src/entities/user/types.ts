/** Участник сайта (справочник ников users/{ник}): пишется при заходе, ключ — ник */
export interface SiteUser {
  id: string;
  nick: string;
  /** Последний анонимный вход (uid), который зашёл под этим ником */
  uid?: string | null;
  firstSeen: number;
  lastSeen: number;
}
