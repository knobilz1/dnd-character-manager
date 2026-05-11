import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, ChevronRight, Sword, Shield } from 'lucide-react';
import { useLibraryStore } from '../store/useLibraryStore';
import { Button, Dialog } from '../components/ui';
import { getClass } from '../data/classes';
import { getRace } from '../data/races';
import { totalCharacterLevel } from '../data/mechanics';

export function HomePage() {
  const navigate = useNavigate();
  const { characters, deleteCharacter } = useLibraryStore();
  const [deleteId, setDeleteId] = React.useState<string | null>(null);

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

  return (
    <div className="min-h-screen bg-slate-900 p-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
              <Sword className="text-red-500" size={32} />
              D&D Character Manager
            </h1>
            <p className="text-slate-400 mt-1">Your personal adventure awaits</p>
          </div>
          <Button onClick={handleCreate} size="lg">
            <Plus size={20} />
            New Character
          </Button>
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
                  {/* Delete button */}
                  <button
                    onClick={e => { e.stopPropagation(); setDeleteId(character.id); }}
                    className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 transition-all p-1 rounded"
                  >
                    <Trash2 size={16} />
                  </button>

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
    </div>
  );
}
