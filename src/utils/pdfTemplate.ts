import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import type { Character } from '../types';
import { fillCharacterPDF } from './fillCharacterPDF';
import { generateCharacterPDF } from './generateCharacterPDF';

const TEMPLATE_PATH_KEY = 'tavern_pdf_template_path';

// ── Template path management ──────────────────────────────────────────────────

export function getCustomTemplatePath(): string | null {
  return localStorage.getItem(TEMPLATE_PATH_KEY);
}

export function clearCustomTemplatePath(): void {
  localStorage.removeItem(TEMPLATE_PATH_KEY);
}

/**
 * Opens the file picker and stores the chosen path for future prints.
 * Returns true if a path was picked and stored, false if the user cancelled.
 */
export async function pickAndStoreTemplatePath(): Promise<boolean> {
  const picked = await openDialog({
    title: 'Select your D&D 5E fillable PDF template',
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
    multiple: false,
    directory: false,
  });
  if (!picked || typeof picked !== 'string') return false;
  localStorage.setItem(TEMPLATE_PATH_KEY, picked);
  return true;
}

// ── Print logic ───────────────────────────────────────────────────────────────

/**
 * Generates a PDF for the given character.
 * - If a custom template path is stored: fills it (WotC form fill).
 * - Otherwise: uses the built-in pdf-lib generator — works immediately, no setup.
 * If the stored template file is missing, clears the path and falls back to built-in.
 */
export async function printCharacterToPDF(character: Character): Promise<Uint8Array> {
  const storedPath = getCustomTemplatePath();
  if (storedPath) {
    try {
      const templateBytes = await readFile(storedPath);
      return await fillCharacterPDF(character, templateBytes);
    } catch {
      // File moved or deleted — clear stored path and fall back to built-in
      clearCustomTemplatePath();
    }
  }
  return generateCharacterPDF(character);
}
