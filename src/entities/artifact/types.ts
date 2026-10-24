/** Markdown-документ: подробный план, привязанный к задаче (или свободный) */
export interface Artifact {
  id: string;
  title: string;
  content: string;
  taskId: string | null;
  author: string;
  updatedBy: string;
  createdAt: number;
  updatedAt: number;
}

export type NewArtifact = Omit<Artifact, 'id' | 'createdAt' | 'updatedAt'>;
