import * as React from 'react';

interface WindowSize {
  width: number;
  height: number;
}

export function useWindowSize(): WindowSize {
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
      setWindowSize(readViewportSize());
    }

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    window.visualViewport?.addEventListener('resize', handleResize);
    window.visualViewport?.addEventListener('scroll', handleResize);

    // Initialize with current viewport.
    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
      window.visualViewport?.removeEventListener('resize', handleResize);
      window.visualViewport?.removeEventListener('scroll', handleResize);
    };
  }, [readViewportSize]);

  return windowSize;
}
