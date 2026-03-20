const path = require('path');
const { spawn } = require('child_process');
const dotenv = require('dotenv');

const projectRoot = path.resolve(__dirname, '..');
const packageJson = require(path.join(projectRoot, 'package.json'));

dotenv.config({ path: path.join(projectRoot, '.env') });

function quoteForCmd(value) {
  const normalized = String(value ?? '');
  if (!normalized.length) return '""';
  if (!/[ \t"&()^<>|]/.test(normalized)) return normalized;
  return `"${normalized.replace(/"/g, '""')}"`;
}

const env = {
  ...process.env,
};

if (!String(env.VITE_APP_VERSION || '').trim()) {
  env.VITE_APP_VERSION = packageJson.version;
}

const args = [
  'electron-builder',
  '--config',
  'electron-builder.config.cjs',
  ...process.argv.slice(2),
];

const child = process.platform === 'win32'
  ? spawn(
      'cmd.exe',
      ['/d', '/s', '/c', ['npx', ...args].map(quoteForCmd).join(' ')],
      {
        cwd: projectRoot,
        stdio: 'inherit',
        env,
        shell: false,
      },
    )
  : spawn('npx', args, {
      cwd: projectRoot,
      stdio: 'inherit',
      env,
      shell: false,
    });

child.on('exit', (code) => {
  process.exit(code ?? 1);
});

child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});
