import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Lock, Play, Square, Unlock } from 'lucide-react';
import { loadWaveformPeaks } from '@/lib/waveform-peaks';
import { getIOSAudioService } from '@/lib/ios-audio-service';
import type { PerformanceTier } from '@/lib/performance-monitor';

const MIN_TRIM_GAP_MS = 10;
const CURSOR_PREVIEW_MAX_MS = 4000;

interface WaveformTrimProps {
  audioUrl: string;
  startTimeMs: number;
  endTimeMs: number;
  durationMs: number;
  onStartTimeChange: (ms: number) => void;
  onEndTimeChange: (ms: number) => void;
  hotcues?: (number | null)[];
  hotcueMarkerMs?: number | null;
  onHotcueMarkerChange?: (timeMs: number) => void;
  onCursorTimeChange?: (timeMs: number | null) => void;
  onDurationMeasured?: (durationMs: number) => void;
  graphicsTier?: PerformanceTier;
}

interface WaveformData {
  peaks: number[];
  duration: number;
}

export function WaveformTrim({
  audioUrl,
  startTimeMs,
  endTimeMs,
  durationMs,
  onStartTimeChange,
  onEndTimeChange,
  hotcues,
  hotcueMarkerMs,
  onHotcueMarkerChange,
  onCursorTimeChange,
  onDurationMeasured,
  graphicsTier = 'low'
}: WaveformTrimProps) {
  type DragKind = 'start' | 'end' | 'pan' | 'hotcue';
  type PreviewMode = 'trim' | 'cursor';
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Cache container bounds to avoid repeated layout reads during drag.
  const cachedRectRef = React.useRef<DOMRect | null>(null);

  const [waveformData, setWaveformData] = React.useState<WaveformData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);

  // Zoom and viewport state.
  const [zoom, setZoom] = React.useState(1);
  const [viewOffsetMs, setViewOffsetMs] = React.useState(0);

  // Drag and preview state.
  const [isDragging, setIsDragging] = React.useState<DragKind | null>(null);
  const [dragStartX, setDragStartX] = React.useState(0);
  const [dragStartViewOffset, setDragStartViewOffset] = React.useState(0);
  const [hoverTime, setHoverTime] = React.useState<number | null>(null);
  const [isPreviewing, setIsPreviewing] = React.useState(false);
  const [currentPlayTime, setCurrentPlayTime] = React.useState<number | null>(null);
  const [trimMarkersLocked, setTrimMarkersLocked] = React.useState(false);
  const [previewMode, setPreviewMode] = React.useState<PreviewMode>('trim');
  const [trimInInput, setTrimInInput] = React.useState('0:00.000');
  const [trimOutInput, setTrimOutInput] = React.useState('0:00.000');
  const [pendingDragState, setPendingDragState] = React.useState<{
    start: number;
    end: number;
    hotcue: number | null;
  } | null>(null);
  const isLowestGraphics = graphicsTier === 'lowest';
  const isDesktopLikeRuntime = React.useMemo(() => {
    if (typeof navigator === 'undefined') return false;
    return !/Android|iPad|iPhone|iPod|Mobile/i.test(navigator.userAgent);
  }, []);
  const shouldThrottleDesktopDrag = isDesktopLikeRuntime;

  const previewAudioContextRef = React.useRef<AudioContext | null>(null);
  const previewAudioBufferRef = React.useRef<AudioBuffer | null>(null);
  const previewDecodePromiseRef = React.useRef<Promise<AudioBuffer> | null>(null);
  const previewSourceRef = React.useRef<AudioBufferSourceNode | null>(null);
  const previewGainRef = React.useRef<GainNode | null>(null);
  const previewPlayTokenRef = React.useRef(0);
  const lastTouchDistance = React.useRef<number | null>(null);
  const pendingDragStateRef = React.useRef<{
    start: number;
    end: number;
    hotcue: number | null;
  } | null>(null);
  const onDurationMeasuredRef = React.useRef(onDurationMeasured);
  const renderPendingDrag = shouldThrottleDesktopDrag ? pendingDragState : null;
  const renderStartTimeMs = renderPendingDrag?.start ?? startTimeMs;
  const renderEndTimeMs = renderPendingDrag?.end ?? endTimeMs;
  const renderHotcueMarkerMs = typeof renderPendingDrag?.hotcue === 'number'
    ? renderPendingDrag.hotcue
    : (typeof hotcueMarkerMs === 'number' && Number.isFinite(hotcueMarkerMs)
      ? Math.max(0, Math.min(durationMs, hotcueMarkerMs))
      : null);
  const isIOS = React.useMemo(
    () => typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent),
    []
  );
  const visibleDurationMs = React.useMemo(() => durationMs / zoom, [durationMs, zoom]);
  const visibleMarkerEntries = React.useMemo(() => {
    const entries: Array<{
      key: string;
      label: string;
      timeMs: number;
      color: string;
      textColor?: string;
      align?: CanvasTextAlign;
      y?: number;
    }> = [
      {
        key: 'trim-in',
        label: 'IN',
        timeMs: renderStartTimeMs,
        color: '#10b981',
        align: 'left',
        y: 4
      },
      {
        key: 'trim-out',
        label: 'OUT',
        timeMs: renderEndTimeMs,
        color: '#ef4444',
        align: 'right',
        y: 4
      }
    ];
    if (typeof renderHotcueMarkerMs === 'number' && Number.isFinite(renderHotcueMarkerMs)) {
      entries.push({
        key: 'marker-cue',
        label: 'CUE',
        timeMs: renderHotcueMarkerMs,
        color: '#fbbf24',
        textColor: '#111827',
        y: 22
      });
    }
    if (Array.isArray(hotcues)) {
      hotcues.forEach((cue, index) => {
        if (typeof cue !== 'number' || !Number.isFinite(cue)) return;
        entries.push({
          key: `saved-hotcue-${index}`,
          label: `C${index + 1}`,
          timeMs: Math.max(0, Math.min(durationMs, cue)),
          color: '#f97316',
          y: 92
        });
      });
    }
    return entries.sort((left, right) => left.timeMs - right.timeMs);
  }, [durationMs, hotcues, renderEndTimeMs, renderHotcueMarkerMs, renderStartTimeMs]);
  const hoverMarkerInfo = React.useMemo(() => {
    if (hoverTime === null || visibleMarkerEntries.length === 0) return null;
    const thresholdMs = Math.max(220, visibleDurationMs * 0.025);
    let nearest: { label: string; timeMs: number } | null = null;
    let nearestDelta = Number.POSITIVE_INFINITY;
    visibleMarkerEntries.forEach((entry) => {
      const delta = Math.abs(entry.timeMs - hoverTime);
      if (delta < nearestDelta) {
        nearest = { label: entry.label, timeMs: entry.timeMs };
        nearestDelta = delta;
      }
    });
    if (!nearest || nearestDelta > thresholdMs) return null;
    return nearest;
  }, [hoverTime, visibleDurationMs, visibleMarkerEntries]);
  const hoverTooltip = React.useMemo(() => {
    if (hoverTime === null) return null;
    const leftPct = clampPct(((hoverTime - viewOffsetMs) / Math.max(1, visibleDurationMs)) * 100);
    const snappedTimeMs = hoverMarkerInfo?.timeMs ?? hoverTime;
    return {
      leftPct,
      label: hoverMarkerInfo
        ? `${hoverMarkerInfo.label} • ${formatTimeLabel(snappedTimeMs)}`
        : formatTimeLabel(snappedTimeMs)
    };
  }, [hoverMarkerInfo, hoverTime, viewOffsetMs, visibleDurationMs]);

  React.useEffect(() => {
    onDurationMeasuredRef.current = onDurationMeasured;
  }, [onDurationMeasured]);

  const emitTrimPreviewDiag = React.useCallback((state: string, extra: Record<string, unknown> = {}) => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('vdjv-trim-preview-diag', {
      detail: {
        state,
        audioUrl,
        startTimeMs,
        endTimeMs,
        durationMs,
        updatedAt: Date.now(),
        ...extra
      }
    }));
  }, [audioUrl, durationMs, endTimeMs, startTimeMs]);

  const getVisibleDuration = React.useCallback(() => {
    return durationMs / zoom;
  }, [durationMs, zoom]);

  const pixelsToTime = React.useCallback((x: number, width: number) => {
    const visibleDuration = getVisibleDuration();
    const timeInView = (x / width) * visibleDuration;
    return Math.max(0, Math.min(durationMs, viewOffsetMs + timeInView));
  }, [durationMs, viewOffsetMs, getVisibleDuration]);

  const timeToPixels = React.useCallback((time: number, width: number) => {
    const visibleDuration = getVisibleDuration();
    return ((time - viewOffsetMs) / visibleDuration) * width;
  }, [viewOffsetMs, getVisibleDuration]);

  const constrainViewOffset = React.useCallback((offset: number, currentZoom: number) => {
    const visibleDuration = durationMs / currentZoom;
    const maxOffset = Math.max(0, durationMs - visibleDuration);
    return Math.max(0, Math.min(maxOffset, offset));
  }, [durationMs]);

  const flushPendingDragUpdates = React.useCallback(() => {
    const pending = pendingDragStateRef.current;
    if (!pending) return;
    pendingDragStateRef.current = null;
    setPendingDragState(null);
    if (Math.abs(pending.start - startTimeMs) > 0.001) {
      onStartTimeChange(pending.start);
    }
    if (Math.abs(pending.end - endTimeMs) > 0.001) {
      onEndTimeChange(pending.end);
    }
    if (
      pending.hotcue !== null &&
      (
        hotcueMarkerMs === null ||
        !Number.isFinite(hotcueMarkerMs) ||
        Math.abs(pending.hotcue - hotcueMarkerMs) > 0.001
      )
    ) {
      onHotcueMarkerChange?.(pending.hotcue);
    }
  }, [endTimeMs, hotcueMarkerMs, onEndTimeChange, onHotcueMarkerChange, onStartTimeChange, startTimeMs]);

  const schedulePendingDragUpdates = React.useCallback((
    nextStart: number,
    nextEnd: number,
    nextHotcue?: number
  ) => {
    const nextPendingState = {
      start: nextStart,
      end: nextEnd,
      hotcue: typeof nextHotcue === 'number' ? nextHotcue : null
    };
    pendingDragStateRef.current = nextPendingState;
    setPendingDragState(nextPendingState);
  }, []);

  // Refresh cached bounds on resize/scroll.
  React.useEffect(() => {
    const updateRect = () => {
      if (containerRef.current) {
        cachedRectRef.current = containerRef.current.getBoundingClientRect();
      }
    };

    updateRect();

    window.addEventListener('resize', updateRect);
    window.addEventListener('scroll', updateRect, true);

    return () => {
      window.removeEventListener('resize', updateRect);
      window.removeEventListener('scroll', updateRect, true);
    };
  }, []);

  // Load waveform peaks.
  React.useEffect(() => {
    if (isLowestGraphics) {
      setWaveformData({
        peaks: [],
        duration: durationMs
      });
      setIsLoading(false);
      return;
    }

    if (!audioUrl || durationMs === 0) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    const generateWaveform = async () => {
      setIsLoading(true);
      try {
        const waveform = await loadWaveformPeaks(audioUrl, audioUrl);
        if (cancelled) return;
        setWaveformData(waveform);
        if (typeof onDurationMeasuredRef.current === 'function') {
          const measuredDurationMs = Number.isFinite(waveform.duration) ? waveform.duration * 1000 : 0;
          if (measuredDurationMs > 0) {
            onDurationMeasuredRef.current(measuredDurationMs);
          }
        }
        setIsLoading(false);
      } catch (error) {
        if (!cancelled) setIsLoading(false);
      }
    };

    generateWaveform();
    return () => { cancelled = true; };
  }, [audioUrl, isLowestGraphics]);

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el || isLoading) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = cachedRectRef.current || el.getBoundingClientRect();

      const x = e.clientX - rect.left;
      const width = rect.width;

      const timeUnderCursor = pixelsToTime(x, width);
      const delta = -e.deltaY * 0.001;
      const newZoom = Math.max(1, Math.min(50, zoom * (1 + delta)));

      const newVisibleDuration = durationMs / newZoom;
      const newOffset = timeUnderCursor - (x / width) * newVisibleDuration;

      setZoom(newZoom);
      setViewOffsetMs(constrainViewOffset(newOffset, newZoom));
    };

    const handleTouchStart = (e: TouchEvent) => {
      e.preventDefault();
        cachedRectRef.current = el.getBoundingClientRect();

      if (e.touches.length === 2) {
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        lastTouchDistance.current = dist;
        return;
      }

      if (e.touches.length === 1) {
        handleInteractionStart(e.touches[0].clientX);
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const rect = cachedRectRef.current || el.getBoundingClientRect();

      if (e.touches.length === 2) {
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );

        if (lastTouchDistance.current !== null) {
          const delta = dist / lastTouchDistance.current;
          const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
          const timeUnderCenter = pixelsToTime(centerX, rect.width);

          const newZoom = Math.max(1, Math.min(50, zoom * delta));

          const newVisibleDuration = durationMs / newZoom;
          const newOffset = timeUnderCenter - (centerX / rect.width) * newVisibleDuration;

          setZoom(newZoom);
          setViewOffsetMs(constrainViewOffset(newOffset, newZoom));
        }
        lastTouchDistance.current = dist;
        return;
      }

      if (e.touches.length === 1) {
        handleInteractionMove(e.touches[0].clientX);
      }
    };

    const handleTouchEnd = () => {
      lastTouchDistance.current = null;
      handleInteractionEnd();
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    el.addEventListener('touchstart', handleTouchStart, { passive: false });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd);
    el.addEventListener('touchcancel', handleTouchEnd);

    return () => {
      el.removeEventListener('wheel', handleWheel);
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
      el.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [isLoading, zoom, viewOffsetMs, durationMs, startTimeMs, endTimeMs, hotcueMarkerMs, onHotcueMarkerChange, isDragging, dragStartX, dragStartViewOffset, pixelsToTime, constrainViewOffset, trimMarkersLocked]);

  const handleInteractionStart = (clientX: number) => {
    if (!containerRef.current) return;

    cachedRectRef.current = containerRef.current.getBoundingClientRect();
    const rect = cachedRectRef.current;

    const x = clientX - rect.left;
    const width = rect.width;
    const time = pixelsToTime(x, width);

    const startX = timeToPixels(renderStartTimeMs, width);
    const endX = timeToPixels(renderEndTimeMs, width);
    const markerX = renderHotcueMarkerMs !== null ? timeToPixels(renderHotcueMarkerMs, width) : null;

    const canDragTrimMarkers = !trimMarkersLocked;
    const isNearStart = canDragTrimMarkers && Math.abs(x - startX) < 20;
    const isNearEnd = canDragTrimMarkers && Math.abs(x - endX) < 20;
    const isNearMarker = markerX !== null && Math.abs(x - markerX) < 14;

    if (isNearStart) {
      setIsDragging('start');
    } else if (isNearEnd) {
      setIsDragging('end');
    } else if (isNearMarker && typeof onHotcueMarkerChange === 'function') {
      setIsDragging('hotcue');
    } else {
      if (zoom > 1) {
        setIsDragging('pan');
        setDragStartX(x);
        setDragStartViewOffset(viewOffsetMs);
      } else {
        if (trimMarkersLocked) return;
        const distToStart = Math.abs(time - startTimeMs);
        const distToEnd = Math.abs(time - endTimeMs);
        if (distToStart < distToEnd) {
          const nextStart = Math.max(0, Math.min(time, renderEndTimeMs - MIN_TRIM_GAP_MS));
          setIsDragging('start');
          if (shouldThrottleDesktopDrag) {
            schedulePendingDragUpdates(nextStart, renderEndTimeMs, renderHotcueMarkerMs ?? undefined);
          } else {
            onStartTimeChange(nextStart);
          }
        } else {
          const nextEnd = Math.max(time, renderStartTimeMs + MIN_TRIM_GAP_MS);
          setIsDragging('end');
          if (shouldThrottleDesktopDrag) {
            schedulePendingDragUpdates(renderStartTimeMs, nextEnd, renderHotcueMarkerMs ?? undefined);
          } else {
            onEndTimeChange(nextEnd);
          }
        }
      }
    }
  };

  const handleInteractionMove = (clientX: number) => {
    if (!containerRef.current || !isDragging) return;

    const rect = cachedRectRef.current || containerRef.current.getBoundingClientRect();

    const x = clientX - rect.left;
    const width = rect.width;

    if (isDragging === 'pan') {
      const dx = x - dragStartX;
      const dt = (dx / width) * (durationMs / zoom);
      const newOffset = dragStartViewOffset - dt;
      setViewOffsetMs(constrainViewOffset(newOffset, zoom));
      return;
    }

    const time = pixelsToTime(x, width);
    const clampedTime = Math.max(0, Math.min(durationMs, time));
    const pending = pendingDragStateRef.current;
    const liveStart = pending?.start ?? startTimeMs;
    const liveEnd = pending?.end ?? endTimeMs;
    const liveHotcue = typeof pending?.hotcue === 'number' ? pending.hotcue : renderHotcueMarkerMs;

    if (isDragging === 'hotcue') {
      if (shouldThrottleDesktopDrag) {
        schedulePendingDragUpdates(liveStart, liveEnd, clampedTime);
      }
      onHotcueMarkerChange?.(clampedTime);
      setHoverTime(clampedTime);
      return;
    }

    if (isDragging === 'start') {
      if (trimMarkersLocked) return;
      const nextStart = Math.min(clampedTime, liveEnd - MIN_TRIM_GAP_MS);
      if (shouldThrottleDesktopDrag) {
        schedulePendingDragUpdates(nextStart, liveEnd, liveHotcue ?? undefined);
      } else {
        onStartTimeChange(nextStart);
      }
    } else {
      if (trimMarkersLocked) return;
      const nextEnd = Math.max(clampedTime, liveStart + MIN_TRIM_GAP_MS);
      if (shouldThrottleDesktopDrag) {
        schedulePendingDragUpdates(liveStart, nextEnd, liveHotcue ?? undefined);
      } else {
        onEndTimeChange(nextEnd);
      }
    }
    setHoverTime(clampedTime);
  };

  const handleInteractionEnd = () => {
    if (shouldThrottleDesktopDrag) {
      flushPendingDragUpdates();
    }
    setIsDragging(null);
  };

  const handleTrimLockToggle = React.useCallback(() => {
    setTrimMarkersLocked((prev) => {
      if (!prev && shouldThrottleDesktopDrag) {
        flushPendingDragUpdates();
      }
      return !prev;
    });
  }, [flushPendingDragUpdates, shouldThrottleDesktopDrag]);

  const applyZoomValue = React.useCallback((rawZoom: number) => {
    const nextZoom = Math.max(1, Math.min(50, Number.isFinite(rawZoom) ? rawZoom : zoom));
    if (Math.abs(nextZoom - zoom) < 0.001) return;
    const markerAnchorTime = typeof hotcueMarkerMs === 'number' && Number.isFinite(hotcueMarkerMs)
      ? Math.max(0, Math.min(durationMs, hotcueMarkerMs))
      : null;
    const viewCenterTime = viewOffsetMs + ((durationMs / zoom) * 0.5);
    const savedCueAnchorTime = Array.isArray(hotcues)
      ? hotcues
        .filter((cue): cue is number => typeof cue === 'number' && Number.isFinite(cue))
        .map((cue) => Math.max(0, Math.min(durationMs, cue)))
        .sort((a, b) => Math.abs(a - viewCenterTime) - Math.abs(b - viewCenterTime))[0] ?? null
      : null;
    const cueAnchorTime = markerAnchorTime
      ?? savedCueAnchorTime
      ?? (hoverTime !== null ? Math.max(0, Math.min(durationMs, hoverTime)) : null);
    const anchorRatio = cueAnchorTime !== null
      ? (cueAnchorTime - viewOffsetMs) / (durationMs / zoom)
      : 0.5;
    const safeAnchorRatio = Math.max(0, Math.min(1, Number.isFinite(anchorRatio) ? anchorRatio : 0.5));
    const anchorTime = viewOffsetMs + (durationMs / zoom) * safeAnchorRatio;
    const newVisibleDuration = durationMs / nextZoom;
    const newOffset = anchorTime - (safeAnchorRatio * newVisibleDuration);
    setZoom(nextZoom);
    setViewOffsetMs(constrainViewOffset(newOffset, nextZoom));
  }, [constrainViewOffset, durationMs, hotcueMarkerMs, hotcues, hoverTime, viewOffsetMs, zoom]);

  const fitRangeView = React.useCallback((rangeStartMs: number, rangeEndMs: number) => {
    const safeStart = Math.max(0, Math.min(durationMs, rangeStartMs));
    const safeEnd = Math.max(safeStart + MIN_TRIM_GAP_MS, Math.min(durationMs, rangeEndMs));
    const span = Math.max(MIN_TRIM_GAP_MS, safeEnd - safeStart);
    const paddedSpan = Math.min(durationMs, Math.max(span * 1.2, MIN_TRIM_GAP_MS * 8));
    const nextZoom = Math.max(1, Math.min(50, durationMs / Math.max(MIN_TRIM_GAP_MS, paddedSpan)));
    const centeredOffset = safeStart - ((paddedSpan - span) * 0.5);
    setZoom(nextZoom);
    setViewOffsetMs(constrainViewOffset(centeredOffset, nextZoom));
  }, [constrainViewOffset, durationMs]);

  const handleZoomPreset = React.useCallback((preset: 'full' | 'trim' | 'cue') => {
    if (preset === 'full') {
      setZoom(1);
      setViewOffsetMs(0);
      return;
    }
    if (preset === 'trim') {
      fitRangeView(renderStartTimeMs, renderEndTimeMs);
      return;
    }
    const cueFocus = typeof renderHotcueMarkerMs === 'number'
      ? renderHotcueMarkerMs
      : (hoverTime ?? renderStartTimeMs);
    fitRangeView(
      Math.max(0, cueFocus - 1500),
      Math.min(durationMs, cueFocus + 1500)
    );
  }, [durationMs, fitRangeView, hoverTime, renderEndTimeMs, renderHotcueMarkerMs, renderStartTimeMs]);

  // Mouse handlers.
  const handleMouseDown = (e: React.MouseEvent) => {
    handleInteractionStart(e.clientX);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (containerRef.current && !isDragging) {
      const rect = cachedRectRef.current || containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      setHoverTime(pixelsToTime(x, rect.width));
    }
    handleInteractionMove(e.clientX);
  };

  React.useEffect(() => {
    if (!trimMarkersLocked) return;
    pendingDragStateRef.current = null;
    setPendingDragState(null);
    if (isDragging === 'start' || isDragging === 'end') {
      setIsDragging(null);
    }
  }, [isDragging, trimMarkersLocked]);

  // Report hover/preview cursor to parent.
  React.useEffect(() => {
    if (onCursorTimeChange) {
      if (isPreviewing && currentPlayTime !== null) {
        onCursorTimeChange(currentPlayTime);
      } else if (hoverTime !== null && !isDragging) {
        onCursorTimeChange(hoverTime);
      } else {
        onCursorTimeChange(null);
      }
    }
  }, [isPreviewing, currentPlayTime, hoverTime, isDragging, onCursorTimeChange]);

  // Draw waveform, range handles, and markers.
  React.useEffect(() => {
    if (!canvasRef.current || !waveformData || !containerRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = containerRef.current.clientWidth;
    const height = 120;

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const { peaks } = waveformData;
    const visibleDuration = durationMs / zoom;

    const peaksPerMs = peaks.length / durationMs;
    const startPeakIndex = Math.floor(viewOffsetMs * peaksPerMs);
    const endPeakIndex = Math.ceil((viewOffsetMs + visibleDuration) * peaksPerMs);

    const visiblePeaks = peaks.slice(
      Math.max(0, startPeakIndex),
      Math.min(peaks.length, endPeakIndex)
    );

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(0, 0, width, height);

    const drawMarkerPill = (
      x: number,
      text: string,
      color: string,
      y: number,
      align: CanvasTextAlign = 'center',
      textColor: string = '#ffffff'
    ) => {
      ctx.font = '600 10px sans-serif';
      const measured = ctx.measureText(text);
      const paddingX = 5;
      const pillWidth = measured.width + paddingX * 2;
      const pillHeight = 14;
      let drawX = x - (pillWidth / 2);
      if (align === 'left') drawX = x + 6;
      if (align === 'right') drawX = x - pillWidth - 6;
      drawX = Math.max(2, Math.min(width - pillWidth - 2, drawX));
      const drawY = Math.max(2, Math.min(height - pillHeight - 2, y));
      ctx.fillStyle = color;
      ctx.fillRect(drawX, drawY, pillWidth, pillHeight);
      ctx.fillStyle = textColor;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, drawX + paddingX, drawY + pillHeight / 2);
    };

    const startX = timeToPixels(renderStartTimeMs, width);
    const endX = timeToPixels(renderEndTimeMs, width);
    ctx.fillStyle = 'rgba(59, 130, 246, 0.2)';

    const drawStartX = Math.max(0, startX);
    const drawEndX = Math.min(width, endX);
    if (drawEndX > drawStartX) {
      ctx.fillRect(drawStartX, 0, drawEndX - drawStartX, height);
    }

    if (visiblePeaks.length > 0) {
      const barWidth = width / visiblePeaks.length;
      const centerY = height / 2;
      const maxBarHeight = height * 0.8;

      ctx.beginPath();
      visiblePeaks.forEach((peak, i) => {
        const x = i * barWidth;
        const isInRange = x >= startX && x <= endX;

        ctx.fillStyle = isInRange ? '#3b82f6' : '#6b7280';
        const barH = peak * maxBarHeight;
        ctx.fillRect(x, centerY - barH / 2, Math.max(1, barWidth - 0.5), barH);
      });
    }

    if (startX >= -5 && startX <= width + 5) {
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(startX, 0);
      ctx.lineTo(startX, height);
      ctx.stroke();

      ctx.fillStyle = '#10b981';
      ctx.beginPath();
      ctx.moveTo(startX, 0);
      ctx.lineTo(startX - 6, 0);
      ctx.lineTo(startX - 6, 12);
      ctx.lineTo(startX, 18);
      ctx.lineTo(startX, 0);
      ctx.fill();
      drawMarkerPill(startX, 'IN', '#10b981', 4, 'left');
    }

    if (endX >= -5 && endX <= width + 5) {
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(endX, 0);
      ctx.lineTo(endX, height);
      ctx.stroke();

      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.moveTo(endX, 0);
      ctx.lineTo(endX + 6, 0);
      ctx.lineTo(endX + 6, 12);
      ctx.lineTo(endX, 18);
      ctx.lineTo(endX, 0);
      ctx.fill();
      drawMarkerPill(endX, 'OUT', '#ef4444', 4, 'right');
    }

    if (isPreviewing && currentPlayTime !== null) {
      const phX = timeToPixels(currentPlayTime, width);
      if (phX >= 0 && phX <= width) {
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(phX, 0);
        ctx.lineTo(phX, height);
        ctx.stroke();
      }
    }

    if (hoverTime !== null && !isDragging) {
      const hX = timeToPixels(hoverTime, width);
      if (hX >= 0 && hX <= width) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(hX, 0);
        ctx.lineTo(hX, height);
        ctx.stroke();
      }
    }

    if (typeof renderHotcueMarkerMs === 'number' && Number.isFinite(renderHotcueMarkerMs)) {
      const markerX = timeToPixels(renderHotcueMarkerMs, width);
      if (markerX >= -10 && markerX <= width + 10) {
        const markerColor = isDragging === 'hotcue' ? '#f59e0b' : '#fbbf24';
        ctx.strokeStyle = markerColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(markerX, 0);
        ctx.lineTo(markerX, height);
        ctx.stroke();

        ctx.fillStyle = markerColor;
        ctx.beginPath();
        ctx.moveTo(markerX, 0);
        ctx.lineTo(markerX - 6, 10);
        ctx.lineTo(markerX + 6, 10);
        ctx.fill();

        drawMarkerPill(markerX, 'CUE', markerColor, 22, 'center', '#111827');
      }
    }

    if (hotcues) {
      hotcues.forEach((hcTime, index) => {
        if (hcTime !== null) {
          const hcX = timeToPixels(hcTime, width);
          if (hcX >= -10 && hcX <= width + 10) {
            ctx.strokeStyle = '#f97316';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(hcX, 0);
            ctx.lineTo(hcX, height);
            ctx.stroke();

            ctx.fillStyle = '#f97316';
            ctx.beginPath();
            ctx.moveTo(hcX, height);
            ctx.lineTo(hcX - 5, height - 10);
            ctx.lineTo(hcX + 5, height - 10);
            ctx.fill();

            drawMarkerPill(hcX, `C${index + 1}`, '#f97316', height - 30);
          }
        }
      });
    }

  }, [waveformData, renderStartTimeMs, renderEndTimeMs, renderHotcueMarkerMs, zoom, viewOffsetMs, isPreviewing, currentPlayTime, hoverTime, hotcues, isDragging, durationMs, timeToPixels]);

  const formatTrimClock = React.useCallback((ms: number) => {
    const safeMs = Number.isFinite(ms) ? Math.max(0, ms) : 0;
    const totalSeconds = safeMs / 1000;
    const minutes = Math.floor(totalSeconds / 60);
    const secondsPart = totalSeconds - minutes * 60;
    return `${minutes}:${secondsPart.toFixed(3).padStart(6, '0')}`;
  }, []);

  const parseTrimInputToMs = React.useCallback((rawValue: string): number | null => {
    const normalized = rawValue.trim();
    if (!normalized) return null;

    const parts = normalized.split(':').map((part) => part.trim());
    if (parts.some((part) => part.length === 0)) return null;

    if (parts.length === 1) {
      const seconds = Number(parts[0]);
      if (!Number.isFinite(seconds) || seconds < 0) return null;
      return Math.round(seconds * 1000);
    }

    if (parts.length > 3) return null;

    const seconds = Number(parts[parts.length - 1]);
    const minutes = Number(parts[parts.length - 2]);
    const hours = parts.length === 3 ? Number(parts[0]) : 0;

    if (!Number.isFinite(seconds) || !Number.isFinite(minutes) || !Number.isFinite(hours)) return null;
    if (seconds < 0 || minutes < 0 || hours < 0) return null;
    if (seconds >= 60 || minutes >= 60) return null;

    const totalSeconds = hours * 3600 + minutes * 60 + seconds;
    return Math.round(totalSeconds * 1000);
  }, []);

  const sanitizeTrimInput = React.useCallback((value: string) => value.replace(/[^0-9:.]/g, ''), []);

  React.useEffect(() => {
    setTrimInInput(formatTrimClock(renderStartTimeMs));
  }, [formatTrimClock, renderStartTimeMs]);

  React.useEffect(() => {
    const normalizedOutMs = renderEndTimeMs > renderStartTimeMs
      ? renderEndTimeMs
      : Math.max(durationMs, renderStartTimeMs + MIN_TRIM_GAP_MS);
    setTrimOutInput(formatTrimClock(normalizedOutMs));
  }, [durationMs, formatTrimClock, renderEndTimeMs, renderStartTimeMs]);

  React.useEffect(() => () => { pendingDragStateRef.current = null; }, []);

  const applyTrimInInput = React.useCallback((rawValue: string) => {
    if (trimMarkersLocked) {
      setTrimInInput(formatTrimClock(startTimeMs));
      return;
    }
    const parsedMs = parseTrimInputToMs(rawValue);
    if (parsedMs === null) {
      setTrimInInput(formatTrimClock(startTimeMs));
      return;
    }

    const maxOutMs = Math.max(durationMs, startTimeMs + MIN_TRIM_GAP_MS, endTimeMs);
    const currentOutMs = endTimeMs > startTimeMs ? endTimeMs : maxOutMs;
    const maxInMs = Math.max(0, currentOutMs - MIN_TRIM_GAP_MS);
    const nextInMs = Math.max(0, Math.min(parsedMs, maxInMs));
    onStartTimeChange(nextInMs);
    if (currentOutMs <= nextInMs) {
      onEndTimeChange(Math.min(maxOutMs, nextInMs + MIN_TRIM_GAP_MS));
    }
    setTrimInInput(formatTrimClock(nextInMs));
  }, [durationMs, endTimeMs, formatTrimClock, onEndTimeChange, onStartTimeChange, parseTrimInputToMs, startTimeMs, trimMarkersLocked]);

  const applyTrimOutInput = React.useCallback((rawValue: string) => {
    if (trimMarkersLocked) {
      const currentOutMs = endTimeMs > startTimeMs ? endTimeMs : Math.max(durationMs, startTimeMs + MIN_TRIM_GAP_MS);
      setTrimOutInput(formatTrimClock(currentOutMs));
      return;
    }
    const parsedMs = parseTrimInputToMs(rawValue);
    const maxOutMs = Math.max(
      durationMs,
      startTimeMs + MIN_TRIM_GAP_MS,
      endTimeMs,
      parsedMs !== null ? parsedMs : 0
    );
    const currentOutMs = endTimeMs > startTimeMs ? endTimeMs : maxOutMs;

    if (parsedMs === null) {
      setTrimOutInput(formatTrimClock(currentOutMs));
      return;
    }

    const minOutMs = Math.min(maxOutMs, Math.max(0, startTimeMs + MIN_TRIM_GAP_MS));
    const nextOutMs = Math.max(minOutMs, Math.min(parsedMs, maxOutMs));
    onEndTimeChange(nextOutMs);
    setTrimOutInput(formatTrimClock(nextOutMs));
  }, [durationMs, endTimeMs, formatTrimClock, onEndTimeChange, parseTrimInputToMs, startTimeMs, trimMarkersLocked]);

  const handleTrimKeyDown = React.useCallback((
    event: React.KeyboardEvent<HTMLInputElement>,
    apply: (value: string) => void
  ) => {
    if (trimMarkersLocked) {
      event.preventDefault();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      apply((event.target as HTMLInputElement).value);
      return;
    }

    if (event.key.length === 1 && !/[0-9:.]/.test(event.key)) {
      event.preventDefault();
    }
  }, [trimMarkersLocked]);

  const stopPreviewPlayback = React.useCallback((keepToken: boolean = false, reason: string = 'stop') => {
    if (!keepToken) {
      previewPlayTokenRef.current += 1;
    }
    const source = previewSourceRef.current;
    const gain = previewGainRef.current;
    previewSourceRef.current = null;
    previewGainRef.current = null;

    if (source && gain && previewAudioContextRef.current) {
      try {
        const now = previewAudioContextRef.current.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.008);
        source.stop(now + 0.010);
      } catch {
        try {
          source.stop();
        } catch { }
      }
    } else if (source) {
      try {
        source.stop();
      } catch { }
    }

    setIsPreviewing(false);
    setCurrentPlayTime(null);
    emitTrimPreviewDiag('play_stop', { reason });
  }, [emitTrimPreviewDiag]);

  const getPreviewAudioContext = React.useCallback(async (): Promise<AudioContext> => {
    if (previewAudioContextRef.current) {
      const existing = previewAudioContextRef.current;
      if (existing.state === 'suspended') {
        try {
          await existing.resume();
        } catch { }
      }
      return existing;
    }

    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    const context = new AudioContextClass({ latencyHint: 'interactive' });
    previewAudioContextRef.current = context;
    if (context.state === 'suspended') {
      try {
        await context.resume();
      } catch { }
    }
    return context;
  }, []);

  const ensurePreviewBuffer = React.useCallback(async (): Promise<AudioBuffer> => {
    if (previewAudioBufferRef.current) return previewAudioBufferRef.current;
    if (previewDecodePromiseRef.current) return previewDecodePromiseRef.current;

    previewDecodePromiseRef.current = (async () => {
      emitTrimPreviewDiag('decode_start');
      try {
        const context = await getPreviewAudioContext();
        const response = await fetch(audioUrl);
        const arrayBuffer = await response.arrayBuffer();
        const decoded = await context.decodeAudioData(arrayBuffer.slice(0));
        previewAudioBufferRef.current = decoded;
        emitTrimPreviewDiag('decode_ready', { bufferDurationMs: Math.round(decoded.duration * 1000) });
        return decoded;
      } catch (error) {
        emitTrimPreviewDiag('decode_error');
        throw error;
      }
    })();

    try {
      return await previewDecodePromiseRef.current;
    } finally {
      previewDecodePromiseRef.current = null;
    }
  }, [audioUrl, emitTrimPreviewDiag, getPreviewAudioContext]);

  React.useEffect(() => {
    stopPreviewPlayback(false, 'audio_changed');
    previewAudioBufferRef.current = null;
    previewDecodePromiseRef.current = null;
    emitTrimPreviewDiag('buffer_reset', { reason: 'audio_changed' });
  }, [audioUrl, emitTrimPreviewDiag, stopPreviewPlayback]);

  const handlePreview = async () => {
    if (!audioUrl || durationMs <= 0) return;

    if (isPreviewing) {
      stopPreviewPlayback(false, 'manual_toggle');
      return;
    }

    const PREVIEW_MIN_WINDOW_SEC = 0.01;
    const previewToken = ++previewPlayTokenRef.current;
    emitTrimPreviewDiag('play_request', { previewToken });

    try {
      if (isIOS) {
        try {
          await getIOSAudioService().forceUnlock();
        } catch { }
      }

      const context = await getPreviewAudioContext();
      if (previewToken !== previewPlayTokenRef.current) return;
      emitTrimPreviewDiag('context_ready', { previewToken, contextState: context.state });
      const buffer = await ensurePreviewBuffer();
      if (previewToken !== previewPlayTokenRef.current) return;
      emitTrimPreviewDiag('buffer_ready', { previewToken, bufferDurationMs: Math.round(buffer.duration * 1000) });

      const mediaDurationSec = Math.max(PREVIEW_MIN_WINDOW_SEC, buffer.duration || (durationMs / 1000));
      const cursorAnchorMs = Math.max(
        0,
        Math.min(
          durationMs,
          hoverMarkerInfo?.timeMs
            ?? hoverTime
            ?? renderHotcueMarkerMs
            ?? renderStartTimeMs
        )
      );
      const previewStartMs = previewMode === 'cursor' ? cursorAnchorMs : renderStartTimeMs;
      const previewEndMs = previewMode === 'cursor'
        ? Math.min(
          durationMs,
          Math.max(
            previewStartMs + 600,
            previewStartMs + Math.min(CURSOR_PREVIEW_MAX_MS, Math.max(1200, effectiveDuration))
          )
        )
        : renderEndTimeMs;
      const safeStartSec = Math.max(
        0,
        Math.min(previewStartMs / 1000, Math.max(0, mediaDurationSec - PREVIEW_MIN_WINDOW_SEC))
      );
      const requestedEndSec = previewEndMs > previewStartMs ? previewEndMs / 1000 : mediaDurationSec;
      const safeEndSec = Math.max(
        safeStartSec + PREVIEW_MIN_WINDOW_SEC,
        Math.min(requestedEndSec, mediaDurationSec)
      );
      const previewDurationSec = Math.max(PREVIEW_MIN_WINDOW_SEC, safeEndSec - safeStartSec);

      stopPreviewPlayback(true, 'restart');
      if (previewToken !== previewPlayTokenRef.current) return;

      const source = context.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = 1;

      const gain = context.createGain();
      source.connect(gain);
      gain.connect(context.destination);

      const now = context.currentTime + 0.002;
      const fadeSec = Math.min(0.01, previewDurationSec / 4);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(1, now + fadeSec);
      gain.gain.setValueAtTime(1, Math.max(now + fadeSec, now + previewDurationSec - fadeSec));
      gain.gain.linearRampToValueAtTime(0, now + previewDurationSec);

      source.onended = () => {
        if (previewToken !== previewPlayTokenRef.current) return;
        previewSourceRef.current = null;
        previewGainRef.current = null;
        setIsPreviewing(false);
        setCurrentPlayTime(null);
        emitTrimPreviewDiag('play_end', { previewToken });
      };

      previewSourceRef.current = source;
      previewGainRef.current = gain;
      setCurrentPlayTime(safeStartSec * 1000);
      setIsPreviewing(true);
      emitTrimPreviewDiag('play_start', {
        previewToken,
        previewStartMs: Math.round(safeStartSec * 1000),
        previewEndMs: Math.round(safeEndSec * 1000)
      });

      source.start(now, safeStartSec, previewDurationSec);
      source.stop(now + previewDurationSec + 0.001);

      const startedAtMs = performance.now();
      const tick = () => {
        if (previewToken !== previewPlayTokenRef.current) return;
        if (!previewSourceRef.current) return;
        const elapsedMs = performance.now() - startedAtMs;
        const nextTimeMs = Math.min(safeEndSec * 1000, (safeStartSec * 1000) + elapsedMs);
        setCurrentPlayTime(nextTimeMs);
        if (nextTimeMs >= safeEndSec * 1000 - 2) return;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } catch {
      if (previewToken !== previewPlayTokenRef.current) return;
      stopPreviewPlayback(true, 'error');
      emitTrimPreviewDiag('play_error', { previewToken });
    }
  };

  React.useEffect(() => {
    return () => {
      stopPreviewPlayback(false, 'unmount');
      if (previewAudioContextRef.current) {
        const ctx = previewAudioContextRef.current;
        previewAudioContextRef.current = null;
        void ctx.close().catch(() => undefined);
      }
      previewAudioBufferRef.current = null;
      previewDecodePromiseRef.current = null;
      emitTrimPreviewDiag('buffer_reset', { reason: 'unmount' });
    };
  }, [emitTrimPreviewDiag, stopPreviewPlayback]);

  const effectiveDuration = renderEndTimeMs - renderStartTimeMs;

  return (
    <div className="space-y-4 select-none">
      <div className="space-y-2 text-sm">
        <div className="grid min-w-0 grid-cols-[auto,minmax(0,1fr),auto,minmax(0,1fr),auto] items-center gap-2">
          <label className="text-green-500 font-bold text-xs sm:text-sm" htmlFor="trim-row-in">IN</label>
          <input
            id="trim-row-in"
            type="text"
            inputMode="decimal"
            pattern="[0-9:.]*"
            className={`h-8 min-w-0 w-full rounded border border-green-500/60 bg-gray-900 px-2 text-base sm:text-sm text-green-200 outline-none focus:border-green-400 ${trimMarkersLocked ? 'cursor-not-allowed opacity-60' : ''}`}
            value={trimInInput}
            disabled={trimMarkersLocked}
            onChange={(event) => setTrimInInput(sanitizeTrimInput(event.target.value))}
            onBlur={(event) => applyTrimInInput(event.target.value)}
            onKeyDown={(event) => handleTrimKeyDown(event, applyTrimInInput)}
          />
          <label className="text-red-500 font-bold text-xs sm:text-sm" htmlFor="trim-row-out">OUT</label>
          <input
            id="trim-row-out"
            type="text"
            inputMode="decimal"
            pattern="[0-9:.]*"
            className={`h-8 min-w-0 w-full rounded border border-red-500/60 bg-gray-900 px-2 text-base sm:text-sm text-red-200 outline-none focus:border-red-400 ${trimMarkersLocked ? 'cursor-not-allowed opacity-60' : ''}`}
            value={trimOutInput}
            disabled={trimMarkersLocked}
            onChange={(event) => setTrimOutInput(sanitizeTrimInput(event.target.value))}
            onBlur={(event) => applyTrimOutInput(event.target.value)}
            onKeyDown={(event) => handleTrimKeyDown(event, applyTrimOutInput)}
          />
          <Button
            type="button"
            variant={trimMarkersLocked ? 'default' : 'outline'}
            size="sm"
            className="h-8 gap-1 whitespace-nowrap px-2"
            onClick={handleTrimLockToggle}
            title={trimMarkersLocked ? 'Unlock trim IN/OUT markers and inputs' : 'Lock trim IN/OUT markers and inputs'}
          >
            {trimMarkersLocked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
            <span className="text-[11px]">{trimMarkersLocked ? 'Locked' : 'Lock'}</span>
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-md border border-gray-700 bg-gray-900/70 p-1">
            <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={() => handleZoomPreset('full')}>
              Full
            </Button>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={() => handleZoomPreset('trim')}>
              Trim
            </Button>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={() => handleZoomPreset('cue')}>
              Cue
            </Button>
          </div>
          <Button variant="ghost" size="sm" onClick={() => handleZoomPreset('full')}>
            Reset View
          </Button>
          <div className="min-w-[8rem] max-w-[12rem] flex-1">
            <Slider
              value={[zoom]}
              min={1}
              max={50}
              step={0.1}
              onValueChange={(values) => applyZoomValue(values[0] ?? zoom)}
              className="w-full cursor-pointer"
              aria-label="Waveform zoom"
            />
          </div>
          <span className="text-xs text-gray-500 bg-gray-900 px-2 py-1 rounded">
            {zoom.toFixed(1)}x
          </span>
          <div className="flex items-center gap-1 rounded-md border border-gray-700 bg-gray-900/70 p-1">
            <Button
              type="button"
              variant={previewMode === 'trim' ? 'default' : 'ghost'}
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={() => setPreviewMode('trim')}
            >
              Preview Trim
            </Button>
            <Button
              type="button"
              variant={previewMode === 'cursor' ? 'default' : 'ghost'}
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={() => setPreviewMode('cursor')}
            >
              From Cursor
            </Button>
          </div>
          <Button
            onClick={handlePreview}
            variant={isPreviewing ? 'destructive' : 'outline'}
            size="sm"
            className="h-6 w-6 p-0"
            disabled={isLoading || effectiveDuration <= 0}
          >
            {isPreviewing ? <Square className="w-3 h-3 text-red-500" /> : <Play className="w-3 h-3 text-green-500" />}
          </Button>
        </div>
      </div>

      <div
        ref={containerRef}
        className="relative w-full bg-gray-800 rounded-lg overflow-hidden border border-gray-700 touch-none"
        style={{ height: '120px', cursor: isDragging === 'pan' ? 'grab' : isDragging === 'hotcue' ? 'ew-resize' : 'crosshair' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleInteractionEnd}
        onMouseLeave={() => { handleInteractionEnd(); setHoverTime(null); }}
        onDoubleClick={handlePreview}
      >
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-gray-500">Loading...</div>
        ) : (
          <canvas ref={canvasRef} className="w-full h-full block" />
        )}

        {hoverTooltip && !isPreviewing && !isLoading && (
          <div
            className="pointer-events-none absolute top-2 z-10 -translate-x-1/2 rounded bg-black/75 px-2 py-1 text-[10px] font-semibold text-white shadow"
            style={{ left: `${hoverTooltip.leftPct}%` }}
          >
            {hoverTooltip.label}
          </div>
        )}

        {isLowestGraphics && !isLoading && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-30">
            <span className="text-xs text-white">Waveform preview disabled in Lowest graphics</span>
          </div>
        )}

        {zoom === 1 && !isLoading && !isLowestGraphics && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-20">
            <span className="text-xs text-white">Scroll to zoom - drag to move</span>
          </div>
        )}
      </div>

    </div>
  );
}

const clampPct = (value: number): number => Math.max(0, Math.min(100, value));

const formatTimeLabel = (ms: number): string => {
  const safeMs = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  const totalSeconds = safeMs / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const secondsPart = totalSeconds - minutes * 60;
  return `${minutes}:${secondsPart.toFixed(3).padStart(6, '0')}`;
};
