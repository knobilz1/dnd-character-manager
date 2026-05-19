import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'dark' | 'light' | 'party' | 'halloween' | 'christmas' | 'deepsea';

// Click cycle: light → dark → party → halloween → christmas → deepsea → light → …
const NEXT: Record<Theme, Theme> = {
  light:     'dark',
  dark:      'party',
  party:     'halloween',
  halloween: 'christmas',
  christmas: 'deepsea',
  deepsea:   'light',
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
