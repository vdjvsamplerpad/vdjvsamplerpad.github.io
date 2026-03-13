import * as React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Copy, Image as ImageIcon, RefreshCw } from 'lucide-react';
import { PadData, SamplerBank } from './types/sampler';
import { WaveformTrim } from './WaveformTrim';
import { isReservedShortcutCombo, normalizeShortcutKey, normalizeStoredShortcutKey, RESERVED_SHORTCUT_KEYS } from '@/lib/keyboard-shortcuts';
import { MidiMessage } from '@/lib/midi';
import { EXTRA_PAD_COLORS, PRIMARY_PAD_COLORS } from './padColorPalette';

interface PadEditDialogProps {
  pad: PadData;
  allBanks?: SamplerBank[];
  allPads?: PadData[];
  bankPads?: PadData[];
  theme?: 'light' | 'dark';
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (pad: PadData) => void;
  onDuplicate?: () => Promise<void> | void;
  onUnload: () => void;
  onRetryMedia?: () => Promise<boolean>;
  midiEnabled?: boolean;
  blockedShortcutKeys?: Set<string>;
  blockedMidiNotes?: Set<number>;
  blockedMidiCCs?: Set<number>;
  graphicsTier?: import('@/lib/performance-monitor').PerformanceTier;
}

const MIN_PAD_GAIN_DB = -24;
const MAX_PAD_GAIN_DB = 24;
const COMPACT_BAKED_TRIM_MIN_DELTA_MS = 10000;

const clampPadGainDb = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(MIN_PAD_GAIN_DB, Math.min(MAX_PAD_GAIN_DB, value));
};

const resolvePadGainDb = (pad: PadData): number => {
  if (typeof pad.gainDb === 'number' && Number.isFinite(pad.gainDb)) {
    return clampPadGainDb(pad.gainDb);
  }
  if (typeof pad.gain === 'number' && Number.isFinite(pad.gain) && pad.gain > 0) {
    return clampPadGainDb(20 * Math.log10(pad.gain));
  }
  return 0;
};

const gainDbToLinear = (gainDb: number): number => Math.pow(10, gainDb / 20);

const observedDurationByAudioUrl = new Map<string, number>();

const getCachedObservedDurationMs = (audioUrl?: string): number => {
  if (typeof audioUrl !== 'string' || audioUrl.length === 0) return 0;
  const cached = observedDurationByAudioUrl.get(audioUrl);
  return typeof cached === 'number' && Number.isFinite(cached) && cached > 0
    ? cached
    : 0;
};

const cacheObservedDurationMs = (audioUrl: string | undefined, durationMs: number): void => {
  if (typeof audioUrl !== 'string' || audioUrl.length === 0) return;
  if (!Number.isFinite(durationMs) || durationMs <= 0) return;
  observedDurationByAudioUrl.set(audioUrl, Math.max(0, Math.round(durationMs)));
};

const resolveSourceDurationMs = (pad: PadData): number => {
  const explicitDuration = typeof pad.audioDurationMs === 'number' && Number.isFinite(pad.audioDurationMs)
    ? Math.max(0, pad.audioDurationMs)
    : 0;
  const cachedObservedDuration = getCachedObservedDurationMs(pad.audioUrl);
  return Math.max(explicitDuration, cachedObservedDuration);
};

export function PadEditDialog({
  pad,
  allBanks = [],
  allPads = [],
  bankPads = [],
  theme = 'light',
  open,
  onOpenChange,
  onSave,
  onDuplicate,
  onUnload,
  onRetryMedia,
  midiEnabled = false,
  blockedShortcutKeys,
  blockedMidiNotes,
  blockedMidiCCs,
  graphicsTier = 'low'
}: PadEditDialogProps) {
  type PadWithMidi = PadData & { midiNote?: number; midiCC?: number };
  const isIOS = React.useMemo(
    () => typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent),
    []
  );
  const [name, setName] = React.useState(pad.name);
  const [color, setColor] = React.useState(pad.color);
  const [triggerMode, setTriggerMode] = React.useState(pad.triggerMode);
  const [playbackMode, setPlaybackMode] = React.useState(pad.playbackMode);
  const [volume, setVolume] = React.useState([pad.volume * 100]);
  const [gainDb, setGainDb] = React.useState([resolvePadGainDb(pad)]);
  const [startTimeMs, setStartTimeMs] = React.useState([pad.startTimeMs || 0]);
  const [endTimeMs, setEndTimeMs] = React.useState([pad.endTimeMs || 0]);
  const [fadeInMs, setFadeInMs] = React.useState([pad.fadeInMs || 0]);
  const [fadeOutMs, setFadeOutMs] = React.useState([pad.fadeOutMs || 0]);
  const [pitch, setPitch] = React.useState([pad.pitch || 0]);
  const [tempoPercent, setTempoPercent] = React.useState([isIOS ? 0 : (typeof pad.tempoPercent === 'number' ? pad.tempoPercent : 0)]);
  const [keyLock, setKeyLock] = React.useState(isIOS ? false : pad.keyLock !== false);
  const [imageUrl, setImageUrl] = React.useState(pad.imageUrl || '');
  const [imageData, setImageData] = React.useState(pad.imageData || '');
  const [shortcutKey, setShortcutKey] = React.useState(pad.shortcutKey || '');
  const [shortcutError, setShortcutError] = React.useState<string | null>(null);
  const [midiError, setMidiError] = React.useState<string | null>(null);
  const [midiNote, setMidiNote] = React.useState<number | undefined>((pad as PadWithMidi).midiNote);
  const [midiCC, setMidiCC] = React.useState<number | undefined>((pad as PadWithMidi).midiCC);
  const [midiLearnActive, setMidiLearnActive] = React.useState(false);
  const [audioDuration, setAudioDuration] = React.useState(resolveSourceDurationMs(pad));
  const [isUploading, setIsUploading] = React.useState(false);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const [isRetryingMedia, setIsRetryingMedia] = React.useState(false);
  const [retryCooldownSeconds, setRetryCooldownSeconds] = React.useState(0);
  const [showUnloadConfirm, setShowUnloadConfirm] = React.useState(false);
  const [showUnsavedConfirm, setShowUnsavedConfirm] = React.useState(false);
  const [showDuplicateConfirm, setShowDuplicateConfirm] = React.useState(false);
  const [showAllColors, setShowAllColors] = React.useState(false);
  const [isDuplicating, setIsDuplicating] = React.useState(false);
  const [savedHotcues, setSavedHotcues] = React.useState<[number | null, number | null, number | null, number | null]>(pad.savedHotcuesMs ?? [null, null, null, null]);
  const [hotcueMarkerMs, setHotcueMarkerMs] = React.useState<number | null>(null);
  const imageInputRef = React.useRef<HTMLInputElement>(null);
  const initialSnapshotRef = React.useRef<string>('');
  const hydratedPadIdentityRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!open) {
      hydratedPadIdentityRef.current = null;
      return;
    }
    const nextPadIdentity = `${(pad as { padId?: string; id?: string }).padId || (pad as { id?: string }).id || ''}:${pad.audioUrl || ''}`;
    if (hydratedPadIdentityRef.current === nextPadIdentity) {
      return;
    }
    hydratedPadIdentityRef.current = nextPadIdentity;

    if (open) {
      setName(pad.name);
      setColor(pad.color);
      setTriggerMode(pad.triggerMode);
      setPlaybackMode(pad.playbackMode);
      setVolume([pad.volume * 100]);
      setGainDb([resolvePadGainDb(pad)]);
      setStartTimeMs([pad.startTimeMs || 0]);
      setEndTimeMs([pad.endTimeMs || 0]);
      setFadeInMs([pad.fadeInMs || 0]);
      setFadeOutMs([pad.fadeOutMs || 0]);
      setPitch([pad.pitch || 0]);
      setTempoPercent([isIOS ? 0 : (typeof pad.tempoPercent === 'number' ? pad.tempoPercent : 0)]);
      setKeyLock(isIOS ? false : pad.keyLock !== false);
      setImageUrl(pad.imageUrl || '');
      setImageData(pad.imageData || '');
      setShortcutKey(pad.shortcutKey || '');
      setShortcutError(null);
      setMidiNote((pad as PadWithMidi).midiNote);
      setMidiCC((pad as PadWithMidi).midiCC);
      setMidiLearnActive(false);
      setMidiError(null);
      setUploadError(null);
      setRetryCooldownSeconds(0);
      setSavedHotcues(pad.savedHotcuesMs ?? [null, null, null, null]);
      setHotcueMarkerMs(null);
      setAudioDuration(resolveSourceDurationMs(pad));
      initialSnapshotRef.current = JSON.stringify({
        name: pad.name,
        color: pad.color,
        triggerMode: pad.triggerMode,
        playbackMode: pad.playbackMode,
        volume: pad.volume,
        gainDb: resolvePadGainDb(pad),
        startTimeMs: pad.startTimeMs || 0,
        endTimeMs: pad.endTimeMs || 0,
        fadeInMs: pad.fadeInMs || 0,
        fadeOutMs: pad.fadeOutMs || 0,
        pitch: pad.pitch || 0,
        tempoPercent: isIOS ? 0 : (typeof pad.tempoPercent === 'number' ? pad.tempoPercent : 0),
        keyLock: isIOS ? false : pad.keyLock !== false,
        imageUrl: pad.imageUrl || '',
        imageData: pad.imageData || '',
        shortcutKey: pad.shortcutKey || '',
        midiNote: (pad as PadWithMidi).midiNote ?? null,
        midiCC: (pad as PadWithMidi).midiCC ?? null,
        savedHotcuesMs: pad.savedHotcuesMs ?? [null, null, null, null]
      });

      if (pad.audioUrl) {
        let durationLoaded = false;
        const sourceDurationMs = resolveSourceDurationMs(pad);

        // Method 1: Try HTMLAudioElement (works on most browsers)
        const audio = new Audio(pad.audioUrl);
        audio.preload = 'metadata';
        const onMetadata = () => {
          if (durationLoaded || !audio.duration || !isFinite(audio.duration)) return;
          durationLoaded = true;
          const durationMs = audio.duration * 1000;
          cacheObservedDurationMs(pad.audioUrl, durationMs);
          setAudioDuration(durationMs);
          setEndTimeMs((prev) => (prev[0] === 0 ? [durationMs] : prev));
        };
        audio.addEventListener('loadedmetadata', onMetadata);
        audio.addEventListener('durationchange', onMetadata);
        audio.load();

        // Method 2: Fallback using Web Audio API (better iOS support)
        // This fires if HTMLAudioElement doesn't load metadata quickly enough.
        const fallbackDelayMs = isIOS ? 1200 : 500;
        const fallbackTimeout = setTimeout(async () => {
          if (durationLoaded) return;

          try {
            const response = await fetch(pad.audioUrl);
            const arrayBuffer = await response.arrayBuffer();
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            const audioContext = new AudioContextClass();
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

            if (!durationLoaded) {
              durationLoaded = true;
              const durationMs = audioBuffer.duration * 1000;
              cacheObservedDurationMs(pad.audioUrl, durationMs);
              setAudioDuration(durationMs);
              setEndTimeMs((prev) => (prev[0] === 0 ? [durationMs] : prev));
            }

            audioContext.close();
          } catch (error) {
            if (sourceDurationMs > 0) {
              setAudioDuration(sourceDurationMs);
            }
          }
        }, fallbackDelayMs);

        return () => {
          clearTimeout(fallbackTimeout);
          audio.removeEventListener('loadedmetadata', onMetadata);
          audio.removeEventListener('durationchange', onMetadata);
        };
      }
    }
  }, [isIOS, open, pad]);

  const getCurrentSnapshot = React.useCallback(() => {
    return JSON.stringify({
      name,
      color,
      triggerMode,
      playbackMode,
      volume: volume[0] / 100,
      gainDb: gainDb[0],
      startTimeMs: startTimeMs[0],
      endTimeMs: endTimeMs[0],
      fadeInMs: fadeInMs[0],
      fadeOutMs: fadeOutMs[0],
      pitch: pitch[0],
      tempoPercent: isIOS ? 0 : tempoPercent[0],
      keyLock: isIOS ? false : keyLock,
      imageUrl,
      imageData,
      shortcutKey: shortcutKey || '',
      midiNote: midiNote ?? null,
      midiCC: midiCC ?? null,
      savedHotcuesMs: savedHotcues
    });
  }, [
    name,
    color,
    triggerMode,
    playbackMode,
    volume,
    gainDb,
    startTimeMs,
    endTimeMs,
    fadeInMs,
    fadeOutMs,
    pitch,
    tempoPercent,
    keyLock,
    isIOS,
    imageUrl,
    imageData,
    shortcutKey,
    midiNote,
    midiCC,
    savedHotcues
  ]);

  const isDirty = React.useMemo(() => {
    if (!open) return false;
    return initialSnapshotRef.current !== getCurrentSnapshot();
  }, [open, getCurrentSnapshot]);

  React.useEffect(() => {
    if (!midiLearnActive) return;

    const handleMidiEvent = (event: Event) => {
      const detail = (event as CustomEvent<MidiMessage>).detail;
      if (!detail) return;

      if (detail.type === 'noteon') {
        if (blockedMidiNotes?.has(detail.note)) {
          setMidiError('That MIDI note is already assigned.');
          setMidiLearnActive(false);
          return;
        }
        const duplicateBank = allBanks.find((bank) => typeof bank.midiNote === 'number' && bank.midiNote === detail.note);
        if (duplicateBank) {
          setMidiError(`That MIDI note is already assigned to bank "${duplicateBank.name}".`);
          setMidiLearnActive(false);
          return;
        }
        const duplicatePad = bankPads.find((otherPad) => {
          if (otherPad.id === pad.id) return false;
          return typeof otherPad.midiNote === 'number' && otherPad.midiNote === detail.note;
        });
        if (duplicatePad) {
          setMidiError(`That MIDI note is already assigned to pad "${duplicatePad.name}".`);
          setMidiLearnActive(false);
          return;
        }
        setMidiNote(detail.note);
      } else if (detail.type === 'cc') {
        if (blockedMidiCCs?.has(detail.cc)) {
          setMidiError('That MIDI CC is already assigned.');
          setMidiLearnActive(false);
          return;
        }
        const duplicateBank = allBanks.find((bank) => typeof bank.midiCC === 'number' && bank.midiCC === detail.cc);
        if (duplicateBank) {
          setMidiError(`That MIDI CC is already assigned to bank "${duplicateBank.name}".`);
          setMidiLearnActive(false);
          return;
        }
        const duplicatePad = bankPads.find((otherPad) => {
          if (otherPad.id === pad.id) return false;
          return typeof otherPad.midiCC === 'number' && otherPad.midiCC === detail.cc;
        });
        if (duplicatePad) {
          setMidiError(`That MIDI CC is already assigned to pad "${duplicatePad.name}".`);
          setMidiLearnActive(false);
          return;
        }
        setMidiCC(detail.cc);
      } else {
        return;
      }
      setMidiError(null);
      setMidiLearnActive(false);
    };

    window.addEventListener('vdjv-midi', handleMidiEvent as EventListener);
    return () => window.removeEventListener('vdjv-midi', handleMidiEvent as EventListener);
  }, [midiLearnActive, blockedMidiNotes, blockedMidiCCs, allBanks, bankPads, pad.id]);

  // Image validation function
  const validateImage = (file: File): Promise<{ valid: boolean; error?: string }> => {
    return new Promise((resolve) => {
      // Check file type
      if (!file.type.startsWith('image/jpeg') && !file.type.startsWith('image/png') && !file.type.startsWith('image/webp')) {
        resolve({
          valid: false,
          error: 'Please upload a JPG, PNG, or WebP image.'
        });
        return;
      }

      // Check file size (2MB limit - much more reasonable)
      const maxSize = 2 * 1024 * 1024; // 2MB
      if (file.size > maxSize) {
        resolve({
          valid: false,
          error: `Image is too large. Please choose an image under 2MB. Current size: ${(file.size / 1024 / 1024).toFixed(1)}MB`
        });
        return;
      }

      // Check dimensions (1024x1024 limit - standard logo size)
      const img = new Image();
      const url = URL.createObjectURL(file);

      img.onload = () => {
        URL.revokeObjectURL(url);

        if (img.width > 1024 || img.height > 1024) {
          resolve({
            valid: false,
            error: `Image is too large. Please choose an image under 1024x1024px. Current dimensions: ${img.width}x${img.height}px`
          });
        } else {
          resolve({ valid: true });
        }
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve({
          valid: false,
          error: 'Invalid image file. Please select a valid JPG, PNG, or WebP image.'
        });
      };

      img.src = url;
    });
  };

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadError(null);

    try {
      // Validate the image
      const validation = await validateImage(file);
      if (!validation.valid) {
        setUploadError(validation.error || 'Invalid image file');
        return;
      }

      // Create object URL for preview
      const imageUrl = URL.createObjectURL(file);

      // Convert to base64 for storage
      const reader = new FileReader();
      reader.onload = () => {
        setImageData(reader.result as string);
        setImageUrl(imageUrl);
        setUploadError(null);
      };
      reader.onerror = () => {
        setUploadError('We could not process that image. Please try another file.');
        URL.revokeObjectURL(imageUrl);
      };
      reader.readAsDataURL(file);
    } catch (error) {
      setUploadError('Image upload failed. Please try again.');
    } finally {
      setIsUploading(false);
      // Clear the input
      if (event.target) {
        event.target.value = '';
      }
    }
  };

  const handleRemoveImage = () => {
    if (imageUrl && imageUrl.startsWith('blob:')) {
      URL.revokeObjectURL(imageUrl);
    }
    setImageUrl('');
    setImageData('');
    setUploadError(null);
  };

  const applyShortcutKey = (nextKey: string | null) => {
    if (!nextKey) {
      setShortcutKey('');
      setShortcutError(null);
      return;
    }

    if (isReservedShortcutCombo(nextKey)) {
      setShortcutError(`"${nextKey}" is reserved for global controls.`);
      return;
    }

    if (blockedShortcutKeys?.has(nextKey)) {
      setShortcutError(`"${nextKey}" is already assigned to system or channel mapping.`);
      return;
    }

    const duplicateBank = allBanks.find((bank) => {
      const existingKey = normalizeStoredShortcutKey(bank.shortcutKey);
      return existingKey === nextKey;
    });

    if (duplicateBank) {
      setShortcutError(`"${nextKey}" is already assigned to bank "${duplicateBank.name}".`);
      return;
    }

    const duplicatePad = bankPads.find((p) => {
      if (p.id === pad.id) return false;
      const existingKey = normalizeStoredShortcutKey(p.shortcutKey);
      return existingKey === nextKey;
    });

    if (duplicatePad) {
      setShortcutError(`"${nextKey}" is already assigned to "${duplicatePad.name}".`);
      return;
    }

    setShortcutKey(nextKey);
    setShortcutError(null);
    setMidiError(null);
  };

  const handleShortcutKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Tab') return;
    event.preventDefault();

    if (event.key === 'Backspace' || event.key === 'Delete' || event.key === 'Escape') {
      applyShortcutKey(null);
      return;
    }

    if (event.shiftKey) {
      setShortcutError('Shift is reserved for the secondary bank.');
      return;
    }
    if (event.ctrlKey) {
      setShortcutError('Ctrl shortcuts are reserved by the browser. Use Alt or Meta instead.');
      return;
    }

    const normalized = normalizeShortcutKey(event.key, {
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
      code: event.code
    });
    if (!normalized) {
      setShortcutError('Please press a letter or number key.');
      return;
    }

    applyShortcutKey(normalized);
  };

  const handleSave = async () => {
    try {
      if (shortcutError) {
        setUploadError(shortcutError);
        return false;
      }
      const trimmedName = name.slice(0, 32);

      const updatedPad: PadData = {
        ...pad,
        name: trimmedName,
        color,
        triggerMode,
        playbackMode,
        volume: volume[0] / 100,
        gainDb: gainDb[0],
        gain: gainDbToLinear(gainDb[0]),
        fadeInMs: fadeInMs[0],
        fadeOutMs: fadeOutMs[0],
        startTimeMs: startTimeMs[0],
        endTimeMs: endTimeMs[0],
        pitch: pitch[0],
        tempoPercent: isIOS ? 0 : tempoPercent[0],
        keyLock: isIOS ? false : keyLock,
        imageUrl,
        imageData,
        shortcutKey: shortcutKey || undefined,
        midiNote,
        midiCC,
        savedHotcuesMs: savedHotcues,
        ignoreChannel: pad.ignoreChannel
      };

      const explicitDuration = typeof pad.audioDurationMs === 'number' && Number.isFinite(pad.audioDurationMs)
        ? Math.max(0, pad.audioDurationMs)
        : 0;
      const liveDuration = Number.isFinite(audioDuration) ? Math.max(0, audioDuration) : 0;
      const cachedDuration = getCachedObservedDurationMs(pad.audioUrl);
      const resolvedDuration = Math.max(explicitDuration, liveDuration, cachedDuration);
      if (resolvedDuration > 0) {
        updatedPad.audioDurationMs = Math.round(resolvedDuration);
      }

      await onSave(updatedPad);
      setName(trimmedName);
      initialSnapshotRef.current = JSON.stringify({
        name: trimmedName,
        color,
        triggerMode,
        playbackMode,
        volume: volume[0] / 100,
        gainDb: gainDb[0],
        gain: gainDbToLinear(gainDb[0]),
        startTimeMs: startTimeMs[0],
        endTimeMs: endTimeMs[0],
        fadeInMs: fadeInMs[0],
        fadeOutMs: fadeOutMs[0],
        pitch: pitch[0],
        tempoPercent: isIOS ? 0 : tempoPercent[0],
        keyLock: isIOS ? false : keyLock,
        imageUrl,
        imageData,
        shortcutKey: shortcutKey || '',
        midiNote: midiNote ?? null,
        midiCC: midiCC ?? null,
        savedHotcuesMs: savedHotcues
      });
      return true;
    } catch (error) {
      if (error instanceof Error) {
        setUploadError(error.message);
      } else {
        setUploadError('Pad changes were not saved. Please try again.');
      }
      return false;
    }
  };

  const handleSaveAndClose = React.useCallback(async () => {
    if (isUploading) return;
    const saved = await handleSave();
    if (saved) {
      onOpenChange(false);
    }
  }, [handleSave, onOpenChange, isUploading]);

  const handleDialogOpenChange = React.useCallback((nextOpen: boolean) => {
    if (!nextOpen && isDirty) {
      setShowUnsavedConfirm(true);
      return;
    }
    onOpenChange(nextOpen);
  }, [isDirty, onOpenChange]);

  const handleContentKeyDown = React.useCallback((event: React.KeyboardEvent) => {
    if (event.key !== 'Enter') return;
    if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    const tagName = target?.tagName?.toLowerCase();
    if (tagName === 'textarea' || tagName === 'button') return;
    event.preventDefault();
    handleSaveAndClose();
  }, [handleSaveAndClose]);

  const handleUnloadClick = () => {
    setShowUnloadConfirm(true);
  };

  const handleConfirmUnload = () => {
    onUnload();
    setShowUnloadConfirm(false);
  };

  const handleDoubleClickReset = (setter: (value: number[]) => void, defaultValue: number) => {
    return () => setter([defaultValue]);
  };

  const formatTime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const milliseconds = Math.floor((ms % 1000) / 10);
    return `${seconds}.${milliseconds.toString().padStart(2, '0')}s`;
  };

  const reservedKeysText = RESERVED_SHORTCUT_KEYS.join(', ');
  const expectsImageAsset = Boolean(
    pad.hasImageAsset ||
    pad.imageStorageKey ||
    pad.imageData ||
    (typeof pad.imageUrl === 'string' && pad.imageUrl.trim().length > 0) ||
    pad.imageBackend === 'native'
  );
  const canRetryMedia = Boolean(
    (!pad.audioUrl && (pad.audioStorageKey || pad.audioBackend)) ||
    (expectsImageAsset && !pad.imageUrl)
  );

  const trimDurationMs = React.useMemo(() => {
    if (!pad.audioUrl) return 0;
    const persistedSourceDuration = typeof pad.audioDurationMs === 'number' && Number.isFinite(pad.audioDurationMs)
      ? Math.max(0, pad.audioDurationMs)
      : 0;
    const cachedObservedDuration = getCachedObservedDurationMs(pad.audioUrl);
    const sourceDuration = Math.max(audioDuration, persistedSourceDuration, cachedObservedDuration);
    const fallbackFromPad = Math.max(pad.startTimeMs || 0, pad.endTimeMs || 0, 10);
    const resolved = sourceDuration > 0 ? sourceDuration : fallbackFromPad;
    return Number.isFinite(resolved) && resolved > 0 ? resolved : 0;
  }, [audioDuration, pad.audioDurationMs, pad.audioUrl, pad.endTimeMs, pad.startTimeMs]);

  React.useEffect(() => {
    if (!open) return;
    if (hotcueMarkerMs !== null) return;
    if (trimDurationMs <= 0) return;
    const safeStart = Math.max(0, Math.min(startTimeMs[0], trimDurationMs));
    const safeEndCandidate = endTimeMs[0] > safeStart ? endTimeMs[0] : trimDurationMs;
    const safeEnd = Math.max(safeStart, Math.min(safeEndCandidate, trimDurationMs));
    const centered = safeStart + ((safeEnd - safeStart) / 2);
    const nextMarker = Math.max(0, Math.min(trimDurationMs, centered));
    setHotcueMarkerMs(nextMarker);
  }, [endTimeMs, hotcueMarkerMs, open, startTimeMs, trimDurationMs]);

  const handleHotcueMarkerChange = React.useCallback((timeMs: number) => {
    if (!Number.isFinite(timeMs)) return;
    const safeTime = Math.max(0, Math.min(trimDurationMs, timeMs));
    setHotcueMarkerMs(safeTime);
  }, [trimDurationMs]);

  const handleTrimDurationMeasured = React.useCallback((durationMs: number) => {
    cacheObservedDurationMs(pad.audioUrl, durationMs);
    setAudioDuration((prev) => {
      const safePrev = Number.isFinite(prev) ? prev : 0;
      return Math.max(safePrev, durationMs);
    });
  }, [pad.audioUrl]);

  React.useEffect(() => {
    setHotcueMarkerMs((prev) => {
      if (prev === null) return prev;
      const clamped = Math.max(0, Math.min(trimDurationMs, prev));
      return Math.abs(clamped - prev) > 0.001 ? clamped : prev;
    });
  }, [trimDurationMs]);

  const hotcueAnchorTime = hotcueMarkerMs;
  const safeTrimStartMs = React.useMemo(
    () => Math.max(0, Math.min(startTimeMs[0], trimDurationMs || 0)),
    [startTimeMs, trimDurationMs],
  );
  const safeTrimEndMs = React.useMemo(() => {
    if (trimDurationMs <= 0) return 0;
    const candidate = endTimeMs[0] > safeTrimStartMs ? endTimeMs[0] : trimDurationMs;
    return Math.max(safeTrimStartMs, Math.min(candidate, trimDurationMs));
  }, [endTimeMs, safeTrimStartMs, trimDurationMs]);
  const hasTrimApplied = React.useMemo(
    () => trimDurationMs > 0 && (safeTrimStartMs > 0 || safeTrimEndMs < trimDurationMs),
    [safeTrimEndMs, safeTrimStartMs, trimDurationMs],
  );
  const isCompactBakeCandidate = React.useMemo(() => {
    if (!hasTrimApplied || trimDurationMs <= 0) return false;
    const trimInDelta = safeTrimStartMs;
    const trimOutDelta = Math.max(0, trimDurationMs - safeTrimEndMs);
    return trimInDelta >= COMPACT_BAKED_TRIM_MIN_DELTA_MS || trimOutDelta >= COMPACT_BAKED_TRIM_MIN_DELTA_MS;
  }, [hasTrimApplied, safeTrimEndMs, safeTrimStartMs, trimDurationMs]);

  const handleTrimReset = React.useCallback(() => {
    setStartTimeMs([0]);
    setEndTimeMs([trimDurationMs > 0 ? trimDurationMs : 0]);
    setHotcueMarkerMs((prev) => {
      if (prev === null || trimDurationMs <= 0) return prev;
      return Math.max(0, Math.min(trimDurationMs, prev));
    });
  }, [trimDurationMs]);

  // Calculate effective playback duration after start/end time adjustments
  const effectiveDuration = endTimeMs[0] - startTimeMs[0];
  // Max fade is 5 seconds or half of trimmed duration, whichever is smaller
  // But ensure minimum 10ms effective duration for fades
  const maxFadeTime = effectiveDuration > 10 ? Math.min(5000, Math.floor(effectiveDuration / 2)) : 0;

  const handleRetryMedia = React.useCallback(async () => {
    if (!onRetryMedia || isRetryingMedia || retryCooldownSeconds > 0) return;
    setUploadError(null);
    setIsRetryingMedia(true);
    try {
      const restored = await onRetryMedia();
      if (!restored) {
        setRetryCooldownSeconds(2);
        setUploadError('Media is still unavailable. Keep this bank selected and try again in 2s.');
      }
    } catch (error) {
      setRetryCooldownSeconds(2);
      setUploadError(error instanceof Error ? error.message : 'Retry failed. Please try again in 2s.');
    } finally {
      setIsRetryingMedia(false);
    }
  }, [isRetryingMedia, onRetryMedia, retryCooldownSeconds]);

  const handleConfirmDuplicate = React.useCallback(async () => {
    if (!onDuplicate || isUploading || isDuplicating) return;
    setIsDuplicating(true);
    try {
      await onDuplicate();
      setShowDuplicateConfirm(false);
    } finally {
      setIsDuplicating(false);
    }
  }, [isDuplicating, isUploading, onDuplicate]);

  React.useEffect(() => {
    if (retryCooldownSeconds <= 0) return;
    const timeoutId = window.setTimeout(() => {
      setRetryCooldownSeconds((value) => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearTimeout(timeoutId);
  }, [retryCooldownSeconds]);

  return (
    <>
      <Dialog open={open} onOpenChange={handleDialogOpenChange}>
        <DialogContent
          className="grid w-[calc(100vw-1rem)] grid-rows-[auto_1fr] sm:w-full sm:max-w-lg max-h-[80vh] overflow-hidden backdrop-blur-md bg-white/95 border-gray-300 dark:bg-gray-800/95 dark:border-gray-600"
          aria-describedby={undefined}
          onKeyDown={handleContentKeyDown}
        >
          <DialogHeader>
            <DialogTitle>Edit Pad Settings</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 overflow-y-auto overflow-x-hidden pr-1">
            {uploadError && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
                {uploadError}
              </div>
            )}



            {/* Image Upload */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label>Pad Image</Label>
                <div className="flex items-center gap-2">
                  {canRetryMedia && (
                    <Button
                      onClick={handleRetryMedia}
                      variant="outline"
                      size="sm"
                      disabled={isUploading || isRetryingMedia || retryCooldownSeconds > 0}
                    >
                      <RefreshCw className={`w-4 h-4 mr-2 ${isRetryingMedia ? 'animate-spin' : ''}`} />
                      {isRetryingMedia
                        ? 'Retrying...'
                        : retryCooldownSeconds > 0
                          ? `Retry in ${retryCooldownSeconds}s`
                          : 'Retry Media'}
                    </Button>
                  )}
                  <Button
                    onClick={handleSaveAndClose}
                    variant="outline"
                    size="sm"
                    disabled={isUploading}
                  >
                    {isUploading ? 'Saving...' : 'Save'}
                  </Button>
                  {onDuplicate && (
                    <Button
                      onClick={() => {
                        if (isUploading || isDuplicating) return;
                        setShowDuplicateConfirm(true);
                      }}
                      variant="outline"
                      size="sm"
                      disabled={isUploading || isDuplicating}
                      title="Duplicate pad"
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </div>
              {imageUrl ? (
                <div className="flex items-center gap-2">
                  <img
                    src={imageUrl}
                    alt="Pad preview"
                    className="w-16 h-16 object-cover rounded border"
                  />
                  <div className="flex-1">
                    <p className="text-sm text-gray-600 mb-2">Image uploaded</p>
                    <Button
                      onClick={handleRemoveImage}
                      variant="outline"
                      size="sm"
                      disabled={isUploading}
                    >
                      Remove Image
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handleImageUpload}
                    className="hidden"
                    disabled={isUploading}
                  />
                  <Button
                    onClick={() => imageInputRef.current?.click()}
                    variant="outline"
                    className="w-full"
                    disabled={isUploading}
                  >
                    <ImageIcon className="w-4 h-4 mr-2" />
                    {isUploading ? 'Uploading...' : 'Upload Image (JPG/PNG/WebP)'}
                  </Button>
                </>
              )}
              <p className="text-xs text-gray-500">
                It will replace the pad name display. Maximum: 1024x1024px, 2MB
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">Pad Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value.slice(0, 32))}
                  placeholder="Enter pad name"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck="false"
                  maxLength={32}
                  onFocus={(e) => {
                    // Prevent immediate focus on mobile
                    if (window.innerWidth <= 1800) {
                      setTimeout(() => e.target.focus(), 100);
                    }
                  }}
                />
              </div>

              <div className="space-y-2">
                <Label>Pad Color</Label>
                <div className="flex gap-1 flex-wrap">
                  {(showAllColors ? [...PRIMARY_PAD_COLORS, ...EXTRA_PAD_COLORS] : PRIMARY_PAD_COLORS).map((colorOption) => (
                    <button
                      key={colorOption.value}
                      onClick={() => setColor(colorOption.value)}
                      className={`w-6 h-6 rounded-full border-2 transition-all ${color === colorOption.value ? 'border-white scale-110' : 'border-gray-400'
                        }`}
                      style={{ backgroundColor: colorOption.value }}
                      title={colorOption.label}
                    />
                  ))}
                  {EXTRA_PAD_COLORS.length > 0 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-6 px-1.5 text-[10px] ml-1"
                      onClick={() => setShowAllColors((prev) => !prev)}
                    >
                      {showAllColors ? 'Less' : 'More'}
                    </Button>
                  )}
                </div>
              </div>
            </div>

            <div className={`grid gap-3 ${midiEnabled ? 'grid-cols-2' : 'grid-cols-1'}`}>
              <div className="space-y-2">
                <Label htmlFor="shortcutKey">Keyboard Shortcut</Label>
                <Input
                  id="shortcutKey"
                  value={shortcutKey}
                  onKeyDown={handleShortcutKeyDown}
                  placeholder="Press a key"
                  readOnly
                />
                {shortcutError && (
                  <p className="text-xs text-red-500">{shortcutError}</p>
                )}
                {!shortcutError && (
                  <p className="text-xs text-gray-500">
                    Reserved keys: {reservedKeysText}
                  </p>
                )}
              </div>

              {midiEnabled && (
                <div className="space-y-2">
                  <Label>MIDI Assignment</Label>
                  <div className="text-xs text-gray-500">
                    Note: {midiNote ?? '-'} | CC: {midiCC ?? '-'}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setMidiLearnActive(true)}
                      className="flex-1"
                    >
                      {midiLearnActive ? 'Listening...' : 'Learn MIDI'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setMidiNote(undefined);
                        setMidiCC(undefined);
                        setMidiLearnActive(false);
                        setMidiError(null);
                      }}
                    >
                      Clear
                    </Button>
                  </div>
                  {midiError && <p className="text-xs text-red-500">{midiError}</p>}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Trigger Mode</Label>
                <Select value={triggerMode} onValueChange={(value: any) => setTriggerMode(value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="toggle">On/Off - Click to play/pause</SelectItem>
                    <SelectItem value="hold">Hold - Play while pressed</SelectItem>
                    <SelectItem value="stutter">Stutter - Restart on each click</SelectItem>
                    <SelectItem value="unmute">Unmute - Play continuously, mute when released</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Playback Mode</Label>
                <Select value={playbackMode} onValueChange={(value: any) => setPlaybackMode(value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="once">Play Once</SelectItem>
                    <SelectItem value="loop">Loop</SelectItem>
                    <SelectItem value="stopper">Stopper - Play and stop all other pads</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label
                    className="cursor-pointer"
                    onDoubleClick={handleDoubleClickReset(setVolume, 100)}
                    title="Double-click to reset to 100%"
                  >
                    Volume: {volume[0]}%
                  </Label>
                </div>
                <Slider
                  value={volume}
                  onValueChange={setVolume}
                  max={100}
                  min={0}
                  step={1}
                  className="w-full cursor-pointer"
                  onDoubleClick={handleDoubleClickReset(setVolume, 100)}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label
                    className="cursor-pointer"
                    onDoubleClick={handleDoubleClickReset(setGainDb, 0)}
                    title="Double-click to reset to 0dB"
                  >
                    Gain: {gainDb[0] > 0 ? '+' : ''}{gainDb[0].toFixed(1)} dB
                  </Label>
                </div>
                <Slider
                  value={gainDb}
                  onValueChange={setGainDb}
                  max={MAX_PAD_GAIN_DB}
                  min={MIN_PAD_GAIN_DB}
                  step={0.5}
                  className="w-full cursor-pointer"
                  onDoubleClick={handleDoubleClickReset(setGainDb, 0)}
                />
              </div>
            </div>

            {pad.audioUrl && trimDurationMs > 0 && (
              <>
                <div className="space-y-4 pt-2">
                  <div className="hidden">
                    <Label>Trim In / Trim Out</Label>
                  </div>
                  <WaveformTrim
                    audioUrl={pad.audioUrl}
                    startTimeMs={startTimeMs[0]}
                    endTimeMs={endTimeMs[0]}
                    durationMs={trimDurationMs}
                    graphicsTier={graphicsTier}
                    onStartTimeChange={(ms) => setStartTimeMs([ms])}
                    onEndTimeChange={(ms) => setEndTimeMs([ms])}
                    hotcues={savedHotcues}
                    hotcueMarkerMs={hotcueMarkerMs}
                    onHotcueMarkerChange={handleHotcueMarkerChange}
                    onDurationMeasured={handleTrimDurationMeasured}
                    canResetTrim={hasTrimApplied}
                    onResetTrim={handleTrimReset}
                  />
                </div>

                {/* Hotcue Controls */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Hotcues</Label>
                    <span className="text-xs text-gray-500">
                      Marker: {hotcueMarkerMs !== null ? (hotcueMarkerMs / 1000).toFixed(3) + 's' : '--'}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {[0, 1, 2, 3].map((index) => {
                      const hasHotcue = savedHotcues[index] !== null;
                      return (
                        <div key={index} className="flex flex-col gap-1">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className={`w-full h-10 font-bold tracking-wider relative overflow-hidden transition-all duration-200 border-2 ${hasHotcue
                                ? 'bg-amber-400 text-black border-amber-500 hover:bg-amber-300 shadow-[0_0_10px_rgba(251,191,36,0.3)]'
                                : 'bg-gray-800/80 text-gray-400 border-gray-700 hover:bg-gray-700 hover:text-amber-500'
                              }`}
                            onClick={() => {
                              const newArr = [...savedHotcues] as [number | null, number | null, number | null, number | null];
                              if (hasHotcue) {
                                newArr[index] = null;
                              } else if (hotcueAnchorTime !== null) {
                                newArr[index] = hotcueAnchorTime;
                              }
                              setSavedHotcues(newArr);
                            }}
                            disabled={!hasHotcue && hotcueAnchorTime === null}
                          >
                            <span className="flex flex-col items-center justify-center leading-none">
                              <span className="text-[14px]">CUE</span>
                              <span className={`text-[9px] mt-0.5 ${hasHotcue ? 'text-black/70' : 'text-gray-500'}`}>
                                {index + 1}
                              </span>
                            </span>
                          </Button>
                          <span className="text-[10px] text-center text-gray-400">
                            {hasHotcue ? (savedHotcues[index]! / 1000).toFixed(2) + 's' : 'Empty'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Fade Controls */}
                <div className="grid grid-cols-2 gap-3">
                  {/* Fade In Control */}
                  <div className="space-y-2">
                    <Label
                      className="cursor-pointer"
                      onDoubleClick={handleDoubleClickReset(setFadeInMs, 0)}
                      title="Double-click to reset to 0ms"
                    >
                      Fade In: {fadeInMs[0]}ms
                    </Label>
                    <Slider
                      value={fadeInMs}
                      onValueChange={(value) => {
                        // Ensure fade in doesn't exceed available duration
                        const clamped = Math.min(value[0], maxFadeTime);
                        setFadeInMs([clamped]);
                      }}
                      max={maxFadeTime}
                      min={0}
                      step={10}
                      className="w-full cursor-pointer"
                      onDoubleClick={handleDoubleClickReset(setFadeInMs, 0)}
                      disabled={maxFadeTime <= 0}
                    />
                  </div>

                  {/* Fade Out Control */}
                  <div className="space-y-2">
                    <Label
                      className="cursor-pointer"
                      onDoubleClick={handleDoubleClickReset(setFadeOutMs, 0)}
                      title="Double-click to reset to 0ms"
                    >
                      Fade Out: {fadeOutMs[0]}ms
                    </Label>
                    <Slider
                      value={fadeOutMs}
                      onValueChange={(value) => {
                        // Ensure fade out doesn't exceed available duration
                        const clamped = Math.min(value[0], maxFadeTime);
                        setFadeOutMs([clamped]);
                      }}
                      max={maxFadeTime}
                      min={0}
                      step={10}
                      className="w-full cursor-pointer"
                      onDoubleClick={handleDoubleClickReset(setFadeOutMs, 0)}
                      disabled={maxFadeTime <= 0}
                    />
                  </div>
                </div>
              </>
            )}

            {!isIOS && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label
                    className="cursor-pointer"
                    onDoubleClick={handleDoubleClickReset(setTempoPercent, 0)}
                    title="Double-click to reset to 0%"
                  >
                    Tempo: {tempoPercent[0] > 0 ? '+' : ''}{tempoPercent[0]}%
                  </Label>
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`pad-key-lock-${pad.id}`} className="text-xs text-gray-500">Key Lock</Label>
                    <Switch
                      id={`pad-key-lock-${pad.id}`}
                      checked={keyLock}
                      onCheckedChange={setKeyLock}
                    />
                  </div>
                </div>
                <Slider
                  value={tempoPercent}
                  onValueChange={setTempoPercent}
                  max={100}
                  min={-50}
                  step={1}
                  className="w-full cursor-pointer"
                  onDoubleClick={handleDoubleClickReset(setTempoPercent, 0)}
                />
                <p className="text-xs text-gray-500">
                  Changes playback speed. With Key Lock on, tempo changes keep the original key.
                </p>
              </div>
            )}

            {isIOS || !keyLock ? (
              <div className="space-y-2">
                <Label
                  className="cursor-pointer"
                  onDoubleClick={handleDoubleClickReset(setPitch, 0)}
                  title="Double-click to reset to 0"
                >
                  Pitch: {pitch[0] > 0 ? '+' : ''}{pitch[0]} semitones
                </Label>
                <Slider
                  value={pitch}
                  onValueChange={setPitch}
                  max={12}
                  min={-12}
                  step={1}
                  className="w-full cursor-pointer"
                  onDoubleClick={handleDoubleClickReset(setPitch, 0)}
                />
                {isIOS && (
                  <p className="text-xs text-gray-500">
                    
                  </p>
                )}
              </div>
            ) : (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                
              </p>
            )}

            <div className="grid gap-2 pt-4 grid-cols-3">
              <Button
                onClick={handleSaveAndClose}
                className="w-full"
                disabled={isUploading}
              >
                {isUploading ? 'Saving...' : 'Save Changes'}
              </Button>
              <Button
                onClick={() => handleDialogOpenChange(false)}
                variant="outline"
                disabled={isUploading}
                className="w-full"
              >
                Cancel
              </Button>
              <Button
                onClick={handleUnloadClick}
                variant="destructive"
                disabled={isUploading}
                className="w-full"
              >
                Unload
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Unload Confirmation Dialog */}
      <ConfirmationDialog
        open={showUnloadConfirm}
        onOpenChange={setShowUnloadConfirm}
        title="Unload Pad"
        description={`Are you sure you want to unload the pad "${name}"? This will permanently remove the pad and its audio. This action cannot be undone.`}
        confirmText="Unload Pad"
        variant="destructive"
        onConfirm={handleConfirmUnload}
        theme={theme}
      />

      <ConfirmationDialog
        open={showDuplicateConfirm}
        onOpenChange={setShowDuplicateConfirm}
        title="Duplicate Pad"
        description={`Create a duplicate of "${name}"? The copy will keep the same media but reset trim, pitch, tempo, fade, gain, volume, and hotcues.`}
        confirmText={isDuplicating ? 'Duplicating...' : 'Duplicate Pad'}
        onConfirm={handleConfirmDuplicate}
        theme={theme}
      />

      <Dialog open={showUnsavedConfirm} onOpenChange={setShowUnsavedConfirm}>
        <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Discard changes?</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-gray-600 dark:text-gray-300">
            You have unsaved changes for this pad. Save them or discard the changes.
          </div>
          <div className="flex gap-2 pt-2">
            <Button
              onClick={() => {
                setShowUnsavedConfirm(false);
                handleSaveAndClose();
              }}
              className="flex-1"
              disabled={isUploading}
            >
              Save
            </Button>
            <Button
              onClick={() => {
                setShowUnsavedConfirm(false);
                onOpenChange(false);
              }}
              variant="outline"
              className="flex-1"
            >
              Discard
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
