import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';
import path from 'node:path';

/**
 * In production Tauri builds, model GLBs/textures and the bundled Piper TTS
 * binary + voice model are bundled as side-loaded resources (bundle.resources
 * in tauri.conf.json) rather than embedded in the Rust binary via
 * generate_context!(). Embedding these (models: ~1.5 GB; Piper: ~100MB)
 * causes the LLVM archive size limit to be exceeded.
 *
 * This plugin removes dist/models/ and dist/tts/ after the Vite build so that
 * generate_context!() never sees those files.
 */
function excludeModelsPlugin(): Plugin {
  return {
    name: 'tauri-exclude-models',
    apply: 'build',
    enforce: 'post',
    closeBundle() {
      for (const sub of ['models', 'tts']) {
        const dir = path.resolve('dist', sub);
        if (fs.existsSync(dir)) {
          fs.rmSync(dir, { recursive: true, force: true });
          console.log(`[tauri-exclude-models] Removed dist/${sub}/ — bundled as Tauri resources instead.`);
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [tailwindcss(), react(), excludeModelsPlugin()],
  server: {
    watch: {
      // Rust writes/locks files in target/ while linking; Vite's watcher
      // picking them up crashes with EBUSY on Windows mid-build.
      ignored: ['**/src-tauri/target/**'],
    },
  },
});
