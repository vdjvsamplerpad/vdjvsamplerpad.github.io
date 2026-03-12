import * as React from 'react';
import { SamplerPad } from './SamplerPad';
import { PadData, SamplerBank, StopMode } from './types/sampler';
import { buildPadSearchAnchorId } from './samplerSearch';

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
  graphicsTier?: import('@/lib/performance-monitor').PerformanceTier;
  editRequest?: { padId: string; token: number } | null;
  channelLoadArmed?: boolean;
  onSelectPadForChannelLoad?: (pad: PadData, bankId: string, bankName: string) => void;
  requiresAuthToPlay?: boolean;
  onRequireLogin?: () => void;
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
  graphicsTier = 'low',
  editRequest = null,
  channelLoadArmed = false,
  onSelectPadForChannelLoad,
  requiresAuthToPlay = false,
  onRequireLogin,
  highlightedPadId = null
}: PadGridProps) {
  const [draggedIndex, setDraggedIndex] = React.useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = React.useState<number | null>(null);
  const [isDragOverGrid, setIsDragOverGrid] = React.useState(false);
  const [dragOverPadTransfer, setDragOverPadTransfer] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

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

    if (data) {
      try {
        const dragData = JSON.parse(data);
        if (dragData.type === 'pad-transfer' && dragData.sourceBankId !== bankId && onTransferPad) {
          // Check if source bank allows transfers
          if (!canTransferFromBank || canTransferFromBank(dragData.sourceBankId)) {
            onTransferPad(dragData.pad.id, dragData.sourceBankId, bankId);
          }
          return;
        }
      } catch {
      }
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
  }, [onFileUpload, onTransferPad, bankId]);

  const handleDragOver = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();

    // Check if this is a pad transfer from another bank
    let data = e.dataTransfer.getData('application/json');
    if (!data) {
      data = e.dataTransfer.getData('text/plain');
    }

    if (data) {
      try {
        const dragData = JSON.parse(data);
        if (dragData.type === 'pad-transfer' && dragData.sourceBankId !== bankId) {
          // Check if source bank allows transfers
          if (!canTransferFromBank || canTransferFromBank(dragData.sourceBankId)) {
            setDragOverPadTransfer(true);
            setIsDragOverGrid(false);
          }
          return;
        }
      } catch {
        // Not a pad transfer, continue with file drag
      }
    }

    // Regular file drag over
    setIsDragOverGrid(true);
    setDragOverPadTransfer(false);
  }, [bankId]);

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

  const handlePadDragStartFromPad = (e: React.DragEvent, pad: PadData, sourceBankId: string, index: number) => {
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

  const handlePadDragStart = (e: React.DragEvent, index: number) => {
    if (!editMode) return;
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

    if (!editMode || draggedIndex === null) return;
    e.preventDefault();
    setDragOverIndex(index);
  };

  const handlePadDragEnd = () => {
    if (!editMode) return;
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
    if (editMode && draggedIndex !== null) {
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
          accept="audio/*"
          multiple
          onChange={handleFileSelect}
          className="hidden"
        />
        <div
          className={`flex items-center justify-center h-64 rounded-2xl border-2 border-dashed transition-all duration-300 cursor-pointer relative ${dragOverPadTransfer
            ? 'border-orange-400 bg-orange-100 scale-105'
            : isDragOverGrid
              ? 'border-blue-400 bg-blue-50'
              : theme === 'dark'
                ? 'bg-gray-800 border-gray-600 hover:bg-gray-700'
                : 'bg-white border-gray-300 hover:bg-gray-50'
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
    <div
      className={`grid ${gap} w-full min-w-0 max-w-full overflow-x-hidden transition-all duration-200 ${dragOverPadTransfer
        ? 'ring-4 ring-orange-400 ring-offset-2 ring-offset-transparent bg-orange-50 dark:bg-orange-900/20 rounded-2xl p-2'
        : channelLoadArmed
          ? 'rounded-2xl shadow-[inset_0_0_0_2px_rgba(16,185,129,0.65)] bg-emerald-50/20 dark:bg-emerald-900/10'
          : editMode
            ? 'rounded-2xl shadow-[inset_0_0_0_2px_rgba(251,146,60,0.65)] bg-amber-50/20 dark:bg-amber-900/10'
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
          className={`relative min-w-0 max-w-full ${aspectRatio} transition-all duration-300 ${
            editMode && dragOverIndex === index ? 'ring-2 ring-blue-400' : ''
            } ${
            highlightedPadId === pad.id
              ? (theme === 'dark'
                  ? 'sampler-search-hit sampler-search-hit-dark ring-4 ring-cyan-300 ring-offset-2 ring-offset-gray-900 scale-[1.02] z-10'
                  : 'sampler-search-hit sampler-search-hit-light ring-4 ring-cyan-400 ring-offset-2 ring-offset-white scale-[1.02] z-10')
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
            allBanks={allBanks}
            allPads={allPads}
            bankPads={pads}
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
            graphicsTier={graphicsTier}
            editRequestToken={editRequest?.padId === pad.id ? editRequest.token : undefined}
            channelLoadArmed={channelLoadArmed}
            onSelectPadForChannelLoad={onSelectPadForChannelLoad}
            requiresAuthToPlay={requiresAuthToPlay}
            onRequireLogin={onRequireLogin}
          />
        </div>
      ))}
    </div>
  );
}
);

