/**
 * battleMapRender.ts — turns a DM-authored battle-map spec (an ASCII grid +
 * legend + tactics, see campaign.rs's build_battle_maps_prompt) into a
 * printable image and PDF. The spec is the source of truth; rendering is fully
 * deterministic, so what the DM authored is exactly what prints.
 *
 * Tiles are drawn from real art via `drawTile`'s single dispatch point — the
 * core indoor pieces (wall/floor/door/column/stairs) are 0x72's "16x16
 * DungeonTileset II" (CC0); water/rubble/foliage/hazard/furniture came from
 * companion CC0/free packs since 0x72's own pack has no outdoor or terrain
 * tiles at all (see src/assets/battle-tiles/ and each style's comment in
 * TILE_STYLE_SPRITES for provenance). `=` (furniture) isn't one fixed sprite
 * — `furnitureVariantFor` picks table/barrel/bench/crate based on what the
 * DM's Features text actually calls that cell, so a "Bar counter" doesn't
 * render identically to a "Barrel" three cells over. A procedural fallback
 * (line-art canvas shapes, the original renderer) covers the brief window
 * before sprites finish loading. See `preloadBattleTileSprites`.
 *
 * The coordinate system matches the DM's prompt and the Active Battle Log:
 * columns are lettered A, B, C… left-to-right, rows numbered 1, 2, 3…
 * top-to-bottom, so a cell like "C3" is one exact square here and in play.
 */

import { PDFDocument } from 'pdf-lib';
import { invoke } from '@tauri-apps/api/core';
import wallLeftUrl from '../assets/battle-tiles/wall_left.png';
import wallMidUrl from '../assets/battle-tiles/wall_mid.png';
import wallRightUrl from '../assets/battle-tiles/wall_right.png';
import wallTopLeftUrl from '../assets/battle-tiles/wall_top_left.png';
import wallTopMidUrl from '../assets/battle-tiles/wall_top_mid.png';
import wallTopRightUrl from '../assets/battle-tiles/wall_top_right.png';
import floorUrl from '../assets/battle-tiles/floor_1.png';
import stairsUrl from '../assets/battle-tiles/floor_stairs.png';
import doorUrl from '../assets/battle-tiles/doors_leaf_closed.png';
import columnUrl from '../assets/battle-tiles/column.png';
import crateUrl from '../assets/battle-tiles/crate.png';
import kosinaFloorUrl from '../assets/battle-tiles/kosina_floor_1.png';
import waterUrl from '../assets/battle-tiles/water_1.png';
import rubbleUrl from '../assets/battle-tiles/rubble_1.png';
import foliageUrl from '../assets/battle-tiles/foliage_1.png';
import treeUrl from '../assets/battle-tiles/tree_1.png';
import hazardUrl from '../assets/battle-tiles/hazard_1.png';
import fireplaceUrl from '../assets/battle-tiles/fireplace_1.png';
import tableUrl from '../assets/battle-tiles/table_1.png';
import barrelUrl from '../assets/battle-tiles/barrel_1.png';
import benchUrl from '../assets/battle-tiles/bench_1.png';

export interface ParsedBattleMap {
  name: string;
  cols: number;
  rows: number;
  cellFeet: number;
  /** One string per row, each padded to exactly `cols` chars (space = void). */
  grid: string[];
  features: string;
  /** Raw `Objects:` section text — a free-object placement layer independent
   *  of the legend grid, only ever present when the DM was told a tile
   *  library is configured (see campaign.rs's build_battle_maps_prompt).
   *  See parseObjectPlacements/preloadMapObjectSprites. */
  objects: string;
  tactics: string;
}

const MAX_DIM = 40; // sanity cap so a malformed spec can't allocate a huge canvas

/** Parses a spec into a grid. Returns null if there's no usable `Map:` block.
 *  Trailing whitespace on a row is dropped then re-padded (void), but leading/
 *  interior spaces are preserved — they're meaningful (void cells). */
export function parseBattleMap(spec: string): ParsedBattleMap | null {
  const lines = spec.replace(/\r\n/g, '\n').split('\n');
  const nameLine = lines.find((l) => l.startsWith('# '));
  const name = (nameLine ? nameLine.slice(2).trim() : '') || 'Battle Map';

  const gridLine = lines.find((l) => l.trim().startsWith('Grid:')) ?? '';
  const feetMatch = gridLine.match(/(\d+)\s*ft/i);
  const cellFeet = feetMatch ? parseInt(feetMatch[1], 10) : 5;

  const mapIdx = lines.findIndex((l) => l.trim() === 'Map:');
  if (mapIdx === -1) return null;

  const rowLines: string[] = [];
  for (let i = mapIdx + 1; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    // A blank line right after `Map:` is tolerated; a blank line after rows have
    // started, or any known section header, ends the map block.
    if (trimmed === '') {
      if (rowLines.length === 0) continue;
      break;
    }
    if (/^(Features:|Objects:|Tactics:|Legend:|Grid:)/.test(trimmed) || trimmed.startsWith('# ')) break;
    rowLines.push(raw.replace(/\s+$/, ''));
    if (rowLines.length >= MAX_DIM) break;
  }
  if (rowLines.length === 0) return null;

  const cols = Math.min(MAX_DIM, Math.max(...rowLines.map((l) => l.length)));
  const grid = rowLines.map((l) => l.slice(0, cols).padEnd(cols, ' '));

  const section = (header: string): string => {
    const start = lines.findIndex((l) => l.trim() === header);
    if (start === -1) return '';
    const out: string[] = [];
    for (let i = start + 1; i < lines.length; i++) {
      const t = lines[i].trim();
      if (/^(Features:|Objects:|Tactics:|Legend:|Grid:|Map:)$/.test(t) || t.startsWith('# ')) break;
      out.push(lines[i]);
    }
    return out.join('\n').trim();
  };

  return { name, cols, rows: grid.length, cellFeet, grid, features: section('Features:'), objects: section('Objects:'), tactics: section('Tactics:') };
}

// ── Procedural tile drawing ──────────────────────────────────────────────────
// Each entry draws ONE cell into a `px`-sized square at (x, y). Kept small and
// legible for print (line-art, high contrast) rather than photorealistic.

const COLORS = {
  floor: '#d9cdb4', floorGrout: '#c3b596',
  wall: '#4a4038', wallLine: '#5c5148',
  void: '#1b1a17',
  water: '#3f7fae', waterHi: '#5b9bc9',
  wood: '#7a5230', stone: '#8a8178', stoneHi: '#a7a097',
  green: '#4b7a3a', greenHi: '#639a4d',
  rubble: '#8a7f6a', hazard: '#d4692a', hazardHi: '#f0a04b',
  sand: '#dcc48a', sandHi: '#c9ac6c',
  grid: 'rgba(40,36,30,0.35)', ink: '#2a2620',
};

type Ctx = CanvasRenderingContext2D;

function fillCell(ctx: Ctx, x: number, y: number, px: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, px, px);
}

function drawFloor(ctx: Ctx, x: number, y: number, px: number) {
  fillCell(ctx, x, y, px, COLORS.floor);
  ctx.strokeStyle = COLORS.floorGrout;
  ctx.lineWidth = Math.max(1, px * 0.02);
  ctx.beginPath();
  ctx.moveTo(x + px * 0.5, y); ctx.lineTo(x + px * 0.5, y + px);
  ctx.moveTo(x, y + px * 0.5); ctx.lineTo(x + px, y + px * 0.5);
  ctx.stroke();
}

/** The original line-art renderer — a fallback for the brief window before
 *  sprites finish loading or if a sprite fails to decode (see `drawTile`),
 *  and the ONLY renderer for `,` (sand) — no sand sprite exists yet, so this
 *  is what actually paints it (a distinct tan/grain look, not just plain
 *  floor). Every other legend code has real art, so this rarely fires for
 *  them. */
function drawTileProcedural(ctx: Ctx, code: string, x: number, y: number, px: number) {
  switch (code) {
    case ' ': fillCell(ctx, x, y, px, COLORS.void); return;
    case '#': {
      fillCell(ctx, x, y, px, COLORS.wall);
      ctx.strokeStyle = COLORS.wallLine;
      ctx.lineWidth = Math.max(1, px * 0.03);
      ctx.beginPath();
      ctx.moveTo(x, y + px * 0.5); ctx.lineTo(x + px, y + px * 0.5);
      ctx.moveTo(x + px * 0.5, y); ctx.lineTo(x + px * 0.5, y + px * 0.5);
      ctx.moveTo(x, y + px * 0.5); ctx.lineTo(x, y + px);
      ctx.stroke();
      return;
    }
    case '~': {
      fillCell(ctx, x, y, px, COLORS.water);
      ctx.strokeStyle = COLORS.waterHi;
      ctx.lineWidth = Math.max(1, px * 0.04);
      for (let i = 1; i <= 3; i++) {
        const yy = y + (px * i) / 4;
        ctx.beginPath();
        ctx.moveTo(x + px * 0.1, yy);
        ctx.quadraticCurveTo(x + px * 0.35, yy - px * 0.08, x + px * 0.5, yy);
        ctx.quadraticCurveTo(x + px * 0.65, yy + px * 0.08, x + px * 0.9, yy);
        ctx.stroke();
      }
      return;
    }
    case '+': {
      drawFloor(ctx, x, y, px);
      ctx.fillStyle = COLORS.wood;
      ctx.fillRect(x + px * 0.15, y + px * 0.15, px * 0.7, px * 0.7);
      ctx.strokeStyle = COLORS.ink;
      ctx.lineWidth = Math.max(1, px * 0.03);
      ctx.strokeRect(x + px * 0.15, y + px * 0.15, px * 0.7, px * 0.7);
      return;
    }
    case 'o': {
      drawFloor(ctx, x, y, px);
      ctx.fillStyle = COLORS.stone;
      ctx.beginPath();
      ctx.arc(x + px * 0.5, y + px * 0.5, px * 0.32, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = COLORS.stoneHi;
      ctx.beginPath();
      ctx.arc(x + px * 0.42, y + px * 0.42, px * 0.12, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    case '=': {
      drawFloor(ctx, x, y, px);
      ctx.fillStyle = COLORS.wood;
      ctx.fillRect(x + px * 0.12, y + px * 0.28, px * 0.76, px * 0.44);
      ctx.strokeStyle = COLORS.ink;
      ctx.lineWidth = Math.max(1, px * 0.02);
      ctx.strokeRect(x + px * 0.12, y + px * 0.28, px * 0.76, px * 0.44);
      return;
    }
    case 'T': {
      drawFloor(ctx, x, y, px);
      ctx.fillStyle = COLORS.wood;
      ctx.fillRect(x + px * 0.45, y + px * 0.5, px * 0.1, px * 0.4);
      ctx.fillStyle = COLORS.green;
      ctx.beginPath();
      ctx.arc(x + px * 0.5, y + px * 0.42, px * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = COLORS.greenHi;
      ctx.beginPath();
      ctx.arc(x + px * 0.4, y + px * 0.34, px * 0.12, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    case '^': {
      drawFloor(ctx, x, y, px);
      ctx.fillStyle = COLORS.rubble;
      const dots = [[0.3, 0.35], [0.6, 0.3], [0.45, 0.6], [0.7, 0.65], [0.25, 0.7]];
      for (const [dx, dy] of dots) {
        ctx.beginPath();
        ctx.arc(x + px * dx, y + px * dy, px * 0.08, 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }
    case ',': {
      // No real sand sprite yet (see TILE_STYLE_SPRITES) — this stays
      // procedural-only, distinct from plain floor, until one's sourced.
      fillCell(ctx, x, y, px, COLORS.sand);
      ctx.fillStyle = COLORS.sandHi;
      const grains = [[0.2, 0.25], [0.55, 0.2], [0.35, 0.5], [0.75, 0.45], [0.6, 0.75], [0.2, 0.7]];
      for (const [dx, dy] of grains) {
        ctx.beginPath();
        ctx.arc(x + px * dx, y + px * dy, px * 0.05, 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }
    case '_': {
      drawFloor(ctx, x, y, px);
      ctx.strokeStyle = COLORS.stone;
      ctx.lineWidth = Math.max(1, px * 0.05);
      for (let i = 1; i <= 4; i++) {
        const yy = y + (px * i) / 5;
        ctx.beginPath();
        ctx.moveTo(x + px * 0.15, yy); ctx.lineTo(x + px * 0.85, yy);
        ctx.stroke();
      }
      return;
    }
    case '*': {
      drawFloor(ctx, x, y, px);
      ctx.fillStyle = COLORS.hazard;
      ctx.beginPath();
      ctx.arc(x + px * 0.5, y + px * 0.55, px * 0.26, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = COLORS.hazardHi;
      ctx.beginPath();
      ctx.arc(x + px * 0.5, y + px * 0.5, px * 0.12, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    default: // '.' and any unexpected code
      drawFloor(ctx, x, y, px);
      return;
  }
}

// ── Sprite tile art ──────────────────────────────────────────────────────────
// Loaded once and cached as decoded <img> elements so `drawTile` can blit them
// synchronously — canvas rendering elsewhere in this file is all sync (no
// await), so images must already be decoded before the first real render.
// See `preloadBattleTileSprites`, which the app calls once on startup; until
// it resolves (or for a sprite this pack has none of), `drawTileProcedural`
// is what actually ends up on the page — a graceful, non-blocking fallback,
// never a broken image.

const WALL_SPRITE_KEYS = ['left', 'mid', 'right', 'topLeft', 'topMid', 'topRight'] as const;
type WallSpriteKey = (typeof WALL_SPRITE_KEYS)[number];

const DEFAULT_WALL: Record<WallSpriteKey, string> = {
  left: wallLeftUrl, mid: wallMidUrl, right: wallRightUrl,
  topLeft: wallTopLeftUrl, topMid: wallTopMidUrl, topRight: wallTopRightUrl,
};

/** The `=` code covers everything from a bar counter to a barrel to a stool
 *  — one fixed crate sprite for all of it looked identical no matter what
 *  the DM's Features text called it. `furnitureVariantFor` below picks one
 *  of these based on that label; `crate` is the fallback for an unlabeled or
 *  unrecognized `=` cell (altar, generic "furniture", etc). */
interface FurnitureSet {
  crate: string;
  table: string;
  barrel: string;
  bench: string;
}

/** Same idea as FurnitureSet for `*` — "hazard (fire/brazier)" per
 *  MAP_LEGEND covers an indoor hearth/campfire/brazier just as often as
 *  actual lava, and those don't look alike. `hazardVariantFor` picks
 *  between them from the Features label. */
interface HazardSet {
  lava: string;
  fireplace: string;
}

interface StyleSpriteSet {
  wall: Record<WallSpriteKey, string>;
  floor: string;
  stairs: string;
  door: string;
  column: string;
  furniture: FurnitureSet;
  water: string;
  rubble: string;
  foliage: string;
  hazard: HazardSet;
  /** Canvas filter applied when blitting this style's sprites — lets a
   *  style reuse another style's art with a different mood (see 'dark')
   *  without needing its own full art pass for every piece. */
  filter?: string;
}

/** Every sprite style the battle-map renderer can draw with — see
 *  `setActiveTileStyle`/`src/data/tileStyles.ts` for the user-facing list.
 *  'dark' reuses the same wall/door/pillar/crate/stairs art as 'default'
 *  (filtered darker/desaturated for consistency) but swaps in real tiles
 *  from Zoltan Kosina's "16x16 Dark Dungeon Tileset" (CC0) for the floor —
 *  the one piece of that pack that turned out to be a clean, atomic tile
 *  rather than a pre-assembled demo fragment (see the extraction notes in
 *  this session's history: most of that sheet wasn't a usable grid).
 *
 *  water/rubble/hazard are shared across both styles (0x72's own pack is
 *  purely indoor dungeon furniture — zero outdoor/terrain tiles): hazard's
 *  `lava` variant is the lava-font pool crop from nijikokun's official
 *  "DungeonTileset II Extended" (CC0, same palette as 0x72's base pack);
 *  water is a cropped tile from lexyshmexy's "Dungeon - Pixel 16x16 Top Down
 *  Tileset" (free, non-commercial-friendly); rubble (the rock pile) is from
 *  Kauzz's "Pixel Valley | Cave (16x16)" (same license terms). Foliage
 *  diverges on purpose: 'default' gets a real tree (Ventilatore's "The
 *  Fan-tasy Tileset", free for non-commercial use, no attribution required)
 *  since that's the style actually meant to read as an outdoor/general-
 *  fantasy setting; 'dark' keeps Kauzz's mushroom since that reads better
 *  for a cave. All picked and cropped by hand — see this session's history
 *  for the extraction process. Sand (`,`) has no sprite yet in either style
 *  (see drawTileProcedural).
 *
 *  `furniture` (table/barrel/bench) and hazard's `fireplace` variant are all
 *  from Ventilatore's free pack too — same source and license as the tree
 *  above — shared across both styles, same reasoning as water/rubble. */
const FURNITURE: FurnitureSet = { crate: crateUrl, table: tableUrl, barrel: barrelUrl, bench: benchUrl };
const HAZARD: HazardSet = { lava: hazardUrl, fireplace: fireplaceUrl };

const TILE_STYLE_SPRITES: Record<string, StyleSpriteSet> = {
  default: {
    wall: DEFAULT_WALL, floor: floorUrl, stairs: stairsUrl, door: doorUrl, column: columnUrl, furniture: FURNITURE,
    water: waterUrl, rubble: rubbleUrl, foliage: treeUrl, hazard: HAZARD,
  },
  dark: {
    wall: DEFAULT_WALL, floor: kosinaFloorUrl, stairs: stairsUrl, door: doorUrl, column: columnUrl, furniture: FURNITURE,
    water: waterUrl, rubble: rubbleUrl, foliage: foliageUrl, hazard: HAZARD,
    filter: 'brightness(0.55) saturate(0.55)',
  },
};

export type TileStyleId = keyof typeof TILE_STYLE_SPRITES;

let activeTileStyle: TileStyleId = 'default';

/** Switches which sprite style `drawTile` draws with, effective on the next
 *  render — nothing re-renders on its own; callers re-run whatever produced
 *  their current preview (see DMConsolePage's refreshMapCardPreviews). */
export function setActiveTileStyle(id: TileStyleId): void {
  activeTileStyle = id;
}

const spriteCache = new Map<string, HTMLImageElement>();
let spritesLoaded = false;

function loadOneSprite(url: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { spriteCache.set(url, img); resolve(); };
    img.onerror = () => resolve(); // missing/broken art just falls back to procedural
    img.src = url;
  });
}

/** Decodes every sprite for every style once and caches them, so later
 *  synchronous renders (`battleMapToPngDataUrl`, PDF export, live preview)
 *  can blit them immediately regardless of which style is active. Safe to
 *  call more than once (no-ops after the first). Call this early (app/page
 *  mount) — a render that happens before it resolves isn't broken, it just
 *  draws the procedural fallback that render call. */
export async function preloadBattleTileSprites(): Promise<void> {
  if (spritesLoaded) return;
  const urls = new Set<string>();
  for (const style of Object.values(TILE_STYLE_SPRITES)) {
    for (const url of Object.values(style.wall)) urls.add(url);
    urls.add(style.floor);
    urls.add(style.stairs);
    urls.add(style.door);
    urls.add(style.column);
    for (const url of Object.values(style.furniture)) urls.add(url);
    urls.add(style.water);
    urls.add(style.rubble);
    urls.add(style.foliage);
    for (const url of Object.values(style.hazard)) urls.add(url);
  }
  await Promise.all([...urls].map(loadOneSprite));
  spritesLoaded = true;
}

function drawSprite(ctx: Ctx, url: string, x: number, y: number, px: number, filter?: string): boolean {
  const img = spriteCache.get(url);
  if (!img) return false;
  if (filter) ctx.filter = filter;
  ctx.drawImage(img, x, y, px, px);
  if (filter) ctx.filter = 'none';
  return true;
}

/** Same as drawSprite but for a non-square footprint — the Objects: layer's
 *  catalog art spans `w`x`h` cells rather than always exactly one. */
function drawSpriteScaled(ctx: Ctx, url: string, x: number, y: number, w: number, h: number): boolean {
  const img = spriteCache.get(url);
  if (!img) return false;
  ctx.drawImage(img, x, y, w, h);
  return true;
}

/** Whether the grid cell at (row, col) is a wall — out-of-bounds counts as
 *  "not a wall" (the map edge reads the same as open space). Pure. */
function isWallAt(grid: string[], row: number, col: number): boolean {
  return grid[row]?.[col] === '#';
}

/** True only for a REAL walkable cell — not a wall, and not void/out-of-
 *  bounds (a space, or past the grid's edge). The distinction from plain
 *  "not a wall" matters for `wallSpriteFor`: a room's bottom wall has void
 *  to its south (nothing beyond the room) but its top wall has real floor
 *  to its south (the room interior) — treating those the same picked the
 *  wrong sprite for the bottom wall (caught by the self-check script before
 *  this ever hit the UI). Pure. */
function isOpenFloorAt(grid: string[], row: number, col: number): boolean {
  const ch = grid[row]?.[col];
  return ch !== undefined && ch !== '#' && ch !== ' ';
}

/** The four cardinal neighbors of a `#` cell — `n`/`s`/`e`/`w` true iff that
 *  neighbor is ALSO a wall (wall-run continuity, for corner detection);
 *  the `*Floor` fields true iff that neighbor is real open floor specifically
 *  (see isOpenFloorAt — void doesn't count), which is what tells a cap/face
 *  wall from a side wall. Everything `wallSpriteFor` needs. Pure. */
export interface WallNeighbors {
  n: boolean; s: boolean; e: boolean; w: boolean;
  nFloor: boolean; sFloor: boolean; eFloor: boolean; wFloor: boolean;
}

export function wallNeighborsAt(grid: string[], row: number, col: number): WallNeighbors {
  return {
    n: isWallAt(grid, row - 1, col),
    s: isWallAt(grid, row + 1, col),
    e: isWallAt(grid, row, col + 1),
    w: isWallAt(grid, row, col - 1),
    nFloor: isOpenFloorAt(grid, row - 1, col),
    sFloor: isOpenFloorAt(grid, row + 1, col),
    eFloor: isOpenFloorAt(grid, row, col + 1),
    wFloor: isOpenFloorAt(grid, row, col - 1),
  };
}

/** Picks which of the 6 low-wall sprites (see WALL_SPRITES) reads correctly
 *  for a `#` cell given its neighbors, using this specific tileset's
 *  convention (its own community-documented "3x3 minimal" autotile, see
 *  0x72_DungeonTilesetII_v1.7/README): a wall shows its flat TOP-CAP when
 *  there's open floor to its south (a north-perimeter wall, looked down on
 *  from above) and its brick FACE when there's open floor to its north (a
 *  south-facing wall) or to its east/west (an east/west-facing side wall).
 *  NW/NE corners (wall continues exactly south+east or south+west) get their
 *  own dedicated corner sprite; SW/SE corners reuse the plain side-wall
 *  piece, since this pack's *low* wall set has no south-corner sprite of its
 *  own (only wall_edge_*, wall_outer_* do — see the ponytail note below).
 *  Verified against a plain rectangular room and an L-shaped room via a
 *  throwaway script before wiring this into the UI. Pure.
 *
 *  ponytail: doesn't use wall_edge_*, wall_outer_* (the full inner/outer
 *  corner-trim set) — SW/SE corners are a visually-fine approximation, not a
 *  true miter. Upgrade path if a DM's room shape ever looks visibly off: add
 *  those sprites and their cases here. */
export function wallSpriteFor(neighbors: WallNeighbors): WallSpriteKey {
  const { n, s, e, w, nFloor, sFloor, eFloor, wFloor } = neighbors;
  if (s && e && !n && !w) return 'topLeft';
  if (s && w && !n && !e) return 'topRight';
  if (n && e && !s && !w) return 'left'; // SW corner, approximated
  if (n && w && !s && !e) return 'right'; // SE corner, approximated
  if (sFloor) return 'topMid';
  if (nFloor) return 'mid';
  if (eFloor) return 'left';
  if (wFloor) return 'right';
  return 'mid'; // interior wall mass, or bordered by void on every side
}

const NEUTRAL_WALL_NEIGHBORS: WallNeighbors = {
  n: true, s: true, e: true, w: true, nFloor: false, sFloor: false, eFloor: false, wFloor: false,
};

/** `- <Label> at <cellrefs>` → cellKey ("col,row", 0-indexed) → lowercased
 *  label, e.g. "Bar counter at B2-K2" → every cell B2..K2 maps to "bar
 *  counter". Mirrors campaign.rs's cell_refs_in (ranges via -/–/—, expanding
 *  a rectangle when both axes differ) closely enough for our purpose here —
 *  picking which furniture sprite LOOKS right, not validating correctness
 *  (that's the backend's job; a spec that fails validation there never
 *  reaches this renderer with bad refs left in). Pure. */
function parseFeatureLabels(features: string): Map<string, string> {
  const labels = new Map<string, string>();
  for (const raw of features.split('\n')) {
    const line = raw.trim().replace(/^-\s*/, '');
    if (!line) continue;
    const atIdx = line.toLowerCase().indexOf(' at ');
    if (atIdx === -1) continue;
    const label = line.slice(0, atIdx).trim().toLowerCase();
    for (const cellKey of cellRefsInText(line.slice(atIdx + 4))) {
      if (!labels.has(cellKey)) labels.set(cellKey, label);
    }
  }
  return labels;
}

const RANGE_DASHES = new Set(['-', '–', '—']); // hyphen, en dash, em dash

/** "B2" → [1, 1] (0-indexed col/row), or null for anything else. */
function parseCellRefToken(tok: string): [number, number] | null {
  const m = /^([A-Za-z]{1,2})(\d{1,2})$/.exec(tok);
  if (!m) return null;
  let col = 0;
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  const row = parseInt(m[2], 10);
  return row > 0 ? [col - 1, row - 1] : null;
}

/** Every "col,row" cell a Features line's tail actually refers to — single
 *  refs and dash-separated ranges (a range across both axes is the
 *  rectangle it spans, same as the backend). A dash next to something that
 *  isn't a cell ref (ordinary prose) is just prose. */
function cellRefsInText(text: string): string[] {
  const toks: { word: string; sep: string }[] = [];
  let cur = '', sep = '';
  for (const ch of text) {
    if (/[A-Za-z0-9]/.test(ch)) {
      cur += ch;
    } else {
      if (cur) { toks.push({ word: cur, sep }); cur = ''; sep = ''; }
      sep += ch;
    }
  }
  if (cur) toks.push({ word: cur, sep });

  const out: string[] = [];
  for (let i = 0; i < toks.length; i++) {
    const a = parseCellRefToken(toks[i].word);
    if (!a) continue;
    const next = toks[i + 1];
    const b = next && RANGE_DASHES.has(next.sep.trim()) ? parseCellRefToken(next.word) : null;
    if (b) {
      const [c1, r1] = a, [c2, r2] = b;
      for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) {
        for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) out.push(`${c},${r}`);
      }
      i++; // consumed the range's second endpoint too
    } else {
      out.push(`${a[0]},${a[1]}`);
    }
  }
  return out;
}

export interface ObjectPlacement { label: string; col: number; row: number; w: number; h: number }

/** `- <label> at <cell> (<W>x<H>)` → placements, mirroring campaign.rs's
 *  parse_object_line (same shape, same tolerances) closely enough for our
 *  purpose here — picking what to draw, not validating correctness (that's
 *  the backend's job; a spec that fails validate_map_spec never reaches
 *  this renderer with a bad Objects line left in). Pure. */
function parseObjectPlacements(objectsText: string): ObjectPlacement[] {
  const out: ObjectPlacement[] = [];
  for (const raw of objectsText.split('\n')) {
    const line = raw.trim().replace(/^-\s*/, '');
    if (!line) continue;
    const atIdx = line.toLowerCase().indexOf(' at ');
    if (atIdx === -1) continue;
    const label = line.slice(0, atIdx).trim();
    const rest = line.slice(atIdx + 4).trim();
    const open = rest.lastIndexOf('(');
    const close = rest.lastIndexOf(')');
    if (open === -1 || close === -1 || close <= open) continue;
    const cellTok = (rest.slice(0, open).trim().match(/^[A-Za-z0-9]+/) ?? [''])[0];
    const cell = parseCellRefToken(cellTok);
    const sizeMatch = /^(\d+)\s*[xX]\s*(\d+)$/.exec(rest.slice(open + 1, close).trim());
    if (!cell || !sizeMatch) continue;
    out.push({ label, col: cell[0], row: cell[1], w: parseInt(sizeMatch[1], 10), h: parseInt(sizeMatch[2], 10) });
  }
  return out;
}

/** label → resolved sprite URL (or null: no library / no match), warmed by
 *  preloadMapObjectSprites and read synchronously by the object draw pass
 *  in renderBattleMapContent — same "resolve once, render from a warm
 *  cache" split as spriteCache/preloadBattleTileSprites. Memoized across
 *  calls so re-rendering an already-resolved spec costs nothing. */
const resolvedObjectUrls = new Map<string, string | null>();

/** Resolves and preloads every unique Objects: label in `spec` against the
 *  user's imported tile catalog (see tile_library.rs's search_tile_catalog),
 *  so the synchronous render pass that follows can draw them from a warm
 *  cache. Call this once before battleMapToPngDataUrl/battleMapToPdfBytes
 *  for a spec that might have changed — safe to call for every spec, since
 *  already-resolved labels are free. No library imported, or no match for a
 *  label, both resolve to `null` (nothing extra drawn) — same as a broken
 *  sprite URL today: silent fallback, never an error. */
export async function preloadMapObjectSprites(spec: string): Promise<void> {
  const map = parseBattleMap(spec);
  if (!map || !map.objects) return;
  const labels = [...new Set(parseObjectPlacements(map.objects).map((p) => p.label))].filter((l) => !resolvedObjectUrls.has(l));
  if (labels.length === 0) return;
  await Promise.all(
    labels.map(async (label) => {
      try {
        const matches = await invoke<{ data_url: string }[]>('search_tile_catalog', { query: label });
        const url = matches[0]?.data_url ?? null;
        if (url) await loadOneSprite(url);
        resolvedObjectUrls.set(label, url);
      } catch {
        resolvedObjectUrls.set(label, null);
      }
    })
  );
}

/** Which furniture look best fits a Features label — real variety instead
 *  of every `=` cell drawing the same crate regardless of what the DM
 *  called it. Falls back to the plain crate for anything unrecognized
 *  (altar, generic "furniture", or no label at all — an ad-hoc/hand-edited
 *  map may have `=` cells with no matching Features line). */
function furnitureVariantFor(label: string | undefined): keyof FurnitureSet {
  if (!label) return 'crate';
  if (/\b(bar|counter|table|desk|altar|shrine)\b/.test(label)) return 'table';
  if (/\b(barrel|keg|cask)\b/.test(label)) return 'barrel';
  if (/\b(stool|chair|bench|seat)\b/.test(label)) return 'bench';
  return 'crate';
}

/** Which hazard look fits a Features label — MAP_LEGEND defines `*` as
 *  "hazard (fire/brazier)", and an indoor hearth/campfire/brazier doesn't
 *  look like a lava pit. `fireplace` is the fallback (unlabeled, "brazier",
 *  "hearth", "campfire", anything not explicitly molten) since most `*`
 *  cells are indoor — actual lava only wins when the label says so. */
function hazardVariantFor(label: string | undefined): keyof HazardSet {
  if (label && /\b(lava|magma|molten|chasm)\b/.test(label)) return 'lava';
  return 'fireplace';
}

/** Sprite-first tile dispatch, using whichever style `setActiveTileStyle`
 *  last selected: draws real art for the codes that style covers (falling
 *  back to the procedural renderer if sprites haven't finished loading
 *  yet), and the original procedural art for anything without a sprite yet
 *  (currently just sand, `,` — see drawTileProcedural). `wallNeighbors` is
 *  only meaningful for `#` cells; omit it for isolated single-tile renders,
 *  where it defaults to a plain wall face (see NEUTRAL_WALL_NEIGHBORS).
 *  `featureLabel` is only meaningful for `=`/`*` cells (see
 *  furnitureVariantFor/hazardVariantFor) — omit it for the fallback look. */
function drawTile(ctx: Ctx, code: string, x: number, y: number, px: number, wallNeighbors?: WallNeighbors, featureLabel?: string) {
  const style = TILE_STYLE_SPRITES[activeTileStyle];
  switch (code) {
    case '.':
      if (drawSprite(ctx, style.floor, x, y, px, style.filter)) return;
      break;
    case '#': {
      const key = wallSpriteFor(wallNeighbors ?? NEUTRAL_WALL_NEIGHBORS);
      if (drawSprite(ctx, style.wall[key], x, y, px, style.filter)) return;
      break;
    }
    case '+':
      if (drawSprite(ctx, style.floor, x, y, px, style.filter) && drawSprite(ctx, style.door, x, y, px, style.filter)) return;
      break;
    case 'o':
      if (drawSprite(ctx, style.floor, x, y, px, style.filter) && drawSprite(ctx, style.column, x, y, px, style.filter)) return;
      break;
    case '=': {
      const sprite = style.furniture[furnitureVariantFor(featureLabel)];
      if (drawSprite(ctx, style.floor, x, y, px, style.filter) && drawSprite(ctx, sprite, x, y, px, style.filter)) return;
      break;
    }
    case '_':
      if (drawSprite(ctx, style.stairs, x, y, px, style.filter)) return;
      break;
    case '~':
      if (drawSprite(ctx, style.water, x, y, px, style.filter)) return;
      break;
    case '*': {
      const variant = hazardVariantFor(featureLabel);
      const sprite = style.hazard[variant];
      // 'lava' is a full-cell pool crop (its own rocky border, no gap to
      // fill); 'fireplace' is a standalone object like furniture/rubble and
      // needs a floor pass underneath or it'd float on a transparent cell.
      if (variant === 'lava') {
        if (drawSprite(ctx, sprite, x, y, px, style.filter)) return;
      } else if (drawSprite(ctx, style.floor, x, y, px, style.filter) && drawSprite(ctx, sprite, x, y, px, style.filter)) {
        return;
      }
      break;
    }
    case '^':
      if (drawSprite(ctx, style.floor, x, y, px, style.filter) && drawSprite(ctx, style.rubble, x, y, px, style.filter)) return;
      break;
    case 'T':
      if (drawSprite(ctx, style.floor, x, y, px, style.filter) && drawSprite(ctx, style.foliage, x, y, px, style.filter)) return;
      break;
  }
  drawTileProcedural(ctx, code, x, y, px);
}

// ── Canvas rendering ─────────────────────────────────────────────────────────

export interface RenderWindow { colStart: number; colEnd: number; rowStart: number; rowEnd: number }

/** Renders ONLY the grid content — tiles + thin cell-boundary lines, no
 *  coordinate ruler — sized exactly `wCols*cellPx` by `wRows*cellPx`. The
 *  ruler is composited separately (see `composeRulerFrame`). */
function renderBattleMapContent(map: ParsedBattleMap, cellPx: number, win?: RenderWindow): HTMLCanvasElement {
  const w = win ?? { colStart: 0, colEnd: map.cols, rowStart: 0, rowEnd: map.rows };
  const wCols = w.colEnd - w.colStart;
  const wRows = w.rowEnd - w.rowStart;
  const canvas = document.createElement('canvas');
  canvas.width = wCols * cellPx;
  canvas.height = wRows * cellPx;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = COLORS.void;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const featureLabels = parseFeatureLabels(map.features);
  for (let r = 0; r < wRows; r++) {
    for (let c = 0; c < wCols; c++) {
      const mapRow = w.rowStart + r, mapCol = w.colStart + c;
      const code = map.grid[mapRow]?.[mapCol] ?? ' ';
      const neighbors = code === '#' ? wallNeighborsAt(map.grid, mapRow, mapCol) : undefined;
      const featureLabel = code === '=' || code === '*' ? featureLabels.get(`${mapCol},${mapRow}`) : undefined;
      drawTile(ctx, code, c * cellPx, r * cellPx, cellPx, neighbors, featureLabel);
    }
  }

  // Objects: layer — free placements independent of the legend grid, drawn
  // on top of it (see preloadMapObjectSprites, which must have already run
  // for `resolvedObjectUrls` to have anything in it). An object anchored
  // outside the current render window is skipped rather than clipped —
  // acceptable for a print-paginated map, since the same map's other pages
  // still show it in full where it actually belongs.
  for (const p of map.objects ? parseObjectPlacements(map.objects) : []) {
    if (p.col < w.colStart || p.col >= w.colEnd || p.row < w.rowStart || p.row >= w.rowEnd) continue;
    const url = resolvedObjectUrls.get(p.label);
    if (!url) continue;
    drawSpriteScaled(ctx, url, (p.col - w.colStart) * cellPx, (p.row - w.rowStart) * cellPx, p.w * cellPx, p.h * cellPx);
  }

  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  for (let r = 0; r < wRows; r++) {
    for (let c = 0; c < wCols; c++) {
      const code = map.grid[w.rowStart + r]?.[w.colStart + c] ?? ' ';
      if (code === ' ') continue;
      ctx.strokeRect(c * cellPx, r * cellPx, cellPx, cellPx);
    }
  }
  return canvas;
}

/** Draws the coordinate ruler (A../1..) around a content layer and returns
 *  the composed full-size canvas. */
function composeRulerFrame(
  map: ParsedBattleMap, cellPx: number, win: RenderWindow | undefined, content: CanvasImageSource
): HTMLCanvasElement {
  const w = win ?? { colStart: 0, colEnd: map.cols, rowStart: 0, rowEnd: map.rows };
  const wCols = w.colEnd - w.colStart;
  const wRows = w.rowEnd - w.rowStart;
  const ruler = Math.round(cellPx * 0.5);
  const canvas = document.createElement('canvas');
  canvas.width = ruler + wCols * cellPx;
  canvas.height = ruler + wRows * cellPx;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = COLORS.void;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(content, ruler, ruler, wCols * cellPx, wRows * cellPx);

  ctx.fillStyle = '#e8e2d2';
  ctx.font = `${Math.round(ruler * 0.5)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let c = 0; c < wCols; c++) {
    ctx.fillText(columnLabel(w.colStart + c), ruler + c * cellPx + cellPx / 2, ruler / 2);
  }
  for (let r = 0; r < wRows; r++) {
    ctx.fillText(String(w.rowStart + r + 1), ruler / 2, ruler + r * cellPx + cellPx / 2);
  }
  return canvas;
}

/** Renders a (sub-)grid to a fresh canvas, with a coordinate ruler (A.. / 1..)
 *  down the left and across the top so cells are referenceable on the print.
 *  `win` defaults to the whole map. `cellPx` sets resolution. */
export function renderBattleMapToCanvas(map: ParsedBattleMap, cellPx = 64, win?: RenderWindow): HTMLCanvasElement {
  return composeRulerFrame(map, cellPx, win, renderBattleMapContent(map, cellPx, win));
}

/** Spreadsheet-style column label: 0→A, 25→Z, 26→AA. */
export function columnLabel(index: number): string {
  let n = index;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/** Renders the whole map to a PNG data URL (dialog preview + PNG export). */
export function battleMapToPngDataUrl(spec: string, cellPx = 64): string | null {
  const map = parseBattleMap(spec);
  if (!map) return null;
  return renderBattleMapToCanvas(map, cellPx).toDataURL('image/png');
}

// ── PDF export (true 1-inch-per-square, tiled across pages) ───────────────────

const PT_PER_SQUARE = 72;   // 1 inch
const PAGE_W = 612, PAGE_H = 792; // US Letter, points
const MARGIN = 36;          // 0.5 inch
const RENDER_PX = 96;       // canvas px per square for embedded image crispness

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.split(',')[1];
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Builds a print-scaled PDF: every grid square is exactly 1 inch, and a map
 *  bigger than one page is tiled across multiple Letter sheets (with the
 *  coordinate ruler repeated on each) to tape together. */
export async function battleMapToPdfBytes(spec: string): Promise<Uint8Array | null> {
  const map = parseBattleMap(spec);
  if (!map) return null;

  const usableSquaresX = Math.floor((PAGE_W - 2 * MARGIN) / PT_PER_SQUARE);
  const usableSquaresY = Math.floor((PAGE_H - 2 * MARGIN) / PT_PER_SQUARE);
  const pdf = await PDFDocument.create();

  for (let ry = 0; ry < map.rows; ry += usableSquaresY) {
    for (let rx = 0; rx < map.cols; rx += usableSquaresX) {
      const win: RenderWindow = {
        colStart: rx, colEnd: Math.min(map.cols, rx + usableSquaresX),
        rowStart: ry, rowEnd: Math.min(map.rows, ry + usableSquaresY),
      };
      const source = renderBattleMapContent(map, RENDER_PX, win);
      const canvas = composeRulerFrame(map, RENDER_PX, win, source);
      const dataUrl = canvas.toDataURL('image/png');
      const png = await pdf.embedPng(dataUrlToBytes(dataUrl));
      const page = pdf.addPage([PAGE_W, PAGE_H]);
      // The canvas is (ruler + cols*px) wide; scale so ONE square === 72pt.
      const scale = PT_PER_SQUARE / RENDER_PX;
      const drawW = canvas.width * scale;
      const drawH = canvas.height * scale;
      page.drawImage(png, { x: MARGIN, y: PAGE_H - MARGIN - drawH, width: drawW, height: drawH });
    }
  }
  return pdf.save();
}
