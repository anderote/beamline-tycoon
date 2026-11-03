import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assetRevision } from '../scripts/versioned-assets.mjs';
import { assetUrl } from '../src/assets/url.js';
const root = mkdtempSync(path.join(tmpdir(), 'beamline-assets-'));
try {
  writeFileSync(path.join(root, 'a.png'), 'one');
  const first = assetRevision(root);
  assert.equal(assetRevision(root), first);
  writeFileSync(path.join(root, 'a.png'), 'two');
  assert.notEqual(assetRevision(root), first);
  assert.equal(assetUrl('assets/textures/a.png', first), `versioned-assets/${first}/textures/a.png`);
  assert.equal(assetUrl('assets/a.png', ''), 'assets/a.png');
  assert.equal(assetUrl('https://example.com/a.png', first), 'https://example.com/a.png');
  assert.equal(assetUrl('data:image/png;base64,abc', first), 'data:image/png;base64,abc');
} finally { rmSync(root, { recursive: true }); }
console.log('Asset revision and URL contracts pass');
const { SpriteManager } = await import('../src/renderer/sprites.js');
const sprites = new SpriteManager();
sprites.spriteOffsets['assets/components/source.png'] = { x: 3, y: 4, scale: 2 };
assert.deepEqual(sprites.getSpriteOffset('versioned-assets/123/components/source.png'), { x: 3, y: 4, scale: 2 });
