import { useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { Header } from '@/widgets/header';
import { Onboarding } from '@/widgets/onboarding';
import { NickDialog } from '@/components/NickDialog';
import { TooltipLayer } from '@/shared/ui';
import { useStartData } from '@/app';
import { useNick, useSaveNick } from '@/entities/user';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { VisitTracker } from '@/components/VisitTracker';
import { AddonPage, AddonsPage } from '@/pages/addons';
import { DocPage } from '@/pages/doc';
import { DatapacksPage } from '@/pages/datapacks';
import { FilesPage } from '@/pages/files';
import { ReferencePage } from '@/pages/reference';
import { FreshnessPage, UpdatesPage } from '@/pages/updates';
import { SchematicsPage } from '@/pages/schematics';
import { BuilderPage } from '@/pages/builder';
import { StatsPage } from '@/pages/stats';
import { DevPage } from '@/pages/dev';
import { TasksPage } from '@/pages/tasks';
import { HomePage } from '@/pages/home';
import { legacyTasksTarget, mapReferenceTarget, recipesReferenceTarget, tagsReferenceTarget } from '@/shared/lib';

/** Без параметров корень — главная; прежние ссылки на задачи и планы сохраняют весь query. */
function RootPage() {
  const { search } = useLocation();
  const legacy = legacyTasksTarget(search);
  return legacy ? <Navigate to={legacy} replace /> : <HomePage />;
}

/** Старые ссылки на карту (в том числе с точками в адресе) ведут в раздел «Мир и ресурсы» */
function MapRedirect() {
  const { search } = useLocation();
  return <Navigate to={mapReferenceTarget(search)} replace />;
}

/** Справочные каталоги сохраняют прежние адреса совместимыми переходами. */
function ReferenceRedirect({ target }: { target: (search: string) => string }) {
  const { search } = useLocation();
  return <Navigate to={target(search)} replace />;
}

/** Прежний адрес документа на всю страницу: /docs теперь — страница файлов */
function OldDocRedirect() {
  const { id = '' } = useParams();
  return <Navigate to={`/doc/${id}`} replace />;
}

export default function App() {
  const nick = useNick();
  const saveNick = useSaveNick();
  const [changingNick, setChangingNick] = useState(false);

  useStartData();

  const save = (n: string) => {
    saveNick(n);
    setChangingNick(false);
  };

  if (!nick) return <NickDialog onSave={save} />;

  return (
    <BrowserRouter>
      <Header nick={nick} onChangeNick={() => setChangingNick(true)} />
      <VisitTracker />
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<RootPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/docs" element={<FilesPage />} />
          <Route path="/files" element={<Navigate to="/docs" replace />} />
          <Route path="/doc/:id" element={<DocPage />} />
          <Route path="/docs/:id" element={<OldDocRedirect />} />
          <Route path="/schematics" element={<SchematicsPage />} />
          <Route path="/builder" element={<BuilderPage />} />
          <Route path="/datapacks" element={<DatapacksPage />} />
          <Route path="/recipes" element={<ReferenceRedirect target={recipesReferenceTarget} />} />
          <Route path="/tags" element={<ReferenceRedirect target={tagsReferenceTarget} />} />
          <Route path="/reference" element={<ReferencePage />} />
          <Route path="/addons" element={<AddonsPage />} />
          <Route path="/addons/:id" element={<AddonPage />} />
          <Route path="/updates" element={<UpdatesPage />} />
          <Route path="/freshness" element={<FreshnessPage />} />
          {/* Статистика — только по прямой ссылке, в меню её нет */}
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/dev" element={<DevPage />} />
          <Route path="/map" element={<MapRedirect />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ErrorBoundary>
      {changingNick && <NickDialog initial={nick} onSave={save} onCancel={() => setChangingNick(false)} />}
      <Onboarding />
      <TooltipLayer />
    </BrowserRouter>
  );
}
