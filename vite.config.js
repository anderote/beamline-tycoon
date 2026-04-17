import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';

const AUDIO_EXT = /\.(mp3|ogg|wav|m4a|flac|aac)$/i;

function scanThemes(musicDir) {
  const themes = {};
  if (!fs.existsSync(musicDir)) return themes;
  for (const entry of fs.readdirSync(musicDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const themeDir = path.join(musicDir, entry.name);
    themes[entry.name] = fs.readdirSync(themeDir)
      .filter(f => AUDIO_EXT.test(f))
      .sort();
  }
  return themes;
}

function musicManifestPlugin() {
  const musicDir = path.resolve('public/music');
  return {
    name: 'music-manifest',
    configureServer(server) {
      // Serve a live theme manifest during dev
      server.middlewares.use('/music/tracks.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(scanThemes(musicDir)));
      });
    },
    writeBundle() {
      // Generate static manifest at build time
      const outDir = path.resolve('dist/music');
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, 'tracks.json'), JSON.stringify(scanThemes(musicDir)));
    },
  };
}

export default defineConfig({
  root: '.',
  publicDir: 'public',
  server: {
    port: 8000,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:8001',
    },
  },
  plugins: [musicManifestPlugin()],
  build: {
    outDir: 'dist',
  },
});
