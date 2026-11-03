import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, mkdirSync, cpSync } from 'node:fs';
import path from 'node:path';
export function assetRevision(root) {
  const hash = createHash('sha256');
  const walk = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(filename);
      else if (entry.isFile()) {
        hash.update(path.relative(root, filename));
        hash.update('\0');
        hash.update(readFileSync(filename));
        hash.update('\0');
      }
    }
  };
  walk(root);
  return hash.digest('hex').slice(0, 20);
}
export function versionedAssetsPlugin() {
  let root, output, revision;
  return {
    name: 'beamline-versioned-assets',
    apply: 'build',
    config(config) {
      root = path.resolve(config.root || '.', 'assets');
      revision = assetRevision(root);
      return { define: { __BEAMLINE_ASSET_REVISION__: JSON.stringify(revision) } };
    },
    configResolved(config) { output = path.resolve(config.root, config.build.outDir); },
    closeBundle() {
      const destination = path.join(output, 'versioned-assets', revision);
      mkdirSync(destination, { recursive: true });
      cpSync(root, destination, { recursive: true });
    },
  };
}
