import { lazy, Suspense, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Header } from './components/Header';
import { NickDialog } from './components/NickDialog';
import { TooltipLayer } from './components/Tooltip';
import { DataProvider } from './data/DataContext';
import { readNick, writeNick } from './lib/nick';
import { TasksPage } from './pages/TasksPage';

const DocsPage = lazy(() => import('./pages/DocsPage').then((m) => ({ default: m.DocsPage })));
const DocPage = lazy(() => import('./pages/DocPage').then((m) => ({ default: m.DocPage })));

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
        <Suspense fallback={<div className="empty">Загрузка…</div>}>
          <Routes>
            <Route path="/" element={<TasksPage />} />
            <Route path="/docs" element={<DocsPage />} />
            <Route path="/docs/:id" element={<DocPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
        {changingNick && <NickDialog initial={nick} onSave={save} onCancel={() => setChangingNick(false)} />}
        <TooltipLayer />
      </DataProvider>
    </BrowserRouter>
  );
}
