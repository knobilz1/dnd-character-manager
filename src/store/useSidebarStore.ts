import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const SIDEBAR_MODULE_IDS = [
  'character-glance',
  'journal',
  'hp',
  'weapon-attacks',
  'spell-slots',
  'class-resources',
  'conditions',
  'hit-dice',
  'combat-abilities',
] as const;

export type SidebarModuleId = (typeof SIDEBAR_MODULE_IDS)[number];

export const SIDEBAR_MODULE_LABELS: Record<SidebarModuleId, string> = {
  'character-glance': 'Character Glance',
  'journal':          'Journal',
  'hp':               'Hit Points',
  'weapon-attacks':   'Weapon Attacks',
  'spell-slots':      'Spell Slots',
  'class-resources':  'Class Resources',
  'conditions':       'Conditions',
  'hit-dice':         'Hit Dice',
  'combat-abilities': 'Combat Abilities',
};

export const SIDEBAR_MODULE_ICONS: Record<SidebarModuleId, string> = {
  'character-glance': '👤',
  'journal':          '📓',
  'hp':               '❤️',
  'weapon-attacks':   '⚔️',
  'spell-slots':      '✨',
  'class-resources':  '🔵',
  'conditions':       '⚠️',
  'hit-dice':         '🎲',
  'combat-abilities': '🪄',
};

interface SidebarState {
  pinnedModules: SidebarModuleId[];
  sidebarOpen: boolean;
  togglePin: (id: SidebarModuleId) => void;
  isPinned: (id: SidebarModuleId) => boolean;
  setSidebarOpen: (open: boolean) => void;
  moveUp: (id: SidebarModuleId) => void;
  moveDown: (id: SidebarModuleId) => void;
}

export const useSidebarStore = create<SidebarState>()(
  persist(
    (set, get) => ({
      pinnedModules: [],
      sidebarOpen: false,

      togglePin: (id) => {
        const current = get().pinnedModules;
        if (current.includes(id)) {
          const next = current.filter(m => m !== id);
          set({ pinnedModules: next, sidebarOpen: next.length > 0 ? get().sidebarOpen : false });
        } else {
          set({ pinnedModules: [...current, id], sidebarOpen: true });
        }
      },

      isPinned: (id) => get().pinnedModules.includes(id),

      setSidebarOpen: (open) => set({ sidebarOpen: open }),

      moveUp: (id) => {
        const mods = get().pinnedModules;
        const i = mods.indexOf(id);
        if (i <= 0) return;
        const next = [...mods];
        [next[i - 1], next[i]] = [next[i], next[i - 1]];
        set({ pinnedModules: next });
      },

      moveDown: (id) => {
        const mods = get().pinnedModules;
        const i = mods.indexOf(id);
        if (i === -1 || i === mods.length - 1) return;
        const next = [...mods];
        [next[i], next[i + 1]] = [next[i + 1], next[i]];
        set({ pinnedModules: next });
      },
    }),
    { name: 'tavern-sheet-sidebar' }
  )
);
