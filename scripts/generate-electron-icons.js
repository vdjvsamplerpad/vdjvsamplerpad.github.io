import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

const sourceIcon = join(rootDir, 'client', 'public', 'assets', 'icon.png');
const iconsDir = join(rootDir, 'build');

async function generateElectronIcons() {
  if (!existsSync(sourceIcon)) {
    throw new Error(`Icon not found at: ${sourceIcon}`);
  }

  if (!existsSync(iconsDir)) {
    mkdirSync(iconsDir, { recursive: true });
  }

  const pngPath = join(iconsDir, 'icon.png');
  const icoPath = join(iconsDir, 'icon.ico');

  await sharp(sourceIcon)
    .resize(256, 256, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toFile(pngPath);

  const icoBuffer = await pngToIco(pngPath);
  writeFileSync(icoPath, icoBuffer);
}

await generateElectronIcons();
