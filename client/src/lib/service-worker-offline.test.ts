import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

type FetchListener = (event: {
  request: {
    method: string;
    url: string;
    mode?: string;
    headers: Headers;
  };
  respondWith: (response: Promise<Response> | Response) => void;
}) => void;

const loadServiceWorkerFetchListener = (fetchImpl: typeof fetch): FetchListener => {
  const listeners = new Map<string, Function>();
  const fakeCache = {
    match: vi.fn(async () => null),
    put: vi.fn(async () => undefined),
  };
  const fakeCaches = {
    keys: vi.fn(async () => [] as string[]),
    open: vi.fn(async () => fakeCache),
  };
  const fakeSelf = {
    location: { origin: 'https://vdjv.test' },
    clients: { claim: vi.fn(async () => undefined) },
    skipWaiting: vi.fn(),
    addEventListener: vi.fn((type: string, listener: Function) => {
      listeners.set(type, listener);
    }),
  };

  const source = readFileSync('client/public/sw.js', 'utf8');
  const factory = new Function('self', 'caches', 'fetch', 'Response', 'Request', 'URL', source);
  factory(fakeSelf, fakeCaches, fetchImpl, Response, Request, URL);
  const listener = listeners.get('fetch');
  if (!listener) throw new Error('Service Worker fetch listener was not registered.');
  return listener as FetchListener;
};

const runFetch = async (
  listener: FetchListener,
  request: { method: string; url: string; mode?: string; headers?: Headers }
): Promise<Response> => {
  let pendingResponse: Promise<Response> | Response | null = null;
  listener({
    request: {
      ...request,
      headers: request.headers || new Headers(),
    },
    respondWith: (response) => {
      pendingResponse = response;
    },
  });
  if (!pendingResponse) throw new Error('Service Worker did not call respondWith.');
  return await Promise.resolve(pendingResponse);
};

describe('service worker offline fallbacks', () => {
  it('returns an offline HTML response for navigation when network and cache are unavailable', async () => {
    const listener = loadServiceWorkerFetchListener(vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch);

    const response = await runFetch(listener, {
      method: 'GET',
      url: 'https://vdjv.test/vdjv/',
      mode: 'navigate',
    });

    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(503);
    await expect(response.text()).resolves.toContain('Offline shell is not ready');
  });

  it('returns a text offline response for uncached static assets when network fails', async () => {
    const listener = loadServiceWorkerFetchListener(vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch);

    const response = await runFetch(listener, {
      method: 'GET',
      url: 'https://vdjv.test/assets/missing.js',
      mode: 'same-origin',
    });

    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(503);
    await expect(response.text()).resolves.toBe('Offline');
  });
});
