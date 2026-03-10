import * as React from 'react';

export type ScrollFrameAnimatorHandle = {
  startAutoplay: () => void;
  stopAutoplay: () => void;
};

type ScrollFrameAnimatorProps = {
  frameCount: number;
  framePathBuilder: (index: number) => string;
  revealThreshold: number;
  onProgressChange?: (progress: number) => void;
  onAutoplayComplete?: () => void;
  autoplayEnabled: boolean;
  compactRunway: boolean;
  overlay?: React.ReactNode;
  overlayVisible?: boolean;
  topOverlay?: React.ReactNode;
  activeVersion?: string;
  tier?: 'high' | 'medium' | 'low' | 'lowest';
};

const BATCH_SIZE = 18;
const AUTOPLAY_DURATION_MS = 2500;

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const easeInOutCubic = (value: number) => (
  value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2
);

export const ScrollFrameAnimator = React.forwardRef<ScrollFrameAnimatorHandle, ScrollFrameAnimatorProps>(function ScrollFrameAnimator({
  frameCount,
  framePathBuilder,
  revealThreshold,
  onProgressChange,
  onAutoplayComplete,
  autoplayEnabled,
  compactRunway,
  overlay,
  overlayVisible = false,
  topOverlay,
  activeVersion,
  tier = 'high',
}, ref) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const framesRef = React.useRef<Array<HTMLImageElement | null>>([]);
  const drawnFrameRef = React.useRef<number>(-1);
  const progressRef = React.useRef<number>(0);
  const autoplayRafRef = React.useRef<number | null>(null);
  const autoplayInterruptGuardUntilRef = React.useRef(0);
  const pendingAutoplayRef = React.useRef(false);
  const isAutoplayingRef = React.useRef(false);
  const [ready, setReady] = React.useState(false);
  const [loadError, setLoadError] = React.useState('');
  const [loadProgress, setLoadProgress] = React.useState(0);
  const [uiProgress, setUiProgress] = React.useState(0);

  // Version Animation State
  const previousVersionRef = React.useRef<string>(activeVersion || 'V1');
  const versionTransitionRafRef = React.useRef<number | null>(null);
  const loadingVersionTransRef = React.useRef<boolean>(false);
  const activeVersionFrameRef = React.useRef<HTMLImageElement | null>(null);
  const sequenceCacheRef = React.useRef<Record<string, HTMLImageElement[]>>({});
  const versionAnimationRef = React.useRef<{
    frames: HTMLImageElement[];
    progress: number;
    reversed: boolean;
    active: boolean;
  }>({ frames: [], progress: 0, reversed: false, active: false });

  const prefetchSequence = React.useCallback((dir: string) => {
    if (sequenceCacheRef.current[dir]) return; // already init/fetched
    sequenceCacheRef.current[dir] = []; // mark as fetching
    const step = tier === 'high' ? 1 : tier === 'medium' ? 2 : 4;
    const framesToLoad: number[] = [];
    for (let i = 1; i <= 97; i += step) framesToLoad.push(i);
    if (framesToLoad[framesToLoad.length - 1] !== 97) framesToLoad.push(97);

    const pad = (n: number) => String(n).padStart(4, '0');
    const promises = framesToLoad.map(frameNum => {
      return new Promise<HTMLImageElement>((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(img); // Resolve broken gracefully
        img.src = `/frames/${dir}/frame-${pad(frameNum)}.webp`;
      });
    });
    Promise.all(promises).then(frames => {
      sequenceCacheRef.current[dir] = frames.filter(f => f.width > 0);
    });
  }, [tier]);

  const syncProgress = React.useCallback(
    (nextProgress: number) => {
      const clampedProgress = clamp(nextProgress);
      if (Math.abs(clampedProgress - progressRef.current) < 0.0005) return;
      progressRef.current = clampedProgress;
      setUiProgress(clampedProgress);
      onProgressChange?.(clampedProgress);
    },
    [onProgressChange],
  );

  const calculateScrollProgress = React.useCallback(() => {
    const container = containerRef.current;
    if (!container) return progressRef.current;
    const rect = container.getBoundingClientRect();
    const runway = rect.height - window.innerHeight;
    if (runway <= 0) return progressRef.current;
    return clamp(-rect.top / runway);
  }, []);

  const stopAutoplay = React.useCallback(() => {
    if (autoplayRafRef.current !== null) {
      window.cancelAnimationFrame(autoplayRafRef.current);
      autoplayRafRef.current = null;
    }
    isAutoplayingRef.current = false;
  }, []);

  const startAutoplay = React.useCallback(() => {
    if (!autoplayEnabled) {
      onAutoplayComplete?.();
      return;
    }

    if (!ready) {
      pendingAutoplayRef.current = true;
      return;
    }

    pendingAutoplayRef.current = false;
    stopAutoplay();
    syncProgress(0);
    isAutoplayingRef.current = true;
    autoplayInterruptGuardUntilRef.current = performance.now() + 700;
    const start = performance.now();

    const tick = (now: number) => {
      if (!isAutoplayingRef.current) return;
      const elapsed = now - start;
      const linearProgress = clamp(elapsed / AUTOPLAY_DURATION_MS);
      const nextProgress = easeInOutCubic(linearProgress);
      syncProgress(nextProgress);

      const container = containerRef.current;
      if (container) {
        const rect = container.getBoundingClientRect();
        const elementTop = rect.top + window.scrollY;
        const runway = rect.height - window.innerHeight;
        window.scrollTo({
          top: elementTop + runway * nextProgress,
          behavior: 'auto',
        });
      }

      if (linearProgress >= 1) {
        stopAutoplay();
        onAutoplayComplete?.();
        return;
      }
      autoplayRafRef.current = window.requestAnimationFrame(tick);
    };

    autoplayRafRef.current = window.requestAnimationFrame(tick);
  }, [autoplayEnabled, onAutoplayComplete, ready, stopAutoplay, syncProgress]);

  React.useImperativeHandle(ref, () => ({
    startAutoplay,
    stopAutoplay,
  }), [startAutoplay, stopAutoplay]);

  React.useEffect(() => {
    let cancelled = false;
    const frames = new Array<HTMLImageElement | null>(frameCount).fill(null);

    const loadFrame = (index: number): Promise<HTMLImageElement> =>
      new Promise((resolve, reject) => {
        const image = new Image();
        image.decoding = 'async';
        image.src = framePathBuilder(index);
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`Failed to load frame ${index + 1}`));
      });

    const preloadFrames = async () => {
      let loaded = 0;
      for (let offset = 0; offset < frameCount; offset += BATCH_SIZE) {
        const batchEnd = Math.min(offset + BATCH_SIZE, frameCount);
        const frameIndexes = Array.from({ length: batchEnd - offset }, (_, idx) => offset + idx);
        const settled = await Promise.allSettled(frameIndexes.map((frameIndex) => loadFrame(frameIndex)));
        for (let idx = 0; idx < settled.length; idx += 1) {
          const result = settled[idx];
          if (result.status === 'fulfilled') {
            frames[frameIndexes[idx]] = result.value;
            loaded += 1;
          }
        }
        if (cancelled) return;
        setLoadProgress(Math.round((loaded / frameCount) * 100));
      }

      if (cancelled) return;
      framesRef.current = frames;
      setReady(true);
      if (loaded < frameCount) {
        setLoadError('VDJV Sampler Pad App preview loaded with partial frames.');
      }
      syncProgress(calculateScrollProgress());
      if (pendingAutoplayRef.current) {
        window.requestAnimationFrame(() => {
          startAutoplay();
        });
      }
    };

    void preloadFrames();
    return () => {
      cancelled = true;
      stopAutoplay();
    };
  }, [calculateScrollProgress, frameCount, framePathBuilder, startAutoplay, stopAutoplay, syncProgress]);

  React.useEffect(() => {
    const onScroll = () => {
      if (isAutoplayingRef.current) return;
      syncProgress(calculateScrollProgress());
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    onScroll();
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [calculateScrollProgress, syncProgress]);

  React.useEffect(() => {
    const interrupt = () => {
      if (!isAutoplayingRef.current) return;
      if (performance.now() < autoplayInterruptGuardUntilRef.current) return;
      stopAutoplay();
      syncProgress(calculateScrollProgress());
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if ([' ', 'PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        interrupt();
      }
    };

    window.addEventListener('wheel', interrupt, { passive: true });
    window.addEventListener('touchstart', interrupt, { passive: true });
    window.addEventListener('pointerdown', interrupt, { passive: true });
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('wheel', interrupt);
      window.removeEventListener('touchstart', interrupt);
      window.removeEventListener('pointerdown', interrupt);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [calculateScrollProgress, stopAutoplay, syncProgress]);

  React.useEffect(() => {
    if (!activeVersion || activeVersion === previousVersionRef.current) return;
    const from = previousVersionRef.current;
    const to = activeVersion;
    previousVersionRef.current = to;

    if (versionTransitionRafRef.current) {
      cancelAnimationFrame(versionTransitionRafRef.current);
      versionTransitionRafRef.current = null;
    }

    if (compactRunway || tier === 'lowest') {
      return; // Skip complex version animations for extreme low-end devices
    }

    let cancelled = false;
    loadingVersionTransRef.current = true;

    const getTransitionConfig = (f: string, t: string) => {
      if (f === 'V1' && t === 'V2') return { dir: 'v2-v1', reverse: true };
      if (f === 'V2' && t === 'V1') return { dir: 'v2-v1', reverse: false };
      if (f === 'V1' && t === 'V3') return { dir: 'v3-v1', reverse: true };
      if (f === 'V3' && t === 'V1') return { dir: 'v3-v1', reverse: false };
      if (f === 'V2' && t === 'V3') return { dir: 'v2-v3', reverse: false };
      if (f === 'V3' && t === 'V2') return { dir: 'v2-v3', reverse: true };
      return null;
    };

    const config = getTransitionConfig(from, to);
    if (!config) return;

    const step = tier === 'high' ? 1 : tier === 'medium' ? 2 : 4;
    const totalResourceFrames = 97;
    const framesToLoad: number[] = [];
    for (let i = 1; i <= totalResourceFrames; i += step) {
      framesToLoad.push(i);
    }
    if (framesToLoad[framesToLoad.length - 1] !== totalResourceFrames) {
      framesToLoad.push(totalResourceFrames);
    }

    const pad = (n: number) => String(n).padStart(4, '0');

    const loadPromises = framesToLoad.map(frameNum => {
      return new Promise<HTMLImageElement>((resolve, fail) => {
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => resolve(img);
        img.onerror = () => fail();
        img.src = `/frames/${config.dir}/frame-${pad(frameNum)}.webp`;
      });
    });

    // Prefetch the target native scroll-array securely so it's ready when user scrolls up
    if (to === 'V2') prefetchSequence('v2-v1');
    if (to === 'V3') prefetchSequence('v2-v3');

    Promise.all(loadPromises).then(loadedFrames => {
      if (cancelled) return;
      loadingVersionTransRef.current = false;
      sequenceCacheRef.current[config.dir] = loadedFrames;

      versionAnimationRef.current = {
        frames: loadedFrames,
        progress: 0,
        reversed: config.reverse,
        active: true
      };

      const durationMs = 800; // Snappy fast-switch transition time
      const start = performance.now();

      const tick = (now: number) => {
        if (cancelled) return;
        let p = (now - start) / durationMs;
        if (p >= 1) {
          p = 1;
          versionAnimationRef.current.progress = p;
          versionAnimationRef.current.active = false;
        } else {
          versionAnimationRef.current.progress = easeInOutCubic(p);
          versionTransitionRafRef.current = requestAnimationFrame(tick);
        }
      };
      versionTransitionRafRef.current = requestAnimationFrame(tick);

    }).catch(() => {
      loadingVersionTransRef.current = false;
    });

    return () => {
      cancelled = true;
      if (versionTransitionRafRef.current) {
        cancelAnimationFrame(versionTransitionRafRef.current);
      }
    };
  }, [activeVersion, tier, compactRunway]);

  React.useEffect(() => {
    let rafId = 0;

    const drawFrame = () => {
      if (!ready) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const context = canvas.getContext('2d');
      if (!context) return;

      let frameToDraw: HTMLImageElement | null = null;
      let frameIdentifier = -1;

      if (progressRef.current < 0.999 && !versionAnimationRef.current.active) {
        // Dynamic Core Runway Scroll Mode based on active version
        let framesToUse = framesRef.current;
        let p = progressRef.current;
        let selectedSequence = '';

        if (activeVersion === 'V3') {
          selectedSequence = 'v2-v3';
          p = progressRef.current; // at 1.0 (bottom) = frame 96 (V3). at 0.0 (top) = frame 0 (V2).
        } else if (activeVersion === 'V2') {
          selectedSequence = 'v2-v1';
          p = 1 - progressRef.current; // at 1.0 (bottom) = frame 0 (V2). at 0.0 (top) = frame 96 (V1)
        } // V1 naturally uses main runway forward (1.0 = frame 96)

        if (selectedSequence) {
          if (sequenceCacheRef.current[selectedSequence] && sequenceCacheRef.current[selectedSequence].length > 0) {
            framesToUse = sequenceCacheRef.current[selectedSequence];
          } else {
            // Cache Miss Override: Freeze at the last frame rather than violently snapping back to V1
            if (activeVersionFrameRef.current) {
              frameToDraw = activeVersionFrameRef.current;
              frameIdentifier = 50000;
              prefetchSequence(selectedSequence); // Recovery prefetch
            }
          }
        }

        if (!frameToDraw) {
          const frameIndex = Math.round(p * (framesToUse.length - 1));
          frameToDraw = framesToUse[frameIndex];
          frameIdentifier = (activeVersion === 'V2' ? 30000 : activeVersion === 'V3' ? 40000 : 0) + frameIndex;
        }

        // Wipe cached activeVersion if user starts scrolling fully back up natively (reset)
        if (progressRef.current < 0.8) {
          activeVersionFrameRef.current = null;
        }
      } else if (versionAnimationRef.current.active && versionAnimationRef.current.frames.length > 0) {
        // Version Animation Mode
        const { frames, progress, reversed } = versionAnimationRef.current;
        const effectiveProgress = reversed ? 1 - progress : progress;
        const frameIndex = Math.round(effectiveProgress * (frames.length - 1));
        frameToDraw = frames[frameIndex];
        frameIdentifier = 10000 + frameIndex; // arbitrary offset to force redraw logic tracking
        activeVersionFrameRef.current = frameToDraw;
      } else if (activeVersionFrameRef.current) {
        // Held State after Version Animation
        frameToDraw = activeVersionFrameRef.current;
        frameIdentifier = 20000;
      } else {
        // Default Default State for end of runway
        frameToDraw = framesRef.current[frameCount - 1];
        frameIdentifier = frameCount - 1;
      }

      if (!frameToDraw) return;

      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const targetWidth = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      const targetHeight = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      const resized = canvas.width !== targetWidth || canvas.height !== targetHeight;
      if (resized) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
      }

      if (!resized && drawnFrameRef.current === frameIdentifier) return;

      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);

      const availableWidth = canvas.clientWidth;
      const availableHeight = canvas.clientHeight;
      const imageRatio = frameToDraw.width / frameToDraw.height;
      const canvasRatio = availableWidth / availableHeight;
      const drawWidth = canvasRatio > imageRatio ? availableHeight * imageRatio : availableWidth;
      const drawHeight = canvasRatio > imageRatio ? availableHeight : availableWidth / imageRatio;
      const drawX = (availableWidth - drawWidth) / 2;
      const drawY = (availableHeight - drawHeight) / 2;
      context.drawImage(frameToDraw, drawX, drawY, drawWidth, drawHeight);
      drawnFrameRef.current = frameIdentifier;
    };

    const tick = () => {
      drawFrame();
      rafId = window.requestAnimationFrame(tick);
    };
    rafId = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [frameCount, ready]);


  const runwayClass = compactRunway ? 'lp-scroll-runway compact' : 'lp-scroll-runway';
  const visibleOverlay = overlayVisible;

  return (
    <div ref={containerRef} className={runwayClass}>
      <div className="lp-sticky-scene">
        <div className="lp-canvas-stage">
          <canvas ref={canvasRef} className="lp-frame-canvas" aria-label="App product animation" />
          <div className="lp-progress-track" aria-hidden="true">
            <div className="lp-progress-fill" style={{ width: `${Math.round(uiProgress * 100)}%` }} />
          </div>
        </div>

        {!ready && (
          <div className="lp-loader-overlay" role="status" aria-live="polite">
            <div className="lp-loader-chip">Preparing VDJV Sampler Pad App Preview</div>
            <div className="lp-loader-value">{loadProgress}%</div>
          </div>
        )}

        {loadError && <div className="lp-load-error">{loadError}</div>}

        <div className={`lp-top-overlay ${visibleOverlay ? 'is-hidden' : ''}`}>{topOverlay}</div>
        <div className={`lp-overlay-controls ${visibleOverlay ? 'is-visible' : ''}`}>{overlay}</div>
      </div>
    </div>
  );
});
