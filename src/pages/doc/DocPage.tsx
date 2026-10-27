import { useNavigate, useParams } from 'react-router-dom';
import { ArtifactPane } from '@/widgets/agent-panel';
import { useArtifacts } from '@/entities/artifact';

/** Документ на всю страницу */
export function DocPage() {
  const { id = '' } = useParams();
  const { items: artifacts } = useArtifacts();
  const navigate = useNavigate();
  const taskId = artifacts.find((a) => a.id === id)?.taskId;

  return (
    <ArtifactPane
      artifactId={id}
      variant="full"
      onClose={() => navigate(`/?doc=${id}${taskId ? '' : '&view=docs'}`)}
      onToggleSize={() => navigate(`/?doc=${id}${taskId ? '' : '&view=docs'}`)}
      onOpenTask={(t) => navigate(`/?task=${t}`)}
      onDeleted={() => navigate(taskId ? '/' : '/?view=docs')}
    />
  );
}
