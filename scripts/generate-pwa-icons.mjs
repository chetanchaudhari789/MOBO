import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.resolve(__dirname, '..');

/**
 * Minimal icon set required for good PWA install UX:
 * - Android: 192/512 PNG icons (and maskable variants)
 * - iOS A2HS: apple-touch-icon (180 PNG)
 */
const ICON_SPECS = [
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  { file: 'icon-192-maskable.png', size: 192 },
  { file: 'icon-512-maskable.png', size: 512 },
  { file: 'apple-touch-icon.png', size: 180 },
];

const APPS = [
  { dir: 'apps/buyer-app', name: 'BUZZMA Buyer' },
  { dir: 'apps/mediator-app', name: 'BUZZMA Mediator' },
];

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function renderSvgToPngBuffer(svg, size) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    background: 'transparent',
  });
  const pngData = resvg.render();
  return pngData.asPng();
}

function main() {
  for (const app of APPS) {
    const appRoot = path.resolve(repoRoot, app.dir);
    const publicDir = path.join(appRoot, 'public');
    const iconsDir = path.join(publicDir, 'icons');

    const sourceSvgPath = path.join(publicDir, 'favicon.svg');
    if (!fs.existsSync(sourceSvgPath)) {
      throw new Error(`Missing ${sourceSvgPath}. Expected to use it as base icon.`);
    }

    const svg = fs.readFileSync(sourceSvgPath, 'utf8');
    ensureDir(iconsDir);

    for (const spec of ICON_SPECS) {
      const outPath = path.join(iconsDir, spec.file);
      const png = renderSvgToPngBuffer(svg, spec.size);
      fs.writeFileSync(outPath, png);
    }

    // Keep a pinned-tab SVG for Safari (optional but nice).
    fs.copyFileSync(sourceSvgPath, path.join(iconsDir, 'safari-pinned-tab.svg'));

    console.log(`[pwa-icons] Generated icons for: ${app.name} -> ${path.relative(repoRoot, iconsDir)}`);
  }
}

main();
