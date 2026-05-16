import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, ChevronRight, Sword, Shield, Download, Upload, RefreshCw } from 'lucide-react';
import { useLibraryStore } from '../store/useLibraryStore';
import { Button, Dialog } from '../components/ui';
import { getClass } from '../data/classes';
import { getRace } from '../data/races';
import { totalCharacterLevel } from '../data/mechanics';
import type { Character } from '../types';
import type { UpdateCheckStatus } from '../hooks/useAppUpdater';

function exportCharacter(character: Character) {
  const json = JSON.stringify(character, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${character.name || 'character'}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function HomePage({ checkForUpdates, checkStatus }: { checkForUpdates?: () => void; checkStatus?: UpdateCheckStatus }) {
  const navigate = useNavigate();
  const { characters, deleteCharacter, createCharacter } = useLibraryStore();
  const [deleteId, setDeleteId] = React.useState<string | null>(null);
  const [importError, setImportError] = React.useState<string | null>(null);
  const importRef = React.useRef<HTMLInputElement>(null);

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
        const data = JSON.parse(ev.target?.result as string) as Character;
        if (!data.name || !data.classes || !data.baseAbilityScores) {
          setImportError('Invalid character file — missing required fields.');
          return;
        }
        // Assign a fresh ID so it never collides with existing characters
        const imported: Character = { ...data, id: crypto.randomUUID(), updatedAt: Date.now() };
        createCharacter(imported);
        navigate(`/character/${imported.id}`);
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
          <div className="flex gap-2">
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
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="text-lg font-bold text-white">{character.name || 'Unnamed'}</h3>
                      <p className="text-sm text-slate-400">
                        Level {level} {race?.name ?? '?'} {classDef?.name ?? '?'}
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="text-xl font-bold text-white">Lv.{level}</div>
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
    </div>
  );
}
