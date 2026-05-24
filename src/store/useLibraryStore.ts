import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Character } from '../types';

interface LibraryState {
  characters: Character[];
  createCharacter: (c: Character) => void;
  updateCharacter: (c: Character) => void;
  deleteCharacter: (id: string) => void;
  sendToGraveyard: (id: string) => void;
}

export const useLibraryStore = create<LibraryState>()(
  persist(
    (set) => ({
      characters: [],
      createCharacter: (c) =>
        set((s) => ({ characters: [...s.characters, c] })),
      updateCharacter: (c) =>
        set((s) => ({
          characters: s.characters.map((ch) =>
            ch.id === c.id ? { ...c, updatedAt: Date.now() } : ch
          ),
        })),
      deleteCharacter: (id) =>
        set((s) => ({ characters: s.characters.filter((c) => c.id !== id) })),
      sendToGraveyard: (id) =>
        set((s) => ({
          characters: s.characters.map((c) =>
            c.id === id ? { ...c, inGraveyard: true, updatedAt: Date.now() } : c
          ),
        })),
    }),
    { name: 'dnd_cm_library_v1' }
  )
);
