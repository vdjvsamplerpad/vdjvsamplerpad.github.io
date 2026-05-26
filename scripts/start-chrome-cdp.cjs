const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const portArg = process.argv.find((arg) => arg.startsWith('--port='));
const urlArg = process.argv.find((arg) => arg.startsWith('--url='));
const port = Number(process.env.CDP_PORT || (portArg ? portArg.slice('--port='.length) : 9223));
const startUrl = process.env.CDP_URL || (urlArg ? urlArg.slice('--url='.length) : 'http://127.0.0.1:4173/vdjv');
const profileDir = process.env.CDP_PROFILE_DIR || path.join(os.tmpdir(), 'vdjv-chrome-cdp-profile');
const executablePath = process.env.CHROME_PATH || chromium.executablePath();

fs.mkdirSync(profileDir, { recursive: true });

const child = spawn(executablePath, [
  `--remote-debugging-port=${port}`,
  '--remote-debugging-address=127.0.0.1',
  `--user-data-dir=${profileDir}`,
  '--no-first-run',
  '--no-default-browser-check',
  startUrl,
], {
  detached: true,
  stdio: 'ignore',
});

child.unref();

console.log(`Chrome CDP launched on http://127.0.0.1:${port}`);
console.log(`Profile: ${profileDir}`);
console.log(`URL: ${startUrl}`);
