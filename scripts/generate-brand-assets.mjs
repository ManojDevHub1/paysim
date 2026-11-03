import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'apps', 'web', 'public');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

/**
 * Master Brand SVG Template (512x512) - Concept V2 ("The Webhook Signal P")
 * Design Tokens & Palette:
 * - Squircle Background: #0f172a to #080c14 with #38bdf8 subtle illuminated gradient border
 * - Brand Monogram: Geometric P in Electric Cyan (#38bdf8 to #0284c7)
 * - Outbound Webhook Waves: Dual concentric arcs in Mint-to-Cyan (#4ade80 to #00f2fe)
 */
export function getMasterSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%">
  <defs>
    <!-- Background: Deep Slate & Charcoal Fintech Void -->
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0f172a" />
      <stop offset="55%" stop-color="#080c14" />
      <stop offset="100%" stop-color="#05080f" />
    </linearGradient>

    <!-- Subtle Ambient Surface Lighting -->
    <radialGradient id="ambientGlow" cx="28%" cy="22%" r="75%">
      <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.16" />
      <stop offset="65%" stop-color="#38bdf8" stop-opacity="0" />
    </radialGradient>

    <!-- Squircle Border Subtle Illumination -->
    <linearGradient id="borderGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.45" />
      <stop offset="40%" stop-color="#1e293b" stop-opacity="0.8" />
      <stop offset="100%" stop-color="#0f172a" stop-opacity="0.5" />
    </linearGradient>

    <!-- Primary Mark Gradient: Electric Cyan to Azure -->
    <linearGradient id="primaryP" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#38bdf8" />
      <stop offset="100%" stop-color="#0284c7" />
    </linearGradient>

    <!-- Webhook Signal Waves Gradient: Vibrant Mint to Cyan Teal -->
    <linearGradient id="signalWaves" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#4ade80" />
      <stop offset="100%" stop-color="#00f2fe" />
    </linearGradient>

    <!-- Elevation Drop Shadow for Mark -->
    <filter id="markElevation" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="6" stdDeviation="10" flood-color="#000000" flood-opacity="0.45" />
    </filter>
  </defs>

  <!-- 1. Background Squircle -->
  <rect x="16" y="16" width="480" height="480" rx="108" fill="url(#bgGrad)" stroke="url(#borderGrad)" stroke-width="4" />
  <rect x="16" y="16" width="480" height="480" rx="108" fill="url(#ambientGlow)" />

  <!-- 2. Master Mark (Centered composite at x=256, y=256) -->
  <g filter="url(#markElevation)">
    <!-- Seamless Geometric P Letterform -->
    <path d="M 166 116
             L 252 116
             A 80 80 0 0 1 332 196
             A 80 80 0 0 1 252 276
             L 166 276
             L 166 368
             A 28 28 0 0 1 110 368
             L 110 144
             A 28 28 0 0 1 138 116
             L 166 116 Z
             M 166 172
             L 246 172
             A 24 24 0 0 1 270 196
             A 24 24 0 0 1 246 220
             L 166 220
             Z"
          fill="url(#primaryP)"
          fill-rule="evenodd" />

    <!-- Webhook Outbound Signal Arc 1 (Inner Wave: R=60, center=(292, 196)) -->
    <path d="M 354 154 A 60 60 0 0 1 354 238"
          fill="none"
          stroke="url(#signalWaves)"
          stroke-width="24"
          stroke-linecap="round" />

    <!-- Webhook Outbound Signal Arc 2 (Outer Wave: R=104, center=(292, 196)) -->
    <path d="M 398 122 A 104 104 0 0 1 398 270"
          fill="none"
          stroke="url(#signalWaves)"
          stroke-width="24"
          stroke-linecap="round" />
  </g>
</svg>`;
}

async function renderPngWithChrome(svgContent, width, height, outputPath) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome_icon_'));
  const htmlPath = path.join(tempDir, 'icon.html');

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    width: ${width}px;
    height: ${height}px;
    background: transparent;
    overflow: hidden;
  }
  svg {
    display: block;
    width: ${width}px;
    height: ${height}px;
  }
</style>
</head>
<body>
${svgContent}
</body>
</html>`;

  fs.writeFileSync(htmlPath, html, 'utf8');

  const res = spawnSync(CHROME_PATH, [
    '--headless=new',
    '--user-data-dir=' + path.join(tempDir, 'profile'),
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--default-background-color=00000000',
    `--window-size=${width},${height}`,
    '--screenshot=' + outputPath,
    'file:///' + htmlPath.replace(/\\/g, '/'),
  ]);

  fs.rmSync(tempDir, { recursive: true, force: true });

  if (res.status !== 0 || !fs.existsSync(outputPath)) {
    throw new Error(`Chrome failed to render PNG ${width}x${height} (code ${res.status})`);
  }
}

/**
 * Packs multiple PNG images into a valid multi-resolution Microsoft ICO container.
 * Format Specification:
 * - ICONDIR (6 bytes): 0x0000 (reserved), 0x0001 (type: 1 for icon), count (uint16)
 * - Array of ICONDIRENTRY (16 bytes each):
 *     width (1 byte, 0 = 256)
 *     height (1 byte, 0 = 256)
 *     colorCount (1 byte, 0 for 24/32-bit)
 *     reserved (1 byte, 0)
 *     planes (uint16, 1)
 *     bitCount (uint16, 32)
 *     bytesInRes (uint32, length of PNG image data)
 *     imageOffset (uint32, file offset of PNG image data)
 * - Raw PNG image data buffers
 */
function buildIcoFile(images) {
  const headerSize = 6;
  const entrySize = 16;
  const numImages = images.length;
  let offset = headerSize + entrySize * numImages;

  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0); // Reserved
  header.writeUInt16LE(1, 2); // 1 = ICO
  header.writeUInt16LE(numImages, 4);

  const entries = [];
  const datas = [];

  for (const img of images) {
    const entry = Buffer.alloc(entrySize);
    entry.writeUInt8(img.width >= 256 ? 0 : img.width, 0);
    entry.writeUInt8(img.height >= 256 ? 0 : img.height, 1);
    entry.writeUInt8(0, 2); // Color palette (0 if no palette)
    entry.writeUInt8(0, 3); // Reserved
    entry.writeUInt16LE(1, 4); // Color planes
    entry.writeUInt16LE(32, 6); // Bits per pixel
    entry.writeUInt32LE(img.data.length, 8); // PNG byte length
    entry.writeUInt32LE(offset, 12); // Data offset

    entries.push(entry);
    datas.push(img.data);
    offset += img.data.length;
  }

  return Buffer.concat([header, ...entries, ...datas]);
}

async function main() {
  console.log('Generating PAYSIM brand icon assets...');
  fs.mkdirSync(publicDir, { recursive: true });

  const masterSvg = getMasterSvg();
  const svgPath = path.join(publicDir, 'favicon.svg');
  fs.writeFileSync(svgPath, masterSvg, 'utf8');
  console.log(`✓ Generated ${svgPath} (${fs.statSync(svgPath).size} bytes)`);

  const sizes = [
    { name: 'icon-512.png', size: 512 },
    { name: 'icon-192.png', size: 192 },
    { name: 'apple-touch-icon.png', size: 180 },
    { name: 'favicon-48.png', size: 48 },
    { name: 'favicon-32.png', size: 32 },
    { name: 'favicon-16.png', size: 16 },
  ];

  const renderedPointers = {};

  for (const { name, size } of sizes) {
    const outPath = path.join(publicDir, name);
    await renderPngWithChrome(masterSvg, size, size, outPath);
    const stat = fs.statSync(outPath);
    console.log(`✓ Rendered ${name} (${size}x${size}, ${stat.size} bytes)`);
    renderedPointers[size] = fs.readFileSync(outPath);
  }

  // Generate multi-resolution favicon.ico containing 16x16, 32x32, and 48x48 PNG frames
  const icoPath = path.join(publicDir, 'favicon.ico');
  const icoBuffer = buildIcoFile([
    { width: 16, height: 16, data: renderedPointers[16] },
    { width: 32, height: 32, data: renderedPointers[32] },
    { width: 48, height: 48, data: renderedPointers[48] },
  ]);
  fs.writeFileSync(icoPath, icoBuffer);
  console.log(`✓ Generated ${icoPath} (Multi-res ICO 16/32/48, ${icoBuffer.length} bytes)`);

  console.log('\nAll brand icon assets generated successfully in apps/web/public/!');
}

main().catch((err) => {
  console.error('Fatal error generating assets:', err);
  process.exit(1);
});
