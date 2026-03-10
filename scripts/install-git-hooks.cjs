const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');

function main() {
  const hooksDir = path.join(repoRoot, '.githooks');
  if (!fs.existsSync(hooksDir)) {
    throw new Error('[hooks:install] .githooks directory is missing.');
  }

  try {
    execSync('git config core.hooksPath .githooks', {
      cwd: repoRoot,
      stdio: 'inherit'
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[hooks:install] Failed to configure Git hooks path. ${message}`);
  }
}

main();
