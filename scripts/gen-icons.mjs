// Rasterizes public/icons/icon.svg into the PNG sizes the PWA manifest and iOS need.
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';

const svg = await readFile('public/icons/icon.svg');
const out = 'public/icons/';

await sharp(svg).resize(192, 192).png().toFile(out + 'icon-192.png');
await sharp(svg).resize(512, 512).png().toFile(out + 'icon-512.png');
await sharp(svg).resize(180, 180).flatten({ background: '#2e6b2e' }).png().toFile(out + 'apple-touch-icon.png');
// Maskable: full-bleed background with the artwork inside the 80% safe zone
const inner = await sharp(svg).resize(400, 400).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: '#2e6b2e' } })
  .composite([{ input: inner, gravity: 'center' }]).png().toFile(out + 'maskable-512.png');
console.log('icons written to', out);
