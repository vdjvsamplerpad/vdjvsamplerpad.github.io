import * as React from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Progress } from '@/components/ui/progress';
import { PadData, SamplerBank, StopMode } from './types/sampler';
import { useAudioPlayer } from './hooks/useAudioPlayer';
import { Play, Pause, MousePointer2, Zap, VolumeX, Loader2, Ban } from 'lucide-react';
import { normalizeShortcutKey, normalizeStoredShortcutKey } from '@/lib/keyboard-shortcuts';
import type { PadEditDialog as PadEditDialogType } from './PadEditDialog';
import type { PadTransferDialog as PadTransferDialogType } from './PadTransferDialog';

const PadEditDialog = React.lazy(() => import('./PadEditDialog').then((module) => ({ default: module.PadEditDialog }))) as unknown as typeof PadEditDialogType;
const PadTransferDialog = React.lazy(() => import('./PadTransferDialog').then((module) => ({ default: module.PadTransferDialog }))) as unknown as typeof PadTransferDialogType;

interface SamplerPadProps {
  pad: PadData;
  bankId: string;
  bankName: string;
  allBanks?: SamplerBank[];
  allPads?: PadData[];
  bankPads?: PadData[];
  editMode: boolean;
  globalMuted: boolean;
  masterVolume: number;
  theme: 'light' | 'dark';
  stopMode: StopMode;
  padSize?: number;
  onUpdatePad: (bankId: string, id: string, updatedPad: PadData) => void;
  onRemovePad: (id: string) => void;
  onDuplicatePad?: (bankId: string, padId: string) => Promise<void> | void;
  onRelinkMissingPadMedia?: (bankId: string, padId: string, file: File) => Promise<void>;
  onRehydratePadMedia?: (bankId: string, padId: string) => Promise<boolean>;
  onDragStart?: (e: React.DragEvent, pad: PadData, bankId: string) => void;
  onTransferPad?: (padId: string, sourceBankId: string, targetBankId: string) => void;
  availableBanks?: Array<{ id: string; name: string; }>;
  canTransferFromBank?: (bankId: string) => boolean;
  midiEnabled?: boolean;
  blockedShortcutKeys?: Set<string>;
  blockedMidiNotes?: Set<number>;
  blockedMidiCCs?: Set<number>;
  hideShortcutLabel?: boolean;
  graphicsTier?: import('@/lib/performance-monitor').PerformanceTier;
  editRequestToken?: number;
  channelLoadArmed?: boolean;
  onSelectPadForChannelLoad?: (pad: PadData, bankId: string, bankName: string) => void;
  requiresAuthToPlay?: boolean;
  onRequireLogin?: () => void;
}

const PLAY_GREEN_HEX = '#4ade80';
const PLAY_AMBER_HEX = '#f59e0b';
const PLAY_AMBER_BORDER_HEX = '#b45309';
const PLAY_COLOR_DISTANCE_THRESHOLD = 90;
const FORCE_WARM_LONG_DURATION_MS = 90_000;
const TOUCH_TRIGGER_CLICK_SUPPRESS_MS = 700;

type RgbColor = { r: number; g: number; b: number };

const normalizeHexColor = (value: string | undefined, fallback = '#4f46e5'): string => {
  if (!value) return fallback;
  const trimmed = value.trim();
  const body = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
  if (!/^[0-9a-fA-F]{6}$/.test(body)) return fallback;
  return `#${body.toLowerCase()}`;
};

const hexToRgb = (hex: string): RgbColor => {
  const normalized = normalizeHexColor(hex, '#000000').slice(1);
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  };
};

const colorDistance = (a: string, b: string): number => {
  const first = hexToRgb(a);
  const second = hexToRgb(b);
  const dr = first.r - second.r;
  const dg = first.g - second.g;
  const db = first.b - second.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
};

const getContrastTextColor = (hex: string): '#111827' | '#ffffff' => {
  const { r, g, b } = hexToRgb(hex);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? '#111827' : '#ffffff';
};

export const SamplerPad = React.memo(function SamplerPad({
  pad,
  bankId,
  bankName,
  allBanks = [],
  allPads = [],
  bankPads = [],
  editMode,
  globalMuted,
  masterVolume,
  theme,
  stopMode,
  padSize = 5,
  onUpdatePad,
  onRemovePad,
  onDuplicatePad,
  onRelinkMissingPadMedia,
  onRehydratePadMedia,
  onDragStart,
  onTransferPad,
  availableBanks = [],
  canTransferFromBank,
  midiEnabled = false,
  blockedShortcutKeys,
  blockedMidiNotes,
  blockedMidiCCs,
  hideShortcutLabel = false,
  graphicsTier = 'low',
  editRequestToken,
  channelLoadArmed = false,
  onSelectPadForChannelLoad,
  requiresAuthToPlay = false,
  onRequireLogin
}: SamplerPadProps) {
  const audioPlayer = useAudioPlayer(
    pad,
    bankId,
    bankName,
    globalMuted,
    masterVolume
  );

  const { isPlaying, progress, isSoftMuted, playAudio, stopAudio, releaseAudio, queueNextPlaySettings } = audioPlayer;
  const {
    isWarmReady,
    isWarming,
    isPendingPlay,
    isQuarantined,
    quarantineRemainingMs,
    forceWarmAudio
  } = audioPlayer;
  const [showEditDialog, setShowEditDialog] = React.useState(false);
  const [showTransferDialog, setShowTransferDialog] = React.useState(false);
  const [isHolding, setIsHolding] = React.useState(false);
  const [imageError, setImageError] = React.useState(false);
  const [isDragging, setIsDragging] = React.useState(false);
  const lastEditTokenRef = React.useRef<number | undefined>(undefined);
  const autoRehydrateRef = React.useRef<Promise<boolean> | null>(null);
  const holdPointerIdRef = React.useRef<number | null>(null);
  const suppressClickUntilRef = React.useRef(0);
  const relinkInputRef = React.useRef<HTMLInputElement>(null);
  const [missingPadAction, setMissingPadAction] = React.useState<'custom_link' | 'official_sync' | null>(null);
  const [missingPadBusy, setMissingPadBusy] = React.useState(false);
  const [missingPadError, setMissingPadError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!editMode || !editRequestToken) return;
    if (lastEditTokenRef.current === editRequestToken) return;
    lastEditTokenRef.current = editRequestToken;
    setShowEditDialog(true);
  }, [editMode, editRequestToken]);

  const shortcutLabel = React.useMemo(() => {
    if (!pad.shortcutKey) return null;
    if (pad.shortcutKey.startsWith('Numpad')) {
      return `Num${pad.shortcutKey.replace('Numpad', '')}`;
    }
    return normalizeStoredShortcutKey(pad.shortcutKey) || normalizeShortcutKey(pad.shortcutKey) || pad.shortcutKey;
  }, [pad.shortcutKey]);

  const requestLoginForPlayback = React.useCallback(() => {
    if (!requiresAuthToPlay) return false;
    if (onRequireLogin) {
      onRequireLogin();
      return true;
    }
    window.dispatchEvent(new Event('vdjv-login-request'));
    window.dispatchEvent(new CustomEvent('vdjv-require-login', {
      detail: { reason: 'Please sign in to play default bank pads.' }
    }));
    return true;
  }, [requiresAuthToPlay, onRequireLogin]);

  const triggerPadMediaRehydrate = React.useCallback(() => {
    if (requiresAuthToPlay) return;
    if (!onRehydratePadMedia) return;
    if (pad.audioUrl) return;
    if (!pad.audioStorageKey && !pad.audioBackend) return;
    if (autoRehydrateRef.current) return;

    autoRehydrateRef.current = onRehydratePadMedia(bankId, pad.id)
      .catch(() => false)
      .finally(() => {
        autoRehydrateRef.current = null;
      });
  }, [
    bankId,
    onRehydratePadMedia,
    pad.audioBackend,
    pad.audioStorageKey,
    pad.audioUrl,
    pad.id,
    requiresAuthToPlay,
  ]);

  const queueMissingPadAction = React.useCallback(() => {
    setMissingPadError(null);
    setMissingPadAction(pad.restoreAssetKind === 'custom_local_media' ? 'custom_link' : 'official_sync');
  }, [pad.restoreAssetKind]);

  const handlePadClick = (e: React.MouseEvent) => {
    if (Date.now() < suppressClickUntilRef.current) {
      e.preventDefault();
      return;
    }
    // Don't handle pad click if clicking on the transfer indicator
    if ((e.target as HTMLElement).closest('.transfer-indicator')) {
      return;
    }

    if (channelLoadArmed && onSelectPadForChannelLoad) {
      onSelectPadForChannelLoad(pad, bankId, bankName);
      return;
    }
    if (pad.missingMediaExpected && !pad.audioUrl) {
      queueMissingPadAction();
      return;
    }
    if (!editMode && requestLoginForPlayback()) return;
    if (!editMode && isPadMediaRehydrating) {
      triggerPadMediaRehydrate();
      return;
    }

    if (editMode) {
      setShowEditDialog(true);
    } else if (pad.triggerMode === 'toggle') {
      if (isPlaying) stopAudio();
      else {
        triggerPadMediaRehydrate();
        playAudio();
      }
    } else if (pad.triggerMode !== 'hold') {
      triggerPadMediaRehydrate();
      playAudio();
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (editMode || channelLoadArmed) return;
    if ((e.target as HTMLElement).closest('.transfer-indicator')) {
      return;
    }
    if (pad.missingMediaExpected && !pad.audioUrl) {
      e.preventDefault();
      queueMissingPadAction();
      return;
    }
    if (pad.triggerMode === 'stutter') {
      if (e.pointerType === 'mouse') return;
      if (requestLoginForPlayback()) return;
      if (isPadMediaRehydrating) {
        triggerPadMediaRehydrate();
        return;
      }
      suppressClickUntilRef.current = Date.now() + TOUCH_TRIGGER_CLICK_SUPPRESS_MS;
      e.preventDefault();
      triggerPadMediaRehydrate();
      playAudio();
      return;
    }
    if (pad.triggerMode !== 'hold') return;
    if (requestLoginForPlayback()) return;
    if (isPadMediaRehydrating) {
      triggerPadMediaRehydrate();
      return;
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (holdPointerIdRef.current !== null && holdPointerIdRef.current !== e.pointerId) return;

    holdPointerIdRef.current = e.pointerId;
    e.preventDefault();
    setIsHolding(true);
    triggerPadMediaRehydrate();
    playAudio();
  };

  const handlePointerRelease = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (editMode || channelLoadArmed) return;
    if (pad.triggerMode !== 'hold') return;
    if (holdPointerIdRef.current !== null && holdPointerIdRef.current !== e.pointerId) return;

    holdPointerIdRef.current = null;
    setIsHolding(false);
    releaseAudio();
  };

  const handlePointerLeave = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (editMode || channelLoadArmed) return;
    if (pad.triggerMode !== 'hold') return;
    if (e.pointerType !== 'mouse') return;
    if (!isHolding) return;
    if (holdPointerIdRef.current !== null && holdPointerIdRef.current !== e.pointerId) return;

    holdPointerIdRef.current = null;
    setIsHolding(false);
    releaseAudio();
  };

  const handleDragStart = (e: React.DragEvent) => {
    if (!editMode) {
      e.preventDefault();
      return;
    }

    setIsDragging(true);
    e.dataTransfer.effectAllowed = 'move';

    // Set both data formats for better compatibility
    const transferData = {
      type: 'pad-transfer',
      pad: pad,
      sourceBankId: bankId
    };

    e.dataTransfer.setData('application/json', JSON.stringify(transferData));
    e.dataTransfer.setData('text/plain', JSON.stringify(transferData));

    if (onDragStart) {
      onDragStart(e, pad, bankId);
    }
  };

  const handleDragEnd = () => {
    setIsDragging(false);
  };

  const handleTransferClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    // Check if this bank allows transfers
    if (canTransferFromBank && !canTransferFromBank(bankId)) {
      return;
    }

    if (availableBanks.length > 1) { // Current bank + other banks
      setShowTransferDialog(true);
    }
  };

  const handleTransfer = (targetBankId: string) => {
    if (onTransferPad && targetBankId !== bankId) {
      onTransferPad(pad.id, bankId, targetBankId);
    }
    setShowTransferDialog(false);
  };

  const handleSave = async (updatedPad: PadData) => {
    try {
      await onUpdatePad(bankId, pad.id, updatedPad);
      queueNextPlaySettings(updatedPad);
      setShowEditDialog(false);
    } catch {
    }
  };

  const handleDuplicatePad = React.useCallback(async () => {
    if (!onDuplicatePad) return;
    try {
      await onDuplicatePad(bankId, pad.id);
      setShowEditDialog(false);
    } catch {
    }
  }, [bankId, onDuplicatePad, pad.id]);


  const handleUnload = () => {
    onRemovePad(pad.id);
    setShowEditDialog(false);
  };

  const handleRetryMedia = React.useCallback(async () => {
    if (!onRehydratePadMedia) {
      throw new Error('Media sync is unavailable right now.');
    }
    const restored = await onRehydratePadMedia(bankId, pad.id);
    if (!restored) {
      throw new Error('Media is still unavailable. Keep this bank selected and try again.');
    }
    return true;
  }, [bankId, onRehydratePadMedia, pad.id]);

  const handleRelinkFileChange = React.useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !onRelinkMissingPadMedia) return;
    setMissingPadBusy(true);
    setMissingPadError(null);
    try {
      await onRelinkMissingPadMedia(bankId, pad.id, file);
    } catch (error) {
      setMissingPadError(error instanceof Error ? error.message : 'Could not relink pad audio.');
    } finally {
      setMissingPadBusy(false);
    }
  }, [bankId, onRelinkMissingPadMedia, pad.id]);

  const handleImageError = () => {
    setImageError(true);
  };

  const handleImageLoad = () => {
    setImageError(false);
  };

  const nameLength = pad.name?.length || 0;
  const fontScale = nameLength > 40 ? 0.6 : nameLength > 30 ? 0.7 : nameLength > 22 ? 0.8 : nameLength > 16 ? 0.9 : 1;

  const getButtonOpacity = () => {
    if (pad.triggerMode === 'unmute' && isPlaying && isSoftMuted) {
      return 'opacity-45';
    }
    if (isDragging) {
      return 'opacity-50';
    }
    return '';
  };

  const isLowestGraphics = graphicsTier === 'lowest';
  const shouldShowImage = !isLowestGraphics && pad.imageUrl && !imageError;
  const shouldShowText = !shouldShowImage;
  const isSnapshotMissingPad = Boolean(pad.missingMediaExpected && !pad.audioUrl);
  const isSnapshotMissingCustomPad = isSnapshotMissingPad && pad.restoreAssetKind === 'custom_local_media';
  const isPadMediaRehydrating =
    !requiresAuthToPlay &&
    !pad.audioUrl &&
    Boolean(pad.audioStorageKey || pad.audioBackend);
  const estimatedPadDurationMs = React.useMemo(() => {
    if (typeof pad.audioDurationMs === 'number' && Number.isFinite(pad.audioDurationMs) && pad.audioDurationMs > 0) {
      return pad.audioDurationMs;
    }
    if (
      typeof pad.endTimeMs === 'number' &&
      Number.isFinite(pad.endTimeMs) &&
      typeof pad.startTimeMs === 'number' &&
      Number.isFinite(pad.startTimeMs)
    ) {
      const range = pad.endTimeMs - pad.startTimeMs;
      if (range > 0) return range;
    }
    return null;
  }, [pad.audioDurationMs, pad.endTimeMs, pad.startTimeMs]);
  const isLongDurationPad = estimatedPadDurationMs !== null && estimatedPadDurationMs >= FORCE_WARM_LONG_DURATION_MS;
  const shouldShowForceWarm =
    !editMode &&
    !channelLoadArmed &&
    !requiresAuthToPlay &&
    Boolean(pad.audioUrl) &&
    !isPlaying &&
    !isPadMediaRehydrating &&
    isLongDurationPad &&
    (!isWarmReady || isWarming || isPendingPlay || isQuarantined);
  const quarantineMinutes = Math.max(1, Math.ceil(quarantineRemainingMs / 60_000));
  const showWarmStateIcon = shouldShowForceWarm;
  const warmStateMode: 'blocked' | 'warming' | 'ready_to_warm' = isQuarantined
    ? 'blocked'
    : (isWarming || isPendingPlay)
      ? 'warming'
      : 'ready_to_warm';
  const warmStateTitle =
    warmStateMode === 'blocked'
      ? `Temporarily blocked due to repeated load failures (${quarantineMinutes}m left).`
      : warmStateMode === 'warming'
        ? (isPendingPlay ? 'Tap to cancel pending play' : 'Warmup in progress')
        : 'Tap to force warm this long pad (no auto-play)';
  const warmStateIconClass = warmStateMode === 'blocked'
    ? (theme === 'dark'
      ? 'bg-rose-500/85 text-rose-50 border-rose-300/50 hover:bg-rose-400/90'
      : 'bg-rose-500 text-white border-rose-700 hover:bg-rose-600')
    : warmStateMode === 'warming'
      ? (theme === 'dark'
        ? 'bg-cyan-500/85 text-cyan-950 border-cyan-200/60 hover:bg-cyan-400/90'
        : 'bg-cyan-500 text-white border-cyan-700 hover:bg-cyan-600')
      : (theme === 'dark'
        ? 'bg-amber-500/85 text-amber-950 border-amber-200/60 hover:bg-amber-400/90'
        : 'bg-amber-500 text-white border-amber-700 hover:bg-amber-600');
  const handleWarmStateIconClick = React.useCallback((event: React.MouseEvent | React.PointerEvent) => {
    event.stopPropagation();
    event.preventDefault();
    if (warmStateMode === 'blocked') return;
    if (isPendingPlay) {
      stopAudio();
      return;
    }
    if (isWarming) return;
    forceWarmAudio();
  }, [forceWarmAudio, isPendingPlay, isWarming, stopAudio, warmStateMode]);

  const handleWarmStateIconKeyDown = React.useCallback((event: React.KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    if (warmStateMode === 'blocked') return;
    if (isPendingPlay) {
      stopAudio();
      return;
    }
    if (isWarming) return;
    forceWarmAudio();
  }, [forceWarmAudio, isPendingPlay, isWarming, stopAudio, warmStateMode]);

  const getEditModeClasses = () => {
    if (editMode) {
      return 'cursor-grab active:cursor-grabbing perf-high:shadow-[inset_0_0_0_3px_rgba(251,146,60,0.95),inset_0_0_0_4px_rgba(0,0,0,0.12)] perf-medium:shadow-[inset_0_0_0_2px_rgba(251,146,60,0.95)] perf-low:ring-2 perf-low:ring-orange-400 perf-lowest:ring-2 perf-lowest:ring-orange-500';
    }
    if (channelLoadArmed) {
      return 'cursor-pointer perf-high:shadow-[inset_0_0_0_3px_rgba(16,185,129,0.95),inset_0_0_0_4px_rgba(0,0,0,0.12)] perf-medium:shadow-[inset_0_0_0_2px_rgba(16,185,129,0.95)] perf-low:ring-2 perf-low:ring-emerald-400 perf-lowest:ring-2 perf-lowest:ring-emerald-500';
    }
    return 'cursor-pointer';
  };

  const getEditModeButtonClasses = () => {
    return editMode ? '' : '';
  };

  const normalizedPadColor = React.useMemo(() => normalizeHexColor(pad.color), [pad.color]);
  const displayedPadVolumePercent = Math.round(Math.max(0, Math.min(1, pad.volume)) * 100);
  const isNearPlayGreen = React.useMemo(
    () => colorDistance(normalizedPadColor, PLAY_GREEN_HEX) <= PLAY_COLOR_DISTANCE_THRESHOLD,
    [normalizedPadColor]
  );
  const playFillColor = isNearPlayGreen ? PLAY_AMBER_HEX : PLAY_GREEN_HEX;
  const playBorderColor = isNearPlayGreen ? PLAY_AMBER_BORDER_HEX : '#166534';
  const playTextColor = React.useMemo(() => getContrastTextColor(playFillColor), [playFillColor]);
  const playTextClass = playTextColor === '#111827' ? 'text-gray-900' : 'text-white';
  const isUnmutePlayingMuted = pad.triggerMode === 'unmute' && isPlaying && isSoftMuted;
  const isUnmutePlayingAudible = pad.triggerMode === 'unmute' && isPlaying && !isSoftMuted;
  const lowestGraphicsTextColor = React.useMemo(() => getContrastTextColor(normalizedPadColor), [normalizedPadColor]);
  const lowestGraphicsTextClass = lowestGraphicsTextColor === '#111827' ? 'text-gray-900' : 'text-white';
  const inactiveBackgroundColor = isLowestGraphics
    ? normalizedPadColor
    : `${normalizedPadColor}${theme === 'dark' ? 'CC' : 'E6'}`;
  const isMotionOff =
    typeof document !== 'undefined' && document.documentElement.classList.contains('motion-off');

  const getTriggerModeIcon = () => {
    // Smaller icons on mobile to maximize text space
    const iconSize = 'w-2 h-2 sm:w-3 sm:h-3';
    switch (pad.triggerMode) {
      case 'toggle':
        if (isPlaying) {
          return <Pause className={`${iconSize} text-blue-400`} />;
        } else {
          return <Play className={`${iconSize} text-blue-400`} />;
        }
      case 'hold':
        return <MousePointer2 className={`${iconSize} text-green-400`} />;
      case 'stutter':
        return <Zap className={`${iconSize} text-orange-400`} />;
      case 'unmute':
        return <VolumeX className={`${iconSize} text-purple-400`} />;
      default:
        return null;
    }
  };

  const getTriggerModeColor = () => {
    switch (pad.triggerMode) {
      case 'toggle':
        return '#60a5fa'; // blue-400
      case 'hold':
        return '#4ade80'; // green-400
      case 'stutter':
        return '#fb923c'; // orange-400
      case 'unmute':
        return '#c084fc'; // purple-400
      default:
        return '#9ca3af'; // gray-400
    }
  };

  // Filter out current bank from available banks for transfer (memoized)
  const transferableBanks = React.useMemo(
    () => availableBanks.filter(bank => bank.id !== bankId),
    [availableBanks, bankId]
  );

  return (
    <>
      <Button
        onClick={handlePadClick}
        onPointerDown={(pad.triggerMode === 'hold' || pad.triggerMode === 'stutter') && !editMode ? handlePointerDown : undefined}
        onPointerUp={pad.triggerMode === 'hold' && !editMode ? handlePointerRelease : undefined}
        onPointerCancel={pad.triggerMode === 'hold' && !editMode ? handlePointerRelease : undefined}
        onPointerLeave={pad.triggerMode === 'hold' && !editMode ? handlePointerLeave : undefined}
        draggable={editMode}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        // Added title for native browser tooltip on hover (shows full name)
        title={shouldShowText ? pad.name : undefined}
        className={`
          w-full h-full min-h-0 md:min-h-[80px] min-w-0 max-w-full font-bold border-2 relative overflow-hidden select-none rounded-[0.75rem]
          ${getButtonOpacity()} ${getEditModeClasses()} ${getEditModeButtonClasses()}
          perf-high:transition-all perf-high:duration-200 perf-high:ease-out 
          perf-medium:transition-colors perf-medium:duration-150 
          perf-low:transition-none
          perf-lowest:transition-none
          perf-high:hover:scale-[1.01] perf-high:active:scale-[0.98]
          perf-high:shadow-sm perf-high:hover:shadow-md
          perf-low:shadow-none
          perf-lowest:shadow-none
          ${isDragging ? 'z-50' : ''}
          ${isPlaying
            ? `${playTextClass} ring-2 ${isUnmutePlayingMuted
              ? (isLowestGraphics ? 'ring-fuchsia-300 border-fuchsia-700' : 'ring-fuchsia-200/80 border-fuchsia-400')
              : isNearPlayGreen
                ? (isLowestGraphics ? 'ring-amber-300 border-amber-700' : 'ring-amber-200/80 border-amber-700')
                : (isLowestGraphics ? 'ring-green-300 border-green-700' : 'ring-green-200/70 border-green-300')}`
            : theme === 'dark'
              ? `${isLowestGraphics ? `border-white/20 ${lowestGraphicsTextClass} hover:border-white/30` : 'border-white/10 text-white hover:border-white/30'} perf-high:backdrop-blur-sm perf-low:backdrop-blur-none perf-lowest:backdrop-blur-none`
              : `${isLowestGraphics ? 'border-black/15 text-gray-900 hover:border-black/20' : 'border-black/5 text-gray-900 hover:border-black/20'} perf-high:backdrop-blur-sm perf-low:backdrop-blur-none perf-lowest:backdrop-blur-none`
          }
        `}
        style={{
          // Use slightly higher opacity (E6 = ~90%) for better contrast on non-playing pads.
          backgroundColor: isPlaying ? playFillColor : inactiveBackgroundColor,
          color: isPlaying ? playTextColor : undefined
        }}
      >
        {shortcutLabel && !hideShortcutLabel && !isLowestGraphics && (
          <div className={`absolute top-0 left-1/2 -translate-x-1/2 z-20 px-1.5 py-0.5 rounded text-[9px] font-semibold tracking-wide ${theme === 'dark'
            ? 'bg-gray-900/70 text-gray-100'
            : 'bg-white/70 text-gray-800'
            }`}>
            {shortcutLabel}
          </div>
        )}
        {isPlaying && !isLowestGraphics && (
          <>
            <div
              className="absolute inset-[3px] z-10 rounded-[0.62rem] pointer-events-none border-2"
              style={{ borderColor: isUnmutePlayingMuted ? '#c026d3' : playBorderColor }}
            />
            <div
              className={`absolute top-1 left-1 z-20 rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wide pointer-events-none ${playTextClass}`}
              style={{ backgroundColor: isUnmutePlayingMuted ? '#a21caf' : playBorderColor }}
            >
              PLAY
            </div>
            {isUnmutePlayingMuted && (
              <div
                className="absolute top-1 right-5 z-20 rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wide pointer-events-none text-white"
                style={{ backgroundColor: '#c026d3' }}
              >
                MUTED
              </div>
            )}
            {isUnmutePlayingAudible && (
              <div
                className="absolute top-1 right-5 z-20 rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wide pointer-events-none text-white"
                style={{ backgroundColor: '#7c3aed' }}
              >
                LIVE
              </div>
            )}
          </>
        )}
        {(editMode || channelLoadArmed) && !isLowestGraphics && (
          <div
            className={`absolute bottom-1 right-1 z-20 rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wide pointer-events-none ${
              editMode
                ? (theme === 'dark' ? 'bg-amber-500/85 text-amber-950' : 'bg-amber-500 text-white')
                : (theme === 'dark' ? 'bg-emerald-500/85 text-emerald-950' : 'bg-emerald-500 text-white')
            }`}
          >
            {editMode ? 'EDIT' : 'LOAD'}
          </div>
        )}
        {(editMode || channelLoadArmed) && isLowestGraphics && (
          <>
            <div
              className="absolute inset-[3px] z-20 rounded-[0.62rem] pointer-events-none border-2"
              style={{ borderColor: editMode ? '#f59e0b' : '#10b981' }}
            />
            <div
              className="absolute bottom-1 right-1 z-20 h-2.5 w-2.5 rounded-sm pointer-events-none"
              style={{ backgroundColor: editMode ? '#f59e0b' : '#10b981' }}
            />
          </>
        )}
        {isPadMediaRehydrating && !editMode && !channelLoadArmed && (
          <div
            className={`absolute bottom-1 left-1 z-20 rounded px-1.5 py-0.5 text-[9px] font-semibold tracking-wide pointer-events-none flex items-center gap-1 ${
              theme === 'dark'
                ? 'bg-blue-500/80 text-blue-50'
                : 'bg-blue-500 text-white'
            }`}
          >
            {!isLowestGraphics ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : null}
            <span>Syncing</span>
          </div>
        )}
        {isSnapshotMissingPad && !editMode && !channelLoadArmed && !missingPadBusy && (
          <div
            className={`absolute bottom-1 left-1 z-20 rounded px-1.5 py-0.5 text-[9px] font-semibold tracking-wide pointer-events-none ${
              theme === 'dark'
                ? 'bg-amber-500/85 text-amber-950'
                : 'bg-amber-500 text-white'
            }`}
          >
            {isSnapshotMissingCustomPad ? 'Missing File' : 'Tap to Sync'}
          </div>
        )}
        {missingPadBusy && (
          <div
            className={`absolute bottom-1 left-1 z-20 rounded px-1.5 py-0.5 text-[9px] font-semibold tracking-wide pointer-events-none flex items-center gap-1 ${
              theme === 'dark'
                ? 'bg-indigo-500/85 text-indigo-50'
                : 'bg-indigo-600 text-white'
            }`}
          >
            <Loader2 className="w-2.5 h-2.5 animate-spin" />
            <span>{isSnapshotMissingCustomPad ? 'Linking' : 'Syncing'}</span>
          </div>
        )}
        {missingPadError && !missingPadBusy && (
          <div
            className={`absolute bottom-1 left-1 z-20 rounded px-1.5 py-0.5 text-[9px] font-semibold tracking-wide pointer-events-none ${
              theme === 'dark'
                ? 'bg-red-500/85 text-red-50'
                : 'bg-red-600 text-white'
            }`}
          >
            Link failed
          </div>
        )}
        {/* Drag/Transfer indicator for edit mode - smaller on mobile */}
        {editMode && (
          <div
            onClick={handleTransferClick}
            className={`transfer-indicator absolute top-0.5 left-0.5 sm:top-1 sm:left-1 p-0.5 sm:p-1 rounded-full transition-all hover:scale-110 z-10 ${transferableBanks.length > 0 && (!canTransferFromBank || canTransferFromBank(bankId))
              ? 'bg-orange-500 hover:bg-orange-400 cursor-pointer'
              : 'bg-gray-500 cursor-not-allowed'
              }`}
            title={
              transferableBanks.length > 0 && (!canTransferFromBank || canTransferFromBank(bankId))
                ? 'Click to transfer to another bank'
                : canTransferFromBank && !canTransferFromBank(bankId)
                  ? 'Transfers not allowed from this bank'
                  : 'No other banks available'
            }
            style={{ pointerEvents: 'auto' }}
          >
            <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 grid grid-cols-2 gap-0.5">
              <div className="w-0.5 h-0.5 sm:w-1 sm:h-1 bg-white rounded-full"></div>
              <div className="w-0.5 h-0.5 sm:w-1 sm:h-1 bg-white rounded-full"></div>
              <div className="w-0.5 h-0.5 sm:w-1 sm:h-1 bg-white rounded-full"></div>
              <div className="w-0.5 h-0.5 sm:w-1 sm:h-1 bg-white rounded-full"></div>
            </div>
          </div>
        )}

        {/* Trigger Mode Indicator */}
        {isLowestGraphics ? (
          showWarmStateIcon ? (
            <div
              role="button"
              tabIndex={0}
              aria-disabled={warmStateMode === 'blocked'}
              className={`absolute top-0.5 sm:top-1 right-0.5 sm:right-1 z-10 w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full border flex items-center justify-center ${warmStateIconClass}`}
              title={warmStateTitle}
              onPointerDown={handleWarmStateIconClick}
              onClick={handleWarmStateIconClick}
              onKeyDown={handleWarmStateIconKeyDown}
            >
              {warmStateMode === 'blocked' ? (
                <Ban className="w-2 h-2 sm:w-2.5 sm:h-2.5" />
              ) : (
                <Loader2 className={`w-2 h-2 sm:w-2.5 sm:h-2.5 ${warmStateMode === 'warming' ? 'animate-spin' : ''}`} />
              )}
            </div>
          ) : (
            <div
              className="absolute top-0.5 sm:top-1 right-0.5 sm:right-1 pointer-events-none z-10"
              title={`Trigger: ${pad.triggerMode}`}
            >
              <div
                className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full border border-black/35 dark:border-white/25"
                style={{ backgroundColor: getTriggerModeColor() }}
              />
            </div>
          )
        ) : (
          <div className={`absolute top-0.5 right-0.5 sm:top-1 sm:right-1 p-0.5 sm:p-1 rounded-full z-10 bg-black bg-opacity-20 ${showWarmStateIcon ? '' : 'pointer-events-none'}`}>
            {showWarmStateIcon ? (
              <div
                role="button"
                tabIndex={0}
                aria-disabled={warmStateMode === 'blocked'}
                className={`w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full border flex items-center justify-center ${warmStateIconClass}`}
                title={warmStateTitle}
                onPointerDown={handleWarmStateIconClick}
                onClick={handleWarmStateIconClick}
                onKeyDown={handleWarmStateIconKeyDown}
              >
                {warmStateMode === 'blocked' ? (
                  <Ban className="w-2 h-2 sm:w-2.5 sm:h-2.5" />
                ) : (
                  <Loader2 className={`w-2 h-2 sm:w-2.5 sm:h-2.5 ${warmStateMode === 'warming' ? 'animate-spin' : ''}`} />
                )}
              </div>
            ) : (
              <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 flex items-center justify-center">
                {getTriggerModeIcon()}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col items-center justify-center h-full w-full pointer-events-none p-0 sm:p-2 overflow-hidden">
          {shouldShowImage ? (
            <div className="absolute inset-0 z-0">
              <img
                src={pad.imageUrl}
                alt={pad.name}
                className="w-full h-full object-cover rounded object-center"
                onError={handleImageError}
                onLoad={handleImageLoad}
              />
            </div>
          ) : shouldShowText ? (
            /* ENHANCED TEXT RENDERING - RESPONSIVE TO PAD SIZE:
               - Text fills entire pad space with absolute positioning
               - Viewport-relative font sizing for very small pads (uses clamp for min/max)
               - Zero padding on mobile to maximize space, minimal on desktop
               - Text scales with actual pad dimensions, not just padSize prop
               - Maximum lines allowed based on available space
               - Strong text shadows for readability
               - Tighter line height for better space utilization
            */
            <div className="absolute inset-0 flex items-center justify-center px-0 py-0 w-full h-full overflow-hidden">
              <span
                className={`text-center font-bold leading-[1.05] break-words whitespace-normal ${isPlaying
                  ? `${playTextClass} drop-shadow-none`
                  : isLowestGraphics
                    ? `${lowestGraphicsTextClass} drop-shadow-none`
                  : theme === 'dark'
                    ? 'text-white perf-high:drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)] perf-medium:drop-shadow-[0_1px_2px_rgba(0,0,0,0.75)] perf-low:drop-shadow-none'
                    : 'text-gray-900 perf-high:drop-shadow-[0_2px_4px_rgba(255,255,255,0.9)] perf-medium:drop-shadow-[0_1px_2px_rgba(255,255,255,0.75)] perf-low:drop-shadow-none'
                  }`}
                style={{
                  // Responsive font sizing that scales with viewport and pad size
                  // Uses clamp for min/max bounds, viewport units for scaling
                  // Minimum sizes ensure readability even on very small pads
                  fontSize: padSize <= 4
                    ? (isLowestGraphics
                      ? `${Math.round(14 * fontScale)}px`
                      : `clamp(${Math.round(12 * fontScale)}px, min(6vw, 6vh, 1.4em), ${Math.round(24 * fontScale)}px)`)
                    : padSize <= 8
                      ? (isLowestGraphics
                        ? `${Math.round(12 * fontScale)}px`
                        : `clamp(${Math.round(11 * fontScale)}px, min(5vw, 5vh, 1.2em), ${Math.round(20 * fontScale)}px)`)
                      : (isLowestGraphics
                        ? `${Math.round(10 * fontScale)}px`
                        : `clamp(${Math.round(10 * fontScale)}px, min(4vw, 4vh, 1.1em), ${Math.round(16 * fontScale)}px)`),
                  padding: '1px 2px',
                  maxWidth: 'calc(100% - 4px)',
                  maxHeight: '100%',
                  wordBreak: 'break-word',
                  overflowWrap: 'break-word',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '100%',
                  height: '100%',
                  boxSizing: 'border-box'
                }}
              >
                {pad.name}
              </span>
            </div>
          ) : null}

          {/* Volume percentage - smaller and positioned at bottom on mobile, hidden if playing */}
          {!isPlaying && !isLowestGraphics && (
            <div
              className={`absolute bottom-0 right-0 opacity-75 whitespace-nowrap z-20 ${theme === 'dark'
                ? 'text-gray-300 perf-high:drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] perf-low:drop-shadow-none'
                : 'text-gray-600 perf-high:drop-shadow-[0_1px_2px_rgba(255,255,255,0.8)] perf-low:drop-shadow-none'
                }`}
              style={{ fontSize: 'clamp(7px, min(2vw, 2vh), 10px)', padding: '1px 2px' }}
            >
              {displayedPadVolumePercent}%
            </div>
          )}

          {/* Progress bar - only show when playing, positioned at very bottom */}
          {isPlaying && !isLowestGraphics && (
            <div className="absolute bottom-0 left-0 right-0 px-0 w-full z-10">
              <Progress value={progress} className="h-0.5 sm:h-1 rounded-full" instant={isMotionOff} />
              <div
                className={`absolute bottom-0 right-0 opacity-75 whitespace-nowrap ${playTextClass}`}
                style={{ fontSize: 'clamp(7px, min(2vw, 2vh), 10px)', padding: '1px 2px' }}
              >
                {displayedPadVolumePercent}%
              </div>
            </div>
          )}
        </div>
      </Button>

      <input
        ref={relinkInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={handleRelinkFileChange}
      />

      <ConfirmationDialog
        open={missingPadAction === 'custom_link'}
        onOpenChange={(open) => {
          if (!open) setMissingPadAction(null);
        }}
        title="Relink Missing Pad Audio"
        description={missingPadError || 'This pad was restored from metadata only and still needs its original audio file on this device. Choose the original audio file to relink it. Pad images will be cleared after relink.'}
        confirmText="Choose Audio File"
        cancelText="Cancel"
        onConfirm={() => {
          setMissingPadAction(null);
          window.setTimeout(() => relinkInputRef.current?.click(), 0);
        }}
        theme={theme}
      />

      <ConfirmationDialog
        open={missingPadAction === 'official_sync'}
        onOpenChange={(open) => {
          if (!open) setMissingPadAction(null);
        }}
        title={pad.restoreAssetKind === 'paid_asset' ? 'Restore Official Pad?' : 'Sync Default Pad?'}
        description={missingPadError || (
          pad.restoreAssetKind === 'paid_asset'
            ? 'This official paid pad is missing on this device. Continue to restore its source assets now.'
            : 'This Default Bank pad is missing on this device. Continue to restore its built-in source assets now.'
        )}
        confirmText={pad.restoreAssetKind === 'paid_asset' ? 'Restore Pad' : 'Sync Pad'}
        cancelText="Cancel"
        onConfirm={() => {
          setMissingPadAction(null);
          setMissingPadBusy(true);
          setMissingPadError(null);
          void handleRetryMedia()
            .catch((error) => {
              setMissingPadError(error instanceof Error ? error.message : 'Pad media sync failed.');
            })
            .finally(() => {
              setMissingPadBusy(false);
            });
        }}
        theme={theme}
      />

      {showEditDialog && (
        <React.Suspense fallback={null}>
          <PadEditDialog
            pad={pad}
            allBanks={allBanks}
            allPads={allPads}
            bankPads={bankPads}
            theme={theme}
            graphicsTier={graphicsTier}
            open={showEditDialog}
            onOpenChange={setShowEditDialog}
            onSave={handleSave}
            onDuplicate={onDuplicatePad ? handleDuplicatePad : undefined}
            onUnload={handleUnload}
            onRetryMedia={handleRetryMedia}
            midiEnabled={midiEnabled}
            blockedShortcutKeys={blockedShortcutKeys}
            blockedMidiNotes={blockedMidiNotes}
            blockedMidiCCs={blockedMidiCCs}
          />
        </React.Suspense>
      )}

      {showTransferDialog && (
        <React.Suspense fallback={null}>
          <PadTransferDialog
            pad={pad}
            availableBanks={transferableBanks}
            open={showTransferDialog}
            onOpenChange={setShowTransferDialog}
            onTransfer={handleTransfer}
            theme={theme}
          />
        </React.Suspense>
      )}
    </>
  );
});
