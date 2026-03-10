import type { AudioEngineCore } from '../../../lib/audio-engine';
import { usesLegacyAudioRuntimePath, type AudioRuntimeStage } from './audioRuntimeStage';

const IS_CAPACITOR_NATIVE = typeof window !== 'undefined' &&
  Boolean((window as any).Capacitor?.isNativePlatform?.());

export type AudioRecoveryState = 'idle' | 'recovering' | 'blocked';

interface AudioRuntimeCoreHost {
  getAudioContext(): AudioContext | null;
  setAudioContext(context: AudioContext | null): void;
  getContextUnlocked(): boolean;
  setContextUnlocked(unlocked: boolean): void;
  getSilentAudio(): HTMLAudioElement | null;
  setSilentAudio(audio: HTMLAudioElement | null): void;
  getSharedIOSGainNode(): GainNode | null;
  setSharedIOSGainNode(node: GainNode | null): void;
  getMasterVolume(): number;
  getIsIOS(): boolean;
  getAudioRuntimeStage(): AudioRuntimeStage;
  getIOSAudioService(): any;
  getEngine(): AudioEngineCore;
  getIsPrewarmed(): boolean;
  setIsPrewarmed(value: boolean): void;
  connectLoadedChannelsToSharedIOSGraph(): void;
  notifyStateChange(immediate?: boolean): void;
}

export class AudioRuntimeCore {
  private readonly host: AudioRuntimeCoreHost;
  private foregroundUnlockTimeout: NodeJS.Timeout | null = null;
  private audioRecoveryState: AudioRecoveryState = 'idle';
  private nativeAppStateListenerReady = false;

  constructor(host: AudioRuntimeCoreHost) {
    this.host = host;
  }

  getAudioRecoveryState(): AudioRecoveryState {
    return this.audioRecoveryState;
  }

  handleForegroundResume(): void {
    if (typeof document !== 'undefined' && document.hidden) return;
    if (this.foregroundUnlockTimeout) {
      clearTimeout(this.foregroundUnlockTimeout);
    }
    this.foregroundUnlockTimeout = setTimeout(() => {
      if (!this.host.getContextUnlocked() && !this.hasUserActivation()) {
        return;
      }
      this.preUnlockAudio().catch(() => {
      });
    }, 60);
  }

  setupNativeAppStateListener(): void {
    if (this.nativeAppStateListenerReady || typeof window === 'undefined') return;
    const capacitor = (window as any).Capacitor;
    if (!capacitor?.isNativePlatform?.()) return;
    const appPlugin = capacitor?.Plugins?.App;
    if (!appPlugin?.addListener) return;

    this.nativeAppStateListenerReady = true;
    Promise.resolve(
      appPlugin.addListener('appStateChange', ({ isActive }: { isActive: boolean }) => {
        if (!isActive) return;
        this.preUnlockAudio().catch(() => {
        });
      })
    ).catch(() => {
      this.nativeAppStateListenerReady = false;
    });
  }

  initializeAudioContext(): void {
    if (this.host.getAudioContext()) return;

    try {
      if (this.host.getIsIOS() && this.host.getIOSAudioService()) {
        this.host.setAudioContext(this.host.getIOSAudioService().getAudioContext());
        this.host.setContextUnlocked(this.host.getIOSAudioService().isUnlocked());
        if (this.host.getContextUnlocked()) {
          this.setupSharedIOSNodes();
        }
        return;
      }

      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const latencyHint: AudioContextLatencyCategory = IS_CAPACITOR_NATIVE ? 'balanced' : 'interactive';
      this.host.setAudioContext(new AudioContextClass({
        latencyHint
      }));

      if (this.host.getIsIOS()) {
        this.createSilentAudio();
        this.setupSharedIOSNodes();
      }
      if (!this.host.getContextUnlocked()) this.setupAudioContextUnlock();
    } catch {
    }
  }

  setupSharedIOSNodes(): void {
    const audioContext = this.host.getAudioContext();
    if (!audioContext || this.host.getSharedIOSGainNode()) return;

    try {
      const sharedIOSGainNode = audioContext.createGain();
      sharedIOSGainNode.gain.setValueAtTime(this.host.getMasterVolume(), audioContext.currentTime);
      sharedIOSGainNode.connect(audioContext.destination);
      this.host.setSharedIOSGainNode(sharedIOSGainNode);
      this.host.connectLoadedChannelsToSharedIOSGraph();
    } catch {
    }
  }

  disablePitchPreservation(audio: HTMLAudioElement): void {
    const el = audio as HTMLAudioElement & {
      preservesPitch?: boolean;
      mozPreservesPitch?: boolean;
      webkitPreservesPitch?: boolean;
    };
    if ('preservesPitch' in el) el.preservesPitch = false;
    if ('mozPreservesPitch' in el) el.mozPreservesPitch = false;
    if ('webkitPreservesPitch' in el) el.webkitPreservesPitch = false;
  }

  async preUnlockAudio(): Promise<void> {
    if (!usesLegacyAudioRuntimePath(this.host.getAudioRuntimeStage())) {
      this.setAudioRecoveryState('recovering');
      try {
        await this.host.getEngine().preUnlock();
        await this.preUnlockLegacyCompatAudio();
        const contextState = this.host.getEngine().getEngineHealth().contextState;
        if (contextState === 'running' || this.host.getContextUnlocked()) {
          this.setAudioRecoveryState('idle');
        } else {
          this.setAudioRecoveryState('blocked', 'v3-context-not-running');
        }
      } catch {
        this.setAudioRecoveryState('blocked', 'v3-preunlock-failed');
      }
      return;
    }

    this.setAudioRecoveryState('recovering');
    try {
      const unlocked = await this.preUnlockLegacyCompatAudio();
      this.host.setContextUnlocked(unlocked);
      if (this.host.getContextUnlocked()) {
        this.setAudioRecoveryState('idle');
      } else {
        this.setAudioRecoveryState('blocked', 'audio-context-not-running');
      }
    } catch (error) {
      if (String((error as Error)?.name || '').toLowerCase() === 'notallowederror') {
        this.setAudioRecoveryState('blocked', 'not-allowed');
        return;
      }
      this.setAudioRecoveryState('blocked', 'pre-unlock-failed');
    }
  }

  private async preUnlockLegacyCompatAudio(): Promise<boolean> {
    if (!this.host.getAudioContext()) this.initializeAudioContext();
    const audioContext = this.host.getAudioContext();
    if (!audioContext) return false;

    if (audioContext.state === 'suspended') {
      if (!this.host.getContextUnlocked() && !this.hasUserActivation()) {
        return false;
      }
      await audioContext.resume();
    }

    if (this.host.getIsIOS() && this.host.getIOSAudioService() && !this.host.getIOSAudioService().isUnlocked()) {
      try {
        await this.host.getIOSAudioService().forceUnlock();
      } catch {
      }
    }

    if (audioContext && !this.host.getIsPrewarmed()) {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      gain.gain.setValueAtTime(0, audioContext.currentTime);
      osc.connect(gain);
      gain.connect(audioContext.destination);
      osc.start();
      osc.stop(audioContext.currentTime + 0.001);
      this.host.setIsPrewarmed(true);
    }

    const running = audioContext.state === 'running';
    if (running) {
      this.host.setContextUnlocked(true);
      this.setupSharedIOSNodes();
    }
    return running;
  }

  private hasUserActivation(): boolean {
    const nav = navigator as Navigator & {
      userActivation?: {
        isActive?: boolean;
        hasBeenActive?: boolean;
      };
    };
    return Boolean(nav.userActivation?.isActive || nav.userActivation?.hasBeenActive);
  }

  private emitAudioRecoveryBlocked(reason: string): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('vdjv-audio-unlock-required', {
      detail: {
        reason,
        contextState: this.host.getAudioContext()?.state || 'none'
      }
    }));
  }

  private emitAudioRecoveryRestored(): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new Event('vdjv-audio-unlock-restored'));
  }

  private setAudioRecoveryState(state: AudioRecoveryState, reason?: string): void {
    if (this.audioRecoveryState === state) return;
    this.audioRecoveryState = state;
    if (state === 'blocked') {
      this.emitAudioRecoveryBlocked(reason || 'audio-context-blocked');
    } else if (state === 'idle') {
      this.emitAudioRecoveryRestored();
    }
    this.host.notifyStateChange();
  }

  private createSilentAudio(): void {
    const silentAudio = new Audio();
    silentAudio.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
    silentAudio.loop = true;
    silentAudio.volume = 0.01;
    this.host.setSilentAudio(silentAudio);
  }

  private setupAudioContextUnlock(): void {
    const unlock = async () => {
      const audioContext = this.host.getAudioContext();
      if (!audioContext || this.host.getContextUnlocked()) return;
      try {
        if (audioContext.state === 'suspended') await audioContext.resume();
        if (this.host.getIsIOS() && this.host.getSilentAudio()) {
          this.host.getSilentAudio()?.play().catch(() => { });
          this.host.getSilentAudio()?.load();
        }
        this.host.setContextUnlocked(true);
        this.setupSharedIOSNodes();
        ['click', 'touchstart', 'touchend', 'mousedown'].forEach(event => {
          document.removeEventListener(event, unlock);
        });
      } catch {
      }
    };
    ['click', 'touchstart', 'touchend', 'mousedown'].forEach(event => {
      document.addEventListener(event, unlock, { once: false, passive: true });
    });
  }
}
