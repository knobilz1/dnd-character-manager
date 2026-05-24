import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'dark' | 'light' | 'party' | 'halloween' | 'christmas' | 'deepsea' | 'eid' | 'parchment';

// Click cycle: dark → party → halloween → christmas → deepsea → eid → parchment → light → dark → …
const NEXT: Record<Theme, Theme> = {
  light:     'dark',
  dark:      'party',
  party:     'halloween',
  halloween: 'christmas',
  christmas: 'deepsea',
  deepsea:   'eid',
  eid:       'parchment',
  parchment: 'light',
};

interface ThemeState {
  theme: Theme;
  toggleTheme: () => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      toggleTheme: () => set({ theme: NEXT[get().theme] }),
    }),
    { name: 'tavern-sheet-theme' }
  )
);
