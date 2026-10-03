import { lazy, Suspense, useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Header } from './components/Header';
import { NickModal } from './components/NickModal';
import { TooltipLayer } from './components/Tooltip';
import { DataProvider } from './data/DataContext';
import { readNick, writeNick } from './lib/nick';
import { BoardPage } from './pages/BoardPage';

const ArtifactPage = lazy(() => import('./pages/ArtifactPage').then((m) => ({ default: m.ArtifactPage })));
const ArtifactsPage = lazy(() => import('./pages/ArtifactsPage').then((m) => ({ default: m.ArtifactsPage })));

export default function App() {
  const [nick, setNick] = useState(readNick);
  const [changingNick, setChangingNick] = useState(false);

  const save = (n: string) => {
    writeNick(n);
    setNick(n);
    setChangingNick(false);
  };

  if (!nick) return <NickModal onSave={save} />;

  return (
    <BrowserRouter>
      <DataProvider nick={nick}>
        <Header nick={nick} onChangeNick={() => setChangingNick(true)} />
        <Suspense fallback={<div className="empty">Загрузка…</div>}>
          <Routes>
            <Route path="/" element={<BoardPage />} />
            <Route path="/artifacts" element={<ArtifactsPage />} />
            <Route path="/a/:id" element={<ArtifactPage />} />
            <Route path="*" element={<BoardPage />} />
          </Routes>
        </Suspense>
        {changingNick && <NickModal initial={nick} onSave={save} onCancel={() => setChangingNick(false)} />}
        <TooltipLayer />
      </DataProvider>
    </BrowserRouter>
  );
}
