import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, ChevronRight, Sword, Shield, Download, Upload, RefreshCw, SunMoon } from 'lucide-react';
import { getVersion } from '@tauri-apps/api/app';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { useLibraryStore } from '../store/useLibraryStore';
import { Button, Dialog } from '../components/ui';
import { cn } from '../utils/cn';
import { getClass } from '../data/classes';
import { getRace } from '../data/races';
import { totalCharacterLevel } from '../data/mechanics';
import type { Character } from '../types';
import type { UpdateCheckStatus } from '../hooks/useAppUpdater';
import { useSnapshotStore } from '../store/useSnapshotStore';
import { useThemeStore } from '../store/useThemeStore';

async function exportCharacter(character: Character) {
  const snapshots = useSnapshotStore.getState().snapshotsFor(character.id);
  const payload = { tavernSheet: true, version: 1, character, snapshots };
  const json = JSON.stringify(payload, null, 2);
  const path = await save({
    defaultPath: `${character.name || 'character'}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (path) await writeTextFile(path, json);
}

export function HomePage({ checkForUpdates, checkStatus }: { checkForUpdates?: () => void; checkStatus?: UpdateCheckStatus }) {
  const navigate = useNavigate();
  const { characters, deleteCharacter, createCharacter } = useLibraryStore();
  const { theme, toggleTheme } = useThemeStore();
  const [deleteId, setDeleteId] = React.useState<string | null>(null);
  const [importError, setImportError] = React.useState<string | null>(null);
  const importRef = React.useRef<HTMLInputElement>(null);
  const [appVersion, setAppVersion] = React.useState<string | null>(null);

  React.useEffect(() => {
    getVersion().then(setAppVersion).catch(() => {});
  }, []);

  function handleOpen(id: string) {
    navigate(`/character/${id}`);
  }

  function handleCreate() {
    navigate('/create');
  }

  function confirmDelete() {
    if (deleteId) deleteCharacter(deleteId);
    setDeleteId(null);
  }

  function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string);

        // Support both new envelope format and legacy plain-character files
        const isEnvelope = parsed?.tavernSheet === true && parsed?.character;
        const data: Character = isEnvelope ? parsed.character : parsed;

        if (!data.name || !data.classes || !data.baseAbilityScores) {
          setImportError('Invalid character file — missing required fields.');
          return;
        }

        const newId = crypto.randomUUID();
        const imported: Character = { ...data, id: newId, updatedAt: Date.now() };
        createCharacter(imported);

        // Restore snapshot history if present
        if (isEnvelope && Array.isArray(parsed.snapshots) && parsed.snapshots.length > 0) {
          useSnapshotStore.getState().importSnapshots(newId, parsed.snapshots);
        }

        navigate(`/character/${newId}`);
      } catch {
        setImportError('Could not read file. Make sure it\'s a valid Tavern Sheet JSON export.');
      }
    };
    reader.readAsText(file);
    // Reset so the same file can be re-imported if needed
    e.target.value = '';
  }

  return (
    <div className="min-h-screen bg-slate-900 p-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
              <Sword className="text-red-500" size={32} />
              Tavern Sheet
            </h1>
            <p className="text-slate-400 mt-1">Unofficial 5e character manager · fan project</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleTheme}
              className={cn(
                'p-2 rounded-lg transition-colors hover:bg-slate-800',
                theme === 'dark'  && 'text-yellow-400 hover:text-yellow-200',
                theme === 'light' && 'text-slate-500  hover:text-slate-700',
                theme === 'party' && 'text-fuchsia-300 hover:text-white',
              )}
              title={
                theme === 'dark'  ? 'Party mode 🎉' :
                theme === 'party' ? 'Switch to light mode' :
                                    'Switch to dark mode'
              }
            >
              {theme === 'dark'  && <SunMoon size={20} />}
              {theme === 'light' && <SunMoon size={20} />}
              {theme === 'party' && <span className="text-xl leading-none">🎉</span>}
            </button>
            <input ref={importRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
            <Button variant="outline" size="lg" onClick={() => importRef.current?.click()}>
              <Upload size={18} />
              Import
            </Button>
            <Button onClick={handleCreate} size="lg">
              <Plus size={20} />
              New Character
            </Button>
          </div>
        </div>

        {/* Character list */}
        {characters.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <Shield size={64} className="text-slate-700 mb-6" />
            <h2 className="text-2xl font-bold text-slate-400 mb-2">No characters yet</h2>
            <p className="text-slate-500 mb-8">Create your first character to begin your adventure</p>
            <Button onClick={handleCreate} size="lg">
              <Plus size={20} />
              Create Character
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {characters.map(character => {
              const level = totalCharacterLevel(character.classes);
              const primaryClass = character.classes[0];
              const classDef = primaryClass ? getClass(primaryClass.classId) : null;
              const race = getRace(character.raceId);
              const hpPercent = Math.round((character.currentHP / character.maxHP) * 100);

              return (
                <div
                  key={character.id}
                  className="bg-slate-800 border border-slate-700 rounded-xl p-5 hover:border-slate-500 transition-all cursor-pointer group relative"
                  onClick={() => handleOpen(character.id)}
                >
                  {/* Card actions */}
                  <div className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
                    <button
                      onClick={e => { e.stopPropagation(); exportCharacter(character); }}
                      className="text-slate-500 hover:text-blue-400 transition-colors p-1 rounded"
                      title="Export character"
                    >
                      <Download size={16} />
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); setDeleteId(character.id); }}
                      className="text-slate-500 hover:text-red-400 transition-colors p-1 rounded"
                      title="Delete character"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>

                  {/* Character info */}
                  <div className="flex items-start gap-3 mb-3">
                    {/* Portrait */}
                    {character.portrait && (
                      <img
                        src={character.portrait}
                        alt="Portrait"
                        className="w-14 h-14 rounded-lg object-cover border border-slate-600 shrink-0"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-lg font-bold text-white truncate">{character.name || 'Unnamed'}</h3>
                        <div className="text-xl font-bold text-white shrink-0">Lv.{level}</div>
                      </div>
                      <p className="text-sm text-slate-400">
                        {race?.name ?? '?'} {classDef?.name ?? '?'}
                      </p>
                    </div>
                  </div>

                  {/* HP bar */}
                  <div className="mb-3">
                    <div className="flex justify-between text-xs text-slate-400 mb-1">
                      <span>HP</span>
                      <span>{character.currentHP}/{character.maxHP}</span>
                    </div>
                    <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${hpPercent > 50 ? 'bg-green-500' : hpPercent > 25 ? 'bg-yellow-500' : 'bg-red-500'}`}
                        style={{ width: `${hpPercent}%` }}
                      />
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="flex items-center justify-between">
                    <div className="flex gap-2">
                      {character.conditions.length > 0 && (
                        <span className="text-xs bg-red-900/50 text-red-300 px-2 py-0.5 rounded">
                          {character.conditions.length} condition{character.conditions.length !== 1 ? 's' : ''}
                        </span>
                      )}
                      {character.inspiration && (
                        <span className="text-xs bg-yellow-900/50 text-yellow-300 px-2 py-0.5 rounded">✦ Inspired</span>
                      )}
                    </div>
                    <ChevronRight size={18} className="text-slate-500 group-hover:text-white transition-colors" />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Delete confirm dialog */}
      <Dialog open={!!deleteId} onClose={() => setDeleteId(null)} title="Delete Character?">
        <p className="text-slate-300 mb-6">This action cannot be undone. The character will be permanently deleted.</p>
        <div className="flex gap-3 justify-end">
          <Button variant="secondary" onClick={() => setDeleteId(null)}>Cancel</Button>
          <Button variant="danger" onClick={confirmDelete}>Delete</Button>
        </div>
      </Dialog>

      {/* Footer */}
      {checkForUpdates && (
        <div className="mt-8 flex justify-center">
          <button
            onClick={checkForUpdates}
            disabled={checkStatus === 'checking'}
            className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-300 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={12} className={checkStatus === 'checking' ? 'animate-spin' : ''} />
            {checkStatus === 'checking' && 'Checking for updates…'}
            {checkStatus === 'up-to-date' && 'Up to date ✓'}
            {checkStatus === 'available' && 'Update available'}
            {checkStatus === 'error' && 'Check failed — try again'}
            {(checkStatus === 'idle' || !checkStatus) && 'Check for updates'}
          </button>
        </div>
      )}

      {/* Import error dialog */}
      <Dialog open={!!importError} onClose={() => setImportError(null)} title="Import Failed">
        <p className="text-slate-300 mb-6">{importError}</p>
        <div className="flex justify-end">
          <Button onClick={() => setImportError(null)}>OK</Button>
        </div>
      </Dialog>

      {appVersion && (
        <div className="fixed bottom-3 right-4 text-xs text-slate-600 select-none pointer-events-none">
          v{appVersion}
        </div>
      )}
    </div>
  );
}
