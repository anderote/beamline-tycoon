const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3333;
const API_KEY = 'a532cdf9-c187-4970-8cec-3a58fda7b15a';
const API_BASE = 'https://api.pixellab.ai';
const PROJECT = path.join(__dirname, '../..');
const COMPONENTS_DIR = path.join(PROJECT, 'assets/components');
const TILES_DIR = path.join(PROJECT, 'assets/tiles');
const DECORATIONS_DIR = path.join(PROJECT, 'assets/decorations');

for (const d of [COMPONENTS_DIR, TILES_DIR, DECORATIONS_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

// ── API helpers ──

async function pixelabPost(endpoint, body) {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
}

async function downloadImage(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// ── Catalog: reads game source files to build the full asset catalog ──

function buildCatalog() {
  const catalog = { components: {}, furniture: {}, tiles: {}, walls: [], decorations: {} };

  // Read components.js — extract spriteKeys and descriptions
  try {
    const src = fs.readFileSync(path.join(PROJECT, 'src/data/components.js'), 'utf-8');
    const idRe = /^\s*(\w+):\s*\{/gm;
    const keyRe = /spriteKey:\s*'([^']+)'/;
    const nameRe = /name:\s*'([^']+)'/;
    const descRe = /desc:\s*'([^']+)'/;
    const catRe = /category:\s*'([^']+)'/;
    const colorRe = /spriteColor:\s*(0x[0-9a-fA-F]+)/;

    // Split by top-level keys
    const blocks = src.split(/\n  (\w+):\s*\{/);
    for (let i = 1; i < blocks.length; i += 2) {
      const id = blocks[i];
      const block = blocks[i + 1] || '';
      const spriteKey = (block.match(keyRe) || [])[1] || id;
      const name = (block.match(nameRe) || [])[1] || id;
      const category = (block.match(catRe) || [])[1] || 'other';
      const color = (block.match(colorRe) || [])[1] || '0x888888';

      if (!catalog.components[spriteKey]) {
        catalog.components[spriteKey] = { spriteKey, name, category, color, ids: [id] };
      } else {
        catalog.components[spriteKey].ids.push(id);
      }
    }
  } catch (e) {
    console.warn('Could not parse components.js:', e.message);
  }

  // Read infrastructure.js — extract furnishings
  try {
    const src = fs.readFileSync(path.join(PROJECT, 'src/data/infrastructure.js'), 'utf-8');

    // Extract ZONE_FURNISHINGS
    const furnStart = src.indexOf('ZONE_FURNISHINGS');
    if (furnStart > -1) {
      const furnBlock = src.slice(furnStart, src.indexOf('};', furnStart) + 2);
      const itemRe = /(\w+):\s*\{[^}]*name:\s*'([^']+)'[^}]*zoneType:\s*'([^']+)'/g;
      let m;
      while ((m = itemRe.exec(furnBlock)) !== null) {
        catalog.furniture[m[1]] = { id: m[1], name: m[2], zoneType: m[3] };
      }
    }
  } catch (e) {
    console.warn('Could not parse infrastructure.js:', e.message);
  }

  return catalog;
}

// ── Routes ──

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  try {
    // Serve dashboard
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
      return;
    }

    // Serve asset images
    if (url.pathname.startsWith('/assets/')) {
      const filePath = path.join(PROJECT, url.pathname);
      if (fs.existsSync(filePath)) {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(fs.readFileSync(filePath));
        return;
      }
      res.writeHead(404); res.end('Not found'); return;
    }

    // ── Catalog ──
    if (url.pathname === '/api/catalog' && req.method === 'GET') {
      const catalog = buildCatalog();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(catalog));
      return;
    }

    // ── List all saved assets across all directories ──
    if (url.pathname === '/api/assets' && req.method === 'GET') {
      const assets = {};

      // Components
      for (const file of fs.readdirSync(COMPONENTS_DIR)) {
        if (!file.endsWith('.png')) continue;
        const match = file.match(/^(.+?)(?:_(NESW|NWSE))?_(\d+)\.png$/);
        if (match) {
          const [, key, dir, idx] = match;
          if (!assets[key]) assets[key] = [];
          assets[key].push({ file, dir: dir || null, index: parseInt(idx), path: `/assets/components/${file}`, assetDir: 'components' });
        }
      }

      // Tiles
      for (const file of fs.readdirSync(TILES_DIR)) {
        if (!file.endsWith('.png')) continue;
        const match = file.match(/^(.+?)_(\d+)\.png$/);
        if (match) {
          const [, key, idx] = match;
          if (!assets[key]) assets[key] = [];
          assets[key].push({ file, index: parseInt(idx), path: `/assets/tiles/${file}`, assetDir: 'tiles' });
        }
      }

      // Decorations
      for (const file of fs.readdirSync(DECORATIONS_DIR)) {
        if (!file.endsWith('.png') || file === 'decoration-manifest.json') continue;
        const key = file.replace('.png', '');
        if (!assets[key]) assets[key] = [];
        assets[key].push({ file, path: `/assets/decorations/${file}`, assetDir: 'decorations' });
      }

      for (const key of Object.keys(assets)) {
        assets[key].sort((a, b) => (a.index || 0) - (b.index || 0));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(assets));
      return;
    }

    // ── Delete asset ──
    if (url.pathname === '/api/assets' && req.method === 'DELETE') {
      const body = await readBody(req);
      const { file, assetDir } = JSON.parse(body);
      const dir = assetDir === 'tiles' ? TILES_DIR : assetDir === 'decorations' ? DECORATIONS_DIR : COMPONENTS_DIR;
      const filePath = path.join(dir, file);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      res.writeHead(404); res.end('Not found'); return;
    }

    // ── Save asset to correct directory ──
    // For objects: saves with direction suffix. If autoFlip=true, also saves horizontal mirror.
    if (url.pathname === '/api/save' && req.method === 'POST') {
      const body = await readBody(req);
      const { spriteKey, downloadUrl, direction, assetType, autoFlip } = JSON.parse(body);

      const imgBuf = await downloadImage(downloadUrl);
      const saved = [];

      if (assetType === 'tile') {
        const existing = fs.readdirSync(TILES_DIR).filter(f => f.startsWith(spriteKey + '_') && f.endsWith('.png'));
        const filename = `${spriteKey}_${existing.length}.png`;
        fs.writeFileSync(path.join(TILES_DIR, filename), imgBuf);
        saved.push(filename);
      } else {
        // Determine direction suffix
        const dirSuffix = direction === 'nw-se' ? 'NWSE' : 'NESW';
        const prefix = `${spriteKey}_${dirSuffix}_`;
        const existing = fs.readdirSync(COMPONENTS_DIR).filter(f => f.startsWith(prefix) && f.endsWith('.png'));
        const filename = `${prefix}${existing.length}.png`;
        fs.writeFileSync(path.join(COMPONENTS_DIR, filename), imgBuf);
        saved.push(filename);
        console.log(`[save] ${filename}`);

        // Auto-flip for symmetric components
        if (autoFlip) {
          try {
            const { execSync } = require('child_process');
            const flipDir = dirSuffix === 'NESW' ? 'NWSE' : 'NESW';
            const flipPrefix = `${spriteKey}_${flipDir}_`;
            const flipExisting = fs.readdirSync(COMPONENTS_DIR).filter(f => f.startsWith(flipPrefix) && f.endsWith('.png'));
            const flipFile = `${flipPrefix}${flipExisting.length}.png`;
            const srcPath = path.join(COMPONENTS_DIR, filename);
            const dstPath = path.join(COMPONENTS_DIR, flipFile);

            execSync(`python3 -c "from PIL import Image; Image.open('${srcPath}').transpose(Image.FLIP_LEFT_RIGHT).save('${dstPath}')"`);
            saved.push(flipFile);
            console.log(`[save] + auto-flipped ${flipFile}`);
          } catch (e) {
            console.warn('[save] Could not auto-flip:', e.message);
          }
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, files: saved }));
      return;
    }

    // ── Generate ──
    if (url.pathname === '/api/generate' && req.method === 'POST') {
      const body = await readBody(req);
      const { component, description, count, refImage, assetType, direction } = JSON.parse(body);

      // Load reference image
      let bgImage = null;
      if (refImage) {
        // Search all asset dirs for the ref file
        for (const dir of [COMPONENTS_DIR, TILES_DIR, DECORATIONS_DIR]) {
          const p = path.join(dir, refImage);
          if (fs.existsSync(p)) { bgImage = fs.readFileSync(p).toString('base64'); break; }
        }
      }

      const n = count || 5;
      const jobs = [];

      if (assetType === 'tile') {
        // Flat 2D isometric tiles
        for (let i = 0; i < n; i++) {
          const payload = {
            description: `${description}, seamless texture, pixel art`,
            size: 64,
            tile_shape: 'thin tile',
            outline: 'lineless',
            shading: 'medium shading',
            detail: 'medium detail',
            text_guidance_scale: 8
          };
          const result = await pixelabPost('/v2/generate-isometric-tile', payload);
          jobs.push({
            objectId: result.tile_id || result.id || result.object_id,
            status: 'queued',
            direction: 'flat',
            variationIdx: i,
            isTile: true
          });
        }
      } else {
        // Map objects — generate specified orientation
        const dir = direction || 'ne-sw';
        const dirDesc = dir === 'nw-se'
          ? ', facing from top-left to bottom-right'
          : ', facing from top-right to bottom-left';
        for (let i = 0; i < n; i++) {
          const payload = {
            description: `isometric pixel art ${description}${dirDesc}, seen from above at 45 degrees`,
            image_size: { width: 64, height: 48 },
            view: 'high top-down',
            outline: 'selective outline',
            shading: 'medium shading',
            detail: 'medium detail'
          };
          if (bgImage) {
            payload.background_image = { base64: bgImage };
            payload.inpainting = { type: 'rectangle', fraction: 0.8 };
          }

          console.log(`[gen] ${component} #${i}: "${payload.description.slice(0,80)}..." ref=${!!bgImage}`);
          const result = await pixelabPost('/v2/map-objects', payload);
          console.log(`[gen] -> ${result.object_id || 'ERROR'} ${result.status || JSON.stringify(result)}`);
          jobs.push({
            objectId: result.object_id,
            status: 'queued',
            direction: dir,
            variationIdx: i
          });
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jobs }));
      return;
    }

    // ── Status check ──
    if (url.pathname === '/api/status' && req.method === 'POST') {
      const body = await readBody(req);
      const { objectIds } = JSON.parse(body);

      // Check status by hitting download URL — 200=ready, 423=processing
      // Don't download the body, just check the status code
      const results = await Promise.all(objectIds.map(async (idObj) => {
        const id = typeof idObj === 'string' ? idObj : idObj.id;
        const isTile = typeof idObj === 'object' && idObj.isTile;

        const dlUrl = isTile
          ? `${API_BASE}/mcp/isometric-tiles/${id}/download`
          : `${API_BASE}/mcp/map-objects/${id}/download`;
        try {
          const resp = await fetch(dlUrl, { redirect: 'manual' });
          const status = resp.status;
          // Consume and discard body to avoid memory leaks
          resp.body?.cancel?.();
          if (status === 200 || status === 302) {
            return { objectId: id, status: 'completed', downloadUrl: dlUrl };
          } else if (status === 423) {
            return { objectId: id, status: 'processing' };
          } else {
            return { objectId: id, status: 'failed', error: `HTTP ${status}` };
          }
        } catch (e) {
          return { objectId: id, status: 'error', error: e.message };
        }
      }));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ results }));
      return;
    }

    // ── Proxy image download ──
    if (url.pathname === '/api/proxy-image' && req.method === 'GET') {
      const imgUrl = url.searchParams.get('url');
      if (!imgUrl) { res.writeHead(400); res.end('Missing url'); return; }
      const imgBuf = await downloadImage(imgUrl);
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=3600' });
      res.end(imgBuf);
      return;
    }

    res.writeHead(404); res.end('Not found');
  } catch (e) {
    console.error('Error:', e);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const server = http.createServer(handleRequest);
server.listen(PORT, () => console.log(`Asset Generator running at http://localhost:${PORT}`));
