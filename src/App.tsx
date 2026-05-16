import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
import { WizardPage } from './pages/wizard/WizardPage';
import { SheetPage } from './pages/sheet/SheetPage';
import { useAppUpdater } from './hooks/useAppUpdater';

function UpdateBanner() {
  const { updateAvailable, updateVersion, installing, installUpdate } = useAppUpdater();
  if (!updateAvailable) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 bg-slate-800 border border-emerald-600 rounded-xl shadow-2xl px-4 py-3 flex items-center gap-4 max-w-sm">
      <div className="flex-1">
        <p className="text-sm font-bold text-white">Update available</p>
        <p className="text-xs text-slate-400">Version {updateVersion} is ready to install.</p>
      </div>
      <button
        onClick={installUpdate}
        disabled={installing}
        className="shrink-0 px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold transition-colors disabled:opacity-50"
      >
        {installing ? 'Installing…' : 'Update'}
      </button>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <UpdateBanner />
      <Routes>
        <Route index element={<HomePage />} />
        <Route path="create" element={<WizardPage />} />
        <Route path="character/:id" element={<SheetPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
