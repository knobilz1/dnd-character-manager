import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';
import path from 'node:path';

/**
 * In production Tauri builds, model GLBs/textures are bundled as side-loaded
 * resources (bundle.resources in tauri.conf.json) rather than embedded in the
 * Rust binary via generate_context!(). Embedding ~1.5 GB of GLBs causes the
 * LLVM archive size limit to be exceeded.
 *
 * This plugin removes dist/models/ after the Vite build so that
 * generate_context!() never sees the model files.
 */
function excludeModelsPlugin(): Plugin {
  return {
    name: 'tauri-exclude-models',
    apply: 'build',
    enforce: 'post',
    closeBundle() {
      const dir = path.resolve('dist', 'models');
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
        console.log('[tauri-exclude-models] Removed dist/models/ — bundled as Tauri resources instead.');
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
