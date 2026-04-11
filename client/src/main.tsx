import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { clearChunkRecoveryAttempt, installChunkLoadRecovery } from '@/lib/chunk-load-recovery';
import { initProductAnalytics } from '@/lib/productAnalytics';
import { isNativeCapacitorRuntime } from '@/lib/runtime-routes';

function restoreSpaPathFromRedirect() {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  const restoredPath = params.get('p');
  if (!restoredPath) return;
  const normalizedPath = restoredPath.startsWith('/') ? restoredPath : `/${restoredPath}`;
  const forwardedSearch = params.get('q');
  const forwardedHash = params.get('h');
  const search = forwardedSearch ? `?${forwardedSearch}` : '';
  const hash = forwardedHash ? `#${forwardedHash}` : '';
  window.history.replaceState({}, '', `${normalizedPath}${search}${hash}`);
}

const isSecureContext = window.location.protocol === 'https:' || window.location.hostname === 'localhost';
if ('serviceWorker' in navigator && isSecureContext && !isNativeCapacitorRuntime() && __VDJV_INCLUDE_LANDING__) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(registration => {
    }).catch(registrationError => {
    });
  });
}

function applyPersistedThemeClass() {
  if (typeof window === 'undefined') return;
  const stored = localStorage.getItem('vdjv-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = stored === 'dark' || (stored !== 'light' && prefersDark);
  document.documentElement.classList.toggle('dark', isDark);
}

function setupGlobalGestureGuards() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  type TouchStartState = {
    startX: number;
    startY: number;
    fromEdge: boolean;
    target: EventTarget | null;
  };

  const EDGE_ZONE_PX = 28;
  const SWIPE_TRIGGER_PX = 14;
  const DOUBLE_TAP_ZOOM_WINDOW_MS = 320;
  const activeTouches = new Map<number, TouchStartState>();
  let lastTouchEndAtMs = 0;

  const isEditableTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof Element)) return false;
    return Boolean(
      target.closest(
        'input, textarea, select, [contenteditable="true"], [contenteditable=""], [data-allow-horizontal-swipe="true"], [role="slider"]'
      )
    );
  };

  const onTouchStart = (event: TouchEvent) => {
    const width = window.innerWidth || document.documentElement.clientWidth || 0;
    for (const touch of Array.from(event.changedTouches)) {
      const fromEdge = touch.clientX <= EDGE_ZONE_PX || touch.clientX >= Math.max(0, width - EDGE_ZONE_PX);
      activeTouches.set(touch.identifier, {
        startX: touch.clientX,
        startY: touch.clientY,
        fromEdge,
        target: event.target
      });
    }
  };

  const onTouchMove = (event: TouchEvent) => {
    if (event.touches.length > 1) {
      event.preventDefault();
      return;
    }
    for (const touch of Array.from(event.changedTouches)) {
      const start = activeTouches.get(touch.identifier);
      if (!start || !start.fromEdge || isEditableTarget(start.target)) continue;
      const dx = touch.clientX - start.startX;
      const dy = touch.clientY - start.startY;
      if (Math.abs(dx) > SWIPE_TRIGGER_PX && Math.abs(dx) > Math.abs(dy) * 1.15) {
        event.preventDefault();
        return;
      }
    }
  };

  const onTouchEnd = (event: TouchEvent) => {
    if (
      event.cancelable &&
      event.touches.length === 0 &&
      event.changedTouches.length === 1
    ) {
      const now = Date.now();
      const isRapidDoubleTap = now - lastTouchEndAtMs > 0 && now - lastTouchEndAtMs < DOUBLE_TAP_ZOOM_WINDOW_MS;
      lastTouchEndAtMs = now;

      if (isRapidDoubleTap) {
        const target = event.target;
        const allowDoubleTap = target instanceof Element && Boolean(
          target.closest(
            'input, textarea, select, [contenteditable=\"true\"], [contenteditable=\"\"], [data-allow-double-tap=\"true\"]'
          )
        );
        if (!allowDoubleTap) {
          event.preventDefault();
        }
      }
    }

    for (const touch of Array.from(event.changedTouches)) {
      activeTouches.delete(touch.identifier);
    }
  };

  const preventDefault = (event: Event) => {
    event.preventDefault();
  };

  const onWheel = (event: WheelEvent) => {
    if (event.ctrlKey) {
      event.preventDefault();
    }
  };

  document.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
  document.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
  document.addEventListener('touchend', onTouchEnd, { capture: true, passive: false });
  document.addEventListener('touchcancel', onTouchEnd, { capture: true, passive: true });
  document.addEventListener('gesturestart', preventDefault as EventListener, { capture: true, passive: false });
  document.addEventListener('gesturechange', preventDefault as EventListener, { capture: true, passive: false });
  document.addEventListener('gestureend', preventDefault as EventListener, { capture: true, passive: false });
  window.addEventListener('wheel', onWheel, { passive: false });
}

restoreSpaPathFromRedirect();
applyPersistedThemeClass();
setupGlobalGestureGuards();
installChunkLoadRecovery();
initProductAnalytics();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

window.setTimeout(() => {
  clearChunkRecoveryAttempt();
}, 0);
