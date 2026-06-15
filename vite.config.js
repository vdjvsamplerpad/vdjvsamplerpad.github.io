import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { execSync } from 'node:child_process';
import fs from 'node:fs';

export const vitePort = 3000;
const devCertDir = path.resolve(process.cwd(), '.cert');

const fallbackVersion = () => {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const yy = String(now.getFullYear()).slice(-2);
  const tt = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  return `1.${mm}.${dd}.${yy}.${tt}`;
};

const getCommitBasedVersion = () => {
  try {
    const stamp = execSync('git log -1 --format=%cd --date=format:%m.%d.%y.%H%M', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (stamp) return `1.${stamp}`;
  } catch {}
  return process.env.VITE_APP_VERSION || fallbackVersion();
};

const sanitizeVersionToken = (value) => String(value || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '-');

const writeVersionManifest = (distPublicDir, appVersion) => {
  fs.mkdirSync(distPublicDir, { recursive: true });
  fs.writeFileSync(
    path.join(distPublicDir, 'version.json'),
    JSON.stringify(
      {
        appVersion,
        builtAt: new Date().toISOString(),
      },
      null,
      2
    )
  );
};

const copySamplerEntryShell = (distPublicDir) => {
  const sourceIndexPath = path.join(distPublicDir, 'index.html');
  if (!fs.existsSync(sourceIndexPath)) return;
  const samplerDir = path.join(distPublicDir, 'vdjv');
  fs.mkdirSync(samplerDir, { recursive: true });
  fs.copyFileSync(sourceIndexPath, path.join(samplerDir, 'index.html'));
};

const escapeForSingleQuotedJs = (value) =>
  String(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');

const collectBuildPrecacheUrls = (distPublicDir) => {
  const urls = new Set([
    '/',
    '/index.html',
    '/vdjv/',
    '/vdjv/index.html',
    '/version.json',
  ]);
  const assetsDir = path.join(distPublicDir, 'assets');
  const cacheableExtensions = new Set(['.js', '.css', '.woff', '.woff2']);

  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (!cacheableExtensions.has(ext)) continue;
      const relativePath = path.relative(distPublicDir, fullPath).replace(/\\/g, '/');
      urls.add(`/${relativePath}`);
    }
  };

  walk(assetsDir);
  return Array.from(urls).sort();
};

const rewriteServiceWorkerMetadata = (distPublicDir, appVersion) => {
  const serviceWorkerPath = path.join(distPublicDir, 'sw.js');
  if (!fs.existsSync(serviceWorkerPath)) return;
  const raw = fs.readFileSync(serviceWorkerPath, 'utf8');
  const buildPrecacheJson = JSON.stringify(collectBuildPrecacheUrls(distPublicDir));
  const next = raw
    .replace(/__VDJV_SHELL_CACHE__/g, `vdjv-shell-cache-${sanitizeVersionToken(appVersion)}`)
    .replace(/__VDJV_BUILD_PRECACHE__/g, escapeForSingleQuotedJs(buildPrecacheJson));
  fs.writeFileSync(serviceWorkerPath, next);
};

const resolveDevHttps = (env) => {
  const wantsHttps = env.VITE_DEV_HTTPS === 'true' || env.HTTPS === 'true';
  if (!wantsHttps) return undefined;

  const resolveExistingPath = (rawPath) => {
    if (!rawPath) return null;
    const absolutePath = path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath);
    return fs.existsSync(absolutePath) ? absolutePath : null;
  };

  const envKeyPath = resolveExistingPath(env.VITE_DEV_HTTPS_KEY);
  const envCertPath = resolveExistingPath(env.VITE_DEV_HTTPS_CERT);
  if (envKeyPath && envCertPath) {
    return {
      key: fs.readFileSync(envKeyPath),
      cert: fs.readFileSync(envCertPath),
    };
  }

  if (fs.existsSync(devCertDir)) {
    const certFiles = fs.readdirSync(devCertDir);
    const preferredPairs = [
      ['localhost-key.pem', 'localhost.pem'],
      ['dev-key.pem', 'dev.pem'],
    ];

    for (const [keyFile, certFile] of preferredPairs) {
      const keyPath = path.join(devCertDir, keyFile);
      const certPath = path.join(devCertDir, certFile);
      if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
        return {
          key: fs.readFileSync(keyPath),
          cert: fs.readFileSync(certPath),
        };
      }
    }

    for (const fileName of certFiles) {
      if (!fileName.endsWith('-key.pem')) continue;
      const baseName = fileName.slice(0, -'-key.pem'.length);
      const certName = `${baseName}.pem`;
      const certPath = path.join(devCertDir, certName);
      if (!fs.existsSync(certPath)) continue;
      const keyPath = path.join(devCertDir, fileName);
      return {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
      };
    }
  }

  return undefined;
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const isElectron = env.ELECTRON === 'true';
  const isCapacitor = env.CAPACITOR === 'true';
  const includeLanding = env.VITE_INCLUDE_LANDING === 'false' ? false : (!isElectron && !isCapacitor);
  const buildSourcemap = env.VITE_BUILD_SOURCEMAP === 'true';
  const requiredClientEnv = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'];
  const missingClientEnv = requiredClientEnv.filter((key) => !String(env[key] || '').trim());

  if (mode !== 'development' && missingClientEnv.length > 0) {
    throw new Error(`Missing required frontend env vars for build: ${missingClientEnv.join(', ')}`);
  }

  const base = isElectron ? './' : '/';
  const appVersion = getCommitBasedVersion();
  const devHttps = resolveDevHttps(env);
  const distPublicDir = path.resolve(__dirname, 'dist/public');
  
  return {
    root: 'client', 
    
    envDir: '../',

    base: base,
    define: {
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion),
      __VDJV_INCLUDE_LANDING__: JSON.stringify(includeLanding),
    },
    
    plugins: [
      react(),
      {
        name: 'handle-source-map-requests',
        apply: 'serve',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            if (req.url && req.url.endsWith('.map')) {
              const cleanUrl = req.url.split('?')[0];
              req.url = cleanUrl;
            }
            next();
          });
        },
      },
      {
        name: 'add-cors-headers',
        apply: 'serve',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
            if (req.method === 'OPTIONS') {
              res.statusCode = 200;
              res.end();
              return;
            }
            next();
          });
        },
      },
      {
        name: 'vdjv-landing-index-prune',
        transformIndexHtml(html) {
          if (includeLanding) return html;
          return html.replace(/\s*<link rel="manifest" href="\/site\.webmanifest" \/>\r?\n/g, '\n');
        },
      },
      {
        name: 'vdjv-prune-landing-assets',
        apply: 'build',
        closeBundle() {
          if (includeLanding) return;
          const pruneTargets = [
            'frames',
            'android',
            'ios',
            '404.html',
            'site.webmanifest',
            'sw.js',
          ];
          for (const target of pruneTargets) {
            const targetPath = path.join(distPublicDir, target);
            if (fs.existsSync(targetPath)) {
              fs.rmSync(targetPath, { recursive: true, force: true });
            }
          }
        },
      },
      {
        name: 'vdjv-web-build-metadata',
        apply: 'build',
        closeBundle() {
          writeVersionManifest(distPublicDir, appVersion);
          if (!includeLanding) return;
          copySamplerEntryShell(distPublicDir);
          rewriteServiceWorkerMetadata(distPublicDir, appVersion);
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './client/src'),
      },
    },
    build: {
      outDir: '../dist/public',
      emptyOutDir: true, 
      sourcemap: buildSourcemap,
      minify: 'terser',
      rollupOptions: {
        output: {
          manualChunks: (id) => {
            const normalizedId = id.replace(/\\/g, '/');
            if (normalizedId.includes('/node_modules/react/') || normalizedId.includes('/node_modules/react-dom/')) {
              return 'react-vendor';
            }
            if (
              normalizedId.includes('/node_modules/@radix-ui/react-dialog/') ||
              normalizedId.includes('/node_modules/@radix-ui/react-popover/') ||
              normalizedId.includes('/node_modules/@radix-ui/react-select/') ||
              normalizedId.includes('/node_modules/@radix-ui/react-switch/') ||
              normalizedId.includes('/node_modules/@radix-ui/react-progress/') ||
              normalizedId.includes('/node_modules/@radix-ui/react-checkbox/') ||
              normalizedId.includes('/node_modules/@radix-ui/react-label/') ||
              normalizedId.includes('/node_modules/@radix-ui/react-slider/') ||
              normalizedId.includes('/node_modules/@radix-ui/react-toggle/') ||
              normalizedId.includes('/node_modules/@radix-ui/react-tooltip/')
            ) {
              return 'ui-vendor';
            }
            if (normalizedId.includes('/node_modules/@supabase/supabase-js/')) return 'supabase-vendor';
            if (
              normalizedId.includes('/node_modules/jszip/') ||
              normalizedId.includes('/node_modules/lucide-react/') ||
              normalizedId.includes('/node_modules/class-variance-authority/') ||
              normalizedId.includes('/node_modules/clsx/') ||
              normalizedId.includes('/node_modules/tailwind-merge/')
            ) {
              return 'utils-vendor';
            }
            if (normalizedId.includes('/node_modules/cmdk/')) return 'cmd-vendor';
            return undefined;
          },
          chunkFileNames: (chunkInfo) => {
            return `assets/[name]-[hash].js`;
          },
        },
      },
      chunkSizeWarningLimit: 1000,
    },
    clearScreen: false,
    server: {
      hmr: { overlay: false },
      host: true,
      port: vitePort,
      https: devHttps,
      allowedHosts: true,
      cors: true,
      proxy: {
        '/api/': {
          target: 'http://localhost:3001',
          changeOrigin: true,
          secure: false,
        },
      },
    },
  };
});
