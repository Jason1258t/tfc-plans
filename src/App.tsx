import { useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { Header } from './components/Header';
import { NickDialog } from './components/NickDialog';
import { TooltipLayer } from './components/Tooltip';
import { DataProvider } from './data/DataContext';
import { readNick, writeNick } from './lib/nick';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AddonsPage } from './pages/AddonsPage';
import { DocPage } from './pages/DocPage';
import { DatapacksPage } from './pages/DatapacksPage';
import { RecipesPage } from './pages/RecipesPage';
import { TagsPage } from './pages/TagsPage';
import { FilesPage } from './pages/FilesPage';
import { ReferencePage } from './pages/ReferencePage';
import { UpdatesPage } from './pages/UpdatesPage';
import { SchematicsPage } from './pages/SchematicsPage';
import { TasksPage } from './pages/TasksPage';

/** Старые ссылки на карту (в том числе с точками в адресе) ведут во вкладку справочника */
function MapRedirect() {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  params.set('tab', 'map');
  return <Navigate to={`/reference?${params}`} replace />;
}

/** Прежний адрес документа на всю страницу: /docs теперь — страница файлов */
function OldDocRedirect() {
  const { id = '' } = useParams();
  return <Navigate to={`/doc/${id}`} replace />;
}

export default function App() {
  const [nick, setNick] = useState(readNick);
  const [changingNick, setChangingNick] = useState(false);

  const save = (n: string) => {
    writeNick(n);
    setNick(n);
    setChangingNick(false);
  };

  if (!nick) return <NickDialog onSave={save} />;

  return (
    <BrowserRouter>
      <DataProvider nick={nick}>
        <Header nick={nick} onChangeNick={() => setChangingNick(true)} />
        <ErrorBoundary>
          <Routes>
            <Route path="/" element={<TasksPage />} />
            <Route path="/docs" element={<FilesPage />} />
            <Route path="/files" element={<Navigate to="/docs" replace />} />
            <Route path="/doc/:id" element={<DocPage />} />
            <Route path="/docs/:id" element={<OldDocRedirect />} />
            <Route path="/schematics" element={<SchematicsPage />} />
            <Route path="/datapacks" element={<DatapacksPage />} />
            <Route path="/recipes" element={<RecipesPage />} />
            <Route path="/tags" element={<TagsPage />} />
            <Route path="/reference" element={<ReferencePage />} />
            <Route path="/addons" element={<AddonsPage />} />
            <Route path="/updates" element={<UpdatesPage />} />
            <Route path="/map" element={<MapRedirect />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ErrorBoundary>
        {changingNick && <NickDialog initial={nick} onSave={save} onCancel={() => setChangingNick(false)} />}
        <TooltipLayer />
      </DataProvider>
    </BrowserRouter>
  );
}
