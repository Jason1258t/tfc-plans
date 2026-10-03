import { useNavigate, useParams } from 'react-router-dom';
import { ArtifactPane } from '../components/ArtifactPane';
import { useData } from '../data/DataContext';

/** Документ на всю страницу */
export function DocPage() {
  const { id = '' } = useParams();
  const { artifacts } = useData();
  const navigate = useNavigate();
  const taskId = artifacts.find((a) => a.id === id)?.taskId;

  return (
    <ArtifactPane
      artifactId={id}
      variant="full"
      onClose={() => navigate(taskId ? `/?doc=${id}` : '/docs')}
      onToggleSize={taskId ? () => navigate(`/?doc=${id}`) : undefined}
      onOpenTask={(t) => navigate(`/?task=${t}`)}
      onDeleted={() => navigate(taskId ? '/' : '/docs')}
    />
  );
}
