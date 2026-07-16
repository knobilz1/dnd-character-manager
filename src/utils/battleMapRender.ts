/**
 * battleMapRender.ts — turns a DM-authored battle-map spec (an ASCII grid +
 * legend + tactics, see campaign.rs's build_battle_maps_prompt) into a
 * printable image and PDF. The spec is the source of truth; rendering is fully
 * deterministic, so what the DM authored is exactly what prints.
 *
 * Tiles are drawn PROCEDURALLY here (no external art), which keeps the app
 * self-contained and lets a map render offline with zero bundled assets. The
 * drawing is isolated in `drawTile` behind a single `TILE` dispatch — to swap
 * in a real CC0 art tileset later, replace `drawTile` with an image blit from
 * bundled sprites keyed by the same legend codes; nothing else changes.
 *
 * The coordinate system matches the DM's prompt and the Active Battle Log:
 * columns are lettered A, B, C… left-to-right, rows numbered 1, 2, 3…
 * top-to-bottom, so a cell like "C3" is one exact square here and in play.
 */

import { PDFDocument } from 'pdf-lib';

export interface ParsedBattleMap {
  name: string;
  cols: number;
  rows: number;
  cellFeet: number;
  /** One string per row, each padded to exactly `cols` chars (space = void). */
  grid: string[];
  features: string;
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
    if (/^(Features:|Tactics:|Legend:|Grid:)/.test(trimmed) || trimmed.startsWith('# ')) break;
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
      if (/^(Features:|Tactics:|Legend:|Grid:|Map:)$/.test(t) || t.startsWith('# ')) break;
      out.push(lines[i]);
    }
    return out.join('\n').trim();
  };

  return { name, cols, rows: grid.length, cellFeet, grid, features: section('Features:'), tactics: section('Tactics:') };
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

function drawTile(ctx: Ctx, code: string, x: number, y: number, px: number) {
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

// ── Canvas rendering ─────────────────────────────────────────────────────────

export interface RenderWindow { colStart: number; colEnd: number; rowStart: number; rowEnd: number }

/** Renders ONLY the grid content — tiles + thin cell-boundary lines, no
 *  coordinate ruler — sized exactly `wCols*cellPx` by `wRows*cellPx`. This is
 *  the layer that's safe to hand to an AI stylize pass (see
 *  `composeRulerFrame`'s doc comment for why the ruler is never included). */
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

  for (let r = 0; r < wRows; r++) {
    for (let c = 0; c < wCols; c++) {
      const code = map.grid[w.rowStart + r]?.[w.colStart + c] ?? ' ';
      drawTile(ctx, code, c * cellPx, r * cellPx, cellPx);
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
  return canvas;
}

// Depth-map colors for the ControlNet stylize path (comfyui.rs's
// comfyui_stylize_map) — near/raised objects render brighter, the flat floor
// plane renders darker, matching the convention depth-conditioned ControlNet
// models are trained on (bright = close to camera, dark = far). Canny edges
// alone only constrain 2D boundary *positions*, not camera perspective — a
// model with a strong bias toward oblique architectural photography can
// satisfy "edges roughly here" while still reinterpreting the whole scene as
// a 3D room viewed at an angle (confirmed live: exported pages showed
// visible wall/furniture sides instead of a strict top-down view, plus
// furniture repositioned once the model committed to that 3D reading). A
// near-flat depth map is a much more direct "this scene has no room depth"
// signal than an edge outline.
const DEPTH_FLOOR = '#4a4a4a';
const DEPTH_RAISED = '#e0e0e0';

function isRaisedCell(code: string): boolean {
  // Walls/furniture/pillars/trees/hazards stand up off the floor; difficult
  // terrain, stairs, and water are walkable ground-plane texture, not
  // obstructions, so they stay at floor depth.
  return code === '#' || code === '+' || code === '=' || code === 'o' || code === 'T' || code === '*';
}

// ── Per-tile-type stylization ────────────────────────────────────────────────
// The whole-scene img2img pass (even with ControlNet/depth conditioning) let
// the model invent geometry that isn't in the source grid and drift furniture
// off-cell — confirmed live: a phantom wall band appeared where the spec had
// none, and a staircase rendered at a slight rotation off the cell grid.
// ControlNet only clamps this probabilistically; it can't guarantee it.
//
// The fix is to stop asking the AI to lay out a scene at all. Every cell's
// look is fully determined by ONE character (see campaign.rs's MAP_LEGEND),
// so instead of stylizing the whole assembled map, stylize ONE swatch per
// DISTINCT legend code present on the map — a single floor tile, a single
// wall block, a single pillar, etc. — then WE composite the result by
// blitting each cell's stylized swatch at its exact grid position, exactly
// like the plain procedural renderer already does with `drawTile`. The AI
// never sees — and therefore can never move — anything relative to anything
// else; grid alignment and furniture position are guaranteed by construction,
// not by asking the model nicely. A repeated code (eight barrels, a long
// wall run) costs one AI call total, not one per instance, since the same
// stylized swatch is reused everywhere that code appears.
const TILE_SAMPLE_PX = 192; // resolution sent to the AI per swatch, independent of print cellPx

// Short descriptive phrase per legend code, for the stylize prompt — see
// campaign.rs's MAP_LEGEND for the canonical meaning of each character.
const TILE_LABELS: Record<string, string> = {
  '.': 'plain floor',
  '#': 'a stone wall block',
  '+': 'a wooden door',
  '~': 'water',
  o: 'a stone pillar',
  '^': 'rubble and difficult terrain',
  '=': 'a piece of furniture or an altar',
  T: 'a tree or foliage',
  _: 'stone stairs',
  '*': 'a fire hazard or brazier',
};

function tileLabelFor(code: string): string {
  return TILE_LABELS[code] ?? 'plain floor';
}

// A background/material code repeats into many cells across a map — often
// most of it. Any discrete object a stylize pass invents inside one of these
// swatches (confirmed live: a wood beam painted into a floor tile) gets
// stamped everywhere that code appears, reading as "furniture on every
// tile." An object code is MEANT to depict one discrete thing (a door, a
// pillar), so that risk doesn't apply the same way — repeating a stylized
// barrel at every 'o' cell is the intended result, not a bug.
const BACKGROUND_CODES = new Set(['.', '~', '^', '_', '#']);

function isBackgroundTile(code: string): boolean {
  return BACKGROUND_CODES.has(code);
}

/** Every distinct non-void legend code present in `win` (defaults to the
 *  whole map) — the set of AI calls a stylize pass needs to make. */
function collectDistinctCodes(map: ParsedBattleMap, win?: RenderWindow): Set<string> {
  const w = win ?? { colStart: 0, colEnd: map.cols, rowStart: 0, rowEnd: map.rows };
  const codes = new Set<string>();
  for (let r = w.rowStart; r < w.rowEnd; r++) {
    for (let c = w.colStart; c < w.colEnd; c++) {
      const code = map.grid[r]?.[c] ?? ' ';
      if (code !== ' ') codes.add(code);
    }
  }
  return codes;
}

/** One cell of `code`'s art, rendered at a fixed AI-friendly resolution
 *  (independent of the print `cellPx`) so swatches can be cached and reused
 *  across preview/PDF/multi-page exports regardless of their render scale. */
function renderTileSwatch(code: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = TILE_SAMPLE_PX;
  canvas.height = TILE_SAMPLE_PX;
  const ctx = canvas.getContext('2d')!;
  drawTile(ctx, code, 0, 0, TILE_SAMPLE_PX);
  return canvas;
}

function renderTileDepthSwatch(code: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = TILE_SAMPLE_PX;
  canvas.height = TILE_SAMPLE_PX;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = isRaisedCell(code) ? DEPTH_RAISED : DEPTH_FLOOR;
  ctx.fillRect(0, 0, TILE_SAMPLE_PX, TILE_SAMPLE_PX);
  return canvas;
}

/** A stylize call for ONE tile swatch: the swatch itself, its depth map, a
 *  short label of what the tile depicts (e.g. "a stone pillar") so the
 *  provider's prompt can name the object instead of guessing from pixels,
 *  and whether this code is a background/material tile vs a discrete-object
 *  tile — see `isBackgroundTile`, and comfyui.rs's comfyui_stylize_map doc
 *  comment for why that distinction changes how the provider prompts it. */
export type TileStylizeFn = (
  tileDataUrl: string, depthMapDataUrl: string, tileLabel: string, isBackground: boolean
) => Promise<string>;

/** Runs `stylize` once per distinct code in `codes` (sequentially — this is
 *  one local GPU running one job at a time regardless of how many requests
 *  arrive concurrently, so there's no throughput to gain from firing them in
 *  parallel, and sequential keeps "which tile is running" legible to the
 *  caller). A code whose stylize call fails falls back to its plain
 *  procedural swatch rather than aborting the whole set — matches the
 *  existing per-card fallback behavior of the automatic checkbox path. */
async function stylizeTileSet(codes: Set<string>, stylize: TileStylizeFn): Promise<Map<string, HTMLImageElement>> {
  const tiles = new Map<string, HTMLImageElement>();
  for (const code of codes) {
    const swatch = renderTileSwatch(code);
    const depth = renderTileDepthSwatch(code);
    try {
      const stylizedDataUrl = await stylize(
        swatch.toDataURL('image/png'), depth.toDataURL('image/png'), tileLabelFor(code), isBackgroundTile(code)
      );
      tiles.set(code, await loadImage(stylizedDataUrl));
    } catch (e) {
      console.warn(`Stylizing the "${code}" tile failed, using its plain render instead:`, e);
      tiles.set(code, await loadImage(swatch.toDataURL('image/png')));
    }
  }
  return tiles;
}

/** Composites a stylized map from pre-stylized per-code tile swatches — the
 *  AI-facing counterpart to `renderBattleMapContent`. Each cell blits its
 *  code's swatch at its exact grid position, so alignment and furniture
 *  position are guaranteed regardless of anything the AI pass did to a
 *  swatch's own pixels (see the "Per-tile-type stylization" comment above).
 *  A soft contact shadow grounds raised objects against the floor, and a
 *  final vignette unifies tone across swatches that were stylized in
 *  separate, independently-seeded AI calls. */
function renderStylizedContentFromTiles(
  map: ParsedBattleMap, cellPx: number, win: RenderWindow | undefined, tiles: Map<string, HTMLImageElement>
): HTMLCanvasElement {
  const w = win ?? { colStart: 0, colEnd: map.cols, rowStart: 0, rowEnd: map.rows };
  const wCols = w.colEnd - w.colStart;
  const wRows = w.rowEnd - w.rowStart;
  const canvas = document.createElement('canvas');
  canvas.width = wCols * cellPx;
  canvas.height = wRows * cellPx;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = COLORS.void;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let r = 0; r < wRows; r++) {
    for (let c = 0; c < wCols; c++) {
      const code = map.grid[w.rowStart + r]?.[w.colStart + c] ?? ' ';
      if (code === ' ') continue;
      const x = c * cellPx, y = r * cellPx;
      if (isRaisedCell(code)) {
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.filter = `blur(${Math.max(1, cellPx * 0.06)}px)`;
        ctx.beginPath();
        ctx.ellipse(x + cellPx * 0.5, y + cellPx * 0.72, cellPx * 0.36, cellPx * 0.16, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      const tile = tiles.get(code);
      if (tile) ctx.drawImage(tile, x, y, cellPx, cellPx);
      else drawTile(ctx, code, x, y, cellPx);
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

  // Independently-seeded swatches can drift slightly in overall hue/exposure
  // from each other; a single flat color-grade pass over the whole composite
  // pulls them back toward one consistent tone so it reads as one scene
  // rather than a patchwork of stickers.
  const grade = ctx.createRadialGradient(
    canvas.width / 2, canvas.height / 2, 0,
    canvas.width / 2, canvas.height / 2, Math.max(canvas.width, canvas.height) * 0.7
  );
  grade.addColorStop(0, 'rgba(20,16,10,0)');
  grade.addColorStop(1, 'rgba(20,16,10,0.22)');
  ctx.fillStyle = grade;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  return canvas;
}

/** Draws the coordinate ruler (A../1..) around a content layer and returns
 *  the composed full-size canvas — same output shape `renderBattleMapToCanvas`
 *  always produced. `content` is drawn into the content rect via `drawImage`
 *  (so it's rescaled to fit if an AI pass returned a different resolution)
 *  and the ruler is always painted fresh afterward, from the map data, never
 *  from pixels that passed through a stylize call. This split exists because
 *  img2img diffusion models cannot reliably preserve small baked-in text or
 *  thin straight lines through their VAE encode/decode round trip — testing
 *  against a live ComfyUI/Flux install showed the ruler coming back as
 *  scrambled digits and, worse, hallucinated extra walls where the model
 *  "reinterpreted" grid lines it couldn't faithfully reproduce. Composing the
 *  ruler afterward, in code, guarantees it's always pixel-exact regardless of
 *  which provider (or model) ran the stylize pass, or whether one ran at all. */
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
 *  `win` defaults to the whole map. `cellPx` sets resolution. Plain/no-AI
 *  render path — see `battleMapToStylizedPngDataUrl` for the AI-pass path. */
export function renderBattleMapToCanvas(map: ParsedBattleMap, cellPx = 64, win?: RenderWindow): HTMLCanvasElement {
  return composeRulerFrame(map, cellPx, win, renderBattleMapContent(map, cellPx, win));
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load the stylized image data.'));
    img.src = dataUrl;
  });
}

/** Same result as `battleMapToPngDataUrl`, but runs `stylize` once per
 *  distinct tile type (no ruler, no whole-scene layout — see the "Per-tile-
 *  type stylization" comment above) before compositing the ruler back on
 *  top — see `composeRulerFrame`'s doc comment. Pass no `stylize` for a
 *  plain render. */
export async function battleMapToStylizedPngDataUrl(
  spec: string, cellPx: number, stylize?: TileStylizeFn
): Promise<string | null> {
  const map = parseBattleMap(spec);
  if (!map) return null;
  let source: CanvasImageSource;
  if (stylize) {
    const tiles = await stylizeTileSet(collectDistinctCodes(map), stylize);
    source = renderStylizedContentFromTiles(map, cellPx, undefined, tiles);
  } else {
    source = renderBattleMapContent(map, cellPx);
  }
  return composeRulerFrame(map, cellPx, undefined, source).toDataURL('image/png');
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
 *  coordinate ruler repeated on each) to tape together.
 *
 *  `stylize`, if given, is run once per DISTINCT tile type across the WHOLE
 *  map (not per page — see the "Per-tile-type stylization" comment above),
 *  so a multi-page export costs the same handful of AI calls as a one-page
 *  one, and every page reuses the identical stylized swatches — seams
 *  between pages line up exactly because they're literally the same tile
 *  image repeated, not independently re-generated per page. */
export async function battleMapToPdfBytes(
  spec: string,
  stylize?: TileStylizeFn
): Promise<Uint8Array | null> {
  const map = parseBattleMap(spec);
  if (!map) return null;

  const usableSquaresX = Math.floor((PAGE_W - 2 * MARGIN) / PT_PER_SQUARE);
  const usableSquaresY = Math.floor((PAGE_H - 2 * MARGIN) / PT_PER_SQUARE);
  const pdf = await PDFDocument.create();
  const tiles = stylize ? await stylizeTileSet(collectDistinctCodes(map), stylize) : null;

  for (let ry = 0; ry < map.rows; ry += usableSquaresY) {
    for (let rx = 0; rx < map.cols; rx += usableSquaresX) {
      const win: RenderWindow = {
        colStart: rx, colEnd: Math.min(map.cols, rx + usableSquaresX),
        rowStart: ry, rowEnd: Math.min(map.rows, ry + usableSquaresY),
      };
      const source: CanvasImageSource = tiles
        ? renderStylizedContentFromTiles(map, RENDER_PX, win, tiles)
        : renderBattleMapContent(map, RENDER_PX, win);
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
