/**
 * Bundle a TS module from src/ into a temp .mjs so audit probes can `import()` the REAL data
 * instead of parsing it. Every parsing sweep in this audit has hit a parser bug; none of the
 * runtime ones have. Usage: node tools/audit/bundle.mjs <entry.ts> <out.mjs>
 */
import { rolldown } from 'rolldown';

import fs from 'node:fs';

const [entry, out] = process.argv.slice(2);
const bundle = await rolldown({ input: entry, platform: 'node' });
await bundle.write({ file: out, format: 'esm' });
await bundle.close();

// Vite injects `import.meta.env`; node leaves it undefined, so a module with a dev-only guard
// (`if (import.meta.env.DEV) window.__x = …`) throws at IMPORT time — nowhere near the code under
// test. Substituted after the write rather than via a bundler `define`, which is not a top-level
// rolldown input option and would silently no-op if it moved again.
fs.writeFileSync(out, fs.readFileSync(out, 'utf8').replaceAll('import.meta.env', '({ DEV: false, PROD: true })'));
