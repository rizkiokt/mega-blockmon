// The game is plain static files with relative URLs (works under /<repo>/ on
// GitHub Pages without a base-path setting). "Building" just copies the
// shippable files into _site/, leaving tests and scripts behind.
import { cpSync, rmSync, mkdirSync } from 'node:fs';

rmSync('_site', { recursive: true, force: true });
mkdirSync('_site');
for (const p of ['index.html', 'css', 'js']) cpSync(p, `_site/${p}`, { recursive: true });
console.log('Built _site/');
