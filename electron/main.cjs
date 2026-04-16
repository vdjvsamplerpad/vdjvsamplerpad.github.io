const { app, BrowserWindow, Menu, shell, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');
const ffmpegStatic = require('ffmpeg-static');
const JSZip = require('jszip');
const yazl = require('yazl');
const { setupAutoUpdater, disposeAutoUpdater } = require('./auto-updater.cjs');

let mainWindow;
const isDev = !app.isPackaged;
const PORTABLE_DATA_MARKER_FILES = [
  'vdjv-portable-data.flag',
  '.vdjv-portable-data',
  'portable-data.flag',
];
const ENCRYPTION_MAGIC = Buffer.from('VDJVENC2');
const ENCRYPTION_VERSION = 1;
const ENCRYPTION_SALT_BYTES = 16;
const ENCRYPTION_IV_BYTES = 12;
const ENCRYPTION_VERIFIER_BYTES = 16;
const ENCRYPTION_PBKDF2_ITERATIONS = 120_000;
const ELECTRON_MEDIA_ROOT_FOLDER = 'media';
const MAX_IMPORT_ARCHIVE_ENTRY_COUNT = 2000;
const MAX_IMPORT_ARCHIVE_TOTAL_UNCOMPRESSED_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_IMPORT_ARCHIVE_ENTRY_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;
const WINDOW_STATE_FILE_NAME = 'window-state.json';
const DEFAULT_WINDOW_STATE = Object.freeze({
  width: 1200,
  height: 800,
});

function resolvePortableExecutableDir() {
  const portableExecutableDir = String(process.env.PORTABLE_EXECUTABLE_DIR || '').trim();
  if (portableExecutableDir) return portableExecutableDir;
  if (!process.execPath) return null;
  return path.dirname(process.execPath);
}

function shouldUsePortableDataMode() {
  if (isDev) return false;
  const explicitPortableFlag = String(process.env.VDJV_PORTABLE_DATA || '').trim().toLowerCase();
  if (explicitPortableFlag === '1' || explicitPortableFlag === 'true' || explicitPortableFlag === 'yes') {
    return true;
  }
  if (process.argv.includes('--portable-data')) return true;
  if (String(process.env.PORTABLE_EXECUTABLE_DIR || '').trim()) return true;
  const executableDir = resolvePortableExecutableDir();
  if (!executableDir) return false;
  return PORTABLE_DATA_MARKER_FILES.some((markerName) => fs.existsSync(path.join(executableDir, markerName)));
}

function configurePortableDataPaths() {
  if (!shouldUsePortableDataMode()) return null;
  const executableDir = resolvePortableExecutableDir();
  if (!executableDir) return null;
  const portableDataRoot = path.join(executableDir, 'VDJV Data');
  const nextUserDataPath = path.join(portableDataRoot, 'userData');
  const nextSessionDataPath = path.join(portableDataRoot, 'sessionData');
  const nextCrashDumpPath = path.join(portableDataRoot, 'crashDumps');
  const nextLogsPath = path.join(portableDataRoot, 'logs');
  fs.mkdirSync(nextUserDataPath, { recursive: true });
  fs.mkdirSync(nextSessionDataPath, { recursive: true });
  fs.mkdirSync(nextCrashDumpPath, { recursive: true });
  fs.mkdirSync(nextLogsPath, { recursive: true });
  app.setPath('userData', nextUserDataPath);
  app.setPath('sessionData', nextSessionDataPath);
  app.setPath('crashDumps', nextCrashDumpPath);
  app.setAppLogsPath(nextLogsPath);
  return {
    executableDir,
    portableDataRoot,
  };
}

const portableDataMode = configurePortableDataPaths();
const isPortableDataMode = Boolean(portableDataMode);

function getWindowStateFilePath() {
  return path.join(app.getPath('userData'), WINDOW_STATE_FILE_NAME);
}

function sanitizeWindowState(rawValue) {
  if (!rawValue || typeof rawValue !== 'object') return null;
  const nextState = {};
  const width = Number(rawValue.width);
  const height = Number(rawValue.height);
  const x = Number(rawValue.x);
  const y = Number(rawValue.y);

  if (!Number.isFinite(width) || width < 640 || width > 5000) return null;
  if (!Number.isFinite(height) || height < 480 || height > 4000) return null;

  nextState.width = Math.round(width);
  nextState.height = Math.round(height);

  if (Number.isFinite(x)) nextState.x = Math.round(x);
  if (Number.isFinite(y)) nextState.y = Math.round(y);

  return nextState;
}

function readWindowState() {
  try {
    const filePath = getWindowStateFilePath();
    if (!fs.existsSync(filePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return sanitizeWindowState(parsed);
  } catch {
    return null;
  }
}

function writeWindowState(bounds) {
  const safeBounds = sanitizeWindowState(bounds);
  if (!safeBounds) return;
  try {
    const filePath = getWindowStateFilePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(safeBounds, null, 2), 'utf8');
  } catch {
  }
}

function resolvePackagedBinaryPath(rawPath) {
  if (!rawPath) return null;
  if (!app.isPackaged) return rawPath;
  const unpackedPath = rawPath.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
  if (unpackedPath !== rawPath && fs.existsSync(unpackedPath)) return unpackedPath;
  return rawPath;
}

function resolveFfmpegBinaryPath() {
  const resolvedPath = resolvePackagedBinaryPath(ffmpegStatic);
  if (resolvedPath && fs.existsSync(resolvedPath)) return resolvedPath;
  return null;
}

function guessAudioExtension(mimeType) {
  const normalized = String(mimeType || '').toLowerCase();
  if (normalized.includes('mpeg') || normalized.includes('mp3')) return '.mp3';
  if (normalized.includes('wav') || normalized.includes('wave')) return '.wav';
  if (normalized.includes('ogg')) return '.ogg';
  if (normalized.includes('aac')) return '.aac';
  if (normalized.includes('m4a') || normalized.includes('mp4')) return '.m4a';
  if (normalized.includes('flac')) return '.flac';
  return '.bin';
}

function guessAudioExtensionFromPath(sourcePath) {
  const ext = path.extname(String(sourcePath || '')).toLowerCase();
  return ext || '.bin';
}

function normalizeInputBytes(inputBytes) {
  if (inputBytes instanceof Uint8Array) return Buffer.from(inputBytes);
  if (inputBytes instanceof ArrayBuffer) return Buffer.from(inputBytes);
  if (ArrayBuffer.isView(inputBytes)) {
    return Buffer.from(inputBytes.buffer, inputBytes.byteOffset, inputBytes.byteLength);
  }
  return null;
}

function sanitizeSuggestedFileName(rawValue, fallback = 'download.bin') {
  const normalized = sanitizeFileName(String(rawValue || '').trim());
  return normalized || fallback;
}

async function saveFileElectron(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, reason: 'window_unavailable' };
  }

  const inputBytes = normalizeInputBytes(payload?.data);
  if (!inputBytes || inputBytes.length === 0) {
    return { ok: false, reason: 'missing_data' };
  }

  const fileName = sanitizeSuggestedFileName(payload?.fileName, 'download.bin');
  const defaultDirectory = app.getPath('downloads');
  const defaultPath = path.join(defaultDirectory, fileName);
  const filters = Array.isArray(payload?.filters) ? payload.filters : [];
  const result = await dialog.showSaveDialog(mainWindow, {
    title: String(payload?.title || 'Save File'),
    defaultPath,
    buttonLabel: 'Save',
    filters,
  });

  if (result.canceled || !result.filePath) {
    return { ok: false, canceled: true };
  }

  await fs.promises.mkdir(path.dirname(result.filePath), { recursive: true });
  await fs.promises.writeFile(result.filePath, inputBytes);
  return { ok: true, savedPath: result.filePath };
}

function sanitizeNativeMediaStorageKey(rawValue) {
  const raw = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (!raw) throw new Error('Native media storage key is required.');
  const segments = raw
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 0) {
    throw new Error('Native media storage key is invalid.');
  }
  const sanitizedSegments = segments.map((segment) => {
    if (segment === '.' || segment === '..') {
      throw new Error('Native media storage key is invalid.');
    }
    return sanitizeFileName(segment);
  });
  const normalized = sanitizedSegments.join('/');
  if (!normalized) {
    throw new Error('Native media storage key is invalid.');
  }
  return normalized;
}

function getElectronNativeMediaRootPath() {
  const rootPath = path.join(app.getPath('userData'), ELECTRON_MEDIA_ROOT_FOLDER);
  return rootPath;
}

function resolveElectronNativeMediaPath(storageKey) {
  const normalizedKey = sanitizeNativeMediaStorageKey(storageKey);
  const rootPath = getElectronNativeMediaRootPath();
  const absolutePath = path.resolve(rootPath, normalizedKey.replace(/\//g, path.sep));
  const resolvedRoot = path.resolve(rootPath);
  if (absolutePath !== resolvedRoot && !absolutePath.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error('Native media path escaped the app data directory.');
  }
  return {
    storageKey: normalizedKey,
    rootPath: resolvedRoot,
    sourcePath: absolutePath,
  };
}

async function resolveNativeMediaDescriptorElectron(payload) {
  const { storageKey, sourcePath } = resolveElectronNativeMediaPath(payload?.storageKey);
  try {
    const stats = await fs.promises.stat(sourcePath);
    if (!stats.isFile()) {
      return { storageKey, exists: false };
    }
    return {
      storageKey,
      exists: true,
      sourcePath,
      fileUrl: pathToFileURL(sourcePath).href,
      bytes: Number(stats.size || 0),
    };
  } catch {
    return {
      storageKey,
      exists: false,
    };
  }
}

async function writeNativeMediaElectron(payload) {
  const inputBytes = normalizeInputBytes(payload?.data);
  if (!inputBytes || inputBytes.length <= 0) {
    throw new Error('Electron native media write requires data.');
  }
  const { storageKey, sourcePath } = resolveElectronNativeMediaPath(payload?.storageKey);
  await fs.promises.mkdir(path.dirname(sourcePath), { recursive: true });
  await fs.promises.writeFile(sourcePath, inputBytes);
  return {
    storageKey,
    sourcePath,
    fileUrl: pathToFileURL(sourcePath).href,
    bytes: inputBytes.length,
  };
}

async function readNativeMediaElectron(payload) {
  const descriptor = await resolveNativeMediaDescriptorElectron(payload);
  if (!descriptor.exists || !descriptor.sourcePath) {
    throw new Error('Electron native media file was not found.');
  }
  const outputBuffer = await fs.promises.readFile(descriptor.sourcePath);
  return {
    storageKey: descriptor.storageKey,
    sourcePath: descriptor.sourcePath,
    fileUrl: descriptor.fileUrl,
    bytes: outputBuffer.length,
    data: outputBuffer.buffer.slice(
      outputBuffer.byteOffset,
      outputBuffer.byteOffset + outputBuffer.byteLength
    ),
  };
}

async function deleteNativeMediaElectron(payload) {
  const { storageKey, sourcePath } = resolveElectronNativeMediaPath(payload?.storageKey);
  await fs.promises.rm(sourcePath, { force: true }).catch(() => {});
  return {
    storageKey,
    deleted: true,
  };
}

function getArchiveEntryCleanupPaths(payload) {
  const entries = Array.isArray(payload?.entries) ? payload.entries : [];
  const cleanupPaths = [];
  for (const entry of entries) {
    if (entry?.cleanupSourcePath === true && typeof entry?.sourcePath === 'string' && entry.sourcePath.trim()) {
      cleanupPaths.push(entry.sourcePath.trim());
    }
  }
  return cleanupPaths;
}

async function cleanupStagedExportEntriesElectron(payload) {
  const rawPaths = Array.isArray(payload?.paths) ? payload.paths : [];
  const stagedDirs = Array.from(
    new Set(
      rawPaths
        .filter((value) => typeof value === 'string' && value.trim().length > 0)
        .map((value) => path.dirname(value))
    )
  );
  await Promise.all(
    stagedDirs.map(async (dirPath) => {
      await fs.promises.rm(dirPath, { recursive: true, force: true }).catch(() => {});
    })
  );
  return { removedCount: stagedDirs.length };
}

async function stageExportEntryElectron(payload) {
  const archivePath = typeof payload?.archivePath === 'string' ? payload.archivePath.trim() : '';
  const inputBytes = normalizeInputBytes(payload?.data);
  if (!archivePath || !inputBytes || inputBytes.length === 0) {
    throw new Error('Export staging requires a valid archivePath and data.');
  }
  const stagedRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vdjv-export-stage-'));
  const fallbackName = path.basename(archivePath) || `entry-${crypto.randomUUID()}.bin`;
  const safeFileName = sanitizeFileName(payload?.fileName || fallbackName);
  const stagedPath = path.join(stagedRoot, safeFileName);
  await fs.promises.writeFile(stagedPath, inputBytes);
  return {
    sourcePath: stagedPath,
    bytes: inputBytes.length,
  };
}

function buildZipArchiveOutputStream(payload) {
  const zip = new yazl.ZipFile();
  const entries = Array.isArray(payload?.entries) ? payload.entries : [];
  const compress = payload?.compression === 'DEFLATE';
  for (const entry of entries) {
    const archivePath = typeof entry?.path === 'string' ? entry.path.trim() : '';
    if (!archivePath) continue;
    const sourcePath = typeof entry?.sourcePath === 'string' ? entry.sourcePath.trim() : '';
    if (sourcePath && fs.existsSync(sourcePath)) {
      zip.addFile(sourcePath, archivePath, { compress });
      continue;
    }
    const buffer = normalizeInputBytes(entry?.data);
    if (!buffer || buffer.length === 0) continue;
    zip.addBuffer(buffer, archivePath, { compress });
  }
  zip.end();
  return zip.outputStream;
}

function normalizeArchiveAssetPath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
}

function hasZipMagicBuffer(inputBuffer) {
  return (
    Buffer.isBuffer(inputBuffer) &&
    inputBuffer.length >= 4 &&
    inputBuffer[0] === 0x50 &&
    inputBuffer[1] === 0x4b &&
    (
      (inputBuffer[2] === 0x03 && inputBuffer[3] === 0x04) ||
      (inputBuffer[2] === 0x05 && inputBuffer[3] === 0x06) ||
      (inputBuffer[2] === 0x07 && inputBuffer[3] === 0x08)
    )
  );
}

function emitImportArchiveProgress(webContents, payload) {
  try {
    if (webContents && !webContents.isDestroyed()) {
      webContents.send('vdjv-import-progress', payload);
    }
  } catch {
  }
}

async function loadImportArchiveSourceBufferElectron(payload, webContents) {
  const source = payload?.source && typeof payload.source === 'object' ? payload.source : {};
  if (source.kind === 'file') {
    const filePath = typeof source.filePath === 'string' ? source.filePath.trim() : '';
    if (!filePath) throw new Error('Import file path is missing.');
    const fileName = typeof source.fileName === 'string' && source.fileName.trim().length > 0
      ? source.fileName.trim()
      : path.basename(filePath);
    const buffer = await fs.promises.readFile(filePath);
    return {
      buffer,
      fileName,
      fileBytes: typeof source.fileBytes === 'number' && Number.isFinite(source.fileBytes)
        ? source.fileBytes
        : buffer.length,
    };
  }

  if (source.kind === 'url') {
    const signedUrl = typeof source.signedUrl === 'string' ? source.signedUrl.trim() : '';
    if (!signedUrl) throw new Error('Import download URL is missing.');
    const response = await fetch(signedUrl, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Download failed with HTTP ${response.status}`);
    }
    const contentLengthHeader = response.headers.get('content-length');
    const totalBytes = contentLengthHeader ? Number(contentLengthHeader) : 0;
    const chunks = [];
    let loadedBytes = 0;
    if (!response.body) {
      const fallbackBuffer = Buffer.from(await response.arrayBuffer());
      loadedBytes = fallbackBuffer.length;
      return {
        buffer: fallbackBuffer,
        fileName: typeof source.fileName === 'string' && source.fileName.trim().length > 0 ? source.fileName.trim() : 'downloaded.bank',
        fileBytes: loadedBytes,
      };
    }
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      chunks.push(chunk);
      loadedBytes += chunk.length;
      emitImportArchiveProgress(webContents, {
        jobId: payload?.jobId || '',
        stage: 'download-progress',
        progress: totalBytes > 0 ? Math.min(20, 4 + Math.round((loadedBytes / totalBytes) * 16)) : 10,
        message: 'Downloading bank archive...',
        downloadedBytes: loadedBytes,
        totalBytes: totalBytes || undefined,
      });
    }
    const buffer = Buffer.concat(chunks);
    const expectedSha256 = typeof source.expectedSha256 === 'string' ? source.expectedSha256.trim().toLowerCase() : '';
    if (expectedSha256) {
      const actualSha256 = crypto.createHash('sha256').update(buffer).digest('hex');
      if (actualSha256 !== expectedSha256) {
        throw new Error('Integrity check failed');
      }
    }
    return {
      buffer,
      fileName: typeof source.fileName === 'string' && source.fileName.trim().length > 0 ? source.fileName.trim() : 'downloaded.bank',
      fileBytes: buffer.length,
    };
  }

  throw new Error('Unsupported import source.');
}

async function assertSafeBankImportArchiveElectron(zip) {
  const entries = Object.values(zip.files || {});
  if (entries.length > MAX_IMPORT_ARCHIVE_ENTRY_COUNT) {
    throw new Error(`Bank archive has too many files (${entries.length}). Maximum supported is ${MAX_IMPORT_ARCHIVE_ENTRY_COUNT}.`);
  }
  let totalUncompressedBytes = 0;
  for (const entry of entries) {
    if (entry?.dir) continue;
    const uncompressedBytes = Number(entry?._data?.uncompressedSize || 0);
    if (Number.isFinite(uncompressedBytes) && uncompressedBytes > MAX_IMPORT_ARCHIVE_ENTRY_UNCOMPRESSED_BYTES) {
      throw new Error(`Bank archive contains an oversized file (${Math.ceil(uncompressedBytes / (1024 * 1024))}MB).`);
    }
    if (Number.isFinite(uncompressedBytes) && uncompressedBytes > 0) {
      totalUncompressedBytes += uncompressedBytes;
      if (totalUncompressedBytes > MAX_IMPORT_ARCHIVE_TOTAL_UNCOMPRESSED_BYTES) {
        throw new Error(`Bank archive is too large after extraction (${Math.ceil(totalUncompressedBytes / (1024 * 1024))}MB).`);
      }
    }
  }
}

function sanitizeFileName(rawValue) {
  const normalized = String(rawValue || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
  return normalized || 'export.bank';
}

function normalizeRelativeFolder(rawValue) {
  const raw = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (!raw) return '';
  const segments = raw
    .split(/[\\/]+/)
    .map((segment) => sanitizeFileName(segment))
    .filter(Boolean);
  return segments.join(path.sep);
}

async function resolveUniqueFilePath(targetPath) {
  const parsed = path.parse(targetPath);
  let candidatePath = targetPath;
  let index = 1;
  while (true) {
    try {
      await fs.promises.access(candidatePath, fs.constants.F_OK);
      candidatePath = path.join(parsed.dir, `${parsed.name} (${index})${parsed.ext}`);
      index += 1;
    } catch {
      return candidatePath;
    }
  }
}

function createEncryptionEnvelopeBuffer(inputBuffer, password) {
  const passwordBuffer = Buffer.from(String(password || ''), 'utf8');
  const salt = crypto.randomBytes(ENCRYPTION_SALT_BYTES);
  const iv = crypto.randomBytes(ENCRYPTION_IV_BYTES);
  const derived = crypto.pbkdf2Sync(passwordBuffer, salt, ENCRYPTION_PBKDF2_ITERATIONS, 48, 'sha256');
  const aesKey = derived.subarray(0, 32);
  const verifier = derived.subarray(32, 48);
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
  const ciphertext = Buffer.concat([cipher.update(inputBuffer), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const header = Buffer.alloc(ENCRYPTION_MAGIC.length + 1 + 1 + 1 + 1 + 4);
  let offset = 0;
  ENCRYPTION_MAGIC.copy(header, offset);
  offset += ENCRYPTION_MAGIC.length;
  header[offset++] = ENCRYPTION_VERSION;
  header[offset++] = salt.length;
  header[offset++] = iv.length;
  header[offset++] = verifier.length;
  header.writeUInt32BE(ENCRYPTION_PBKDF2_ITERATIONS, offset);
  return Buffer.concat([header, salt, iv, verifier, ciphertext, authTag]);
}

function parseEncryptionEnvelopeBuffer(inputBuffer) {
  if (!Buffer.isBuffer(inputBuffer) || inputBuffer.length < ENCRYPTION_MAGIC.length + 1 + 1 + 1 + 1 + 4) {
    return null;
  }
  if (!inputBuffer.subarray(0, ENCRYPTION_MAGIC.length).equals(ENCRYPTION_MAGIC)) {
    return null;
  }
  let offset = ENCRYPTION_MAGIC.length;
  const version = inputBuffer[offset++];
  if (version !== ENCRYPTION_VERSION) {
    throw new Error('Unsupported encrypted bank version.');
  }
  const saltLength = inputBuffer[offset++];
  const ivLength = inputBuffer[offset++];
  const verifierLength = inputBuffer[offset++];
  const iterations = inputBuffer.readUInt32BE(offset);
  offset += 4;
  const requiredLength = offset + saltLength + ivLength + verifierLength + 16;
  if (inputBuffer.length < requiredLength) {
    throw new Error('Invalid encrypted payload.');
  }
  const salt = inputBuffer.subarray(offset, offset + saltLength);
  offset += saltLength;
  const iv = inputBuffer.subarray(offset, offset + ivLength);
  offset += ivLength;
  const verifier = inputBuffer.subarray(offset, offset + verifierLength);
  offset += verifierLength;
  const authTag = inputBuffer.subarray(inputBuffer.length - 16);
  const ciphertext = inputBuffer.subarray(offset, inputBuffer.length - 16);
  return {
    iterations,
    salt,
    iv,
    verifier,
    ciphertext,
    authTag,
  };
}

function decryptEncryptionEnvelopeBuffer(inputBuffer, candidatePasswords) {
  const envelope = parseEncryptionEnvelopeBuffer(inputBuffer);
  if (!envelope) {
    return {
      decryptedBuffer: inputBuffer,
      encrypted: false,
      matchedPassword: null,
    };
  }
  for (const password of candidatePasswords) {
    const normalized = typeof password === 'string' ? password.trim() : '';
    if (!normalized) continue;
    const derived = crypto.pbkdf2Sync(Buffer.from(normalized, 'utf8'), envelope.salt, envelope.iterations, 48, 'sha256');
    const aesKey = derived.subarray(0, 32);
    const verifier = derived.subarray(32, 48);
    if (!crypto.timingSafeEqual(verifier, envelope.verifier)) {
      continue;
    }
    const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, envelope.iv);
    decipher.setAuthTag(envelope.authTag);
    const decryptedBuffer = Buffer.concat([decipher.update(envelope.ciphertext), decipher.final()]);
    return {
      decryptedBuffer,
      encrypted: true,
      matchedPassword: normalized,
    };
  }
  throw new Error('Cannot decrypt bank file. Please ensure you have access to this bank.');
}

async function runFfmpegJob(ffmpegPath, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = '';

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`));
    });
  });
}

function getArchiveJobCleanupPaths(payload) {
  const entries = Array.isArray(payload?.entries) ? payload.entries : [];
  const cleanupPaths = [];
  for (const entry of entries) {
    if (entry?.cleanupSourcePath === true && typeof entry?.sourcePath === 'string' && entry.sourcePath.trim()) {
      cleanupPaths.push(entry.sourcePath.trim());
    }
  }
  return cleanupPaths;
}

async function materializeArchiveJobEntry(entry, tempRoot, ffmpegPath) {
  const archivePath = typeof entry?.path === 'string' ? entry.path.trim() : '';
  if (!archivePath) {
    throw new Error('Archive job entry requires a valid path.');
  }

  if (entry?.kind === 'audio') {
    const sourcePath = typeof entry?.sourcePath === 'string' ? entry.sourcePath.trim() : '';
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      throw new Error(`Archive audio entry source was missing for ${archivePath}.`);
    }
    const transform = typeof entry?.transform === 'string' ? entry.transform : 'copy';
    if (transform === 'copy') {
      return { path: archivePath, sourcePath };
    }
    if (!ffmpegPath) {
      throw new Error('Electron export is unavailable: ffmpeg binary not found.');
    }

    const useMp3Output =
      transform === 'trim_mp3' ||
      guessAudioExtension(entry?.mimeType) === '.mp3' ||
      guessAudioExtensionFromPath(sourcePath) === '.mp3';
    const outputExt = useMp3Output ? '.mp3' : '.wav';
    const outputPath = path.join(tempRoot, `${crypto.randomUUID()}${outputExt}`);
    const args = ['-hide_banner', '-loglevel', 'error', '-y'];
    const shouldTrim =
      Number.isFinite(entry?.startTimeMs) &&
      Number.isFinite(entry?.endTimeMs) &&
      entry.endTimeMs > entry.startTimeMs;

    if (shouldTrim) {
      args.push('-ss', String(Math.max(0, Number(entry.startTimeMs)) / 1000));
    }
    args.push('-i', sourcePath);
    if (shouldTrim) {
      args.push('-to', String(Math.max(0, Number(entry.endTimeMs)) / 1000));
    }
    args.push('-map', 'a:0');
    args.push('-vn');

    if (useMp3Output) {
      args.push('-c:a', 'libmp3lame');
      args.push('-b:a', `${Math.max(32, Math.min(320, Number(entry?.bitrate) || 128))}k`);
    } else {
      args.push('-c:a', 'pcm_s16le');
    }

    args.push(outputPath);
    await runFfmpegJob(ffmpegPath, args);
    return { path: archivePath, sourcePath: outputPath };
  }

  const sourcePath = typeof entry?.sourcePath === 'string' ? entry.sourcePath.trim() : '';
  if (sourcePath && fs.existsSync(sourcePath)) {
    return { path: archivePath, sourcePath };
  }

  const inputBytes = normalizeInputBytes(entry?.data);
  if (!inputBytes || inputBytes.length === 0) {
    throw new Error(`Archive raw entry data was missing for ${archivePath}.`);
  }
  const outputPath = path.join(tempRoot, sanitizeFileName(path.basename(archivePath) || `${crypto.randomUUID()}.bin`));
  await fs.promises.writeFile(outputPath, inputBytes);
  return { path: archivePath, sourcePath: outputPath };
}

async function exportArchiveJobElectron(payload) {
  const ffmpegPath = resolveFfmpegBinaryPath();
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vdjv-export-job-'));
  const cleanupPaths = getArchiveJobCleanupPaths(payload);
  const downloadsRoot = app.getPath('downloads');
  const relativeFolder = normalizeRelativeFolder(payload?.relativeFolder);
  const targetDir = relativeFolder ? path.join(downloadsRoot, relativeFolder) : downloadsRoot;
  await fs.promises.mkdir(targetDir, { recursive: true });

  const fileName = sanitizeFileName(payload?.fileName);
  const outputPath = await resolveUniqueFilePath(path.join(targetDir, fileName));
  const tempArchivePath = path.join(tempRoot, `archive-${crypto.randomUUID()}.zip`);

  try {
    const materializedEntries = [];
    const rawEntries = Array.isArray(payload?.entries) ? payload.entries : [];
    for (const entry of rawEntries) {
      materializedEntries.push(await materializeArchiveJobEntry(entry, tempRoot, ffmpegPath));
    }

    const archiveStream = buildZipArchiveOutputStream({
      entries: materializedEntries,
      compression: payload?.compression,
      compressionLevel: payload?.compressionLevel,
    });
    await pipeline(archiveStream, fs.createWriteStream(tempArchivePath));

    let outputBuffer = await fs.promises.readFile(tempArchivePath);
    if (typeof payload?.encryptionPassword === 'string' && payload.encryptionPassword.length > 0) {
      outputBuffer = createEncryptionEnvelopeBuffer(outputBuffer, payload.encryptionPassword);
    }

    await fs.promises.writeFile(outputPath, outputBuffer);

    return {
      savedPath: outputPath,
      archiveBytes: outputBuffer.length,
      archiveData: payload?.returnArchiveBytes
        ? outputBuffer.buffer.slice(outputBuffer.byteOffset, outputBuffer.byteOffset + outputBuffer.byteLength)
        : undefined,
      message: `Successfully saved to ${outputPath}`,
    };
  } finally {
    await fs.promises.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    if (cleanupPaths.length > 0) {
      await cleanupStagedExportEntriesElectron({ paths: cleanupPaths }).catch(() => {});
    }
  }
}

async function importArchiveJobElectron(webContents, payload) {
  const createdStorageKeys = [];
  const jobId = typeof payload?.jobId === 'string' ? payload.jobId : crypto.randomUUID();
  try {
    emitImportArchiveProgress(webContents, {
      jobId,
      stage: 'validate-file',
      progress: 5,
      message: 'Checking bank file...',
    });
    const sourceInfo = await loadImportArchiveSourceBufferElectron(payload, webContents);
    emitImportArchiveProgress(webContents, {
      jobId,
      stage: 'metadata-start',
      progress: 20,
      message: 'Reading bank metadata...',
    });

    const candidatePasswords = Array.isArray(payload?.candidateDerivedKeys) ? payload.candidateDerivedKeys : [];
    let decryptedInfo;
    if (hasZipMagicBuffer(sourceInfo.buffer)) {
      decryptedInfo = {
        decryptedBuffer: sourceInfo.buffer,
        encrypted: false,
      };
    } else {
      emitImportArchiveProgress(webContents, {
        jobId,
        stage: 'decrypt-start',
        progress: 12,
        message: 'Decrypting bank archive...',
      });
      decryptedInfo = decryptEncryptionEnvelopeBuffer(sourceInfo.buffer, candidatePasswords);
    }

    const zip = await JSZip.loadAsync(decryptedInfo.decryptedBuffer);
    await assertSafeBankImportArchiveElectron(zip);
    const bankJsonFile = zip.file('bank.json');
    if (!bankJsonFile) {
      throw new Error('Invalid bank file: bank.json not found.');
    }
    const bankJsonText = await bankJsonFile.async('string');
    let metadataJsonText = null;
    const metadataFile = zip.file('metadata.json');
    if (metadataFile) {
      try {
        metadataJsonText = await metadataFile.async('string');
      } catch {
        metadataJsonText = null;
      }
    }

    let metadataJson = null;
    if (metadataJsonText) {
      try {
        metadataJson = JSON.parse(metadataJsonText);
      } catch {
        metadataJson = null;
      }
    }
    const bankJson = JSON.parse(bankJsonText);
    const pads = Array.isArray(bankJson?.pads) ? bankJson.pads : [];
    emitImportArchiveProgress(webContents, {
      jobId,
      stage: 'pads-start',
      progress: 30,
      message: 'Extracting bank media...',
    });

    const resultPads = [];
    for (let index = 0; index < pads.length; index += 1) {
      const pad = pads[index] && typeof pads[index] === 'object' ? pads[index] : {};
      const sourcePadId = typeof pad.id === 'string' ? pad.id : null;
      const sourcePadName = typeof pad.name === 'string' ? pad.name : null;
      const audioPath = normalizeArchiveAssetPath(pad.audioUrl);
      const imagePath = normalizeArchiveAssetPath(pad.imageUrl);
      const audioFile = audioPath ? zip.file(audioPath) : null;
      const imageFile = imagePath ? zip.file(imagePath) : null;
      const padResult = {
        index,
        sourcePadId,
        sourcePadName,
        audioStorageKey: null,
        audioFilePath: null,
        audioFileUrl: null,
        imageStorageKey: null,
        imageFilePath: null,
        imageFileUrl: null,
        audioBytes: 0,
        audioDurationMs:
          typeof pad.endTimeMs === 'number' && Number.isFinite(pad.endTimeMs) && pad.endTimeMs > 0
            ? Math.round(pad.endTimeMs)
            : 0,
        hasImageAsset: false,
        audioRejectedReason: null,
      };

      if (!audioFile) {
        padResult.audioRejectedReason = 'missing_audio';
      } else {
        const audioBuffer = await audioFile.async('nodebuffer');
        const audioExt = path.extname(audioPath).toLowerCase() || '.bin';
        const audioStorageKey = sanitizeNativeMediaStorageKey(`audio/pad-audio-${crypto.randomUUID()}${audioExt}`);
        const storedAudio = await writeNativeMediaElectron({ storageKey: audioStorageKey, data: audioBuffer });
        createdStorageKeys.push(audioStorageKey);
        padResult.audioStorageKey = audioStorageKey;
        padResult.audioFilePath = storedAudio.sourcePath || null;
        padResult.audioFileUrl = storedAudio.fileUrl || null;
        padResult.audioBytes = audioBuffer.length;
      }

      if (imageFile) {
        const imageBuffer = await imageFile.async('nodebuffer');
        const imageExt = path.extname(imagePath).toLowerCase() || '.bin';
        const imageStorageKey = sanitizeNativeMediaStorageKey(`image/pad-image-${crypto.randomUUID()}${imageExt}`);
        const storedImage = await writeNativeMediaElectron({ storageKey: imageStorageKey, data: imageBuffer });
        createdStorageKeys.push(imageStorageKey);
        padResult.imageStorageKey = imageStorageKey;
        padResult.imageFilePath = storedImage.sourcePath || null;
        padResult.imageFileUrl = storedImage.fileUrl || null;
        padResult.hasImageAsset = true;
      }

      resultPads.push(padResult);
      emitImportArchiveProgress(webContents, {
        jobId,
        stage: 'pads-progress',
        progress: 30 + Math.min(60, Math.round(((index + 1) / Math.max(pads.length, 1)) * 60)),
        message: `Importing pads... ${index + 1}/${Math.max(pads.length, 1)}`,
        currentPad: index + 1,
        totalPads: pads.length,
      });
    }

    let thumbnailStorageKey = null;
    let thumbnailFilePath = null;
    let thumbnailFileUrl = null;
    const thumbnailAssetPath = typeof metadataJson?.thumbnailAssetPath === 'string'
      ? normalizeArchiveAssetPath(metadataJson.thumbnailAssetPath)
      : '';
    const thumbnailFile = thumbnailAssetPath ? zip.file(thumbnailAssetPath) : null;
    if (thumbnailFile) {
      const thumbnailBuffer = await thumbnailFile.async('nodebuffer');
      const thumbnailExt = path.extname(thumbnailAssetPath).toLowerCase() || '.bin';
      thumbnailStorageKey = sanitizeNativeMediaStorageKey(`image/bank-thumbnail-${crypto.randomUUID()}${thumbnailExt}`);
      const storedThumbnail = await writeNativeMediaElectron({ storageKey: thumbnailStorageKey, data: thumbnailBuffer });
      createdStorageKeys.push(thumbnailStorageKey);
      thumbnailFilePath = storedThumbnail.sourcePath || null;
      thumbnailFileUrl = storedThumbnail.fileUrl || null;
    }

    emitImportArchiveProgress(webContents, {
      jobId,
      stage: 'finalize',
      progress: 96,
      message: 'Finalizing import payload...',
    });

    return {
      jobId,
      sourceFileName: sourceInfo.fileName,
      sourceFileBytes: sourceInfo.fileBytes,
      encrypted: Boolean(decryptedInfo.encrypted),
      bankJsonText,
      metadataJsonText,
      thumbnailStorageKey,
      thumbnailFilePath,
      thumbnailFileUrl,
      pads: resultPads,
    };
  } catch (error) {
    await Promise.allSettled(createdStorageKeys.map((storageKey) => deleteNativeMediaElectron({ storageKey })));
    throw error;
  }
}

async function transcodeAudioToMp3Electron(payload) {
  const ffmpegPath = resolveFfmpegBinaryPath();
  if (!ffmpegPath) {
    throw new Error('Electron MP3 export is unavailable: ffmpeg binary not found.');
  }

  const inputBytes = payload?.audioBytes;
  const audioBuffer =
    inputBytes instanceof Uint8Array
      ? Buffer.from(inputBytes)
      : inputBytes instanceof ArrayBuffer
        ? Buffer.from(inputBytes)
        : ArrayBuffer.isView(inputBytes)
          ? Buffer.from(inputBytes.buffer, inputBytes.byteOffset, inputBytes.byteLength)
          : null;

  if (!audioBuffer || audioBuffer.length === 0) {
    throw new Error('Electron MP3 export failed: missing input audio data.');
  }

  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vdjv-mp3-export-'));
  const inputPath = path.join(tempRoot, `input${guessAudioExtension(payload?.mimeType)}`);
  const outputPath = path.join(tempRoot, 'output.mp3');

  try {
    await fs.promises.writeFile(inputPath, audioBuffer);

    const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', inputPath];
    const shouldTrim =
      payload?.applyTrim === true &&
      Number.isFinite(payload?.startTimeMs) &&
      Number.isFinite(payload?.endTimeMs) &&
      payload.endTimeMs > payload.startTimeMs;

    if (shouldTrim) {
      args.push('-ss', String(Math.max(0, payload.startTimeMs) / 1000));
      args.push('-to', String(Math.max(0, payload.endTimeMs) / 1000));
    }

    args.push('-map', 'a:0');
    args.push('-vn');
    args.push('-c:a', 'libmp3lame');
    args.push('-b:a', `${Math.max(32, Math.min(320, Number(payload?.bitrate) || 128))}k`);
    args.push(outputPath);

    await new Promise((resolve, reject) => {
      const child = spawn(ffmpegPath, args, { windowsHide: true });
      let stderr = '';

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`));
      });
    });

    const outputBuffer = await fs.promises.readFile(outputPath);
    return {
      audioBytes: outputBuffer.buffer.slice(
        outputBuffer.byteOffset,
        outputBuffer.byteOffset + outputBuffer.byteLength
      ),
    };
  } finally {
    await fs.promises.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
}

async function createZipArchiveElectron(payload) {
  const cleanupPaths = getArchiveEntryCleanupPaths(payload);
  if (typeof payload?.fileName === 'string' && payload.fileName.trim().length > 0) {
    try {
      return await createAndSaveZipArchiveElectron(payload);
    } finally {
      if (cleanupPaths.length > 0) {
        await cleanupStagedExportEntriesElectron({ paths: cleanupPaths }).catch(() => {});
      }
    }
  }
  try {
    const archiveStream = buildZipArchiveOutputStream(payload);
    const chunks = [];
    for await (const chunk of archiveStream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const archiveBuffer = Buffer.concat(chunks);
    return {
      archiveBytes: archiveBuffer.buffer.slice(
        archiveBuffer.byteOffset,
        archiveBuffer.byteOffset + archiveBuffer.byteLength
      ),
    };
  } finally {
    if (cleanupPaths.length > 0) {
      await cleanupStagedExportEntriesElectron({ paths: cleanupPaths }).catch(() => {});
    }
  }
}

async function createAndSaveZipArchiveElectron(payload) {
  const cleanupPaths = getArchiveEntryCleanupPaths(payload);
  const downloadsRoot = app.getPath('downloads');
  const relativeFolder = normalizeRelativeFolder(payload?.relativeFolder);
  const targetDir = relativeFolder ? path.join(downloadsRoot, relativeFolder) : downloadsRoot;
  await fs.promises.mkdir(targetDir, { recursive: true });

  const safeFileName = sanitizeFileName(payload?.fileName);
  const outputPath = await resolveUniqueFilePath(path.join(targetDir, safeFileName));

  try {
    const archiveStream = buildZipArchiveOutputStream(payload);
    await pipeline(archiveStream, fs.createWriteStream(outputPath));
  } catch (error) {
    await fs.promises.rm(outputPath, { force: true }).catch(() => {});
    throw error;
  } finally {
    if (cleanupPaths.length > 0) {
      await cleanupStagedExportEntriesElectron({ paths: cleanupPaths }).catch(() => {});
    }
  }

  const stats = await fs.promises.stat(outputPath);
  return {
    savedPath: outputPath,
    archiveBytes: stats.size,
    message: `Successfully saved to ${outputPath}`,
  };
}

function isAllowedExternalUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === 'https:') return true;
    if (isDev && parsed.protocol === 'http:') return true;
    return false;
  } catch {
    return false;
  }
}

function setupWindowStateCycle(win) {
  let cycleMode = 'windowed';
  let normalBounds = readWindowState() || win.getBounds();
  let suppressMaximizeEvent = false;
  let suppressUnmaximizeEvent = false;
  let suppressLeaveFullscreenEvent = false;
  let persistTimeout = null;

  const emitFullscreenState = () => {
    if (win.isDestroyed()) return;
    win.webContents.send('vdjv-window-fullscreen-changed', win.isFullScreen());
  };

  const persistNormalBounds = () => {
    if (!normalBounds) return;
    writeWindowState(normalBounds);
  };

  const schedulePersistNormalBounds = () => {
    if (persistTimeout) {
      clearTimeout(persistTimeout);
    }
    persistTimeout = setTimeout(() => {
      persistTimeout = null;
      persistNormalBounds();
    }, 120);
  };

  const captureNormalBounds = () => {
    if (!win.isMaximized() && !win.isFullScreen() && !win.isMinimized() && cycleMode !== 'pseudo-fullscreen') {
      normalBounds = win.getBounds();
      schedulePersistNormalBounds();
    }
  };

  const enterTrueFullscreen = () => {
    cycleMode = 'fullscreen';
    if (win.isFullScreen()) {
      emitFullscreenState();
      return;
    }
    if (win.isMaximized()) {
      suppressUnmaximizeEvent = true;
      win.unmaximize();
      setImmediate(() => {
        if (win.isDestroyed()) return;
        win.setFullScreen(true);
      });
      return;
    }
    win.setFullScreen(true);
  };

  const exitToWindowed = () => {
    cycleMode = 'windowed';
    const restoreBounds = normalBounds;
    if (win.isFullScreen()) {
      suppressLeaveFullscreenEvent = true;
      win.setFullScreen(false);
      setImmediate(() => {
        if (win.isDestroyed()) return;
        suppressUnmaximizeEvent = true;
        if (win.isMaximized()) win.unmaximize();
        if (restoreBounds) win.setBounds(restoreBounds);
      });
      return;
    }
    suppressUnmaximizeEvent = true;
    if (win.isMaximized()) win.unmaximize();
    if (restoreBounds) win.setBounds(restoreBounds);
    emitFullscreenState();
  };

  win.on('move', captureNormalBounds);
  win.on('resize', captureNormalBounds);
  win.on('close', () => {
    captureNormalBounds();
    if (persistTimeout) {
      clearTimeout(persistTimeout);
      persistTimeout = null;
    }
    persistNormalBounds();
  });

  // Cycle order on maximize button (Windows):
  // windowed -> maximized -> fullscreen -> windowed
  win.on('maximize', () => {
    if (suppressMaximizeEvent) {
      suppressMaximizeEvent = false;
      return;
    }

    if (cycleMode === 'windowed') {
      cycleMode = 'maximized';
    }
  });

  win.on('unmaximize', () => {
    if (suppressUnmaximizeEvent) {
      suppressUnmaximizeEvent = false;
      return;
    }
    if (cycleMode !== 'maximized') return;
    setImmediate(() => {
      if (win.isDestroyed()) return;
      enterTrueFullscreen();
    });
  });

  win.on('leave-full-screen', () => {
    if (suppressLeaveFullscreenEvent) {
      suppressLeaveFullscreenEvent = false;
      emitFullscreenState();
      return;
    }
    if (cycleMode !== 'fullscreen') return;
    exitToWindowed();
  });

  win.on('enter-full-screen', () => {
    cycleMode = 'fullscreen';
    emitFullscreenState();
  });

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = String(input.key || '').toUpperCase();
    if (key !== 'F11') return;
    event.preventDefault();

    if (win.isFullScreen()) {
      exitToWindowed();
      return;
    }

    if (win.isMaximized()) {
      enterTrueFullscreen();
      return;
    }

    suppressMaximizeEvent = true;
    cycleMode = 'maximized';
    win.maximize();
  });

  return {
    toggleFullscreen() {
      if (win.isFullScreen()) {
        exitToWindowed();
        return false;
      }
      enterTrueFullscreen();
      return true;
    },
    getFullscreenState() {
      return win.isFullScreen();
    },
    dispose() {
      if (persistTimeout) {
        clearTimeout(persistTimeout);
        persistTimeout = null;
      }
      persistNormalBounds();
    },
  };
}

function resolveWindowIconPath() {
  if (app.isPackaged) {
    const packagedIco = path.join(process.resourcesPath, 'icon.ico');
    if (fs.existsSync(packagedIco)) return packagedIco;

    const packagedPng = path.join(process.resourcesPath, 'icon.png');
    if (fs.existsSync(packagedPng)) return packagedPng;
  }

  const devIco = path.join(__dirname, '..', 'build', 'icon.ico');
  if (fs.existsSync(devIco)) return devIco;

  const devPng = path.join(__dirname, '..', 'build', 'icon.png');
  if (fs.existsSync(devPng)) return devPng;

  return undefined;
}

function createMainWindow() {
  const iconPath = resolveWindowIconPath();
  const persistedWindowState = readWindowState();
  mainWindow = new BrowserWindow({
    width: persistedWindowState?.width || DEFAULT_WINDOW_STATE.width,
    height: persistedWindowState?.height || DEFAULT_WINDOW_STATE.height,
    ...(Number.isFinite(persistedWindowState?.x) ? { x: persistedWindowState.x } : {}),
    ...(Number.isFinite(persistedWindowState?.y) ? { y: persistedWindowState.y } : {}),
    autoHideMenuBar: true,
    fullscreenable: true,
    icon: iconPath,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      devTools: isDev,
      preload: path.join(__dirname, 'preload.cjs'),
    },
    show: false,
  });

  // Remove app menu so Alt doesn't reveal File/Edit/View menu in production usage.
  Menu.setApplicationMenu(null);
  mainWindow.setMenuBarVisibility(false);
  mainWindow.removeMenu();

  const indexPath = path.join(__dirname, '..', 'dist', 'public', 'index.html');
  mainWindow.loadFile(indexPath);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;

    const key = String(input.key || '').toUpperCase();
    const hasCtrlOrCmd = Boolean(input.control || input.meta);

    // Reserve F11 for our custom window-state cycle, not the default Electron fullscreen toggle.
    if (key === 'F11') {
      event.preventDefault();
      return;
    }

    // Keep production users out of DevTools shortcuts.
    if (!isDev) {
      const devtoolsShortcut =
        key === 'F12' ||
        (hasCtrlOrCmd && input.shift && (key === 'I' || key === 'J')) ||
        (hasCtrlOrCmd && key === 'U');
      if (devtoolsShortcut) event.preventDefault();
    }
  });

  const windowStateControls = setupWindowStateCycle(mainWindow);

  ipcMain.removeHandler('vdjv-window-toggle-fullscreen');
  ipcMain.removeHandler('vdjv-window-get-fullscreen-state');
  ipcMain.removeHandler('vdjv-audio-transcode-mp3');
  ipcMain.removeHandler('vdjv-zip-create');
  ipcMain.removeHandler('vdjv-zip-create-save');
  ipcMain.removeHandler('vdjv-export-archive-job');
  ipcMain.removeHandler('vdjv-import-archive-job');
  ipcMain.removeHandler('vdjv-native-media-resolve');
  ipcMain.removeHandler('vdjv-native-media-write');
  ipcMain.removeHandler('vdjv-native-media-read');
  ipcMain.removeHandler('vdjv-native-media-delete');
  ipcMain.removeAllListeners('vdjv-system-memory-info');
  ipcMain.handle('vdjv-window-toggle-fullscreen', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    return windowStateControls.toggleFullscreen();
  });
  ipcMain.handle('vdjv-window-get-fullscreen-state', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    return windowStateControls.getFullscreenState();
  });
  ipcMain.handle('vdjv-audio-transcode-mp3', async (_event, payload) => {
    return await transcodeAudioToMp3Electron(payload);
  });
  ipcMain.handle('vdjv-zip-create', async (_event, payload) => {
    return await createZipArchiveElectron(payload);
  });
  ipcMain.handle('vdjv-zip-create-save', async (_event, payload) => {
    return await createAndSaveZipArchiveElectron(payload);
  });
  ipcMain.handle('vdjv-native-media-resolve', async (_event, payload) => {
    return await resolveNativeMediaDescriptorElectron(payload);
  });
  ipcMain.handle('vdjv-native-media-write', async (_event, payload) => {
    return await writeNativeMediaElectron(payload);
  });
  ipcMain.handle('vdjv-native-media-read', async (_event, payload) => {
    return await readNativeMediaElectron(payload);
  });
  ipcMain.handle('vdjv-native-media-delete', async (_event, payload) => {
    return await deleteNativeMediaElectron(payload);
  });
  ipcMain.on('vdjv-system-memory-info', (event) => {
    event.returnValue = {
      totalMemBytes: os.totalmem(),
      freeMemBytes: os.freemem(),
      cpuCount: Array.isArray(os.cpus()) ? os.cpus().length : 0,
    };
  });
  ipcMain.handle('vdjv-export-stage-entry', async (_event, payload) => {
    return await stageExportEntryElectron(payload);
  });
  ipcMain.handle('vdjv-export-cleanup-staged', async (_event, payload) => {
    return await cleanupStagedExportEntriesElectron(payload);
  });
  ipcMain.handle('vdjv-export-archive-job', async (_event, payload) => {
    return await exportArchiveJobElectron(payload);
  });
  ipcMain.handle('vdjv-import-archive-job', async (event, payload) => {
    return await importArchiveJobElectron(event.sender, payload);
  });
  ipcMain.handle('vdjv-save-file', async (_event, payload) => {
    return await saveFileElectron(payload);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    windowStateControls.dispose();
    ipcMain.removeHandler('vdjv-window-toggle-fullscreen');
    ipcMain.removeHandler('vdjv-window-get-fullscreen-state');
    ipcMain.removeHandler('vdjv-audio-transcode-mp3');
    ipcMain.removeHandler('vdjv-zip-create');
    ipcMain.removeHandler('vdjv-zip-create-save');
    ipcMain.removeHandler('vdjv-export-archive-job');
    ipcMain.removeHandler('vdjv-import-archive-job');
    ipcMain.removeHandler('vdjv-native-media-resolve');
    ipcMain.removeHandler('vdjv-native-media-write');
    ipcMain.removeHandler('vdjv-native-media-read');
    ipcMain.removeHandler('vdjv-native-media-delete');
    ipcMain.removeAllListeners('vdjv-system-memory-info');
    mainWindow = null;
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createMainWindow();
});

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.vdjv.samplerpad.desktop');
  }
  createMainWindow();
  if (!isPortableDataMode) {
    setupAutoUpdater({
      getMainWindow: () => mainWindow,
    });
  }
});

app.on('before-quit', () => {
  disposeAutoUpdater();
});



