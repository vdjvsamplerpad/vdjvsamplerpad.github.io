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
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './client/src'),
      },
    },
    build: {
      outDir: '../dist/public',
      emptyOutDir: true, 
      sourcemap: true,
      minify: 'terser',
      rollupOptions: {
        output: {
          manualChunks: {
            'react-vendor': ['react', 'react-dom'],
            'ui-vendor': ['@radix-ui/react-dialog', '@radix-ui/react-popover', '@radix-ui/react-select', '@radix-ui/react-switch', '@radix-ui/react-progress', '@radix-ui/react-checkbox', '@radix-ui/react-label', '@radix-ui/react-slider', '@radix-ui/react-toggle', '@radix-ui/react-tooltip'],
            'supabase-vendor': ['@supabase/supabase-js'],
            'utils-vendor': ['jszip', 'lucide-react', 'class-variance-authority', 'clsx', 'tailwind-merge'],
            'cmd-vendor': ['cmdk'],
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
