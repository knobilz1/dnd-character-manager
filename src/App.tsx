import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
import { WizardPage } from './pages/wizard/WizardPage';
import { SheetPage } from './pages/sheet/SheetPage';
import { useAppUpdater } from './hooks/useAppUpdater';
import { useThemeStore } from './store/useThemeStore';
import { SnowOverlay } from './components/SnowOverlay';
import { HauntOverlay } from './components/HauntOverlay';
import { DeepSeaOverlay } from './components/DeepSeaOverlay';

export default function App() {
  const updater = useAppUpdater();
  const { theme } = useThemeStore();

  // Keep the <html> data-theme attribute in sync with the store
  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  return (
    <BrowserRouter>
      {theme === 'christmas' && <SnowOverlay />}
      {theme === 'halloween' && <HauntOverlay />}
      {theme === 'deepsea' && <DeepSeaOverlay />}
      {/* Global update banner */}
      {updater.updateAvailable && (
        <div className="fixed bottom-4 right-4 z-50 bg-slate-800 border border-emerald-600 rounded-xl shadow-2xl px-4 py-3 flex items-center gap-4 max-w-sm">
          <div className="flex-1">
            <p className="text-sm font-bold text-white">Update available</p>
            <p className="text-xs text-slate-400">Version {updater.updateVersion} is ready to install.</p>
          </div>
          <button
            onClick={updater.installUpdate}
            disabled={updater.installing}
            className="shrink-0 px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold transition-colors disabled:opacity-50"
          >
            {updater.installing ? 'Installing…' : 'Update'}
          </button>
        </div>
      )}
      <Routes>
        <Route index element={<HomePage checkForUpdates={updater.checkForUpdates} checkStatus={updater.checkStatus} />} />
        <Route path="create" element={<WizardPage />} />
        <Route path="character/:id" element={<SheetPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
