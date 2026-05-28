import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';

const TEMPLATE_PATH_KEY = 'tavern_pdf_template_path';

/**
 * Returns the WotC 5E character sheet template as bytes.
 *
 * On the first call ever (or after the file has moved/been deleted):
 *   shows a one-time file picker and stores the chosen path.
 * On every subsequent call:
 *   reads the stored path silently — no dialog shown.
 *
 * Returns null only if the user actively cancels the picker.
 */
export async function getTemplateBytes(): Promise<Uint8Array | null> {
  const stored = localStorage.getItem(TEMPLATE_PATH_KEY);

  if (stored) {
    try {
      return await readFile(stored);
    } catch {
      // File moved or deleted — clear it and fall through to the picker
      localStorage.removeItem(TEMPLATE_PATH_KEY);
    }
  }

  const picked = await openDialog({
    title: 'Select your D&D 5E fillable PDF template (one-time setup)',
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
    multiple: false,
    directory: false,
  });

  if (!picked || typeof picked !== 'string') return null;

  localStorage.setItem(TEMPLATE_PATH_KEY, picked);
  return await readFile(picked);
}

/** Clears the stored template path (e.g. from a settings reset). */
export function clearTemplatePath(): void {
  localStorage.removeItem(TEMPLATE_PATH_KEY);
}
