/**
 * Bundle a TS module from src/ into a temp .mjs so audit probes can `import()` the REAL data
 * instead of parsing it. Every parsing sweep in this audit has hit a parser bug; none of the
 * runtime ones have. Usage: node tools/audit/bundle.mjs <entry.ts> <out.mjs>
 */
import { rolldown } from 'rolldown';

const [entry, out] = process.argv.slice(2);
const bundle = await rolldown({ input: entry, platform: 'node' });
await bundle.write({ file: out, format: 'esm' });
await bundle.close();
