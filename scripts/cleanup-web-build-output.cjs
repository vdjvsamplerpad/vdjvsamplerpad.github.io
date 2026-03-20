const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const publicDistRoot = path.join(projectRoot, 'dist', 'public');

try {
  fs.rmSync(publicDistRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[cleanup-web-build-output] Could not fully remove ${publicDistRoot}: ${message}`);
}
