import { CreateTask } from '../CreateTask';
import { EditTask } from '../EditTask';

export type TaskDialogMode = { kind: 'create'; groupId: string | null } | { kind: 'edit'; taskId: string };

interface Props {
  mode: TaskDialogMode;
  onClose: () => void;
  onOpenArtifact: (id: string) => void;
}

/** Окно задачи: создание или правка — две отдельные формы (см. CreateTask и EditTask) */
export function TaskDialog({ mode, onClose, onOpenArtifact }: Props) {
  return mode.kind === 'create' ? (
    <CreateTask groupId={mode.groupId} onClose={onClose} onOpenArtifact={onOpenArtifact} />
  ) : (
    <EditTask taskId={mode.taskId} onClose={onClose} onOpenArtifact={onOpenArtifact} />
  );
}
