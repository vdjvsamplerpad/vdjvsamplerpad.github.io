import * as React from 'react';
import { SamplerPad } from './SamplerPad';
import { PadData, SamplerBank, StopMode } from './types/sampler';
import { buildPadSearchAnchorId } from './samplerSearch';
import { parsePadDragTransferPayload } from './padDragTransfer';
import { AUDIO_FILE_INPUT_ACCEPT } from '@/lib/audio-file-accept';
import { Upload } from 'lucide-react';

const EMPTY_BANKS: SamplerBank[] = [];
const EMPTY_PADS: PadData[] = [];

const normalizeSearchHitColor = (value: string | undefined, fallback = '#22d3ee'): string => {
  if (!value) return fallback;
  const trimmed = value.trim();
  const body = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
  if (!/^[0-9a-fA-F]{6}$/.test(body)) return fallback;
  return `#${body.toLowerCase()}`;
};

const hexToRgbString = (hex: string): string => {
  const normalized = normalizeSearchHitColor(hex).slice(1);
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
};

const MOBILE_EDIT_DRAG_LONG_PRESS_MS = 320;
const MOBILE_EDIT_DRAG_CANCEL_PX = 12;
const MOBILE_EDIT_DRAG_AUTOSCROLL_EDGE_PX = 72;
const MOBILE_EDIT_DRAG_AUTOSCROLL_STEP_PX = 18;

type MobileEditDragTargetKind = 'pad' | 'bank' | null;

type MobileEditDragSession = {
  pointerId: number;
  sourceIndex: number;
  sourcePadId: string;
  sourcePadName: string;
  sourceBankId: string;
  sourceElement: HTMLElement;
  scrollElement: HTMLElement | null;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  active: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  targetIndex: number | null;
  targetBankId: string | null;
  targetBankName: string | null;
  targetKind: MobileEditDragTargetKind;
  rafId: number | null;
};

type MobileEditDragViewState = Pick<
  MobileEditDragSession,
  | 'sourceIndex'
  | 'sourcePadId'
  | 'sourcePadName'
  | 'sourceBankId'
  | 'currentX'
  | 'currentY'
  | 'active'
  | 'targetIndex'
  | 'targetBankId'
  | 'targetBankName'
  | 'targetKind'
>;

type MobileEditDragScrollLock = {
  sourceElement: HTMLElement;
  sourceTouchAction: string;
  bodyTouchAction: string;
  documentOverscrollBehaviorY: string;
};

const getNearestScrollableElement = (element: HTMLElement | null): HTMLElement | null => {
  let current = element?.parentElement || null;
  while (current && current !== document.body) {
    const style = window.getComputedStyle(current);
    const canScrollY = /(auto|scroll|overlay)/.test(style.overflowY) && current.scrollHeight > current.clientHeight;
    if (canScrollY) return current;
    current = current.parentElement;
  }
  return null;
};

export interface PadGridProps {
  pads: PadData[];
  bankId: string;
  bankName: string;
  allBanks: SamplerBank[];
  allPads: PadData[];
  editMode: boolean;
  globalMuted: boolean;
  masterVolume: number;
  padSize: number;
  theme: 'light' | 'dark';
  stopMode: StopMode;
  windowWidth: number;
  onUpdatePad: (bankId: string, id: string, updatedPad: PadData) => void;
  onRemovePad: (id: string) => void;
  onDuplicatePad?: (bankId: string, padId: string) => Promise<void> | void;
  onRelinkMissingPadMedia?: (bankId: string, padId: string, file: File) => Promise<void>;
  onRehydratePadMedia?: (bankId: string, padId: string) => Promise<boolean>;
  onReorderPads: (fromIndex: number, toIndex: number) => void;
  onFileUpload?: (file: File) => Promise<void> | void;
  onPadDragStart?: (e: React.DragEvent, pad: PadData, bankId: string) => void;
  onTransferPad?: (padId: string, sourceBankId: string, targetBankId: string) => void;
  availableBanks?: Array<{ id: string; name: string; }>;
  canTransferFromBank?: (bankId: string) => boolean;
  midiEnabled?: boolean;
  blockedShortcutKeys?: Set<string>;
  blockedMidiNotes?: Set<number>;
  blockedMidiCCs?: Set<number>;
  hideShortcutLabel?: boolean;
  adminPadColorPaintActive?: boolean;
  onAdminPadColorPaint?: (bankId: string, pad: PadData) => void | Promise<void>;
  graphicsTier?: import('@/lib/performance-monitor').PerformanceTier;
  editRequest?: { padId: string; token: number } | null;
  closeEditRequest?: { padId: string; token: number } | null;
  onRequestEditPad?: (padId: string) => void;
  onPadEditDialogOpenChange?: (padId: string, open: boolean) => void;
  channelLoadArmed?: boolean;
  onSelectPadForChannelLoad?: (pad: PadData, bankId: string, bankName: string) => void;
  requiresAuthToPlay?: boolean;
  onRequireLogin?: (reason?: string) => void;
  onGuestTrialConsumePlayback?: (pad: PadData, bankId: string, bankName: string) => boolean;
  highlightedPadId?: string | null;
}

export const PadGrid = React.memo(function PadGrid({
  pads,
  bankId,
  bankName,
  allBanks,
  allPads,
  editMode,
  globalMuted,
  masterVolume,
  padSize,
  theme,
  stopMode,
  windowWidth,
  onUpdatePad,
  onRemovePad,
  onDuplicatePad,
  onRelinkMissingPadMedia,
  onRehydratePadMedia,
  onReorderPads,
  onFileUpload,
  onPadDragStart,
  onTransferPad,
  availableBanks = [],
  canTransferFromBank,
  midiEnabled = false,
  blockedShortcutKeys,
  blockedMidiNotes,
  blockedMidiCCs,
  hideShortcutLabel = false,
  adminPadColorPaintActive = false,
  onAdminPadColorPaint,
  graphicsTier = 'low',
  editRequest = null,
  closeEditRequest = null,
  onRequestEditPad,
  onPadEditDialogOpenChange,
  channelLoadArmed = false,
  onSelectPadForChannelLoad,
  requiresAuthToPlay = false,
  onRequireLogin,
  onGuestTrialConsumePlayback,
  highlightedPadId = null
}: PadGridProps) {
  const [draggedIndex, setDraggedIndex] = React.useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = React.useState<number | null>(null);
  const [isDragOverGrid, setIsDragOverGrid] = React.useState(false);
  const [dragOverPadTransfer, setDragOverPadTransfer] = React.useState(false);
  const [mobileEditDragState, setMobileEditDragState] = React.useState<MobileEditDragViewState | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const mobileEditDragRef = React.useRef<MobileEditDragSession | null>(null);
  const mobileEditDragScrollLockRef = React.useRef<MobileEditDragScrollLock | null>(null);
  const suppressMobileEditClickRef = React.useRef(false);
  const suppressMobileEditClickTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const dialogBanks = editMode ? allBanks : EMPTY_BANKS;
  const dialogAllPads = editMode ? allPads : EMPTY_PADS;
  const dialogBankPads = editMode ? pads : EMPTY_PADS;

  // Handle drag and drop for file uploads
  const handleDrop = React.useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOverGrid(false);
    setDragOverPadTransfer(false);

    // Check if this is a pad transfer
    let data = e.dataTransfer.getData('application/json');
    if (!data) {
      data = e.dataTransfer.getData('text/plain');
    }

    const dragData = parsePadDragTransferPayload(data);
    if (dragData && dragData.sourceBankId !== bankId && onTransferPad) {
      if (!canTransferFromBank || canTransferFromBank(dragData.sourceBankId)) {
        onTransferPad(dragData.padId, dragData.sourceBankId, bankId);
      }
      return;
    }

    // Handle file uploads
    if (!onFileUpload) return;

    const files = Array.from(e.dataTransfer.files);
    const audioFiles = files.filter(file => file.type.startsWith('audio/'));

    for (const file of audioFiles) {
      try {
        await Promise.resolve(onFileUpload(file));
      } catch {
        break;
      }
    }
  }, [bankId, canTransferFromBank, onFileUpload, onTransferPad]);

  const handleDragOver = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();

    // Check if this is a pad transfer from another bank
    let data = e.dataTransfer.getData('application/json');
    if (!data) {
      data = e.dataTransfer.getData('text/plain');
    }

    const dragData = parsePadDragTransferPayload(data);
    if (dragData && dragData.sourceBankId !== bankId) {
      if (!canTransferFromBank || canTransferFromBank(dragData.sourceBankId)) {
        setDragOverPadTransfer(true);
        setIsDragOverGrid(false);
      }
      return;
    }

    // Regular file drag over
    setIsDragOverGrid(true);
    setDragOverPadTransfer(false);
  }, [bankId, canTransferFromBank]);

  const handleDragLeave = React.useCallback((e: React.DragEvent) => {
    // Only clear if actually leaving the grid
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOverGrid(false);
      setDragOverPadTransfer(false);
    }
  }, []);

  const handleFileSelect = React.useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0 && onFileUpload) {
      for (const file of Array.from(files)) {
        if (file.type.startsWith('audio/')) {
          try {
            await Promise.resolve(onFileUpload(file));
          } catch {
            break;
          }
        }
      }
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [onFileUpload]);

  const handleEmptyAreaClick = () => {
    if (channelLoadArmed) return;
    if (onFileUpload) {
      fileInputRef.current?.click();
    }
  };

  const handleUploadTileClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (channelLoadArmed || !onFileUpload) return;
    fileInputRef.current?.click();
  };

  const handlePadDragStartFromPad = (e: React.DragEvent, pad: PadData, sourceBankId: string, index: number) => {
    if (adminPadColorPaintActive) {
      e.preventDefault();
      return;
    }
    handlePadDragStart(e, index);
    if (onPadDragStart) {
      onPadDragStart(e, pad, sourceBankId);
    }
  };

  // Sort pads by position for consistent ordering
  const sortedPads = React.useMemo(
    () => [...pads].sort((a, b) => (a.position || 0) - (b.position || 0)),
    [pads]
  );
  const searchHitColor = React.useMemo(() => {
    const currentBank = allBanks.find((entry) => entry.id === bankId);
    return normalizeSearchHitColor(currentBank?.bankMetadata?.color || currentBank?.defaultColor);
  }, [allBanks, bankId]);
  const searchHitColorRgb = React.useMemo(() => hexToRgbString(searchHitColor), [searchHitColor]);

  // Calculate responsive gap and sizing
  const isMobile = windowWidth < 768;
  const isNativeCapacitor = typeof window !== 'undefined' && Boolean((window as any).Capacitor?.isNativePlatform?.());
  const supportsDesktopDragDrop = !isMobile && !isNativeCapacitor;
  const gap = isMobile ? 'gap-0' : 'gap-1';
  const aspectRatio = 'aspect-square';
  const showAddPadText = isMobile ? padSize <= 8 : padSize <= 6;
  const showAddPadDropHint = supportsDesktopDragDrop && padSize <= 6;
  const useMobileEditDrag = editMode && !adminPadColorPaintActive && (isMobile || isNativeCapacitor);

  const resolveBankName = React.useCallback((targetBankId: string | null) => {
    if (!targetBankId) return null;
    if (targetBankId === bankId) return bankName || 'Current bank';
    return (
      allBanks.find((entry) => entry.id === targetBankId)?.name ||
      availableBanks.find((entry) => entry.id === targetBankId)?.name ||
      'Target bank'
    );
  }, [allBanks, availableBanks, bankId, bankName]);

  const snapshotMobileEditDrag = React.useCallback((session: MobileEditDragSession): MobileEditDragViewState => ({
    sourceIndex: session.sourceIndex,
    sourcePadId: session.sourcePadId,
    sourcePadName: session.sourcePadName,
    sourceBankId: session.sourceBankId,
    currentX: session.currentX,
    currentY: session.currentY,
    active: session.active,
    targetIndex: session.targetIndex,
    targetBankId: session.targetBankId,
    targetBankName: session.targetBankName,
    targetKind: session.targetKind,
  }), []);

  const clearMobileEditClickSuppress = React.useCallback(() => {
    suppressMobileEditClickRef.current = false;
    if (suppressMobileEditClickTimerRef.current !== null) {
      clearTimeout(suppressMobileEditClickTimerRef.current);
      suppressMobileEditClickTimerRef.current = null;
    }
  }, []);

  const markMobileEditClickSuppressed = React.useCallback(() => {
    suppressMobileEditClickRef.current = true;
    if (suppressMobileEditClickTimerRef.current !== null) {
      clearTimeout(suppressMobileEditClickTimerRef.current);
    }
    suppressMobileEditClickTimerRef.current = setTimeout(() => {
      suppressMobileEditClickTimerRef.current = null;
      suppressMobileEditClickRef.current = false;
    }, 450);
  }, []);

  const unlockMobileEditDragScroll = React.useCallback(() => {
    const lock = mobileEditDragScrollLockRef.current;
    if (!lock || typeof document === 'undefined') return;
    lock.sourceElement.style.touchAction = lock.sourceTouchAction;
    document.body.style.touchAction = lock.bodyTouchAction;
    document.documentElement.style.overscrollBehaviorY = lock.documentOverscrollBehaviorY;
    mobileEditDragScrollLockRef.current = null;
  }, []);

  const lockMobileEditDragScroll = React.useCallback((sourceElement: HTMLElement) => {
    if (typeof document === 'undefined' || mobileEditDragScrollLockRef.current) return;
    mobileEditDragScrollLockRef.current = {
      sourceElement,
      sourceTouchAction: sourceElement.style.touchAction,
      bodyTouchAction: document.body.style.touchAction,
      documentOverscrollBehaviorY: document.documentElement.style.overscrollBehaviorY,
    };
    sourceElement.style.touchAction = 'none';
    document.body.style.touchAction = 'none';
    document.documentElement.style.overscrollBehaviorY = 'contain';
  }, []);

  const resetMobileEditDrag = React.useCallback((options?: { suppressClick?: boolean }) => {
    const session = mobileEditDragRef.current;
    if (session?.timer) {
      clearTimeout(session.timer);
    }
    if (session && session.rafId !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(session.rafId);
    }
    if (session?.active && typeof session.sourceElement.releasePointerCapture === 'function') {
      try {
        session.sourceElement.releasePointerCapture(session.pointerId);
      } catch {
      }
    }
    unlockMobileEditDragScroll();
    mobileEditDragRef.current = null;
    setMobileEditDragState(null);
    setDragOverIndex(null);
    setDragOverPadTransfer(false);
    if (options?.suppressClick) {
      markMobileEditClickSuppressed();
    }
  }, [markMobileEditClickSuppressed, unlockMobileEditDragScroll]);

  const resolveMobileEditDragTarget = React.useCallback((clientX: number, clientY: number) => {
    const session = mobileEditDragRef.current;
    if (!session || typeof document === 'undefined') return;

    const hit = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    const padTarget = hit?.closest('[data-vdjv-pad-bank-id][data-vdjv-pad-index]') as HTMLElement | null;
    const bankTarget = hit?.closest('[data-vdjv-bank-drop-id]') as HTMLElement | null;

    let targetIndex: number | null = null;
    let targetBankId: string | null = null;
    let targetKind: MobileEditDragTargetKind = null;

    if (padTarget) {
      const nextBankId = padTarget.dataset.vdjvPadBankId || null;
      const indexText = padTarget.dataset.vdjvPadIndex;
      const parsedIndex = typeof indexText === 'string' ? Number.parseInt(indexText, 10) : Number.NaN;
      targetBankId = nextBankId;
      targetIndex = Number.isFinite(parsedIndex) ? parsedIndex : null;
      targetKind = 'pad';
    } else if (bankTarget) {
      targetBankId = bankTarget.dataset.vdjvBankDropId || null;
      targetKind = 'bank';
    }

    if (targetBankId === session.sourceBankId && targetKind === 'bank') {
      targetBankId = null;
      targetKind = null;
    }

    if (targetBankId && targetBankId !== session.sourceBankId) {
      const canTransfer = Boolean(onTransferPad) && (!canTransferFromBank || canTransferFromBank(session.sourceBankId));
      if (!canTransfer) {
        targetBankId = null;
        targetIndex = null;
        targetKind = null;
      }
    }

    if (targetBankId !== session.sourceBankId) {
      targetIndex = null;
    }

    session.currentX = clientX;
    session.currentY = clientY;
    session.targetIndex = targetIndex;
    session.targetBankId = targetBankId;
    session.targetBankName = resolveBankName(targetBankId);
    session.targetKind = targetKind;
    setDragOverIndex(targetBankId === session.sourceBankId ? targetIndex : null);
    setMobileEditDragState(snapshotMobileEditDrag(session));
  }, [canTransferFromBank, onTransferPad, resolveBankName, snapshotMobileEditDrag]);

  const activateMobileEditDrag = React.useCallback((pointerId: number) => {
    const session = mobileEditDragRef.current;
    if (!session || session.pointerId !== pointerId || session.active) return;
    if (session.timer) {
      clearTimeout(session.timer);
      session.timer = null;
    }
    session.active = true;
    lockMobileEditDragScroll(session.sourceElement);
    if (typeof session.sourceElement.setPointerCapture === 'function') {
      try {
        session.sourceElement.setPointerCapture(pointerId);
      } catch {
      }
    }
    setDraggedIndex(null);
    setDragOverIndex(session.sourceIndex);
    setMobileEditDragState(snapshotMobileEditDrag(session));
    resolveMobileEditDragTarget(session.currentX, session.currentY);
  }, [lockMobileEditDragScroll, resolveMobileEditDragTarget, snapshotMobileEditDrag]);

  const finishMobileEditDrag = React.useCallback(() => {
    const session = mobileEditDragRef.current;
    if (!session) return;

    const wasActive = session.active;
    const sourceIndex = session.sourceIndex;
    const sourceBankId = session.sourceBankId;
    const sourcePadId = session.sourcePadId;
    const targetIndex = session.targetIndex;
    const targetBankId = session.targetBankId;

    resetMobileEditDrag({ suppressClick: wasActive });
    if (!wasActive) return;

    if (targetBankId && targetBankId !== sourceBankId) {
      if (onTransferPad && (!canTransferFromBank || canTransferFromBank(sourceBankId))) {
        onTransferPad(sourcePadId, sourceBankId, targetBankId);
      }
      return;
    }

    if (targetIndex !== null && targetIndex !== sourceIndex) {
      onReorderPads(sourceIndex, targetIndex);
    }
  }, [canTransferFromBank, onReorderPads, onTransferPad, resetMobileEditDrag]);

  const handleMobileEditPointerDown = React.useCallback((event: React.PointerEvent<HTMLElement>, pad: PadData, index: number) => {
    if (!useMobileEditDrag) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if ((event.target as HTMLElement).closest('.transfer-indicator')) return;

    resetMobileEditDrag();
    const sourceElement = event.currentTarget;
    const session: MobileEditDragSession = {
      pointerId: event.pointerId,
      sourceIndex: index,
      sourcePadId: pad.id,
      sourcePadName: pad.name || 'Pad',
      sourceBankId: bankId,
      sourceElement,
      scrollElement: getNearestScrollableElement(sourceElement),
      startX: event.clientX,
      startY: event.clientY,
      currentX: event.clientX,
      currentY: event.clientY,
      active: false,
      timer: null,
      targetIndex: null,
      targetBankId: null,
      targetBankName: null,
      targetKind: null,
      rafId: null,
    };
    session.timer = setTimeout(() => activateMobileEditDrag(event.pointerId), MOBILE_EDIT_DRAG_LONG_PRESS_MS);
    mobileEditDragRef.current = session;
  }, [activateMobileEditDrag, bankId, resetMobileEditDrag, useMobileEditDrag]);

  const handleMobileEditClickCapture = React.useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (!suppressMobileEditClickRef.current) return;
    clearMobileEditClickSuppress();
    event.preventDefault();
    event.stopPropagation();
  }, [clearMobileEditClickSuppress]);

  React.useEffect(() => {
    if (!useMobileEditDrag || typeof document === 'undefined') {
      resetMobileEditDrag();
      return;
    }

    const scheduleTargetResolve = (session: MobileEditDragSession) => {
      if (session.rafId !== null) return;
      session.rafId = window.requestAnimationFrame(() => {
        const current = mobileEditDragRef.current;
        if (!current || current.pointerId !== session.pointerId) return;
        current.rafId = null;
        resolveMobileEditDragTarget(current.currentX, current.currentY);
      });
    };

    const autoScrollForPointer = (session: MobileEditDragSession, clientY: number) => {
      if (typeof window === 'undefined') return;
      const viewportHeight = window.visualViewport?.height || window.innerHeight || 0;
      if (viewportHeight <= 0) return;
      let delta = 0;
      if (clientY < MOBILE_EDIT_DRAG_AUTOSCROLL_EDGE_PX) {
        delta = -MOBILE_EDIT_DRAG_AUTOSCROLL_STEP_PX;
      } else if (clientY > viewportHeight - MOBILE_EDIT_DRAG_AUTOSCROLL_EDGE_PX) {
        delta = MOBILE_EDIT_DRAG_AUTOSCROLL_STEP_PX;
      }
      if (delta === 0) return;
      const scrollTarget = session.scrollElement;
      if (scrollTarget) {
        scrollTarget.scrollTop += delta;
      } else {
        window.scrollBy({ top: delta, behavior: 'auto' });
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      const session = mobileEditDragRef.current;
      if (!session || session.pointerId !== event.pointerId) return;

      const deltaX = Math.abs(event.clientX - session.startX);
      const deltaY = Math.abs(event.clientY - session.startY);
      if (!session.active && Math.max(deltaX, deltaY) >= MOBILE_EDIT_DRAG_CANCEL_PX) {
        resetMobileEditDrag();
        return;
      }

      session.currentX = event.clientX;
      session.currentY = event.clientY;
      if (session.active) {
        event.preventDefault();
        autoScrollForPointer(session, event.clientY);
        scheduleTargetResolve(session);
      }
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (!mobileEditDragRef.current?.active) return;
      event.preventDefault();
    };

    const handlePointerUp = (event: PointerEvent) => {
      const session = mobileEditDragRef.current;
      if (!session || session.pointerId !== event.pointerId) return;
      if (session.active) {
        event.preventDefault();
      }
      finishMobileEditDrag();
    };

    const handlePointerCancel = (event: PointerEvent) => {
      const session = mobileEditDragRef.current;
      if (!session || session.pointerId !== event.pointerId) return;
      resetMobileEditDrag({ suppressClick: session.active });
    };

    const handleScroll = () => {
      const session = mobileEditDragRef.current;
      if (!session) return;
      if (session.active) {
        scheduleTargetResolve(session);
        return;
      }
      resetMobileEditDrag({ suppressClick: session.active });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') {
        resetMobileEditDrag({ suppressClick: Boolean(mobileEditDragRef.current?.active) });
      }
    };

    const activeMoveOptions: AddEventListenerOptions = { capture: true, passive: false };
    document.addEventListener('pointermove', handlePointerMove, activeMoveOptions);
    document.addEventListener('pointerup', handlePointerUp, { capture: true });
    document.addEventListener('pointercancel', handlePointerCancel, { capture: true });
    document.addEventListener('touchmove', handleTouchMove, activeMoveOptions);
    document.addEventListener('scroll', handleScroll, { capture: true });
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleScroll);

    return () => {
      document.removeEventListener('pointermove', handlePointerMove, activeMoveOptions);
      document.removeEventListener('pointerup', handlePointerUp, { capture: true });
      document.removeEventListener('pointercancel', handlePointerCancel, { capture: true });
      document.removeEventListener('touchmove', handleTouchMove, activeMoveOptions);
      document.removeEventListener('scroll', handleScroll, { capture: true });
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleScroll);
    };
  }, [finishMobileEditDrag, resetMobileEditDrag, resolveMobileEditDragTarget, useMobileEditDrag]);

  React.useEffect(() => {
    resetMobileEditDrag();
  }, [adminPadColorPaintActive, bankId, editMode, resetMobileEditDrag]);

  React.useEffect(() => {
    return () => {
      resetMobileEditDrag();
      clearMobileEditClickSuppress();
    };
  }, [clearMobileEditClickSuppress, resetMobileEditDrag]);

  const handlePadDragStart = (e: React.DragEvent, index: number) => {
    if (!editMode || adminPadColorPaintActive) return;
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handlePadDragOver = (e: React.DragEvent, index: number) => {
    const hasExternalFiles = Array.from(e.dataTransfer?.types || []).includes('Files');
    if (hasExternalFiles && onFileUpload) {
      e.preventDefault();
      setIsDragOverGrid(true);
      setDragOverPadTransfer(false);
      return;
    }

    if (!editMode || adminPadColorPaintActive || draggedIndex === null) return;
    e.preventDefault();
    setDragOverIndex(index);
  };

  const handlePadDragEnd = () => {
    if (!editMode || adminPadColorPaintActive) return;
    if (draggedIndex !== null && dragOverIndex !== null && draggedIndex !== dragOverIndex) {
      onReorderPads(draggedIndex, dragOverIndex);
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handlePadDragLeave = (e: React.DragEvent) => {
    const hasExternalFiles = Array.from(e.dataTransfer?.types || []).includes('Files');
    if (hasExternalFiles) {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
        setIsDragOverGrid(false);
      }
      return;
    }
    setDragOverIndex(null);
  };

  const handlePadDrop = (e: React.DragEvent, index: number) => {
    if (editMode && !adminPadColorPaintActive && draggedIndex !== null) {
      e.preventDefault();
      e.stopPropagation();
      if (draggedIndex !== index) {
        onReorderPads(draggedIndex, index);
      }
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }

    e.stopPropagation();
    void handleDrop(e);
    setDragOverIndex(null);
  };

  if (pads.length === 0) {
    return (
      <>
        <input
          ref={fileInputRef}
          type="file"
          accept={AUDIO_FILE_INPUT_ACCEPT}
          multiple
          onChange={handleFileSelect}
          className="hidden"
        />
        <div
          data-vdjv-bank-drop-id={bankId}
          className={`vdjv-surface flex h-64 cursor-pointer items-center justify-center rounded-2xl border-2 border-dashed transition-all duration-300 relative ${dragOverPadTransfer
            ? 'border-orange-400 bg-orange-100 scale-105 dark:bg-orange-950/40'
            : isDragOverGrid
              ? 'border-red-400 bg-red-50 dark:bg-red-950/30'
              : theme === 'dark'
                ? 'border-red-400/24 hover:border-red-300/40'
                : 'border-red-200 hover:border-red-300'
            }`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={!dragOverPadTransfer ? handleEmptyAreaClick : undefined}
        >
          {dragOverPadTransfer ? (
            <div className="text-center">
              <div className="text-4xl mb-2">TARGET</div>
              <p className="text-lg font-bold text-orange-700">DROP PAD HERE</p>
              <p className="text-sm text-orange-600">Transfer to {bankName}</p>
            </div>
          ) : (
            <div className="text-center">
              <p className={`text-lg mb-2 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                No pads loaded
              </p>
              <p className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                {supportsDesktopDragDrop ? 'Click here or drag audio files to create pads' : 'Click here to upload audio'}
              </p>
            </div>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept={AUDIO_FILE_INPUT_ACCEPT}
        multiple
        onChange={handleFileSelect}
        className="hidden"
      />
      <div
      data-vdjv-bank-drop-id={bankId}
      className={`grid ${gap} w-full min-w-0 max-w-full overflow-x-hidden transition-all duration-200 ${mobileEditDragState?.active ? 'touch-none' : useMobileEditDrag ? 'touch-pan-y' : ''} ${adminPadColorPaintActive ? 'cursor-crosshair' : ''} ${dragOverPadTransfer
                ? 'ring-4 ring-orange-400 ring-offset-2 ring-offset-transparent bg-orange-50 dark:bg-orange-900/20 rounded-2xl p-2'
        : channelLoadArmed
          ? 'rounded-2xl shadow-[inset_0_0_0_2px_rgba(16,185,129,0.65)] bg-emerald-50/20 dark:bg-emerald-900/10'
          : editMode
            ? 'rounded-2xl shadow-[inset_0_0_0_2px_hsl(var(--vdjv-warn)/0.62)] bg-amber-50/20 dark:bg-amber-900/10'
          : ''
        }`}
      style={{
        gridTemplateColumns: `repeat(${padSize}, minmax(0, 1fr))`,
      }}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      {/* Drop zone indicator overlay for pad transfers */}
      {dragOverPadTransfer && (
        <div className="absolute inset-0 flex items-center justify-center z-50 pointer-events-none">
          <div className={`text-center p-4 rounded-xl ${theme === 'dark'
            ? 'bg-orange-900/80 text-orange-200 border border-orange-600'
            : 'bg-orange-100/90 text-orange-800 border border-orange-400'
            }`}>
            <div className="text-3xl mb-2">TARGET</div>
            <p className="font-bold text-lg">DROP PAD HERE</p>
            <p className="text-sm opacity-75">Transfer to {bankName}</p>
          </div>
        </div>
      )}

      {sortedPads.map((pad, index) => (
        <div
          key={pad.id}
          id={buildPadSearchAnchorId(bankId, pad.id)}
          data-bank-id={bankId}
          data-pad-id={pad.id}
          data-vdjv-pad-bank-id={bankId}
          data-vdjv-pad-index={index}
          className={`relative min-w-0 max-w-full ${aspectRatio} transition-all duration-300 ${
            editMode && dragOverIndex === index ? 'ring-2 ring-red-400' : ''
            } ${
            mobileEditDragState?.active && mobileEditDragState.sourcePadId === pad.id
              ? 'z-20 scale-[1.02] opacity-75'
              : ''
            } ${
            highlightedPadId === pad.id
              ? (theme === 'dark'
                  ? 'sampler-search-hit sampler-search-hit-dark ring-4 ring-red-300 ring-offset-2 ring-offset-gray-950 z-10'
                  : 'sampler-search-hit sampler-search-hit-light ring-4 ring-red-500 ring-offset-2 ring-offset-white z-10')
              : ''
            }`}
          style={{
            contain: 'content',
            ['--sampler-search-hit-color' as string]: searchHitColor,
            ['--sampler-search-hit-rgb' as string]: searchHitColorRgb,
          }}
          onDragOver={(e) => handlePadDragOver(e, index)}
          onDrop={(e) => handlePadDrop(e, index)}
          onDragLeave={(e) => handlePadDragLeave(e)}
          onPointerDown={useMobileEditDrag ? (e) => handleMobileEditPointerDown(e, pad, index) : undefined}
          onClickCapture={useMobileEditDrag ? handleMobileEditClickCapture : undefined}
        >
          {highlightedPadId === pad.id ? (
            <div className="sampler-search-hit-badge pointer-events-none">
              Found
            </div>
          ) : null}
          <SamplerPad
            pad={pad}
            bankId={bankId}
            bankName={bankName}
            allBanks={dialogBanks}
            allPads={dialogAllPads}
            bankPads={dialogBankPads}
            editMode={editMode}
            globalMuted={globalMuted}
            masterVolume={masterVolume}
            theme={theme}
            stopMode={stopMode}
            padSize={padSize}
            onUpdatePad={onUpdatePad}
            onRemovePad={onRemovePad}
            onDuplicatePad={onDuplicatePad}
            onRelinkMissingPadMedia={onRelinkMissingPadMedia}
            onRehydratePadMedia={onRehydratePadMedia}
            onDragStart={(e, dragPad, sourceBankId) => handlePadDragStartFromPad(e, dragPad, sourceBankId, index)}
            onDragEnd={handlePadDragEnd}
            onTransferPad={onTransferPad}
            availableBanks={availableBanks}
            canTransferFromBank={canTransferFromBank}
            midiEnabled={midiEnabled}
            blockedShortcutKeys={blockedShortcutKeys}
            blockedMidiNotes={blockedMidiNotes}
            blockedMidiCCs={blockedMidiCCs}
            hideShortcutLabel={hideShortcutLabel}
            adminColorPaintActive={adminPadColorPaintActive}
            onAdminPaintPad={onAdminPadColorPaint}
            graphicsTier={graphicsTier}
            editRequestToken={editRequest?.padId === pad.id ? editRequest.token : undefined}
            closeEditRequestToken={closeEditRequest?.padId === pad.id ? closeEditRequest.token : undefined}
            onRequestEditPad={onRequestEditPad}
            onEditDialogOpenChange={onPadEditDialogOpenChange}
            channelLoadArmed={channelLoadArmed}
            onSelectPadForChannelLoad={onSelectPadForChannelLoad}
            requiresAuthToPlay={requiresAuthToPlay}
            onRequireLogin={onRequireLogin}
            onGuestTrialConsumePlayback={onGuestTrialConsumePlayback}
            useNativeEditDrag={!useMobileEditDrag}
          />
        </div>
      ))}
      {onFileUpload && (
        <button
          type="button"
          className={`relative min-w-0 max-w-full overflow-hidden ${aspectRatio} rounded-xl border-2 border-dashed transition-colors ${
            theme === 'dark'
              ? 'border-slate-600 bg-slate-900 text-slate-200 hover:border-red-400 hover:bg-slate-800'
              : 'border-slate-300 bg-white text-slate-700 hover:border-red-400 hover:bg-red-50'
          } ${channelLoadArmed ? 'cursor-not-allowed opacity-55' : 'cursor-pointer'}`}
          onClick={handleUploadTileClick}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          disabled={channelLoadArmed}
          aria-label={`Upload audio to ${bankName || 'current bank'}`}
        >
          <span className="flex h-full w-full min-w-0 flex-col items-center justify-center gap-1.5 overflow-hidden p-1.5 text-center">
            <span className={`flex h-10 max-h-[48%] w-10 max-w-[48%] shrink-0 items-center justify-center rounded-full border ${
              theme === 'dark'
                ? 'border-red-400/50 bg-red-500/12 text-red-100'
                : 'border-red-200 bg-red-50 text-red-600'
            }`}>
              <Upload className="h-5 max-h-[70%] w-5 max-w-[70%]" />
            </span>
            {showAddPadText ? (
              <span className="max-w-full truncate text-xs font-bold uppercase leading-none tracking-wide">Add Pad</span>
            ) : null}
            {showAddPadDropHint ? (
              <span className="max-w-full truncate text-[10px] leading-none opacity-70">Drop audio here</span>
            ) : null}
          </span>
        </button>
      )}
      {Array.from({ length: Math.max(1, padSize) }).map((_, index) => (
        <div
          key={`bottom-spacer-${index}`}
          aria-hidden="true"
          className={`pointer-events-none min-w-0 max-w-full ${aspectRatio}`}
        />
      ))}
      </div>
      {mobileEditDragState?.active && (
        <div
          className={`pointer-events-none fixed z-[90] max-w-[220px] rounded-xl border px-3 py-2 text-xs font-bold shadow-2xl ${
            theme === 'dark'
              ? 'border-amber-300/40 bg-slate-950/92 text-white'
              : 'border-amber-500/50 bg-white/95 text-slate-950'
          }`}
          style={{
            left: 0,
            top: 0,
            transform: `translate3d(${mobileEditDragState.currentX + 12}px, ${mobileEditDragState.currentY + 12}px, 0)`,
          }}
        >
          <div className="truncate">{mobileEditDragState.sourcePadName}</div>
          <div className={`mt-1 truncate text-[10px] font-semibold uppercase tracking-wide ${
            theme === 'dark' ? 'text-amber-200' : 'text-amber-700'
          }`}>
            {mobileEditDragState.targetBankId && mobileEditDragState.targetBankId !== mobileEditDragState.sourceBankId
              ? `Transfer to ${mobileEditDragState.targetBankName || 'bank'}`
              : mobileEditDragState.targetIndex !== null && mobileEditDragState.targetIndex !== mobileEditDragState.sourceIndex
                ? `Move to slot ${mobileEditDragState.targetIndex + 1}`
                : 'Drag to a pad or bank'}
          </div>
        </div>
      )}
    </>
  );
}
);

