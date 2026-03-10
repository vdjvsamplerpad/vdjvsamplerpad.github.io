import React from 'react';
import { useGlobalPlaybackManager } from './useGlobalPlaybackManager';

export function useIOSAudioOptimization() {
  const playbackManager = useGlobalPlaybackManager();

  const preUnlockForBankSwitch = React.useCallback(async () => {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (!isIOS) return;

    try {
      await playbackManager.preUnlockAudio();
    } catch {
    }
  }, [playbackManager]);

  const playPadOptimized = React.useCallback(async (padId: string) => {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (isIOS) {
      const iosService = (window as any).getIOSAudioService?.();
      if (iosService && !iosService.isUnlocked()) {
        await playbackManager.preUnlockAudio();
      }
    }

    playbackManager.playPad(padId);
  }, [playbackManager]);

  return {
    preUnlockForBankSwitch,
    playPadOptimized,
    isIOS: /iPad|iPhone|iPod/.test(navigator.userAgent)
  };
}

export function IOSAudioOptimizer({ children }: { children: React.ReactNode }) {
  const { preUnlockForBankSwitch } = useIOSAudioOptimization();
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

  React.useEffect(() => {
    if (!isIOS) return;

    const handleFirstInteraction = () => {
      preUnlockForBankSwitch();
      document.removeEventListener('touchstart', handleFirstInteraction);
      document.removeEventListener('click', handleFirstInteraction);
    };

    document.addEventListener('touchstart', handleFirstInteraction, { once: true });
    document.addEventListener('click', handleFirstInteraction, { once: true });

    return () => {
      document.removeEventListener('touchstart', handleFirstInteraction);
      document.removeEventListener('click', handleFirstInteraction);
    };
  }, [isIOS, preUnlockForBankSwitch]);

  return React.createElement(React.Fragment, null, children);
}
