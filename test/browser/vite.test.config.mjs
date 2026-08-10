// test/browser/vite.test.config.mjs — vite config for the browser test server.
//
// Same app as `npm run dev`, with one change: **HMR off**.
//
// With HMR on, any edit anywhere under the repo (a teammate or another agent
// working in the same checkout, or the specs themselves being edited between
// runs) makes vite push a `full-reload` to the page — which destroys the test's
// execution context mid-run and surfaces as the useless
// "Execution context was destroyed, most likely because of a navigation".
// The specs reload the page themselves where a reload is the thing under test;
// nothing else should be able to.
//
// Everything else — the /api proxy, the music-manifest middleware, publicDir —
// is inherited so the app under test is the app the developer runs.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import base from '../../vite.config.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const port = Number(process.env.BT_TEST_PORT || 8123);

export default {
  ...base,
  // `root`/`publicDir` in the base config are relative to *its* location, so
  // they have to be re-anchored now that the config lives two levels down.
  root: repoRoot,
  publicDir: path.join(repoRoot, 'public'),
  server: {
    ...base.server,
    port,
    strictPort: true,
    hmr: false,
  },
};
