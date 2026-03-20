const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const dotenv = require('dotenv');

const projectRoot = path.resolve(__dirname, '..');
const androidRoot = path.join(projectRoot, 'android');
const packageJson = require(path.join(projectRoot, 'package.json'));

dotenv.config({ path: path.join(projectRoot, '.env') });

function quoteForCmd(value) {
  const normalized = String(value ?? '');
  if (!normalized.length) return '""';
  if (!/[ \t"&()^<>|]/.test(normalized)) return normalized;
  return `"${normalized.replace(/"/g, '""')}"`;
}

function computeVersionCode(version) {
  const match = String(version || '').trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return 1;
  const major = Number(match[1] || 0);
  const minor = Number(match[2] || 0);
  const patch = Number(match[3] || 0);
  return Math.max(1, major * 10000 + minor * 100 + patch);
}

function sanitizeArtifactSegment(value) {
  return String(value || 'artifact')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'artifact';
}

function renameBuiltArtifact(sourcePath, nextFileName) {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Expected build artifact not found: ${sourcePath}`);
  }
  const targetPath = path.join(path.dirname(sourcePath), nextFileName);
  if (fs.existsSync(targetPath)) {
    fs.unlinkSync(targetPath);
  }
  fs.renameSync(sourcePath, targetPath);
  return targetPath;
}

function run(command, args, cwd, env) {
  return new Promise((resolve, reject) => {
    const child = process.platform === 'win32'
      ? spawn(
          'cmd.exe',
          ['/d', '/s', '/c', [command, ...args].map(quoteForCmd).join(' ')],
          {
            cwd,
            env,
            stdio: 'inherit',
            shell: false,
          },
        )
      : spawn(command, args, {
          cwd,
          env,
          stdio: 'inherit',
          shell: false,
        });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} failed with exit code ${code ?? 1}`));
    });
  });
}

async function main() {
  const mode = process.argv[2] === 'apk' ? 'apk' : 'bundle';
  const env = {
    ...process.env,
  };

  if (!String(env.VITE_APP_VERSION || '').trim()) {
    env.VITE_APP_VERSION = packageJson.version;
  }
  if (!String(env.ANDROID_RELEASE_VERSION_NAME || '').trim()) {
    env.ANDROID_RELEASE_VERSION_NAME = packageJson.version;
  }
  if (!String(env.ANDROID_RELEASE_VERSION_CODE || '').trim()) {
    env.ANDROID_RELEASE_VERSION_CODE = String(computeVersionCode(packageJson.version));
  }
  if (String(env.ANDROID_RELEASE_KEYSTORE_PATH || '').trim() && !path.isAbsolute(env.ANDROID_RELEASE_KEYSTORE_PATH)) {
    env.ANDROID_RELEASE_KEYSTORE_PATH = path.resolve(projectRoot, env.ANDROID_RELEASE_KEYSTORE_PATH);
  }

  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const gradleCommand = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';

  await run(npmCommand, ['run', 'cap:sync'], projectRoot, env);
  await run(
    gradleCommand,
    [mode === 'apk' ? 'assembleRelease' : 'bundleRelease'],
    androidRoot,
    env,
  );

  const outputPath = mode === 'apk'
    ? path.join(androidRoot, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')
    : path.join(androidRoot, 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab');
  const versionName = sanitizeArtifactSegment(env.ANDROID_RELEASE_VERSION_NAME || packageJson.version);
  const artifactFileName = mode === 'apk'
    ? `VDJV-Sampler-Pad-${versionName}.apk`
    : `VDJV-Sampler-Pad-${versionName}.aab`;
  const finalOutputPath = renameBuiltArtifact(outputPath, artifactFileName);
  console.log(`OUTPUT=${finalOutputPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
