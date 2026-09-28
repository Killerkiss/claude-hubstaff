import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

// The plugin is installed by cloning this repo, so it ships a single self-contained bundle:
// users need Node, but no `npm install`.
const plugin = JSON.parse(readFileSync('plugins/hubstaff/.claude-plugin/plugin.json', 'utf8'));

await build({
  entryPoints: ['plugins/hubstaff/src/index.ts'],
  outfile: 'plugins/hubstaff/dist/server.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  minify: true,
  legalComments: 'none',
  define: { __VERSION__: JSON.stringify(plugin.version) },
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});
