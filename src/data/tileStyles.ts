import type { TileStyleId } from '../utils/battleMapRender';

/** User-facing list for the battle-map tile-style picker (see
 *  DMConsolePage.tsx) — one entry per style battleMapRender.ts's
 *  TILE_STYLE_SPRITES actually has art for. Add a style here only once its
 *  sprites exist there; a label with nothing behind it is worse than no
 *  picker at all. */
export interface TileStyleOption {
  id: TileStyleId;
  label: string;
}

export const TILE_STYLES: TileStyleOption[] = [
  { id: 'default', label: 'Default' },
  { id: 'dark', label: 'Dreary' },
];
