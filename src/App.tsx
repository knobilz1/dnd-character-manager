import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
import { CreatorPage } from './pages/creator/CreatorPage';
import { SheetPage } from './pages/sheet/SheetPage';
import { CompanionView } from './pages/companion/CompanionView';
import { GraveyardPage } from './pages/GraveyardPage';
import { DMConsolePage } from './pages/dm/DMConsolePage';
// Lazy so the dev-only review page (and the three.js viewport it pulls in) never lands in the
// main bundle; the route is dev-gated below anyway.
const ModelReviewPage = React.lazy(() => import('./pages/dev/ModelReviewPage'));
import { useAppUpdater } from './hooks/useAppUpdater';
import { useThemeStore } from './store/useThemeStore';
import { useDriveSync } from './hooks/useDriveSync';
import { useDmPushSync } from './hooks/useDmPushSync';
import { SnowOverlay } from './components/SnowOverlay';
import { HauntOverlay } from './components/HauntOverlay';
import { DeepSeaOverlay } from './components/DeepSeaOverlay';
import { FireworksOverlay } from './components/FireworksOverlay';
import { EidOverlay } from './components/EidOverlay';
import { ErrorBoundary, AppCrashFallback } from './components/ErrorBoundary';

export default function App() {
  const updater = useAppUpdater();
  const { theme } = useThemeStore();
  useDriveSync();
  useDmPushSync();

  // Keep the <html> data-theme attribute in sync with the store
  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  return (
    <BrowserRouter>
      {theme === 'christmas' && <SnowOverlay />}
      {theme === 'halloween' && <HauntOverlay />}
      {theme === 'deepsea' && <DeepSeaOverlay />}
      {theme === 'party' && <FireworksOverlay />}
      {theme === 'eid' && <EidOverlay />}
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
      {/* Without this, any render error in any page unmounts the whole tree and
          the window goes blank with no way back — the failure mode the 3D
          viewport already guards against locally. */}
      <ErrorBoundary label="App" fallback={<AppCrashFallback />}>
      <Routes>
        <Route index element={<HomePage checkForUpdates={updater.checkForUpdates} checkStatus={updater.checkStatus} />} />
        <Route path="create" element={<CreatorPage />} />
        <Route path="character/:id" element={<SheetPage />} />
        {/* A companion in its own window — opened from the sheet's Companions panel. */}
        <Route path="companion/:charId/:companionId" element={<CompanionView />} />
        <Route path="graveyard" element={<GraveyardPage />} />
        <Route path="dm" element={<DMConsolePage />} />
        {/* Dev-only: review every rigged body against every animation state. Not registered in a
            production build, so it cannot be reached from a shipped app. */}
        {import.meta.env.DEV && (
          <Route
            path="model-review"
            element={
              // App.tsx has no Suspense boundary of its own, and a lazy element without one throws
              // on navigation, so this route carries its own.
              <React.Suspense fallback={<div className="p-6 text-sm text-neutral-400">Loading model review…</div>}>
                <ModelReviewPage />
              </React.Suspense>
            }
          />
        )}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
