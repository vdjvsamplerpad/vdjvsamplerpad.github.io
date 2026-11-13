
const CACHE_NAME = 'vdjv-shell-cache-1.06.21.26.0053';
const BUILD_PRECACHE_URLS = (() => {
  const raw = '["/","/assets/AccountUpgradeDialog-BiIPuFx-.js","/assets/AccountUpgradeDialog-DNR3SzyO.js","/assets/AdminAccessDialog-DBzlCyP7.js","/assets/AdminAccessDialog-VVlqUcM0.js","/assets/AppSettingsDialog-BXRsNqcR.js","/assets/AppSettingsDialog-zwIqm2Wh.js","/assets/AudioAdmission-CjZpWhYO.js","/assets/BankEditDialog-BQg9nNO1.js","/assets/BankEditDialog-CC60xVZZ.js","/assets/HeaderAdminDebugPanel-CYCijBBi.js","/assets/HeaderAdminDebugPanel-DWCT67qF.js","/assets/InstallerDownloadRedirectPage-DNqOL2az.js","/assets/InstallerDownloadRedirectPage-JfpvSDbH.js","/assets/LandingPage-B7ng9Ldx.js","/assets/LandingPage-BOgRNVip.js","/assets/LegalPageLayout-2UwGfCnB.js","/assets/LegalPageLayout-8GmtXziM.js","/assets/LoginModal-BdpWbOoi.js","/assets/LoginModal-C6O4jP1E.js","/assets/OnlineBankStoreDialog-CxDTcExA.js","/assets/OnlineBankStoreDialog-DHOasjD_.js","/assets/PadEditDialog-BoLk_yB4.js","/assets/PadEditDialog-CyxDY7KY.js","/assets/PadTransferDialog-DqhTK5ie.js","/assets/PricingPage-DD_K48oW.js","/assets/PricingPage-tw3XZ1yE.js","/assets/PrivacyPage-Ba7cDOQE.js","/assets/PrivacyPage-rzJLMOJc.js","/assets/SamplerPadAppDialogs-CfLff5tD.js","/assets/SamplerRouteApp-BKeJ7C4K.js","/assets/SamplerRouteApp-C4nHL2zL.js","/assets/SideMenu-C0kJxona.js","/assets/SideMenu-Dlc0DATi.js","/assets/TermsPage-DN1SpzL4.js","/assets/TermsPage-DqdXRTjH.js","/assets/VersionSelector-CbsADI08.js","/assets/VolumeMixer-BpEaGNxM.js","/assets/account-tier-content-CXuQthCj.js","/assets/action-group-XaeqnKJt.js","/assets/admin-bank-utils-C6IorHhH.js","/assets/admin-bank-utils-D9XP_lgp.js","/assets/audio-engine-C6RQP_Mb.js","/assets/audioPadNormalization-sgl3wksr.js","/assets/client-crash-report-DW7hLHje.js","/assets/client-crash-report-GoGD6HZ1.js","/assets/confirmation-dialog-BCvva0a3.js","/assets/device-profiles-B33d9eBn.js","/assets/download-config-BgT9NXu6.js","/assets/electronArchiveJob-C22QCxE6.js","/assets/esm-Bqf7NO7Z.js","/assets/esm-CCtU3vew.js","/assets/esm-CgZxytIZ.js","/assets/esm-DDuv8pMU.js","/assets/esm-NvVHaBao.js","/assets/esm-OcAEecFV.js","/assets/help-tooltip-0t5LEjUe.js","/assets/image-upload-Dx0fyLXy.js","/assets/index-BMawObnN.js","/assets/index-CAOE65G5.js","/assets/index-vspyXI-g.css","/assets/ios-audio-service-C6UEoRRT.js","/assets/keyboard-shortcuts-DcDnJnt_.js","/assets/led-colors-C80BEb27.js","/assets/legal-content-CEmWMqeF.js","/assets/mobile-wallet-links-BG7KCR8N.js","/assets/mobile-wallet-links-DpDjXsne.js","/assets/native-bank-import-BN_X8LrA.js","/assets/native-bank-import-X1QEzuXP.js","/assets/padColorPalette-DP-Do8Wf.js","/assets/padDragTransfer-Ce1krt0n.js","/assets/padDragTransfer-SMdhlFnO.js","/assets/popover-C29G7A5Q.js","/assets/preparedAudio-RVFUjwA6.js","/assets/progress-CXzp7vhd.js","/assets/progress-dialog-Bevb1zR7.js","/assets/progress-dialog-CgIJaiwu.js","/assets/react-vendor-BuOWn9hb.js","/assets/receipt-ocr-Ch1VAOIq.js","/assets/receipt-ocr-Wn1b0Rc3.js","/assets/rolldown-runtime-Djccxexk.js","/assets/samplerAppConfig-DJq8XTzb.js","/assets/samplerAppConfig-DOA-4VvJ.js","/assets/select-DNjwoUU0.js","/assets/slider-BR8oirNH.js","/assets/src-C1z3SpV_.js","/assets/store-asset-upload-C1l2EA48.js","/assets/store-asset-upload-kTwnjTdz.js","/assets/supabase-DXNH3x_9.js","/assets/supabase-n7mBErd6.js","/assets/supabase-vendor-BRen5-hO.js","/assets/supportDiagnostics-BkapWrv8.js","/assets/supportDiagnostics-P8ovOraz.js","/assets/system-mappings-DGCwTbtz.js","/assets/ui-vendor-DnNza5Wl.js","/assets/useGlobalPlaybackManager-BmM38C7o.js","/assets/useGlobalPlaybackManager-GaeTZn3E.js","/assets/useOnlineStoreDownloadTransfer-4hUxS6ED.js","/assets/useOnlineStoreDownloadTransfer-sT2cMRde.js","/assets/useSamplerStore.backupPipelines-leua64Z_.js","/assets/useSamplerStore.bankDuplication-OqJIc2i0.js","/assets/useSamplerStore.bankIdentity-CSnw8zJv.js","/assets/useSamplerStore.exportAdminBank-DiKE_Q2S.js","/assets/useSamplerStore.exportAdminBank-lNGiePoV.js","/assets/useSamplerStore.exportBank-Q3ToA9X0.js","/assets/useSamplerStore.idbStorage-BeZipdtL.js","/assets/useSamplerStore.import.worker-k_kyytTf.js","/assets/useSamplerStore.importBank-D8dG_Z4r.js","/assets/useSamplerStore.importBank-TtVZBgZV.js","/assets/useSamplerStore.importErrors-BAzhyz_C.js","/assets/useSamplerStore.operationDiagnostics-C4KtfpUK.js","/assets/useSamplerStore.provenance-DtZ61daT.js","/assets/useSamplerStore.snapshotMetadata-bTv_6ERe.js","/assets/useSamplerStore.updateStoreBank-BD507qRl.js","/assets/useSamplerStore.updateStoreBank-DEyFJiUa.js","/assets/utils-vendor-iRij_y69.js","/assets/waveform-peaks-BxS_RQEa.js","/assets/web-B6sjlDBo.js","/assets/web-C28FzftS.js","/assets/web-CoJsY0SQ.js","/assets/web-D6xfwKVM.js","/assets/web-DEAy121x.js","/assets/web-DHjF28xI.js","/assets/web-SNzkESYo.js","/assets/web-whH0txrK.js","/index.html","/vdjv/","/vdjv/index.html","/version.json"]';
  if (!raw || raw.startsWith('__VDJV_')) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((url) => typeof url === 'string' && url.startsWith('/')) : [];
  } catch {
    return [];
  }
})();
const APP_SHELL_URLS = [
  '/',
  '/index.html',
  '/vdjv/',
  '/vdjv/index.html',
  '/ios/',
  '/android/',
  '/version.json',
  '/site.webmanifest',
  '/assets/logo.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-192.png',
  '/icons/maskable-512.png',
  '/icons/apple-touch-icon.png',
];
const PRECACHE_URLS = Array.from(new Set([...APP_SHELL_URLS, ...BUILD_PRECACHE_URLS]));
const SHELL_CACHE_PREFIX = 'vdjv-shell-cache-';

const STATIC_ASSET_EXTENSIONS = new Set([
  '.js',
  '.css',
  '.png',
  '.jpg',
  '.jpeg',
  '.svg',
  '.webp',
  '.ico',
  '.json',
  '.webmanifest',
  '.woff',
  '.woff2',
]);

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function isApiRequest(url) {
  return (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/functions/') ||
    url.pathname.includes('/functions/v1/')
  );
}

function isStaticAsset(url) {
  const pathname = url.pathname.toLowerCase();
  for (const extension of STATIC_ASSET_EXTENSIONS) {
    if (pathname.endsWith(extension)) return true;
  }
  return pathname.startsWith('/assets/') || pathname.startsWith('/icons/');
}

function offlineHtmlResponse() {
  return new Response(
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VDJV Offline</title><style>html{background:#0b1020;color:#f8fafc;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}.card{max-width:420px;border:1px solid rgba(255,255,255,.18);border-radius:20px;background:rgba(255,255,255,.08);padding:24px;box-shadow:0 24px 80px rgba(0,0,0,.35)}h1{margin:0 0 10px;font-size:22px}p{margin:0;color:rgba(248,250,252,.72);line-height:1.5}</style></head><body><main class="card"><h1>Offline shell is not ready</h1><p>Open VDJV online once, wait for Offline mode is ready, then try again. Local saved banks remain on this device when the app shell is cached.</p></main></body></html>',
    {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    }
  );
}

function offlineTextResponse(message = 'Offline') {
  return new Response(message, {
    status: 503,
    statusText: 'Service Unavailable',
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function candidateShellCacheNames() {
  const cacheNames = await caches.keys();
  return [
    CACHE_NAME,
    ...cacheNames.filter((cacheName) => cacheName !== CACHE_NAME && cacheName.startsWith(SHELL_CACHE_PREFIX)),
  ];
}

async function matchShellCache(requestOrUrl) {
  const cacheNames = await candidateShellCacheNames();
  for (const cacheName of cacheNames) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(requestOrUrl);
    if (cached) return cached;
  }
  return null;
}

async function precacheUrls(urls) {
  const cache = await caches.open(CACHE_NAME);
  const results = await Promise.allSettled(
    urls.map(async (url) => {
      const request = new Request(url, { cache: 'reload', credentials: 'same-origin' });
      const response = await fetch(request);
      if (!response || !response.ok || response.status === 206) return { url, ok: false };
      await cache.put(url, response.clone());
      return { url, ok: true };
    })
  );
  return results.map((result, index) => (
    result.status === 'fulfilled'
      ? result.value
      : { url: urls[index], ok: false, error: result.reason instanceof Error ? result.reason.message : 'fetch failed' }
  ));
}

async function verifyOfflineShellCache() {
  const requiredUrls = Array.from(new Set([
    '/',
    '/index.html',
    '/vdjv/',
    '/vdjv/index.html',
    ...BUILD_PRECACHE_URLS,
  ]));
  const missing = [];
  for (const url of requiredUrls) {
    const cached = await matchShellCache(url);
    if (!cached) missing.push(url);
  }
  return {
    ready: missing.length === 0,
    cacheName: CACHE_NAME,
    checked: requiredUrls.length,
    missing,
  };
}

async function networkFirstNavigation(request) {
  const url = new URL(request.url);
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      if (url.pathname === '/' || url.pathname === '/index.html') {
        cache.put('/index.html', response.clone());
      } else {
        cache.put(request, response.clone());
      }
      return response;
    }
    const cachedShell =
      (await matchShellCache(request)) ||
      (await matchShellCache('/index.html')) ||
      (await matchShellCache('/')) ||
      (await matchShellCache('/vdjv/index.html'));
    return cachedShell || response || offlineHtmlResponse();
  } catch {
    return (
      (await matchShellCache(request)) ||
      (await matchShellCache('/index.html')) ||
      (await matchShellCache('/')) ||
      (await matchShellCache('/vdjv/index.html')) ||
      offlineHtmlResponse()
    );
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = (await cache.match(request)) || (await matchShellCache(request));
  const networkPromise = fetch(request)
    .then((response) => {
      if (response && response.ok && response.status !== 206) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) return cached;
  const networkResponse = await networkPromise;
  return networkResponse || (await matchShellCache(request)) || offlineTextResponse();
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    precacheUrls(PRECACHE_URLS)
  );
  self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  const url = new URL(event.request.url);
  const isNavigation = event.request.mode === 'navigate';
  const isApiPath = isApiRequest(url);
  const hasAuthHeader = event.request.headers.has('authorization');
  const isRangeRequest = event.request.headers.has('range');

  if (!isSameOrigin(url) && !isNavigation) {
    return;
  }

  if (isNavigation) {
    event.respondWith(networkFirstNavigation(event.request));
    return;
  }

  if (isApiPath || hasAuthHeader) {
    event.respondWith(
      fetch(event.request).catch(() => offlineTextResponse())
    );
    return;
  }

  if (isRangeRequest) {
    event.respondWith(fetch(event.request).catch(() => offlineTextResponse('Offline media range unavailable')));
    return;
  }

  const isDevServerFile = url.pathname.startsWith('/@vite/') ||
      url.pathname.startsWith('/@react-refresh') ||
      (url.pathname.includes('?t=') && (url.pathname.includes('/src/') || url.pathname.includes('/node_modules/')));

  if (isDevServerFile) {
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(staleWhileRevalidate(event.request));
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      const recentShellCaches = cacheNames
        .filter((cacheName) => cacheName !== CACHE_NAME && cacheName.startsWith(SHELL_CACHE_PREFIX))
        .sort()
        .slice(-2);
      const retainedShellCaches = new Set([CACHE_NAME, ...recentShellCaches]);
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (!retainedShellCaches.has(cacheName)) {
            return caches.delete(cacheName);
          }
          return Promise.resolve();
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (event.data && event.data.type === 'VDJV_PREPARE_OFFLINE_READY') {
    const port = event.ports && event.ports[0];
    event.waitUntil((async () => {
      await precacheUrls(PRECACHE_URLS);
      const result = await verifyOfflineShellCache();
      if (port) port.postMessage({ type: 'VDJV_OFFLINE_READY_RESULT', ...result });
    })().catch((error) => {
      if (port) {
        port.postMessage({
          type: 'VDJV_OFFLINE_READY_RESULT',
          ready: false,
          cacheName: CACHE_NAME,
          checked: 0,
          missing: [],
          error: error instanceof Error ? error.message : 'Offline preparation failed',
        });
      }
    }));
    return;
  }
  if (event.data && event.data.type === 'VDJV_VERIFY_OFFLINE_READY') {
    const port = event.ports && event.ports[0];
    event.waitUntil(verifyOfflineShellCache().then((result) => {
      if (port) port.postMessage({ type: 'VDJV_OFFLINE_READY_RESULT', ...result });
    }).catch((error) => {
      if (port) {
        port.postMessage({
          type: 'VDJV_OFFLINE_READY_RESULT',
          ready: false,
          cacheName: CACHE_NAME,
          checked: 0,
          missing: [],
          error: error instanceof Error ? error.message : 'Offline verification failed',
        });
      }
    }));
  }
});
