
const CACHE_NAME = 'vdjv-shell-cache-v5';
const APP_SHELL_URLS = [
  '/',
  '/index.html',
  '/ios/',
  '/android/',
  '/site.webmanifest',
  '/assets/logo.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-192.png',
  '/icons/maskable-512.png',
  '/icons/apple-touch-icon.png',
];

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
    const cachedShell = await cache.match('/index.html');
    return cachedShell || response;
  } catch {
    return (
      (await cache.match(request)) ||
      (await cache.match('/index.html')) ||
      (await cache.match('/'))
    );
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((response) => {
      if (response && response.ok && response.status !== 206) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  return cached || networkPromise || new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL_URLS))
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
      fetch(event.request).catch(() => new Response('Offline', { status: 503, statusText: 'Service Unavailable' }))
    );
    return;
  }

  if (isRangeRequest) {
    event.respondWith(fetch(event.request));
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
    caches.keys().then((cacheNames) => Promise.all(
      cacheNames.map((cacheName) => {
        if (cacheName !== CACHE_NAME) {
          return caches.delete(cacheName);
        }
        return Promise.resolve();
      })
    )).then(() => self.clients.claim())
  );
});
