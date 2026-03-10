import sharp from 'sharp';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

const iconSizes = {
  'mipmap-mdpi': 48,
  'mipmap-hdpi': 72,
  'mipmap-xhdpi': 96,
  'mipmap-xxhdpi': 144,
  'mipmap-xxxhdpi': 192,
};

const sourceIcon = join(rootDir, 'client', 'public', 'assets', 'icon.png');
const androidResDir = join(rootDir, 'android', 'app', 'src', 'main', 'res');

async function generateIcons() {
  if (!existsSync(sourceIcon)) {
    throw new Error(`Icon not found at: ${sourceIcon}`);
  }

  for (const [folder, size] of Object.entries(iconSizes)) {
    const outputDir = join(androidResDir, folder);
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    const outputPath = join(outputDir, 'ic_launcher.png');
    const roundOutputPath = join(outputDir, 'ic_launcher_round.png');
    const foregroundPath = join(outputDir, 'ic_launcher_foreground.png');

    await sharp(sourceIcon)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .toFile(outputPath);

    await sharp(sourceIcon)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .toFile(roundOutputPath);

    const foregroundSize = Math.floor(size * 0.7);
    await sharp(sourceIcon)
      .resize(foregroundSize, foregroundSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .toFile(foregroundPath);

    const backgroundPath = join(outputDir, 'ic_launcher_background.png');
    await sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 1 },
      },
    })
      .png()
      .toFile(backgroundPath);
  }
}

await generateIcons();
