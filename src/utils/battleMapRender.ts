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

/** Renders a (sub-)grid to a fresh canvas, with a coordinate ruler (A.. / 1..)
 *  down the left and across the top so cells are referenceable on the print.
 *  `win` defaults to the whole map. `cellPx` sets resolution. */
export function renderBattleMapToCanvas(map: ParsedBattleMap, cellPx = 64, win?: RenderWindow): HTMLCanvasElement {
  const w = win ?? { colStart: 0, colEnd: map.cols, rowStart: 0, rowEnd: map.rows };
  const wCols = w.colEnd - w.colStart;
  const wRows = w.rowEnd - w.rowStart;
  const ruler = Math.round(cellPx * 0.5);
  const canvas = document.createElement('canvas');
  canvas.width = ruler + wCols * cellPx;
  canvas.height = ruler + wRows * cellPx;
  const ctx = canvas.getContext('2d')!;

  // Background (also fills the ruler gutter).
  ctx.fillStyle = COLORS.void;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Tiles.
  for (let r = 0; r < wRows; r++) {
    for (let c = 0; c < wCols; c++) {
      const code = map.grid[w.rowStart + r]?.[w.colStart + c] ?? ' ';
      drawTile(ctx, code, ruler + c * cellPx, ruler + r * cellPx, cellPx);
    }
  }

  // Grid lines over non-void cells.
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  for (let r = 0; r < wRows; r++) {
    for (let c = 0; c < wCols; c++) {
      const code = map.grid[w.rowStart + r]?.[w.colStart + c] ?? ' ';
      if (code === ' ') continue;
      ctx.strokeRect(ruler + c * cellPx, ruler + r * cellPx, cellPx, cellPx);
    }
  }

  // Coordinate ruler.
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
 *  `stylize`, if given, is run over each page's rendered PNG (as a data URL)
 *  before it's embedded — this is the Phase 2 ComfyUI atmosphere-pass hook
 *  (see DMConsolePage.tsx's stylizeMapImage). It must resolve to a data URL
 *  and must not throw; a caller that wants a plain-render fallback on
 *  failure handles that itself before passing the callback in, so this
 *  function stays decoupled from any particular AI backend. Multi-page maps
 *  run one stylize call per page — seams between pages are not blended,
 *  a known limitation of the per-tile pass. */
export async function battleMapToPdfBytes(
  spec: string,
  stylize?: (dataUrl: string) => Promise<string>
): Promise<Uint8Array | null> {
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
      const canvas = renderBattleMapToCanvas(map, RENDER_PX, win);
      let dataUrl = canvas.toDataURL('image/png');
      if (stylize) dataUrl = await stylize(dataUrl);
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
