// src/three-global.js — promotes the npm `three` package to a global.
//
// 31 source files under src/ reference a bare `THREE.` global (they were
// written against the old CDN <script> tag and are NOT being converted to
// ESM imports as part of this change). This file is what keeps them working
// now that three is installed as a real npm dependency instead of being
// loaded from jsdelivr: it populates globalThis.THREE from the npm package
// so every one of those files keeps resolving THREE exactly as before.
//
// The `??=` is load-bearing: it guarantees this file can never clobber a
// pre-installed globalThis.THREE stub. Six node tests inject their own
// lightweight THREE stub onto globalThis before pulling in renderer code
// that expects THREE to exist, and this must never override those stubs:
//   test/test-staff-builder.js:131
//   test/test-wildflower-builder.js:210
//   test/test-utility-line-fault-mark.js:41
//   test/test-convergence-regressions-2.js:448
//   test/uv-utils.test.js:8
//
// Addon import path check (three@0.160.0): the package's exports map has
// "./addons/*": "./examples/jsm/*", so `three/addons/postprocessing/*.js`
// resolves correctly — that's the path later tasks should use, not the
// `three/examples/jsm/postprocessing/*.js` long form (though both work).
import * as THREE from 'three';
globalThis.THREE ??= THREE;
