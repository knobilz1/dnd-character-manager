import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'dark' | 'light' | 'party';

// Click cycle: light → dark → party → light → …
const NEXT: Record<Theme, Theme> = {
  light: 'dark',
  dark:  'party',
  party: 'light',
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
