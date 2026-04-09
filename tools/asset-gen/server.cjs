const http = require('http');
const fs = require('fs');
const path = require('path');

// Load .env
const envPath = path.join(__dirname, '../../.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^(\w+)=(.+)$/);
    if (m) process.env[m[1]] = m[2].trim();
  }
}

const PORT = 3333;
const API_KEY = process.env.PIXELLAB_API_KEY || '';
const XAI_KEY = process.env.XAI_API_KEY || '';
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
      const { component, description, count, refImage, assetType, direction, globalStyle } = JSON.parse(body);

      // Load reference image — prefer uploaded ref photo for this component, fall back to style ref
      let bgImage = null;
      const uploadedRefPath = path.join(COMPONENTS_DIR, 'references', `${component}.png`);
      if (fs.existsSync(uploadedRefPath)) {
        bgImage = fs.readFileSync(uploadedRefPath).toString('base64');
        console.log(`[gen] Using uploaded reference photo for ${component}`);
      } else if (refImage) {
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
            description: `${description}, seamless texture, pixel art, RollerCoaster Tycoon 2 style${globalStyle ? ', ' + globalStyle : ''}`,
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
            description: `isometric pixel art ${description}${dirDesc}, seen from above at 45 degrees, RollerCoaster Tycoon 2 style${globalStyle ? ', ' + globalStyle : ''}`,
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

    // ── Save uploaded reference image ──
    if (url.pathname === '/api/save-ref-image' && req.method === 'POST') {
      const body = await readBody(req);
      const { key, dataUrl } = JSON.parse(body);
      const refDir = path.join(COMPONENTS_DIR, 'references');
      if (!fs.existsSync(refDir)) fs.mkdirSync(refDir, { recursive: true });
      // Strip data URL prefix and save as PNG
      const b64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
      fs.writeFileSync(path.join(refDir, `${key}.png`), Buffer.from(b64, 'base64'));
      console.log(`[ref] Saved reference image for ${key}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // ── Delete uploaded reference image ──
    if (url.pathname === '/api/delete-ref-image' && req.method === 'POST') {
      const body = await readBody(req);
      const { key } = JSON.parse(body);
      const refPath = path.join(COMPONENTS_DIR, 'references', `${key}.png`);
      if (fs.existsSync(refPath)) fs.unlinkSync(refPath);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // ── Save sprite offsets ──
    if (url.pathname === '/api/save-offsets' && req.method === 'POST') {
      const body = await readBody(req);
      const offsets = JSON.parse(body);
      fs.writeFileSync(path.join(COMPONENTS_DIR, 'offsets.json'), JSON.stringify(offsets, null, 2));
      console.log(`[offsets] Saved ${Object.keys(offsets).length} offset entries`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // ── Load sprite offsets ──
    if (url.pathname === '/api/offsets' && req.method === 'GET') {
      const offsetsPath = path.join(COMPONENTS_DIR, 'offsets.json');
      const offsets = fs.existsSync(offsetsPath) ? JSON.parse(fs.readFileSync(offsetsPath, 'utf-8')) : {};
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(offsets));
      return;
    }

    // ── AI Improve global style ──
    if (url.pathname === '/api/improve-global-style' && req.method === 'POST') {
      const body = await readBody(req);
      const { currentStyle } = JSON.parse(body);

      const systemPrompt = `You are an expert at writing style prompts for PixelLab, a pixel art generation AI. The game is a particle accelerator tycoon in the style of RollerCoaster Tycoon 2.

Your job: improve a global style prompt that gets appended to every individual asset generation. This should define the overall visual language — color palette, shading approach, level of detail, artistic style.

Rules:
- Output ONLY the improved style text, nothing else. No quotes, no explanation.
- Keep it under 150 characters
- Focus on art style, not content (no specific objects or components)
- Think about: color palette, shading style, outline approach, level of detail, mood
- Should work for beamline components, lab furniture, floor tiles, and decorations alike
- RollerCoaster Tycoon 2 is the target aesthetic: clean isometric pixel art, readable at small sizes`;

      try {
        const grokRes = await fetch('https://api.x.ai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${XAI_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'grok-3-mini',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: currentStyle ? `Improve this global style prompt:\n\n"${currentStyle}"` : 'Write a global style prompt for RCT2-style particle accelerator game assets.' }
            ],
            max_tokens: 200,
            temperature: 0.7
          })
        });
        const data = await grokRes.json();
        const improved = data.choices?.[0]?.message?.content?.trim() || '';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ improved }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // ── AI Improve prompt ──
    if (url.pathname === '/api/improve-prompt' && req.method === 'POST') {
      const body = await readBody(req);
      const { spriteKey, currentPrompt, refImage, hasUploadedRef } = JSON.parse(body);

      // Check for uploaded reference photo
      let uploadedRefB64 = null;
      const refPhotoPath = path.join(COMPONENTS_DIR, 'references', `${spriteKey}.png`);
      if (hasUploadedRef && fs.existsSync(refPhotoPath)) {
        uploadedRefB64 = fs.readFileSync(refPhotoPath).toString('base64');
      }

      const refContext = refImage ? `\nThe pixel art style reference is "${refImage}" — the new prompt should produce something visually cohesive with that.` : '';

      const systemPrompt = `You are an expert at writing prompts for PixelLab, a pixel art generation AI that creates isometric game assets in the style of RollerCoaster Tycoon 2 (RCT2). The game is a particle accelerator tycoon — building beamlines, labs, and research facilities.

Your job: take a description of a component and improve it into an optimal PixelLab prompt that will generate a great RCT2-style isometric pixel art sprite.

Rules:
- Output ONLY the improved prompt text, nothing else. No quotes, no explanation.
- Keep it under 200 characters
- Focus on visual appearance: shape, color, material, key distinguishing features
- Always include "on support stand" or "on metal stand" for beamline components
- Use specific colors (blue, copper, silver, green) not vague ones
- Mention the beam pipe running through when relevant
- Don't include "pixel art", "isometric", or "RCT2" — those are added separately
- Think about what makes this component visually distinct at small pixel scale (48-64px)
- Real accelerator components should look like miniature versions of the real thing
${uploadedRefB64 ? '- A reference photo of the real component is attached — describe what you see in terms PixelLab can reproduce as pixel art' : ''}`;

      const messages = [];
      if (uploadedRefB64) {
        // Use vision model with the uploaded photo
        messages.push({
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/png;base64,${uploadedRefB64}` } },
            { type: 'text', text: `This is a real photo of a "${spriteKey}" component. Based on what you see, improve this PixelLab prompt to generate an accurate RCT2-style pixel art version:${refContext}\n\nCurrent prompt: "${currentPrompt}"` }
          ]
        });
      } else {
        messages.push({
          role: 'user',
          content: `Improve this PixelLab prompt for generating a "${spriteKey}" asset in RCT2 pixel art style:${refContext}\n\nCurrent prompt: "${currentPrompt}"`
        });
      }

      try {
        const grokRes = await fetch('https://api.x.ai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${XAI_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: uploadedRefB64 ? 'grok-4-fast-non-reasoning' : 'grok-3-mini',
            messages: [{ role: 'system', content: systemPrompt }, ...messages],
            max_tokens: 300,
            temperature: 0.7
          })
        });
        const grokData = await grokRes.json();
        const improved = grokData.choices?.[0]?.message?.content?.trim() || '';
        if (!improved) console.log('[ai] Raw response:', JSON.stringify(grokData).slice(0, 500));
        console.log(`[ai] ${spriteKey}: "${improved.slice(0, 80)}..."`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ improved }));
      } catch (e) {
        console.error('[ai] Grok error:', e);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
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
