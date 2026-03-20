import * as React from 'react';

interface WindowSize {
  width: number;
  height: number;
}

export function useWindowSize(): WindowSize {
  const isDesktopRuntime = React.useMemo(() => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return true;
    const ua = navigator.userAgent || '';
    const isElectron = /Electron/i.test(ua) || Boolean((window as Window & { process?: { versions?: { electron?: string } } }).process?.versions?.electron);
    const isCapacitorNative = Boolean((window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.());
    const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
    return isElectron || (!isCapacitorNative && !isMobile);
  }, []);

  const readViewportSize = React.useCallback((): WindowSize => {
    if (typeof window === 'undefined') {
      return { width: 1024, height: 768 };
    }
    const visualViewport = window.visualViewport;
    const width = visualViewport?.width ?? window.innerWidth;
    const height = visualViewport?.height ?? window.innerHeight;
    return {
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height)),
    };
  }, []);

  const [windowSize, setWindowSize] = React.useState<WindowSize>({
    width: readViewportSize().width,
    height: readViewportSize().height,
  });

  React.useEffect(() => {
    if (typeof window === 'undefined') return;

    function handleResize() {
      const nextSize = readViewportSize();
      setWindowSize((prev) => (
        prev.width === nextSize.width && prev.height === nextSize.height
          ? prev
          : nextSize
      ));
    }

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    window.visualViewport?.addEventListener('resize', handleResize);
    if (!isDesktopRuntime) {
      window.visualViewport?.addEventListener('scroll', handleResize);
    }

    // Initialize with current viewport.
    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
      window.visualViewport?.removeEventListener('resize', handleResize);
      if (!isDesktopRuntime) {
        window.visualViewport?.removeEventListener('scroll', handleResize);
      }
    };
  }, [isDesktopRuntime, readViewportSize]);

  return windowSize;
}
