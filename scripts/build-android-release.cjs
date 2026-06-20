const path = require('path');
const fs = require('fs');
const { execSync, spawn } = require('child_process');
const crypto = require('crypto');
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

function getGitOutput(args, fallback = '') {
  try {
    return execSync(`git ${args}`, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || fallback;
  } catch {
    return fallback;
  }
}

function getCommitDate() {
  const raw = getGitOutput('log -1 --format=%cd --date=format:%Y-%m-%dT%H:%M:%S%z');
  if (!raw) return new Date();
  const normalized = raw.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function getBuildSequence(env) {
  const explicit = Number(env.ANDROID_RELEASE_BUILD_SEQUENCE || env.VDJV_RELEASE_BUILD_SEQUENCE || 0);
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.max(1, Math.min(99, Math.floor(explicit)));
  }
  const commitCount = Number(getGitOutput('rev-list --count HEAD', '1'));
  if (!Number.isFinite(commitCount) || commitCount <= 0) return 1;
  return ((Math.floor(commitCount) - 1) % 99) + 1;
}

function computeDateBuildMetadata(env) {
  const commitDate = getCommitDate();
  const year = String(commitDate.getFullYear()).slice(-2);
  const month = String(commitDate.getMonth() + 1).padStart(2, '0');
  const day = String(commitDate.getDate()).padStart(2, '0');
  const sequence = getBuildSequence(env);
  return {
    buildVersion: `1.${month}.${day}`,
    buildCode: Number(`${year}${month}${day}${String(sequence).padStart(2, '0')}`),
    buildSequence: sequence,
    commit: getGitOutput('rev-parse --short=12 HEAD', ''),
  };
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function writeAndroidReleaseManifest(input) {
  const releaseDir = path.join(projectRoot, 'release');
  fs.mkdirSync(releaseDir, { recursive: true });
  const artifact = fs.statSync(input.apkPath);
  const manifest = {
    schema: 1,
    platform: 'android',
    publicVersion: input.publicVersion,
    version: input.publicVersion,
    buildVersion: input.buildVersion,
    buildCode: input.buildCode,
    buildSequence: input.buildSequence,
    commit: input.commit || null,
    builtAt: new Date().toISOString(),
    apk: {
      asset: 'VDJV-Sampler-Pad-latest.apk',
      versionedAsset: input.apkAssetName,
      sha256: sha256File(input.apkPath),
      size: artifact.size,
    },
  };
  fs.writeFileSync(
    path.join(releaseDir, 'release-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
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
  const dateBuildMetadata = computeDateBuildMetadata(env);
  if (!String(env.VITE_APP_PUBLIC_VERSION || '').trim()) {
    env.VITE_APP_PUBLIC_VERSION = packageJson.version;
  }
  if (!String(env.VITE_APP_BUILD_VERSION || '').trim()) {
    env.VITE_APP_BUILD_VERSION = dateBuildMetadata.buildVersion;
  }
  if (!String(env.VITE_APP_BUILD_CODE || '').trim()) {
    env.VITE_APP_BUILD_CODE = String(dateBuildMetadata.buildCode);
  }
  if (!String(env.ANDROID_RELEASE_VERSION_NAME || '').trim()) {
    env.ANDROID_RELEASE_VERSION_NAME = packageJson.version;
  }
  if (!String(env.ANDROID_RELEASE_VERSION_CODE || '').trim()) {
    env.ANDROID_RELEASE_VERSION_CODE = env.VITE_APP_BUILD_CODE || String(computeVersionCode(packageJson.version));
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
  if (mode === 'apk') {
    writeAndroidReleaseManifest({
      apkPath: finalOutputPath,
      apkAssetName: artifactFileName,
      publicVersion: env.ANDROID_RELEASE_VERSION_NAME || packageJson.version,
      buildVersion: env.VITE_APP_BUILD_VERSION || dateBuildMetadata.buildVersion,
      buildCode: Number(env.ANDROID_RELEASE_VERSION_CODE || env.VITE_APP_BUILD_CODE || dateBuildMetadata.buildCode),
      buildSequence: dateBuildMetadata.buildSequence,
      commit: dateBuildMetadata.commit,
    });
  }
  console.log(`OUTPUT=${finalOutputPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
