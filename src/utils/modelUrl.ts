/**
 * modelUrl — resolve 3D model asset filenames to a loadable URL.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Tauri v2 embeds everything in `dist/` into the Rust binary via
 * `generate_context!()` (include_bytes! under the hood). With many large GLB
 * files the binary exceeds the LLVM archive size limit and the build fails.
 *
 * The fix: a Vite plugin removes `dist/models/` after the frontend build so
 * the models are never embedded. Instead they are declared in
 * `bundle.resources` and the OS installer copies them alongside the app bundle.
 * At runtime we use Tauri's `convertFileSrc(resourceDir + "/models/" + name)`
 * to produce a valid `asset://` URL.
 *
 * In dev (`tauri dev` or plain `vite dev`) the Vite dev-server still serves
 * the files from `public/models/` as `/models/<filename>`, so no async init is
 * needed and the component renders immediately.
 *
 * USAGE
 * ─────
 *   import { modelUrl, initModelUrls, NEEDS_TAURI_MODEL_INIT } from '../../utils/modelUrl';
 *
 *   // In parent component that owns the Canvas:
 *   const [urlsReady, setUrlsReady] = useState(!NEEDS_TAURI_MODEL_INIT);
 *   useEffect(() => {
 *     if (!NEEDS_TAURI_MODEL_INIT) return;
 *     initModelUrls().then(() => setUrlsReady(true));
 *   }, []);
 *
 *   // Then once urlsReady, pass modelUrl('Human_Male_Idle.glb') to useLoader.
 */

/** True only in production Tauri builds — needs async init before modelUrl() works. */
export const NEEDS_TAURI_MODEL_INIT: boolean =
  typeof window !== 'undefined' &&
  '__TAURI_INTERNALS__' in window &&
  !import.meta.env.DEV;

// Internal state
let _modelsDir  = '';   // absolute filesystem path, e.g. /Applications/Tavern.app/.../models
let _convertFileSrc: ((filePath: string, protocol?: string) => string) | null = null;
let _initPromise: Promise<void> | null = NEEDS_TAURI_MODEL_INIT ? null : Promise.resolve();

/** Async init — resolves the resource dir and imports convertFileSrc.
 *  Safe to call multiple times; cached after the first call. */
export function initModelUrls(): Promise<void> {
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    const [{ join, resourceDir }, { convertFileSrc }] = await Promise.all([
      import('@tauri-apps/api/path'),
      import('@tauri-apps/api/core'),
    ]);
    _modelsDir       = await join(await resourceDir(), 'models');
    _convertFileSrc  = convertFileSrc;
  })();

  return _initPromise;
}

/** Convert a model filename (e.g. `'Human_Male_Idle.glb'` or `'armor/helmet.glb'`)
 *  to a URL that can be passed to GLTFLoader / TextureLoader.
 *
 *  Synchronous — call only after initModelUrls() has resolved (or when
 *  NEEDS_TAURI_MODEL_INIT is false). */
export function modelUrl(filename: string): string {
  if (!_convertFileSrc || !_modelsDir) {
    // Dev or pre-init fallback: served by Vite dev server from public/models/
    return `/models/${filename}`;
  }
  // Produce the absolute filesystem path, then let convertFileSrc encode it.
  // Note: _modelsDir uses the OS path separator; filenames may contain '/'
  // (e.g. 'armor/helmet.glb') which we normalise to the OS separator.
  const sep      = _modelsDir.includes('\\') ? '\\' : '/';
  const filePart = filename.replace(/\//g, sep);
  return _convertFileSrc(`${_modelsDir}${sep}${filePart}`);
}
