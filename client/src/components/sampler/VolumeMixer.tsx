import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import {
  ChevronDown,
  ChevronUp,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  SlidersHorizontal as Equalizer,
  Square,
  Trash2,
  Volume2,
  Waves,
  X
} from 'lucide-react';
import { ChannelDeckState, PlayingPadInfo, StopMode } from './types/sampler';
import { loadWaveformPeaks, resampleWaveformPeaks } from '@/lib/waveform-peaks';
import type { PerformanceTier } from '@/lib/performance-monitor';

interface VolumeMixerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelStates: ChannelDeckState[];
  channelCount: number;
  legacyPlayingPads: PlayingPadInfo[];
  masterVolume: number;
  onMasterVolumeChange: (volume: number) => void;
  onPadVolumeChange: (padId: string, volume: number) => void;
  onStopPad: (padId: string) => void;
  onChannelVolumeChange: (channelId: number, volume: number) => void;
  onStopChannel: (channelId: number) => void;
  onPlayChannel: (channelId: number) => void;
  onPauseChannel: (channelId: number) => void;
  onSeekChannel: (channelId: number, ms: number) => void;
  onUnloadChannel: (channelId: number) => void;
  onArmChannelLoad: (channelId: number) => void;
  onCancelChannelLoad: () => void;
  armedLoadChannelId: number | null;
  onSetChannelHotcue: (channelId: number, slotIndex: number, ms: number | null) => void;
  onTriggerChannelHotcue: (channelId: number, slotIndex: number) => void;
  onSetChannelCollapsed: (channelId: number, collapsed: boolean) => void;
  stopMode: StopMode;
  editMode: boolean;
  theme: 'light' | 'dark';
  windowWidth: number;
  graphicsTier?: PerformanceTier;
}

const HOTCUE_SLOTS = [0, 1, 2, 3] as const;
const HOTCUE_CLICK_SUPPRESS_TOUCH_MS = 220;
const HOTCUE_CLICK_SUPPRESS_MOUSE_MS = 20;
const HOTCUE_LONGPRESS_ARM_MS = 300;
const HOTCUE_LONGPRESS_PROGRESS_MS = 1000;
const WAVEFORM_CLICK_SUPPRESS_MS = 280;
const TRANSPORT_CLICK_SUPPRESS_TOUCH_MS = 260;
const HOTCUE_COLORS = [
  { marker: 'bg-red-500', activeDark: 'border-red-500 text-red-200 bg-red-500/20', activeLight: 'border-red-400 text-red-700 bg-red-50' },
  { marker: 'bg-blue-500', activeDark: 'border-blue-500 text-blue-200 bg-blue-500/20', activeLight: 'border-blue-400 text-blue-700 bg-blue-50' },
  { marker: 'bg-emerald-500', activeDark: 'border-emerald-500 text-emerald-200 bg-emerald-500/20', activeLight: 'border-emerald-400 text-emerald-700 bg-emerald-50' },
  { marker: 'bg-yellow-500', activeDark: 'border-yellow-500 text-yellow-200 bg-yellow-500/20', activeLight: 'border-yellow-400 text-yellow-700 bg-yellow-50' }
] as const;

const formatMs = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60).toString().padStart(2, '0');
  const seconds = (total % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const createFallbackState = (channelId: number): ChannelDeckState => ({
  channelId,
  loadedPadRef: null,
  isPlaying: false,
  isPaused: false,
  playheadMs: 0,
  durationMs: 0,
  channelVolume: 1,
  hotcuesMs: [null, null, null, null],
  hasLocalHotcueOverride: false,
  collapsed: false,
  waveformKey: null,
  pad: null
});

type WaveformTarget = { channelId: number; audioUrl: string; cacheKey: string };
const WAVEFORM_ANALYZE_STILL_RUNNING_MS = 12000;

const getWaveformRuntimeLoad = (): {
  constrained: boolean;
  pointScale: number;
  decodeBudgetCap: number;
} => {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') {
    return { constrained: false, pointScale: 1, decodeBudgetCap: 4 };
  }
  const nav = navigator as Navigator & { deviceMemory?: number };
  const ua = nav.userAgent || '';
  const isMobile = /Android|iPhone|iPad|iPod/i.test(ua);
  const isNativeCapacitor = Boolean((window as any).Capacitor?.isNativePlatform?.());
  const memory = typeof nav.deviceMemory === 'number' && Number.isFinite(nav.deviceMemory)
    ? nav.deviceMemory
    : null;
  const constrained = isNativeCapacitor || isMobile || (memory !== null && memory <= 4);
  return {
    constrained,
    pointScale: constrained ? 0.72 : 1,
    decodeBudgetCap: constrained ? 2 : 4
  };
};

const resolveDisplayedPlayingPadTiming = (
  pad: PlayingPadInfo,
  nowWallClockMs: number,
  nowPerfMs: number
): { progressMs: number; durationMs: number } => {
  const durationMs = Math.max(0, pad.endMs || 0);
  if (durationMs <= 0) {
    return { progressMs: 0, durationMs: 0 };
  }
  const baseProgressMs = clamp(pad.currentMs || 0, 0, durationMs);
  const playStartTime = typeof pad.playStartTime === 'number' ? pad.playStartTime : 0;
  if (playStartTime <= 0) {
    return { progressMs: baseProgressMs, durationMs };
  }
  const tempoRate = Number.isFinite(pad.tempoRate) ? Math.max(0.05, Number(pad.tempoRate)) : 1;
  const elapsedBaseMs = pad.timingSource === 'performance'
    ? Math.max(0, nowPerfMs - playStartTime)
    : Math.max(0, nowWallClockMs - playStartTime);
  const liveProgressMs = elapsedBaseMs * tempoRate;
  const progressMs = pad.playbackMode === 'loop'
    ? (durationMs > 0 ? liveProgressMs % durationMs : 0)
    : Math.min(durationMs, liveProgressMs);
  return {
    progressMs: elapsedBaseMs > 0 ? progressMs : baseProgressMs,
    durationMs
  };
};

const resolveTransportBadge = (
  channel: ChannelDeckState,
  loaded: boolean,
  isLoadArmed: boolean,
  isOtherChannelArmed: boolean,
  theme: 'light' | 'dark'
): { label: string; className: string } => {
  if (isLoadArmed) {
    return {
      label: 'ARMED',
      className: theme === 'dark'
        ? 'bg-emerald-900/40 text-emerald-200 border border-emerald-500/60'
        : 'bg-emerald-50 text-emerald-700 border border-emerald-300'
    };
  }
  if (isOtherChannelArmed) {
    return {
      label: 'WAIT',
      className: theme === 'dark'
        ? 'bg-sky-900/35 text-sky-200 border border-sky-500/50'
        : 'bg-sky-50 text-sky-700 border border-sky-300'
    };
  }
  if (!loaded) {
    return {
      label: 'EMPTY',
      className: theme === 'dark'
        ? 'bg-gray-900/40 text-gray-300 border border-gray-600'
        : 'bg-gray-100 text-gray-600 border border-gray-300'
    };
  }
  if (channel.isPlaying) {
    return {
      label: 'PLAYING',
      className: theme === 'dark'
        ? 'bg-cyan-900/35 text-cyan-200 border border-cyan-500/50'
        : 'bg-cyan-50 text-cyan-700 border border-cyan-300'
    };
  }
  if (channel.isPaused) {
    return {
      label: 'PAUSED',
      className: theme === 'dark'
        ? 'bg-amber-900/35 text-amber-200 border border-amber-500/50'
        : 'bg-amber-50 text-amber-700 border border-amber-300'
    };
  }
  return {
    label: 'READY',
    className: theme === 'dark'
      ? 'bg-violet-900/35 text-violet-200 border border-violet-500/50'
      : 'bg-violet-50 text-violet-700 border border-violet-300'
  };
};

const extractAudioUrlFromCacheKey = (cacheKey: string): string => {
  if (!cacheKey) return '';
  if (/^(blob:|data:|https?:|file:|\/)/.test(cacheKey)) return cacheKey;
  const splitAt = cacheKey.indexOf(':');
  if (splitAt < 0 || splitAt >= cacheKey.length - 1) return '';
  return cacheKey.slice(splitAt + 1);
};

const truncateLogValue = (value: string, maxLength: number = 140): string => {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 24)}...${value.slice(-16)}`;
};

const logWaveformStatus = (_message: string, _details?: Record<string, unknown>) => {};

interface WaveformBarsProps {
  channelId: number;
  waveform: number[];
  isLowestGraphics: boolean;
  theme: 'light' | 'dark';
  collapsed: boolean;
}

const WaveformBars = React.memo(function WaveformBars({
  channelId,
  waveform,
  isLowestGraphics,
  theme,
  collapsed
}: WaveformBarsProps) {
  if (collapsed || waveform.length === 0) return null;
  return (
    <div className="absolute inset-0 flex items-end gap-[1px] px-1 py-1 pointer-events-none">
      {waveform.map((height, index) => (
        <div
          key={`${channelId}-wf-${index}`}
          className={
            isLowestGraphics
              ? (theme === 'dark' ? 'w-full bg-cyan-300' : 'w-full bg-cyan-700')
              : (theme === 'dark' ? 'w-full bg-cyan-200/25' : 'w-full bg-cyan-800/20')
          }
          style={{ height: `${Math.max(8, Math.round(Math.max(0, height) * 100))}%` }}
        />
      ))}
    </div>
  );
});

export function VolumeMixer({
  open,
  onOpenChange,
  channelStates,
  channelCount,
  legacyPlayingPads,
  masterVolume,
  onMasterVolumeChange,
  onPadVolumeChange,
  onStopPad,
  onChannelVolumeChange,
  onStopChannel,
  onPlayChannel,
  onPauseChannel,
  onSeekChannel,
  onUnloadChannel,
  onArmChannelLoad,
  onCancelChannelLoad,
  armedLoadChannelId,
  onSetChannelHotcue,
  onTriggerChannelHotcue,
  onSetChannelCollapsed,
  stopMode,
  editMode,
  theme,
  windowWidth,
  graphicsTier = 'low'
}: VolumeMixerProps) {
  const isMobile = windowWidth < 768;
  const isLowestGraphics = graphicsTier === 'lowest';
  const [isElectronFullscreen, setIsElectronFullscreen] = React.useState(false);
  const isElectronWindowControlsAvailable = typeof window !== 'undefined' && Boolean(window.electronAPI?.toggleFullscreen);
  const isWaveformAnalysisEnabled = !isLowestGraphics;
  const waveformRuntimeLoad = React.useMemo(() => getWaveformRuntimeLoad(), []);
  const waveformPointBudget = React.useMemo(() => {
    if (isLowestGraphics) return { collapsed: 0, expanded: 0 };
    const base = graphicsTier === 'high'
      ? { collapsed: 56, expanded: 96 }
      : graphicsTier === 'medium'
        ? { collapsed: 40, expanded: 72 }
        : { collapsed: 28, expanded: 48 };
    const collapseBudget = Math.max(18, Math.round(base.collapsed * waveformRuntimeLoad.pointScale));
    const expandedBudget = Math.max(32, Math.round(base.expanded * waveformRuntimeLoad.pointScale));
    return { collapsed: collapseBudget, expanded: expandedBudget };
  }, [graphicsTier, isLowestGraphics, waveformRuntimeLoad.pointScale]);
  const waveformDecodeBudget = React.useMemo(() => {
    if (!isWaveformAnalysisEnabled) return 0;
    const base = graphicsTier === 'high' ? 4 : graphicsTier === 'medium' ? 3 : 2;
    const channelPenalty = channelCount >= 6 ? 1 : 0;
    return Math.max(1, Math.min(waveformRuntimeLoad.decodeBudgetCap, base - channelPenalty));
  }, [channelCount, graphicsTier, isWaveformAnalysisEnabled, waveformRuntimeLoad.decodeBudgetCap]);

  const channelStateMap = React.useMemo(() => {
    const map = new Map<number, ChannelDeckState>();
    channelStates.forEach((channel) => map.set(channel.channelId, channel));
    return map;
  }, [channelStates]);

  const visibleChannels = React.useMemo(() => {
    const items: ChannelDeckState[] = [];
    for (let i = 1; i <= channelCount; i += 1) {
      items.push(channelStateMap.get(i) || createFallbackState(i));
    }
    return items;
  }, [channelCount, channelStateMap]);

  const waveformStateKey = React.useMemo(() => (
    channelStates
      .map((channel) => [
        channel.channelId,
        channel.loadedPadRef?.bankId || '',
        channel.loadedPadRef?.padId || '',
        channel.pad?.padId || '',
        channel.pad?.audioUrl || '',
        channel.waveformKey || '',
        channel.collapsed ? 1 : 0
      ].join('~'))
      .join('||')
  ), [channelStates]);

  const waveformStateMap = React.useMemo(() => {
    const map = new Map<number, ChannelDeckState>();
    channelStates.forEach((channel) => map.set(channel.channelId, channel));
    return map;
  }, [waveformStateKey]);

  const waveformSourceChannels = React.useMemo(() => {
    const items: ChannelDeckState[] = [];
    for (let i = 1; i <= channelCount; i += 1) {
      items.push(waveformStateMap.get(i) || createFallbackState(i));
    }
    return items;
  }, [channelCount, waveformStateMap]);

  const channelVolumeSyncKey = React.useMemo(() => {
    const parts: string[] = [];
    for (let i = 1; i <= channelCount; i += 1) {
      const channel = channelStateMap.get(i);
      const volume = typeof channel?.channelVolume === 'number' ? channel.channelVolume : 1;
      parts.push(`${i}:${volume.toFixed(4)}`);
    }
    return parts.join('|');
  }, [channelCount, channelStateMap]);

  React.useEffect(() => {
    const activeIds = new Set(visibleChannels.map((channel) => channel.channelId));
    waveformSeekPreviewTimeoutRef.current.forEach((timeoutId, channelId) => {
      if (activeIds.has(channelId)) return;
      window.clearTimeout(timeoutId);
      waveformSeekPreviewTimeoutRef.current.delete(channelId);
    });
    setWaveformSeekPreviewByChannel((prev) => {
      const next: Record<number, number> = {};
      let changed = false;
      Object.entries(prev).forEach(([key, value]) => {
        const id = Number(key);
        if (!activeIds.has(id)) {
          changed = true;
          return;
        }
        next[id] = value;
      });
      return changed ? next : prev;
    });
  }, [visibleChannels]);

  const [channelVolumeDrafts, setChannelVolumeDrafts] = React.useState<Record<number, number>>({});
  const [channelWaveforms, setChannelWaveforms] = React.useState<Record<number, { key: string; peaks: number[] }>>({});
  const [waveformByKey, setWaveformByKey] = React.useState<Record<string, number[]>>({});
  const [waveformLoadingByChannel, setWaveformLoadingByChannel] = React.useState<Record<number, true>>({});
  const [waveformSeekPreviewByChannel, setWaveformSeekPreviewByChannel] = React.useState<Record<number, number>>({});
  const waveformRequestedKeyRef = React.useRef<Map<number, string>>(new Map());
  const waveformExpectedKeyRef = React.useRef<Map<number, string>>(new Map());
  const waveformStartedAtRef = React.useRef<Map<number, number>>(new Map());
  const waveformTimeoutRef = React.useRef<Map<number, number>>(new Map());
  const hotcuePointerHandledAtRef = React.useRef<Map<string, number>>(new Map());
  const hotcueLastPointerTypeRef = React.useRef<Map<string, string>>(new Map());
  const waveformPointerHandledAtRef = React.useRef<Map<number, number>>(new Map());
  const waveformLastPointerTypeRef = React.useRef<Map<number, string>>(new Map());
  const waveformSeekPreviewTimeoutRef = React.useRef<Map<number, number>>(new Map());
  const transportPointerHandledAtRef = React.useRef<Map<string, number>>(new Map());
  const channelSeekRafRef = React.useRef<Map<number, number>>(new Map());
  const pendingSeekMsRef = React.useRef<Map<number, number>>(new Map());
  const waveformLastMouseDragRef = React.useRef<Map<number, boolean>>(new Map());
  const waveformLastSeekRef = React.useRef<Map<number, { ms: number; padId: string | null }>>(new Map());
  const activeWaveformPointerRef = React.useRef<{
    channelId: number;
    pointerId: number;
    pointerType: string;
    startX: number;
    moved: boolean;
  } | null>(null);
  const isMountedRef = React.useRef(true);
  const channelVolumeRafRef = React.useRef<Map<number, number>>(new Map());
  const pendingChannelVolumeRef = React.useRef<Map<number, number>>(new Map());
  const activeVolumeDragRef = React.useRef<Set<number>>(new Set());

  const [holdingHotcue, setHoldingHotcue] = React.useState<{ channelId: number; slotIndex: number; progress: number } | null>(null);
  const [playingSamplerClock, setPlayingSamplerClock] = React.useState(() => ({
    nowMs: Date.now(),
    perfMs: typeof performance !== 'undefined' ? performance.now() : 0
  }));
  const hotcueArmTimerRef = React.useRef<number | null>(null);
  const hotcueRafRef = React.useRef<number | null>(null);
  const hotcueActiveKeyRef = React.useRef<string | null>(null);
  const hotcueProgressStartedAtRef = React.useRef<number | null>(null);
  const hotcueCaptureMsRef = React.useRef<Map<string, number>>(new Map());
  const hotcueActionSuppressUntilRef = React.useRef<Map<string, number>>(new Map());

  const clearHotcueHold = React.useCallback(() => {
    if (hotcueArmTimerRef.current !== null) {
      window.clearTimeout(hotcueArmTimerRef.current);
      hotcueArmTimerRef.current = null;
    }
    if (hotcueRafRef.current !== null) {
      window.cancelAnimationFrame(hotcueRafRef.current);
      hotcueRafRef.current = null;
    }
    hotcueActiveKeyRef.current = null;
    hotcueProgressStartedAtRef.current = null;
    setHoldingHotcue(null);
  }, []);

  const markHotcueActionHandled = React.useCallback((key: string) => {
    const now = performance.now();
    hotcuePointerHandledAtRef.current.set(key, now);
    hotcueActionSuppressUntilRef.current.set(key, now + 420);
  }, []);

  const resolveHotcueCaptureMs = React.useCallback((channel: ChannelDeckState) => {
    const currentPadId = channel.loadedPadRef?.padId || channel.pad?.padId || null;
    const previewPlayhead = waveformSeekPreviewByChannel[channel.channelId];
    const lastSeek = waveformLastSeekRef.current.get(channel.channelId);
    if (channel.isPlaying) {
      return Math.max(0, channel.playheadMs || 0);
    }
    if (typeof previewPlayhead === 'number') {
      return Math.max(0, previewPlayhead);
    }
    if (lastSeek && lastSeek.padId === currentPadId) {
      return Math.max(0, lastSeek.ms);
    }
    return Math.max(0, channel.playheadMs || 0);
  }, [waveformSeekPreviewByChannel]);

  const clearWaveformWatch = React.useCallback((channelId: number) => {
    waveformStartedAtRef.current.delete(channelId);
    const timeoutId = waveformTimeoutRef.current.get(channelId);
    if (typeof timeoutId === 'number') {
      window.clearTimeout(timeoutId);
      waveformTimeoutRef.current.delete(channelId);
    }
  }, []);

  const setWaveformLoading = React.useCallback((channelId: number, loading: boolean) => {
    setWaveformLoadingByChannel((prev) => {
      const current = prev[channelId] === true;
      if (current === loading) return prev;
      const next = { ...prev };
      if (loading) {
        next[channelId] = true;
      } else {
        delete next[channelId];
      }
      return next;
    });
  }, []);

  React.useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      waveformSeekPreviewTimeoutRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
      waveformSeekPreviewTimeoutRef.current.clear();
      channelSeekRafRef.current.forEach((rafId) => window.cancelAnimationFrame(rafId));
      channelSeekRafRef.current.clear();
      pendingSeekMsRef.current.clear();
      channelVolumeRafRef.current.forEach((rafId) => window.cancelAnimationFrame(rafId));
      channelVolumeRafRef.current.clear();
      pendingChannelVolumeRef.current.clear();
      waveformTimeoutRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
      waveformTimeoutRef.current.clear();
      waveformStartedAtRef.current.clear();
      if (hotcueArmTimerRef.current !== null) window.clearTimeout(hotcueArmTimerRef.current);
      if (hotcueRafRef.current !== null) window.cancelAnimationFrame(hotcueRafRef.current);
    };
  }, []);

  React.useEffect(() => {
    setChannelVolumeDrafts((prev) => {
      const next = { ...prev };
      let changed = false;
      const activeIds = new Set<number>();

      for (let i = 1; i <= channelCount; i += 1) {
        activeIds.add(i);
        const channel = channelStateMap.get(i) || createFallbackState(i);
        if (activeVolumeDragRef.current.has(channel.channelId)) continue;
        if (typeof next[channel.channelId] !== 'number' || Math.abs(next[channel.channelId] - channel.channelVolume) > 0.002) {
          next[channel.channelId] = channel.channelVolume;
          changed = true;
        }
      }

      Object.keys(next).forEach((key) => {
        const id = Number(key);
        if (!activeIds.has(id)) {
          delete next[id];
          changed = true;
        }
      });

      return changed ? next : prev;
    });
  }, [channelCount, channelStateMap, channelVolumeSyncKey]);

  const scheduleChannelVolume = React.useCallback((channelId: number, nextVolume: number) => {
    pendingChannelVolumeRef.current.set(channelId, nextVolume);
    if (channelVolumeRafRef.current.has(channelId)) return;
    const rafId = window.requestAnimationFrame(() => {
      channelVolumeRafRef.current.delete(channelId);
      const pending = pendingChannelVolumeRef.current.get(channelId);
      pendingChannelVolumeRef.current.delete(channelId);
      if (typeof pending !== 'number') return;
      onChannelVolumeChange(channelId, pending);
    });
    channelVolumeRafRef.current.set(channelId, rafId);
  }, [onChannelVolumeChange]);

  const flushChannelVolume = React.useCallback((channelId: number, nextVolume: number) => {
    const rafId = channelVolumeRafRef.current.get(channelId);
    if (typeof rafId === 'number') {
      window.cancelAnimationFrame(rafId);
      channelVolumeRafRef.current.delete(channelId);
    }
    pendingChannelVolumeRef.current.delete(channelId);
    onChannelVolumeChange(channelId, nextVolume);
  }, [onChannelVolumeChange]);

  const handleChannelVolumeDrag = React.useCallback((channelId: number, nextVolume: number) => {
    activeVolumeDragRef.current.add(channelId);
    setChannelVolumeDrafts((prev) => ({
      ...prev,
      [channelId]: nextVolume
    }));
    scheduleChannelVolume(channelId, nextVolume);
  }, [scheduleChannelVolume]);

  const handleChannelVolumeCommit = React.useCallback((channelId: number, nextVolume: number) => {
    activeVolumeDragRef.current.delete(channelId);
    flushChannelVolume(channelId, nextVolume);
  }, [flushChannelVolume]);

  const stopSliderPointerPropagation = React.useCallback((event: React.PointerEvent) => {
    // Keep touch/pen isolation (mobile overlay), but do not block mouse pointer
    // events so Radix slider drag continues to work on desktop.
    if (event.pointerType !== 'mouse') {
      event.stopPropagation();
    }
  }, []);

  React.useEffect(() => {
    if (!open || legacyPlayingPads.length === 0) return;
    const intervalId = window.setInterval(() => {
      setPlayingSamplerClock({
        nowMs: Date.now(),
        perfMs: performance.now()
      });
    }, 120);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [legacyPlayingPads.length, open]);

  React.useEffect(() => {
    if (!isElectronWindowControlsAvailable) return;
    let mounted = true;

    window.electronAPI?.getFullscreenState?.()
      .then((value) => {
        if (!mounted) return;
        setIsElectronFullscreen(Boolean(value));
      })
      .catch(() => {});

    const unsubscribe = window.electronAPI?.onFullscreenChange?.((next) => {
      if (!mounted) return;
      setIsElectronFullscreen(Boolean(next));
    });

    return () => {
      mounted = false;
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [isElectronWindowControlsAvailable]);

  const stopSliderTouchPropagation = React.useCallback((event: React.TouchEvent) => {
    event.stopPropagation();
  }, []);

  const waveformTargets = React.useMemo<WaveformTarget[]>(() => {
    if (!isWaveformAnalysisEnabled) return [];
    return waveformSourceChannels
      .filter((channel) => !channel.collapsed)
      .map((channel) => {
      const keyAudioUrl = extractAudioUrlFromCacheKey(channel.waveformKey || '');
      const audioUrl = channel.pad?.audioUrl || keyAudioUrl;
      const cacheKey = audioUrl
        ? (channel.waveformKey || `${channel.pad?.padId || channel.channelId}:${audioUrl}`)
        : '';
      return {
        channelId: channel.channelId,
        audioUrl,
        cacheKey
      };
      })
      .slice(0, waveformDecodeBudget);
  }, [isWaveformAnalysisEnabled, waveformSourceChannels, waveformDecodeBudget]);

  React.useEffect(() => {
    const targets = waveformTargets;
    const expected = new Map<number, string>();
    targets.forEach((target) => {
      if (target.cacheKey) {
        expected.set(target.channelId, target.cacheKey);
      }
    });
    waveformExpectedKeyRef.current = expected;
    setWaveformLoadingByChannel((prev) => {
      let changed = false;
      const next = { ...prev };
      Object.keys(next).forEach((id) => {
        const channelId = Number(id);
        if (!expected.has(channelId)) {
          delete next[channelId];
          changed = true;
        }
      });
      return changed ? next : prev;
    });

    waveformRequestedKeyRef.current.forEach((key, channelId) => {
      const nextKey = expected.get(channelId);
      if (!nextKey || nextKey !== key) {
        logWaveformStatus('Drop stale waveform request', {
          channelId,
          staleKey: truncateLogValue(key),
          expectedKey: nextKey ? truncateLogValue(nextKey) : null
        });
        clearWaveformWatch(channelId);
        waveformRequestedKeyRef.current.delete(channelId);
        setWaveformLoading(channelId, false);
      }
    });

    setChannelWaveforms((prev) => {
      const next = { ...prev };
      let changed = false;
      Object.keys(next).forEach((id) => {
        const channelId = Number(id);
        const nextKey = expected.get(channelId);
        if (!nextKey || next[channelId]?.key !== nextKey) {
          delete next[channelId];
          changed = true;
        }
      });
      return changed ? next : prev;
    });

    targets.forEach((target) => {
      const audioUrl = target.audioUrl;
      if (!audioUrl) return;
      if (waveformRequestedKeyRef.current.get(target.channelId) === target.cacheKey) return;
      clearWaveformWatch(target.channelId);
      const startedAt = Date.now();
      waveformStartedAtRef.current.set(target.channelId, startedAt);
      waveformRequestedKeyRef.current.set(target.channelId, target.cacheKey);
      setWaveformLoading(target.channelId, true);
      const timeoutId = window.setTimeout(() => {
        if (!isMountedRef.current) return;
        const expectedKey = waveformExpectedKeyRef.current.get(target.channelId);
        const requestedKey = waveformRequestedKeyRef.current.get(target.channelId);
        if (expectedKey !== target.cacheKey || requestedKey !== target.cacheKey) return;
        const elapsedMs = Date.now() - startedAt;
        logWaveformStatus('Still analyzing waveform', {
          channelId: target.channelId,
          elapsedMs,
          cacheKey: truncateLogValue(target.cacheKey)
        });
      }, WAVEFORM_ANALYZE_STILL_RUNNING_MS);
      waveformTimeoutRef.current.set(target.channelId, timeoutId);
      logWaveformStatus('Waveform decode started', {
        channelId: target.channelId,
        cacheKey: truncateLogValue(target.cacheKey),
        audioUrl: truncateLogValue(audioUrl)
      });
      void loadWaveformPeaks(audioUrl, target.cacheKey)
        .then((waveform) => {
          if (!isMountedRef.current) return;
          const elapsedMs = Date.now() - startedAt;
          if (waveformExpectedKeyRef.current.get(target.channelId) !== target.cacheKey) {
            logWaveformStatus('Waveform result ignored (stale key)', {
              channelId: target.channelId,
              elapsedMs,
              cacheKey: truncateLogValue(target.cacheKey)
            });
            clearWaveformWatch(target.channelId);
            setWaveformLoading(target.channelId, false);
            if (waveformRequestedKeyRef.current.get(target.channelId) === target.cacheKey) {
              waveformRequestedKeyRef.current.delete(target.channelId);
            }
            return;
          }
          clearWaveformWatch(target.channelId);
          setWaveformLoading(target.channelId, false);
          logWaveformStatus('Waveform decode complete', {
            channelId: target.channelId,
            elapsedMs,
            points: waveform.peaks.length,
            cacheKey: truncateLogValue(target.cacheKey)
          });
          setWaveformByKey((prev) => {
            const existingByKey = prev[target.cacheKey];
            const existingByAudio = prev[target.audioUrl];
            if (existingByKey === waveform.peaks && existingByAudio === waveform.peaks) return prev;
            return {
              ...prev,
              [target.cacheKey]: waveform.peaks,
              [target.audioUrl]: waveform.peaks
            };
          });
          setChannelWaveforms((prev) => {
            const existing = prev[target.channelId];
            if (existing?.key === target.cacheKey && existing.peaks === waveform.peaks) return prev;
            return {
              ...prev,
              [target.channelId]: {
                key: target.cacheKey,
                peaks: waveform.peaks
              }
            };
          });
        })
        .catch((error) => {
          if (!isMountedRef.current) return;
          const elapsedMs = Date.now() - startedAt;
          clearWaveformWatch(target.channelId);
          setWaveformLoading(target.channelId, false);
          if (waveformExpectedKeyRef.current.get(target.channelId) !== target.cacheKey) {
            logWaveformStatus('Waveform decode error ignored (stale key)', {
              channelId: target.channelId,
              elapsedMs,
              cacheKey: truncateLogValue(target.cacheKey),
              error: error instanceof Error ? error.message : String(error)
            });
            return;
          }
          if (waveformRequestedKeyRef.current.get(target.channelId) === target.cacheKey) {
            waveformRequestedKeyRef.current.delete(target.channelId);
          }
          logWaveformStatus('Waveform decode failed', {
            channelId: target.channelId,
            elapsedMs,
            cacheKey: truncateLogValue(target.cacheKey),
            error: error instanceof Error ? error.message : String(error)
          });
        });
    });
  }, [clearWaveformWatch, setWaveformLoading, waveformTargets]);

  const waveformProfiles = React.useMemo(() => {
    const map = new Map<number, number[]>();
    waveformSourceChannels.forEach((channel) => {
      if (isLowestGraphics) {
        map.set(channel.channelId, []);
        return;
      }
      const points = channel.collapsed ? waveformPointBudget.collapsed : waveformPointBudget.expanded;
      const targetKey = channel.waveformKey || (
        channel.pad?.audioUrl
          ? `${channel.pad?.padId || channel.channelId}:${channel.pad.audioUrl}`
          : ''
      );
      const entry = channelWaveforms[channel.channelId];
      const targetAudioUrl = channel.pad?.audioUrl || extractAudioUrlFromCacheKey(targetKey);
      let source: number[] | undefined;

      if (entry?.peaks?.length) {
        if (entry.key === targetKey) {
          source = entry.peaks;
        } else if (targetAudioUrl && extractAudioUrlFromCacheKey(entry.key) === targetAudioUrl) {
          // Guard against transient key drift while channel state updates.
          source = entry.peaks;
        }
      }

      if (!source && targetKey) {
        const keyed = waveformByKey[targetKey];
        if (Array.isArray(keyed) && keyed.length > 0) {
          source = keyed;
        }
      }

      if (!source && targetAudioUrl) {
        const keyedByUrl = waveformByKey[targetAudioUrl];
        if (Array.isArray(keyedByUrl) && keyedByUrl.length > 0) {
          source = keyedByUrl;
        }
      }

      if (!source && targetAudioUrl) {
        const keyedByAudio = Object.entries(waveformByKey).find(([key, peaks]) => (
          Array.isArray(peaks)
          && peaks.length > 0
          && extractAudioUrlFromCacheKey(key) === targetAudioUrl
        ));
        if (keyedByAudio) {
          source = keyedByAudio[1];
        }
      }

      if (!source && entry?.peaks?.length) {
        source = entry.peaks;
      }

      if (source && source.length > 0) {
        map.set(channel.channelId, resampleWaveformPeaks(source, points));
      } else {
        map.set(channel.channelId, []);
      }
    });
    return map;
  }, [channelWaveforms, isLowestGraphics, waveformByKey, waveformPointBudget.collapsed, waveformPointBudget.expanded, waveformSourceChannels]);

  const clearWaveformSeekPreview = React.useCallback((channelId: number) => {
    const timeoutId = waveformSeekPreviewTimeoutRef.current.get(channelId);
    if (typeof timeoutId === 'number') {
      window.clearTimeout(timeoutId);
      waveformSeekPreviewTimeoutRef.current.delete(channelId);
    }
    setWaveformSeekPreviewByChannel((prev) => {
      if (typeof prev[channelId] !== 'number') return prev;
      const next = { ...prev };
      delete next[channelId];
      return next;
    });
  }, []);

  const scheduleWaveformSeek = React.useCallback((channelId: number, nextMs: number, immediate: boolean = false) => {
    if (immediate) {
      const existingRafId = channelSeekRafRef.current.get(channelId);
      if (typeof existingRafId === 'number') {
        window.cancelAnimationFrame(existingRafId);
        channelSeekRafRef.current.delete(channelId);
      }
      pendingSeekMsRef.current.delete(channelId);
      onSeekChannel(channelId, nextMs);
      return;
    }
    pendingSeekMsRef.current.set(channelId, nextMs);
    if (channelSeekRafRef.current.has(channelId)) return;
    const rafId = window.requestAnimationFrame(() => {
      channelSeekRafRef.current.delete(channelId);
      const pending = pendingSeekMsRef.current.get(channelId);
      pendingSeekMsRef.current.delete(channelId);
      if (typeof pending !== 'number') return;
      onSeekChannel(channelId, pending);
    });
    channelSeekRafRef.current.set(channelId, rafId);
  }, [onSeekChannel]);

  const seekChannelAtClientX = React.useCallback((
    clientX: number,
    target: HTMLDivElement,
    channel: ChannelDeckState,
    immediate: boolean = false
  ) => {
    const duration = Math.max(1, channel.pad?.endMs || channel.durationMs || 0);
    if (duration <= 1) return;
    const rect = target.getBoundingClientRect();
    const x = clamp(clientX - rect.left, 0, rect.width);
    const ratio = rect.width > 0 ? x / rect.width : 0;
    const nextMs = ratio * duration;
    setWaveformSeekPreviewByChannel((prev) => {
      if (prev[channel.channelId] === nextMs) return prev;
      return {
        ...prev,
        [channel.channelId]: nextMs
      };
    });
    waveformLastSeekRef.current.set(channel.channelId, {
      ms: nextMs,
      padId: channel.loadedPadRef?.padId || channel.pad?.padId || null,
    });
    scheduleWaveformSeek(channel.channelId, nextMs, immediate);
    const timeoutId = waveformSeekPreviewTimeoutRef.current.get(channel.channelId);
    if (typeof timeoutId === 'number') {
      window.clearTimeout(timeoutId);
    }
    const releaseId = window.setTimeout(() => {
      clearWaveformSeekPreview(channel.channelId);
    }, 180);
    waveformSeekPreviewTimeoutRef.current.set(channel.channelId, releaseId);
  }, [clearWaveformSeekPreview, scheduleWaveformSeek]);

  const handleWaveformSeekClick = React.useCallback((event: React.MouseEvent<HTMLDivElement>, channel: ChannelDeckState) => {
    if (waveformLastMouseDragRef.current.get(channel.channelId)) {
      waveformLastMouseDragRef.current.set(channel.channelId, false);
      return;
    }
    const lastPointerTs = waveformPointerHandledAtRef.current.get(channel.channelId);
    const lastPointerType = waveformLastPointerTypeRef.current.get(channel.channelId) || 'mouse';
    if (
      lastPointerType !== 'mouse' &&
      typeof lastPointerTs === 'number' &&
      performance.now() - lastPointerTs < WAVEFORM_CLICK_SUPPRESS_MS
    ) {
      return;
    }
    seekChannelAtClientX(event.clientX, event.currentTarget, channel, true);
  }, [seekChannelAtClientX]);

  const handleWaveformPointerDown = React.useCallback((event: React.PointerEvent<HTMLDivElement>, channel: ChannelDeckState) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    activeWaveformPointerRef.current = {
      channelId: channel.channelId,
      pointerId: event.pointerId,
      pointerType: event.pointerType || 'mouse',
      startX: event.clientX,
      moved: false,
    };
    waveformLastPointerTypeRef.current.set(channel.channelId, event.pointerType || 'mouse');
    if (event.pointerType !== 'mouse') {
      waveformPointerHandledAtRef.current.set(channel.channelId, performance.now());
    }
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
    }
    seekChannelAtClientX(event.clientX, event.currentTarget, channel, event.pointerType === 'mouse');
  }, [seekChannelAtClientX]);

  const handleWaveformPointerMove = React.useCallback((event: React.PointerEvent<HTMLDivElement>, channel: ChannelDeckState) => {
    const active = activeWaveformPointerRef.current;
    if (!active) return;
    if (active.channelId !== channel.channelId || active.pointerId !== event.pointerId) return;
    if (event.pointerType === 'mouse' && (event.buttons & 1) !== 1) return;
    if (!active.moved && Math.abs(event.clientX - active.startX) > 4) {
      active.moved = true;
    }
    seekChannelAtClientX(event.clientX, event.currentTarget, channel);
  }, [seekChannelAtClientX]);

  const handleWaveformPointerEnd = React.useCallback((event: React.PointerEvent<HTMLDivElement>, channelId: number) => {
    const active = activeWaveformPointerRef.current;
    if (!active) return;
    if (active.channelId !== channelId || active.pointerId !== event.pointerId) return;
    activeWaveformPointerRef.current = null;
    waveformLastPointerTypeRef.current.set(channelId, active.pointerType);
    if (active.pointerType === 'mouse') {
      waveformLastMouseDragRef.current.set(channelId, active.moved);
    } else {
      waveformPointerHandledAtRef.current.set(channelId, performance.now());
    }
    const timeoutId = waveformSeekPreviewTimeoutRef.current.get(channelId);
    if (typeof timeoutId === 'number') {
      window.clearTimeout(timeoutId);
    }
    const releaseId = window.setTimeout(() => {
      clearWaveformSeekPreview(channelId);
    }, 120);
    waveformSeekPreviewTimeoutRef.current.set(channelId, releaseId);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
    }
  }, [clearWaveformSeekPreview]);

  const handleSetOrClearHotcue = React.useCallback((channelId: number, slotIndex: number, captureMs?: number | null) => {
    const channel = channelStateMap.get(channelId);
    if (!channel) return;
    const existing = channel.hotcuesMs[slotIndex];
    if (typeof existing === 'number') {
      onSetChannelHotcue(channelId, slotIndex, null);
    } else {
      const cueSourceMs = typeof captureMs === 'number'
        ? captureMs
        : resolveHotcueCaptureMs(channel);
      onSetChannelHotcue(channelId, slotIndex, Math.max(0, cueSourceMs));
    }
  }, [channelStateMap, onSetChannelHotcue, resolveHotcueCaptureMs]);

  const handleTransportPointerDown = React.useCallback((
    event: React.PointerEvent<HTMLButtonElement>,
    transportKey: string,
    action: () => void
  ) => {
    if (event.pointerType === 'mouse') return;
    transportPointerHandledAtRef.current.set(transportKey, performance.now());
    action();
  }, []);

  const handleTransportClick = React.useCallback((transportKey: string, action: () => void) => {
    const pointerTs = transportPointerHandledAtRef.current.get(transportKey);
    if (typeof pointerTs === 'number' && performance.now() - pointerTs < TRANSPORT_CLICK_SUPPRESS_TOUCH_MS) {
      return;
    }
    action();
  }, []);

  const handleHotcuePointerDown = React.useCallback((
    event: React.PointerEvent<HTMLButtonElement>,
    channel: ChannelDeckState,
    slotIndex: number
  ) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    clearHotcueHold();
    const key = `${channel.channelId}:${slotIndex}`;
    hotcueActiveKeyRef.current = key;
    hotcueLastPointerTypeRef.current.set(key, event.pointerType || 'mouse');
    hotcueCaptureMsRef.current.set(key, resolveHotcueCaptureMs(channel));

    hotcueArmTimerRef.current = window.setTimeout(() => {
      if (hotcueActiveKeyRef.current !== key) return;
      hotcueProgressStartedAtRef.current = performance.now();
      setHoldingHotcue({ channelId: channel.channelId, slotIndex, progress: 0 });

      const animate = () => {
        if (hotcueActiveKeyRef.current !== key) return;
        const startedAt = hotcueProgressStartedAtRef.current ?? performance.now();
        const elapsed = performance.now() - startedAt;
        const progress = clamp((elapsed / HOTCUE_LONGPRESS_PROGRESS_MS) * 100, 0, 100);
        setHoldingHotcue({ channelId: channel.channelId, slotIndex, progress });

        if (elapsed >= HOTCUE_LONGPRESS_PROGRESS_MS) {
          const captureMs = hotcueCaptureMsRef.current.get(key);
          handleSetOrClearHotcue(channel.channelId, slotIndex, captureMs);
          markHotcueActionHandled(key);
          clearHotcueHold();
          return;
        }

        hotcueRafRef.current = window.requestAnimationFrame(animate);
      };

      hotcueRafRef.current = window.requestAnimationFrame(animate);
    }, HOTCUE_LONGPRESS_ARM_MS);
  }, [clearHotcueHold, handleSetOrClearHotcue, markHotcueActionHandled, resolveHotcueCaptureMs]);

  const handleHotcueTap = React.useCallback((channel: ChannelDeckState, slotIndex: number, captureMs?: number | null) => {
    if (editMode) {
      const key = `${channel.channelId}:${slotIndex}`;
      handleSetOrClearHotcue(channel.channelId, slotIndex, captureMs);
      markHotcueActionHandled(key);
      return;
    }
    onTriggerChannelHotcue(channel.channelId, slotIndex);
  }, [editMode, handleSetOrClearHotcue, markHotcueActionHandled, onTriggerChannelHotcue]);

  const handleHotcuePointerUp = React.useCallback((
    event: React.PointerEvent<HTMLButtonElement>,
    channel: ChannelDeckState,
    slotIndex: number
  ) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const key = `${channel.channelId}:${slotIndex}`;
    if (hotcueActiveKeyRef.current === key) {
      clearHotcueHold();
    }
    const suppressUntil = hotcueActionSuppressUntilRef.current.get(key);
    if (typeof suppressUntil === 'number' && performance.now() < suppressUntil) {
      return;
    }
    const suppressMs = event.pointerType === 'mouse'
      ? HOTCUE_CLICK_SUPPRESS_MOUSE_MS
      : HOTCUE_CLICK_SUPPRESS_TOUCH_MS;
    const pointerTs = hotcuePointerHandledAtRef.current.get(key);
    if (typeof pointerTs === 'number' && performance.now() - pointerTs < suppressMs) {
      return;
    }
    hotcueLastPointerTypeRef.current.set(key, event.pointerType || 'mouse');
    hotcuePointerHandledAtRef.current.set(key, performance.now());
    handleHotcueTap(channel, slotIndex, hotcueCaptureMsRef.current.get(key));
  }, [clearHotcueHold, handleHotcueTap]);

  const handleHotcuePointerCancel = React.useCallback((channelId: number, slotIndex: number) => {
    const key = `${channelId}:${slotIndex}`;
    if (hotcueActiveKeyRef.current === key) {
      clearHotcueHold();
    }
  }, [clearHotcueHold]);

  const handleHotcueClick = React.useCallback((channel: ChannelDeckState, slotIndex: number) => {
    const key = `${channel.channelId}:${slotIndex}`;
    const suppressUntil = hotcueActionSuppressUntilRef.current.get(key);
    if (typeof suppressUntil === 'number' && performance.now() < suppressUntil) {
      return;
    }
    const pointerType = hotcueLastPointerTypeRef.current.get(key) || 'mouse';
    const suppressMs = pointerType === 'mouse'
      ? HOTCUE_CLICK_SUPPRESS_MOUSE_MS
      : HOTCUE_CLICK_SUPPRESS_TOUCH_MS;
    const pointerTs = hotcuePointerHandledAtRef.current.get(key);
    if (typeof pointerTs === 'number' && performance.now() - pointerTs < suppressMs) {
      return;
    }
    handleHotcueTap(channel, slotIndex, hotcueCaptureMsRef.current.get(key));
  }, [handleHotcueTap]);

  const handleToggleElectronFullscreen = React.useCallback(() => {
    if (!isElectronWindowControlsAvailable) return;
    window.electronAPI?.toggleFullscreen?.()
      .then((next) => {
        setIsElectronFullscreen(Boolean(next));
      })
      .catch(() => {});
  }, [isElectronWindowControlsAvailable]);

  const panelClasses = theme === 'dark'
    ? 'bg-gray-800/95 border-gray-700 text-white perf-high:backdrop-blur-md'
    : 'bg-white/95 border-gray-200 text-gray-900 perf-high:backdrop-blur-md';

  const sectionClasses = theme === 'dark'
    ? 'bg-gray-900/60 border-gray-700 perf-high:backdrop-blur-sm shadow-sm'
    : 'bg-gray-50/60 border-gray-200 perf-high:backdrop-blur-sm shadow-sm';
  const masterPercent = clamp(Math.round(masterVolume * 100), 0, 100);
  const masterDbLabel = masterPercent <= 0
    ? '-inf dB'
    : `${(20 * Math.log10(Math.max(masterVolume, 0.0001))).toFixed(1)} dB`;

  return (
    <div className={`fixed inset-y-0 right-0 z-50 w-[24rem] md:w-[24rem] max-w-[95vw] border-l shadow-2xl transition-transform duration-300 ${panelClasses} ${open ? 'translate-x-0' : 'translate-x-full'}`}>
      <div className={`flex items-center justify-between px-4 py-3 border-b ${theme === 'dark' ? 'border-gray-700' : 'border-gray-200'}`}>
        <div>
          <h2 className="text-sm font-semibold">Mixer</h2>
          <p className={`text-[11px] ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
            {channelCount} loadable channels, stop mode: {stopMode}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isElectronWindowControlsAvailable && (
            <Button
              variant="outline"
              size="icon"
              onClick={handleToggleElectronFullscreen}
              className={theme === 'dark'
                ? 'h-8 w-8 border-emerald-500/60 bg-emerald-900/30 text-emerald-300 hover:bg-emerald-800/60'
                : 'h-8 w-8 border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}
              title={isElectronFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            >
              {isElectronFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
          )}
          <Button
            variant="outline"
            size="icon"
            onClick={() => onOpenChange(false)}
            className={theme === 'dark'
              ? 'h-8 w-8 border-red-500/60 bg-red-900/30 text-red-300 hover:bg-red-800/60'
              : 'h-8 w-8 border-red-300 bg-red-50 text-red-600 hover:bg-red-100'}
            title="Close Mixer"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="h-[calc(100dvh-64px)] overflow-y-auto overscroll-contain [scrollbar-gutter:stable] p-3 space-y-3 touch-pan-y">

        <section className={`rounded-lg border p-3 ${sectionClasses}`}>
          <div className="flex items-center justify-between gap-2 mb-2">
            <Label className="text-xs font-semibold flex items-center gap-2 uppercase tracking-[0.12em]">
              <Volume2 className="h-4 w-4" /> Master Slider
            </Label>
            <div className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${theme === 'dark' ? 'bg-gray-800 text-amber-200' : 'bg-gray-100 text-amber-700'}`}>
              {masterPercent}% ({masterDbLabel})
            </div>
          </div>

          <div className={`rounded-lg border px-2.5 py-2 ${theme === 'dark' ? 'border-amber-500/30 bg-gray-950/50' : 'border-amber-300 bg-amber-50/55'}`}>
            <div className={`mb-1.5 flex items-center justify-between text-[9px] font-semibold uppercase tracking-[0.1em] ${theme === 'dark' ? 'text-amber-200/80' : 'text-amber-700/80'}`}>
              <span>Cut</span>
              <span>Master</span>
              <span>Boost</span>
            </div>
            <div className="relative px-1">
              <div className="pointer-events-none absolute inset-x-1 top-1/2 -translate-y-1/2 flex items-center justify-between">
                {Array.from({ length: 11 }).map((_, index) => (
                  <span
                    key={`master-tick-${index}`}
                    className={`h-3 w-[1px] ${theme === 'dark' ? 'bg-gray-500/80' : 'bg-gray-500/60'}`}
                  />
                ))}
              </div>
              <input
                type="range"
                value={masterPercent}
                onChange={(event) => onMasterVolumeChange(Number(event.currentTarget.value) / 100)}
                min={0}
                max={100}
                step={1}
                className={`relative z-10 w-full appearance-none bg-transparent touch-none
                  [&::-webkit-slider-runnable-track]:h-2 [&::-webkit-slider-runnable-track]:rounded-full
                  [&::-webkit-slider-thumb]:mt-[-7px] [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:shadow
                  [&::-moz-range-track]:h-2 [&::-moz-range-track]:rounded-full [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:shadow
                  ${theme === 'dark'
                    ? '[&::-webkit-slider-runnable-track]:bg-gray-700/90 [&::-webkit-slider-thumb]:border-amber-300 [&::-webkit-slider-thumb]:bg-gray-100 [&::-moz-range-track]:bg-gray-700/90 [&::-moz-range-thumb]:border-amber-300 [&::-moz-range-thumb]:bg-gray-100'
                    : '[&::-webkit-slider-runnable-track]:bg-gray-300 [&::-webkit-slider-thumb]:border-amber-700 [&::-webkit-slider-thumb]:bg-white [&::-moz-range-track]:bg-gray-300 [&::-moz-range-thumb]:border-amber-700 [&::-moz-range-thumb]:bg-white'}`}
                onPointerDownCapture={stopSliderPointerPropagation}
                onTouchStartCapture={stopSliderTouchPropagation}
                aria-label="Master Volume"
              />
            </div>
          </div>
        </section>

        <section className={`rounded-lg border p-3 ${sectionClasses}`}>
          <Label className="text-xs font-semibold flex items-center gap-2 mb-2">
            <Equalizer className="h-4 w-4" />
            Channel Decks
          </Label>
          <div className="space-y-2">
            {visibleChannels.map((channel) => {
              const loaded = Boolean(channel.pad && channel.loadedPadRef);
              const duration = Math.max(1, channel.pad?.endMs || channel.durationMs || 0);
              const previewPlayhead = waveformSeekPreviewByChannel[channel.channelId];
              const playhead = clamp(
                typeof previewPlayhead === 'number' ? previewPlayhead : (channel.playheadMs || 0),
                0,
                duration
              );
              const progressPct = duration > 0 ? (playhead / duration) * 100 : 0;
              const isLoadArmed = armedLoadChannelId === channel.channelId;
              const isOtherChannelArmed = armedLoadChannelId !== null && armedLoadChannelId !== channel.channelId;
              const waveform = waveformProfiles.get(channel.channelId) || [];
              const isWaveformLoading = waveformLoadingByChannel[channel.channelId] === true;
              const transportBadge = resolveTransportBadge(channel, loaded, isLoadArmed, isOtherChannelArmed, theme);
              const displayedVolume = clamp(
                typeof channelVolumeDrafts[channel.channelId] === 'number'
                  ? channelVolumeDrafts[channel.channelId]
                  : channel.channelVolume,
                0,
                1
              );
              const previewPct = typeof previewPlayhead === 'number' ? clamp((previewPlayhead / duration) * 100, 0, 100) : null;
              const showPreviewMarker = typeof previewPct === 'number' && Math.abs(previewPct - progressPct) > 0.2;

              return (
                <div
                  key={channel.channelId}
                  className={`rounded-md border ${theme === 'dark' ? 'border-gray-700 bg-gray-950/40' : 'border-gray-200 bg-white'} ${channel.collapsed ? 'p-2' : 'p-2.5'}`}
                >
                  <div className="flex items-center gap-1.5">
                    <div className={`text-[10px] font-semibold rounded px-1.5 py-0.5 ${theme === 'dark' ? 'bg-gray-700 text-gray-200' : 'bg-gray-100 text-gray-700'}`}>
                      CH {channel.channelId}
                    </div>
                    <div className={`w-[64px] shrink-0 rounded px-1.5 py-0.5 text-center text-[9px] font-semibold tracking-[0.08em] ${transportBadge.className}`}>
                      {transportBadge.label}
                    </div>
                    <div className="min-w-0 flex-1 text-[11px] truncate" title={channel.pad ? `${channel.pad.padName} (${channel.pad.bankName})` : 'No sampler loaded'}>
                      {channel.pad ? `${channel.pad.padName} (${channel.pad.bankName})` : 'No sampler loaded'}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className={`h-7 px-2 text-[10px] ${isLoadArmed
                        ? (theme === 'dark'
                          ? 'border-emerald-400 bg-emerald-900/40 text-emerald-200'
                          : 'border-emerald-400 bg-emerald-50 text-emerald-700')
                          : ''}`}
                      onClick={() => {
                        if (isLoadArmed) {
                          onCancelChannelLoad();
                        } else {
                          onArmChannelLoad(channel.channelId);
                        }
                      }}
                    >
                      {isLoadArmed ? 'Waiting Pad...' : 'Load'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => onSetChannelCollapsed(channel.channelId, !channel.collapsed)}
                      title={channel.collapsed ? 'Expand channel' : 'Collapse channel'}
                    >
                      {channel.collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                    </Button>
                  </div>



                  <div className="mt-1.5 flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      onPointerDown={(event) => handleTransportPointerDown(
                        event,
                        `play-toggle:${channel.channelId}`,
                        () => (channel.isPlaying ? onPauseChannel(channel.channelId) : onPlayChannel(channel.channelId))
                      )}
                      onClick={() => handleTransportClick(
                        `play-toggle:${channel.channelId}`,
                        () => (channel.isPlaying ? onPauseChannel(channel.channelId) : onPlayChannel(channel.channelId))
                      )}
                      disabled={!loaded}
                      title={channel.isPlaying ? 'Pause' : 'Play'}
                    >
                      {channel.isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      onPointerDown={(event) => handleTransportPointerDown(
                        event,
                        `stop:${channel.channelId}`,
                        () => onStopChannel(channel.channelId)
                      )}
                      onClick={() => handleTransportClick(
                        `stop:${channel.channelId}`,
                        () => onStopChannel(channel.channelId)
                      )}
                      disabled={!loaded}
                      title="Stop"
                    >
                      <Square className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => onUnloadChannel(channel.channelId)}
                      disabled={!loaded}
                      title="Unload"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    <div className="min-w-0 flex-1 text-[10px] text-right text-gray-500 dark:text-gray-400">
                      {formatMs(playhead)} / {formatMs(duration)}
                    </div>
                  </div>

                  <div
                    className={`relative mt-1.5 rounded border cursor-pointer overflow-hidden touch-none ${channel.collapsed ? 'h-4' : 'h-11'} ${
                      isLowestGraphics
                        ? (theme === 'dark' ? 'border-gray-500 bg-gray-800' : 'border-gray-400 bg-gray-200')
                        : (theme === 'dark' ? 'border-gray-700 bg-gray-900' : 'border-gray-300 bg-gray-100')
                    }`}
                    onPointerDown={(event) => handleWaveformPointerDown(event, channel)}
                    onPointerMove={(event) => handleWaveformPointerMove(event, channel)}
                    onPointerUp={(event) => handleWaveformPointerEnd(event, channel.channelId)}
                    onPointerCancel={(event) => handleWaveformPointerEnd(event, channel.channelId)}
                    onClick={(event) => handleWaveformSeekClick(event, channel)}
                    title={loaded ? 'Seek using waveform' : 'Load a sampler first'}
                  >
                    <WaveformBars
                      channelId={channel.channelId}
                      waveform={waveform}
                      isLowestGraphics={isLowestGraphics}
                      theme={theme}
                      collapsed={channel.collapsed}
                    />

                    {!channel.collapsed && loaded && isWaveformLoading && waveform.length === 0 && (
                      <div className={`absolute inset-0 flex items-center justify-center text-[10px] pointer-events-none ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>
                        Analyzing waveform...
                      </div>
                    )}

                    {!channel.collapsed && loaded && !isWaveformAnalysisEnabled && waveform.length === 0 && (
                      <div className={`absolute inset-0 flex items-center justify-center text-[10px] pointer-events-none ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>
                        {isLowestGraphics
                          ? 'Waveform hidden in Lowest graphics.'
                          : 'Waveform disabled in basic audio stage.'}
                      </div>
                    )}

                    <div
                      className={`absolute inset-y-0 left-0 ${
                        isLowestGraphics
                          ? (theme === 'dark' ? 'bg-cyan-500' : 'bg-cyan-500')
                          : (theme === 'dark' ? 'bg-cyan-300/25' : 'bg-cyan-400/25')
                      }`}
                      style={{
                        width: `${progressPct}%`,
                        opacity: isLowestGraphics ? 0.28 : 1
                      }}
                    />

                    <div
                      className={`absolute inset-y-0 w-[2px] ${theme === 'dark' ? 'bg-cyan-300' : 'bg-cyan-600'}`}
                      style={{ left: `${progressPct}%` }}
                    />

                    {showPreviewMarker && (
                      <>
                        <div
                          className={`absolute inset-y-0 w-[2px] border-l border-dashed ${theme === 'dark' ? 'border-amber-300/90' : 'border-amber-600/90'}`}
                          style={{ left: `${previewPct}%` }}
                        />
                        {!channel.collapsed && (
                          <div
                            className={`pointer-events-none absolute top-1 -translate-x-1/2 rounded px-1.5 py-0.5 text-[9px] font-semibold shadow ${theme === 'dark' ? 'bg-amber-400 text-gray-950' : 'bg-amber-500 text-white'}`}
                            style={{ left: `${previewPct}%` }}
                          >
                            SEEK {formatMs(previewPlayhead || 0)}
                          </div>
                        )}
                      </>
                    )}

                    {HOTCUE_SLOTS.map((slotIndex) => {
                      const cue = channel.hotcuesMs[slotIndex];
                      if (typeof cue !== 'number') return null;
                      const cuePct = clamp((cue / duration) * 100, 0, 100);
                      const color = HOTCUE_COLORS[slotIndex];
                      if (channel.collapsed) {
                        return (
                          <div
                            key={`${channel.channelId}-cue-dot-${slotIndex}`}
                            className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 h-2 w-2 rounded-full border border-black/35 ${color.marker}`}
                            style={{ left: `${cuePct}%` }}
                          />
                        );
                      }
                      return (
                        <div
                          key={`${channel.channelId}-cue-line-${slotIndex}`}
                          className={`absolute inset-y-0 w-[2px] ${color.marker}`}
                          style={{ left: `${cuePct}%` }}
                        />
                      );
                    })}
                  </div>


                  {!channel.collapsed && (
                    <div className="mt-1.5 grid grid-cols-4 gap-1">
                      {HOTCUE_SLOTS.map((slotIndex) => {
                        const cue = channel.hotcuesMs[slotIndex];
                        const hasCue = typeof cue === 'number';
                        const color = HOTCUE_COLORS[slotIndex];
                        const activeClass = theme === 'dark' ? color.activeDark : color.activeLight;
                        const editHotcueClass = editMode
                          ? (theme === 'dark'
                            ? 'shadow-[inset_0_0_0_2px_rgba(251,191,36,0.8)]'
                            : 'shadow-[inset_0_0_0_2px_rgba(217,119,6,0.8)]')
                          : '';
                        const isHolding = holdingHotcue?.channelId === channel.channelId && holdingHotcue?.slotIndex === slotIndex;
                        return (
                          <Button
                            key={`${channel.channelId}-hotcue-${slotIndex}`}
                            type="button"
                            variant="outline"
                            size="sm"
                            className={`h-8 px-0 text-[11px] relative overflow-hidden ${hasCue ? activeClass : ''} ${editHotcueClass}`}
                            onPointerDown={(event) => handleHotcuePointerDown(event, channel, slotIndex)}
                            onPointerUp={(event) => handleHotcuePointerUp(event, channel, slotIndex)}
                            onPointerLeave={() => handleHotcuePointerCancel(channel.channelId, slotIndex)}
                            onPointerCancel={() => handleHotcuePointerCancel(channel.channelId, slotIndex)}
                            onClick={() => handleHotcueClick(channel, slotIndex)}
                            disabled={!loaded}
                            title={editMode
                              ? (hasCue ? `Clear C${slotIndex + 1}` : `Set C${slotIndex + 1}`)
                              : (hasCue ? `Jump to ${formatMs(cue || 0)} (hold 5s to clear/set)` : `C${slotIndex + 1} not set (hold 5s to set)`)}
                          >
                            {isHolding && (
                              <div
                                className="absolute bottom-0 left-0 h-[3px] bg-current opacity-60 transition-none"
                                style={{ width: `${holdingHotcue.progress}%` }}
                              />
                            )}
                            {editMode && (
                              <span className={`absolute top-[1px] right-1 text-[8px] font-bold leading-none ${theme === 'dark' ? 'text-amber-300' : 'text-amber-700'}`}>
                                E
                              </span>
                            )}
                            <span className="relative z-10 pointer-events-none">C{slotIndex + 1}</span>
                          </Button>
                        );
                      })}
                    </div>
                  )}

                  <div className="mt-1.5 space-y-1">
                    <div className="flex justify-between text-[10px] text-gray-500 dark:text-gray-400">
                      <span>Channel Volume</span>
                      <span>{Math.round(displayedVolume * 100)}%</span>
                    </div>
                    <Slider
                      value={[displayedVolume * 100]}
                      min={0}
                      max={100}
                      step={0.1}
                      onValueChange={([value]) => handleChannelVolumeDrag(channel.channelId, value / 100)}
                      onValueCommit={([value]) => handleChannelVolumeCommit(channel.channelId, value / 100)}
                      className="h-8 px-1 touch-none"
                      onPointerDownCapture={stopSliderPointerPropagation}
                      onTouchStartCapture={stopSliderTouchPropagation}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className={`rounded-lg border p-3 ${sectionClasses}`}>
          <Label className="text-xs font-semibold flex items-center gap-2 mb-2">
            <Waves className="h-4 w-4" /> Current Playing Sampler
          </Label>
          <div className="space-y-2">
            {legacyPlayingPads.length === 0 && (
              <div className="text-xs text-gray-500 dark:text-gray-400">No pad-grid playback running.</div>
            )}
            {legacyPlayingPads.map((pad) => {
              const liveTiming = resolveDisplayedPlayingPadTiming(
                pad,
                playingSamplerClock.nowMs,
                playingSamplerClock.perfMs
              );
              const duration = Math.max(1, liveTiming.durationMs);
              const progress = clamp(liveTiming.progressMs, 0, duration);
              return (
                <div key={pad.padId} className={`rounded-md border p-2 ${theme === 'dark' ? 'border-gray-700 bg-gray-950/40' : 'border-gray-200 bg-white'}`}>
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium truncate">{pad.padName}</div>
                      <div className="text-[10px] text-gray-500 dark:text-gray-400 truncate">{pad.bankName}</div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => onStopPad(pad.padId)}
                      title="Stop pad"
                    >
                      <Square className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className={`mt-2 space-y-1 ${isMobile ? 'pb-0.5' : ''}`}>
                    <div className="flex justify-between text-[10px] text-gray-500 dark:text-gray-400">
                      <span>{formatMs(progress)} / {formatMs(duration)}</span>
                      <span>{Math.round(pad.volume * 100)}%</span>
                    </div>
                    <Slider
                      value={[pad.volume * 100]}
                      min={0}
                      max={100}
                      step={1}
                      onValueChange={([value]) => onPadVolumeChange(pad.padId, value / 100)}
                      className="h-8 px-1 touch-none"
                      onPointerDownCapture={stopSliderPointerPropagation}
                      onTouchStartCapture={stopSliderTouchPropagation}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
