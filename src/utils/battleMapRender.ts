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
   *  Resolved to real catalog art by the backend vision picker; the renderer
   *  draws that via the `tiles` param (see get_map_tiles / MapTileArt), not
   *  from this text directly. */
  objects: string;
  tactics: string;
  /** Cells named on the `Deployment:` section's `Enemies:`/`Party:` lines,
   *  0-indexed [col,row] and clamped to the grid — the translucent start-zone
   *  overlay (drawn only when the caller asks, so a printed map can omit it).
   *  Empty for a spec generated before the section existed. */
  deployment: { enemies: Array<[number, number]>; party: Array<[number, number]> };
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
    if (/^(Features:|Objects:|Tactics:|Deployment:|Legend:|Grid:)/.test(trimmed) || trimmed.startsWith('# ')) break;
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
      if (/^(Features:|Objects:|Tactics:|Deployment:|Legend:|Grid:|Map:)$/.test(t) || t.startsWith('# ')) break;
      out.push(lines[i]);
    }
    return out.join('\n').trim();
  };

  // Deployment start-zones: pull the cell refs out of the `Enemies:`/`Party:`
  // bullets' prose and clamp to the grid (a stray non-cell token like a DC or a
  // damage die that happens to look cell-shaped just falls outside and drops).
  const zoneCells = (side: string): Array<[number, number]> => {
    const line = lines.find((l) => new RegExp(`^\\s*-\\s*${side}\\s*:`, 'i').test(l));
    if (!line) return [];
    // The line is "<start cells> — <reason>": take only the cells BEFORE the
    // reason separator, so a landmark the side moves TOWARD (named in the
    // reason, e.g. "entering at F12 — until they reach B10") isn't drawn as a
    // start zone. Cell ranges use a bare dash ("F8-H8"), so splitting on a
    // SPACED dash never splits a range.
    const cellPart = line.replace(new RegExp(`^\\s*-\\s*${side}\\s*:`, 'i'), '').split(/\s[—–-]\s/)[0];
    return cellRefsInText(cellPart)
      .map((s) => s.split(',').map(Number) as [number, number])
      // In grid AND on a cell a miniature could actually stand — never tint a
      // wall, a void cell, or a `%` chasm (a fatal drop). A range like
      // "D9-J12" spanning the cave edge only fills the passable cells inside it.
      .filter(([c, r]) => c >= 0 && c < cols && r >= 0 && r < grid.length && grid[r][c] !== '#' && grid[r][c] !== ' ' && grid[r][c] !== '%');
  };

  return { name, cols, rows: grid.length, cellFeet, grid, features: section('Features:'), objects: section('Objects:'), tactics: section('Tactics:'), deployment: { enemies: zoneCells('Enemies'), party: zoneCells('Party') } };
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
  chasm: '#0c0a08', chasmRim: '#332c24',
  bridgePlank: '#6e4a28', bridgeRope: '#a07d4a',
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
    case '%': {
      // A deep chasm/gorge — a lethal drop, drawn as a dark pit with a faintly
      // lit rocky rim so it reads as depth, clearly NOT `~` water. No floor
      // underneath: nothing stands here.
      fillCell(ctx, x, y, px, COLORS.chasm);
      const g = ctx.createRadialGradient(x + px * 0.5, y + px * 0.55, px * 0.06, x + px * 0.5, y + px * 0.5, px * 0.78);
      g.addColorStop(0, '#040302');
      g.addColorStop(0.7, COLORS.chasm);
      g.addColorStop(1, COLORS.chasmRim);
      ctx.fillStyle = g;
      ctx.fillRect(x, y, px, px);
      return;
    }
    case 'H': {
      // A plank/rope bridge deck laid over a chasm — dark void showing through
      // the plank gaps, timber slats across the span, a rope rail down each
      // long edge. Reads as a walkable crossing over the drop.
      fillCell(ctx, x, y, px, COLORS.chasm);
      ctx.fillStyle = COLORS.bridgePlank;
      const planks = 4;
      for (let i = 0; i < planks; i++) {
        ctx.fillRect(x + (px * i) / planks + px * 0.03, y + px * 0.06, px / planks - px * 0.06, px * 0.88);
      }
      ctx.strokeStyle = COLORS.bridgeRope;
      ctx.lineWidth = Math.max(1.5, px * 0.06);
      ctx.beginPath();
      ctx.moveTo(x, y + px * 0.09); ctx.lineTo(x + px, y + px * 0.09);
      ctx.moveTo(x, y + px * 0.91); ctx.lineTo(x + px, y + px * 0.91);
      ctx.stroke();
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

/** The ground for one cell: the resolved biome floor texture if there is one
 *  (drawn WITHOUT the style filter — it's real full-colour biome art, not the
 *  dungeon tile that gets darkened), else the built-in style floor. This is
 *  what makes a beach read as sand and a cave as rock instead of dungeon
 *  stone. Falls through to the built-in floor if the biome texture hasn't
 *  loaded yet. */
/** The catalog-resolved terrain for one map: the ground under `.`, the water
 *  under `~`, and whether `#` is living rock or built masonry. Resolved in
 *  campaign.rs (`resolve_floor` / `resolve_liquid` / `NATURAL_WALL_BIOMES`) —
 *  everything here just draws what it's handed. */
export type MapTerrain = {
  floor?: string | null;
  liquid?: string | null;
  /** `#` is living rock — draw the ground darkened rather than the masonry
   *  sprites. True for caves and wilderness, false for taverns and towns,
   *  whose walls really are mortared stone and already read correctly. */
  naturalWalls?: boolean;
};

function drawGround(ctx: Ctx, x: number, y: number, px: number, terrain: MapTerrain | undefined, style: StyleSpriteSet): boolean {
  if (terrain?.floor && drawSprite(ctx, terrain.floor, x, y, px)) return true;
  return drawSprite(ctx, style.floor, x, y, px, style.filter);
}

/** Draw a texture, then wash it with black. How a natural biome's `#` (the
 *  living rock the cave is cut from) and ` ` (solid rock past the map edge)
 *  are made to read as clearly NOT-floor while staying the same material —
 *  which is what a top-down cave actually looks like. Doing it by shading the
 *  floor rather than resolving a separate wall texture is deliberate: the
 *  catalog's Textures are all GROUND art, and its best "rock" candidate is tan
 *  crazy-paving that reads as a patio. */
/** How hard `#` and ` ` are shaded down from the floor texture. Wall must read
 *  as impassable at a glance next to lit floor; void is darker still so the
 *  map's outline stays legible where wall meets nothing. */
const WALL_DARKNESS = 0.55;
const VOID_DARKNESS = 0.78;

function drawShaded(ctx: Ctx, url: string, x: number, y: number, px: number, darkness: number): boolean {
  if (!drawSprite(ctx, url, x, y, px)) return false;
  ctx.fillStyle = `rgba(0,0,0,${darkness})`;
  ctx.fillRect(x, y, px, px);
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


/** One catalog tile the vision resolver chose for a placement (see
 *  campaign.rs get_map_tiles / MapTileArt). `cells` are [col,row]; `w`/`h` the
 *  footprint in cells; `tw`/`th` the tile's native cell size so a small piece
 *  can be TILED across a wider run (a 1x1 bar segment across a 6x1 counter)
 *  instead of stretched. `data_url` is the loaded image. */
export interface MapTileArt {
  cells: [number, number][];
  w: number;
  h: number;
  tw: number;
  th: number;
  data_url: string;
  /** Optional sub-cell placement [x, y, w, h] in fractional cells (absolute
   *  grid coords). When set, the tile is drawn ONCE inside that rect instead of
   *  tiled across the footprint — a hearth's flame in its firebox. */
  sub?: [number, number, number, number] | null;
}

/** Preloads the resolved tiles' art into the shared sprite cache so the
 *  synchronous render pass can draw them — same warm-cache split as
 *  preloadBattleTileSprites. Safe to call for any list; already-loaded URLs
 *  are free. */
export async function preloadResolvedTileArt(tiles: MapTileArt[], terrain?: MapTerrain | null): Promise<void> {
  const urls = tiles.map((t) => t.data_url);
  if (terrain?.floor) urls.push(terrain.floor);
  if (terrain?.liquid) urls.push(terrain.liquid);
  await Promise.all(urls.map((u) => loadOneSprite(u)));
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
function drawTile(ctx: Ctx, code: string, x: number, y: number, px: number, wallNeighbors?: WallNeighbors, featureLabel?: string, terrain?: MapTerrain) {
  const style = TILE_STYLE_SPRITES[activeTileStyle];
  switch (code) {
    case '.':
      if (drawGround(ctx, x, y, px, terrain, style)) return;
      break;
    case ' ':
      // Void past the map edge. In a natural biome that's not nothing, it's
      // the rock the cave was cut from — so shade the ground hard rather than
      // punching a flat near-black hole. The prompt now actively asks for
      // irregular outlines (alcoves, jogs), and every one of them was landing
      // as a black rectangle that read like a rendering glitch.
      if (terrain?.naturalWalls && terrain.floor && drawShaded(ctx, terrain.floor, x, y, px, VOID_DARKNESS)) return;
      break;
    case '#': {
      // Living rock in the wilderness; mortared masonry in a building.
      if (terrain?.naturalWalls && terrain.floor && drawShaded(ctx, terrain.floor, x, y, px, WALL_DARKNESS)) return;
      const key = wallSpriteFor(wallNeighbors ?? NEUTRAL_WALL_NEIGHBORS);
      if (drawSprite(ctx, style.wall[key], x, y, px, style.filter)) return;
      break;
    }
    case '+':
      // In a natural biome there's nothing to hang a door on — `+` is a cave
      // mouth or a trail gap, and the normal-brightness cell breaking the
      // darkened wall band already reads as the opening. Red plank doors
      // floating on grass (live: every forest/cave map) read as a bug.
      if (terrain?.naturalWalls) {
        if (drawGround(ctx, x, y, px, terrain, style)) return;
        break;
      }
      if (drawGround(ctx, x, y, px, terrain, style) && drawSprite(ctx, style.door, x, y, px, style.filter)) return;
      break;
    case 'o':
      // Intentionally NOT the column sprite: column.png is 16x48 (a pillar
      // drawn three cells TALL, a side-on view), but an `o` is a single 1x1
      // cell, so drawSprite crushes it to a third height into a stubby,
      // barrel-looking blob nobody can identify. A pillar on a TOP-DOWN grid
      // is a round stone cross-section anyway — fall through to the
      // procedural `case 'o'` (floor + stone disc + highlight), which draws
      // exactly that and reads correctly.
      break;
    case '=': {
      const sprite = style.furniture[furnitureVariantFor(featureLabel)];
      if (drawGround(ctx, x, y, px, terrain, style) && drawSprite(ctx, sprite, x, y, px, style.filter)) return;
      break;
    }
    case '_':
      if (drawSprite(ctx, style.stairs, x, y, px, style.filter)) return;
      break;
    case '~':
      if (terrain?.liquid && drawSprite(ctx, terrain.liquid, x, y, px)) return;
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
      } else if (drawGround(ctx, x, y, px, terrain, style) && drawSprite(ctx, sprite, x, y, px, style.filter)) {
        return;
      }
      break;
    }
    case '^':
      if (drawGround(ctx, x, y, px, terrain, style) && drawSprite(ctx, style.rubble, x, y, px, style.filter)) return;
      break;
    case 'T':
      if (drawGround(ctx, x, y, px, terrain, style) && drawSprite(ctx, style.foliage, x, y, px, style.filter)) return;
      break;
  }
  drawTileProcedural(ctx, code, x, y, px);
}

// ── Canvas rendering ─────────────────────────────────────────────────────────

export interface RenderWindow { colStart: number; colEnd: number; rowStart: number; rowEnd: number }

/** Renders ONLY the grid content — tiles + thin cell-boundary lines, no
 *  coordinate ruler — sized exactly `wCols*cellPx` by `wRows*cellPx`. The
 *  ruler is composited separately (see `composeRulerFrame`). */
const DEPLOYMENT_STYLES = {
  enemies: { fill: 'rgba(220,38,38,0.30)', edge: 'rgba(220,38,38,0.95)', label: 'ENEMIES' },
  party: { fill: 'rgba(56,189,248,0.30)', edge: 'rgba(56,189,248,0.98)', label: 'PARTY' },
} as const;

/** Groups a cell set into 4-connected clusters, so a side split across two
 *  ledges gets a label over each cluster instead of one floating between them. */
function contiguousGroups(cells: Array<[number, number]>): Array<Array<[number, number]>> {
  const key = ([c, r]: [number, number]) => `${c},${r}`;
  const remaining = new Map(cells.map((cell) => [key(cell), cell] as const));
  const groups: Array<Array<[number, number]>> = [];
  for (const start of cells) {
    if (!remaining.has(key(start))) continue;
    const group: Array<[number, number]> = [];
    const stack = [start];
    remaining.delete(key(start));
    while (stack.length) {
      const [c, r] = stack.pop()!;
      group.push([c, r]);
      for (const n of [[c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]] as Array<[number, number]>) {
        if (remaining.has(key(n))) { remaining.delete(key(n)); stack.push(n); }
      }
    }
    groups.push(group);
  }
  return groups;
}

/** Translucent Enemies/Party start-zones over the grid: a tinted fill with a
 *  crisp border tracing each region's outer edge, plus a pill label per
 *  cluster. Drawn last so it reads over terrain and art; entirely optional so
 *  the same map prints clean with it off. */
function drawDeploymentZones(ctx: CanvasRenderingContext2D, map: ParsedBattleMap, cellPx: number, w: RenderWindow) {
  for (const side of ['enemies', 'party'] as const) {
    const cells = map.deployment[side].filter(([c, r]) => c >= w.colStart && c < w.colEnd && r >= w.rowStart && r < w.rowEnd);
    if (cells.length === 0) continue;
    const style = DEPLOYMENT_STYLES[side];
    const x = (c: number) => (c - w.colStart) * cellPx;
    const y = (r: number) => (r - w.rowStart) * cellPx;

    ctx.fillStyle = style.fill;
    for (const [c, r] of cells) ctx.fillRect(x(c), y(r), cellPx, cellPx);

    // Outline only the region's outer edges (a cell side with no same-zone
    // neighbour) so the whole cluster reads as one bordered area.
    const has = new Set(cells.map(([c, r]) => `${c},${r}`));
    ctx.strokeStyle = style.edge;
    ctx.lineWidth = Math.max(2, cellPx * 0.06);
    ctx.beginPath();
    for (const [c, r] of cells) {
      if (!has.has(`${c},${r - 1}`)) { ctx.moveTo(x(c), y(r)); ctx.lineTo(x(c) + cellPx, y(r)); }
      if (!has.has(`${c},${r + 1}`)) { ctx.moveTo(x(c), y(r) + cellPx); ctx.lineTo(x(c) + cellPx, y(r) + cellPx); }
      if (!has.has(`${c - 1},${r}`)) { ctx.moveTo(x(c), y(r)); ctx.lineTo(x(c), y(r) + cellPx); }
      if (!has.has(`${c + 1},${r}`)) { ctx.moveTo(x(c) + cellPx, y(r)); ctx.lineTo(x(c) + cellPx, y(r) + cellPx); }
    }
    ctx.stroke();

    for (const group of contiguousGroups(cells)) {
      const cx = group.reduce((a, [c]) => a + c, 0) / group.length;
      const cy = group.reduce((a, [, r]) => a + r, 0) / group.length;
      drawZoneLabel(ctx, style.label, (cx - w.colStart + 0.5) * cellPx, (cy - w.rowStart + 0.5) * cellPx, cellPx);
    }
  }
}

/** A centered pill label (dark plate + white text) so the zone name stays
 *  legible over any terrain underneath. */
function drawZoneLabel(ctx: CanvasRenderingContext2D, text: string, px: number, py: number, cellPx: number) {
  ctx.font = `bold ${Math.round(cellPx * 0.3)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const padX = cellPx * 0.16;
  const tw = ctx.measureText(text).width;
  const h = Math.round(cellPx * 0.42);
  ctx.fillStyle = 'rgba(15,23,42,0.85)';
  ctx.fillRect(px - tw / 2 - padX, py - h / 2, tw + padX * 2, h);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, px, py);
}

function renderBattleMapContent(map: ParsedBattleMap, cellPx: number, win?: RenderWindow, tiles: MapTileArt[] = [], terrain?: MapTerrain, showDeployment = false): HTMLCanvasElement {
  const w = win ?? { colStart: 0, colEnd: map.cols, rowStart: 0, rowEnd: map.rows };
  const wCols = w.colEnd - w.colStart;
  const wRows = w.rowEnd - w.rowStart;
  const canvas = document.createElement('canvas');
  canvas.width = wCols * cellPx;
  canvas.height = wRows * cellPx;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = COLORS.void;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Cells a resolved catalog tile will cover — the base pass draws plain floor
  // there (not the built-in glyph sprite) so the real tile sits on floor with
  // no squished-column / campfire artefact peeking out from under it.
  const covered = new Set<string>();
  for (const t of tiles) for (const [c, r] of t.cells) covered.add(`${c},${r}`);

  const featureLabels = parseFeatureLabels(map.features);
  for (let r = 0; r < wRows; r++) {
    for (let c = 0; c < wCols; c++) {
      const mapRow = w.rowStart + r, mapCol = w.colStart + c;
      let code = map.grid[mapRow]?.[mapCol] ?? ' ';
      if (covered.has(`${mapCol},${mapRow}`) && code !== '#' && code !== ' ') code = '.'; // resolved tile replaces the glyph
      const neighbors = code === '#' ? wallNeighborsAt(map.grid, mapRow, mapCol) : undefined;
      const featureLabel = code === '=' || code === '*' ? featureLabels.get(`${mapCol},${mapRow}`) : undefined;
      drawTile(ctx, code, c * cellPx, r * cellPx, cellPx, neighbors, featureLabel, terrain);
    }
  }

  // Resolved-tile layer — the exact catalog art the vision picker chose for
  // each placement, drawn over the floor. A tile smaller than its footprint is
  // repeated (tiled) across it in native steps rather than stretched; a
  // placement entirely outside the current render window is skipped (its other
  // print pages still show it where it belongs).
  for (const t of tiles) {
    const originCol = Math.min(...t.cells.map(([c]) => c));
    const originRow = Math.min(...t.cells.map(([, r]) => r));
    if (originCol < w.colStart || originCol >= w.colEnd || originRow < w.rowStart || originRow >= w.rowEnd) continue;
    // Sub-cell placement (a hearth's flame): draw once inside the given rect.
    if (t.sub) {
      const [sx, sy, sw, sh] = t.sub;
      drawSpriteScaled(ctx, t.data_url, (sx - w.colStart) * cellPx, (sy - w.rowStart) * cellPx, sw * cellPx, sh * cellPx);
      continue;
    }
    // Art bigger than its footprint — a 3x3 pine on a single `T` cell. The
    // resolver searches at the object's real catalog size (see
    // `structured_footprint_guide`), so the CHOSEN art is a proper tree, but
    // the grid cell it anchors is still 1x1. Draw it at native size, CENTERED
    // on the footprint, overhanging the neighbours rather than crushed into
    // one square — which is what a tree on a battle map actually looks like,
    // and (with several overlapping) reads as real canopy instead of shrubs.
    // Tactically it stays a 1-cell object; this is purely how it's drawn.
    if (t.tw > t.w || t.th > t.h) {
      const cx = (originCol - w.colStart + t.w / 2) * cellPx;
      const cy = (originRow - w.rowStart + t.h / 2) * cellPx;
      const dw = t.tw * cellPx, dh = t.th * cellPx;
      drawSpriteScaled(ctx, t.data_url, cx - dw / 2, cy - dh / 2, dw, dh);
      continue;
    }
    const stepX = Math.max(1, t.tw), stepY = Math.max(1, t.th);
    for (let dy = 0; dy < t.h; dy += stepY) {
      for (let dx = 0; dx < t.w; dx += stepX) {
        const px = (originCol + dx - w.colStart) * cellPx;
        const py = (originRow + dy - w.rowStart) * cellPx;
        // Clamp the last (partial) repeat so a tile whose size doesn't evenly
        // divide the footprint — a 5x1 bar in a 6x1 run — squishes to fit
        // rather than overflowing into the next cells.
        const drawW = Math.min(stepX, t.w - dx) * cellPx;
        const drawH = Math.min(stepY, t.h - dy) * cellPx;
        drawSpriteScaled(ctx, t.data_url, px, py, drawW, drawH);
      }
    }
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

  if (showDeployment) drawDeploymentZones(ctx, map, cellPx, w);
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
export function renderBattleMapToCanvas(map: ParsedBattleMap, cellPx = 64, win?: RenderWindow, tiles: MapTileArt[] = [], terrain?: MapTerrain, showDeployment = false): HTMLCanvasElement {
  return composeRulerFrame(map, cellPx, win, renderBattleMapContent(map, cellPx, win, tiles, terrain, showDeployment));
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

/** Renders the whole map to a PNG data URL (dialog preview + PNG export).
 *  `tiles` are the resolved catalog tiles (preload their art first with
 *  preloadResolvedTileArt); omit for the plain built-in-sprite render. */
export function battleMapToPngDataUrl(spec: string, cellPx = 64, tiles: MapTileArt[] = [], terrain?: MapTerrain, showDeployment = false): string | null {
  const map = parseBattleMap(spec);
  if (!map) return null;
  return renderBattleMapToCanvas(map, cellPx, undefined, tiles, terrain, showDeployment).toDataURL('image/png');
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
export async function battleMapToPdfBytes(spec: string, tiles: MapTileArt[] = [], terrain?: MapTerrain, showDeployment = false): Promise<Uint8Array | null> {
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
      const source = renderBattleMapContent(map, RENDER_PX, win, tiles, terrain, showDeployment);
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
