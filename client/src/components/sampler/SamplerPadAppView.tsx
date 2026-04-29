import * as React from 'react';
import { PadGrid } from './PadGrid';
import { HeaderControls } from './HeaderControls';
import { Button } from '@/components/ui/button';
import type { PerformanceTier } from '@/lib/performance-monitor';
import type { PadData, SamplerBank, StopMode } from './types/sampler';
import type { RemoteSnapshotPromptState } from './hooks/useSamplerStore.snapshotMetadata';
import type { SideMenu as SideMenuType } from './SideMenu';
import type { VolumeMixer as VolumeMixerType } from './VolumeMixer';
import type { SamplerPadAppDialogs as SamplerPadAppDialogsType } from './SamplerPadAppDialogs';

const loadSideMenu = () => import('./SideMenu');
const loadVolumeMixer = () => import('./VolumeMixer');
const loadSamplerPadAppDialogs = () => import('./SamplerPadAppDialogs');

const SideMenu = React.lazy(() => loadSideMenu().then((module) => ({ default: module.SideMenu }))) as unknown as typeof SideMenuType;
const VolumeMixer = React.lazy(() => loadVolumeMixer().then((module) => ({ default: module.VolumeMixer }))) as unknown as typeof VolumeMixerType;
const SamplerPadAppDialogs = React.lazy(() => loadSamplerPadAppDialogs().then((module) => ({ default: module.SamplerPadAppDialogs }))) as unknown as typeof SamplerPadAppDialogsType;

type MissingMediaSummary = {
  missingAudio: number;
  missingImages: number;
  affectedBanks: string[];
} | null;

type PendingChannelLoadConfirm = {
  channelId: number;
  pad: PadData;
  bankId: string;
  bankName: string;
} | null;

type PendingChannelCountConfirm = {
  nextCount: number;
} | null;

type PendingOfficialPadTransferConfirm = {
  padId: string;
  sourceBankId: string;
  targetBankId: string;
  padName: string;
  targetBankName: string;
} | null;

interface SamplerPadAppViewProps {
      layoutSizeClass: string;
      theme: 'light' | 'dark';
  sideMenuProps: React.ComponentProps<typeof SideMenu>;
  headerControlsProps: React.ComponentProps<typeof HeaderControls>;
  volumeMixerProps: React.ComponentProps<typeof VolumeMixer>;
  showVolumeMixer: boolean;
  isIOSClient: boolean;
  audioRecoveryState: string;
  onRestoreAudio: () => void;
  getMainContentMargin: string;
  getMainContentPadding: string;
  usePortraitDualStack: boolean;
  padInteractionLockClass: string;
  padInteractionBlockerWidth: number;
  isDualMode: boolean;
  displayPrimary: SamplerBank | null;
  displaySecondary: SamplerBank | null;
  singleBank: SamplerBank | null;
  primaryBankId: string | null;
  secondaryBankId: string | null;
  currentBankId: string | null;
  primaryScrollRef: React.RefObject<HTMLDivElement | null>;
  secondaryScrollRef: React.RefObject<HTMLDivElement | null>;
  singleScrollRef: React.RefObject<HTMLDivElement | null>;
  primaryFallbackScrollRef: React.MutableRefObject<number>;
  secondaryFallbackScrollRef: React.MutableRefObject<number>;
  singleFallbackScrollRef: React.MutableRefObject<number>;
  saveBankScroll: (bankId: string | null, scrollTop: number) => void;
  allPads: PadData[];
  banks: SamplerBank[];
  availableBanks: Array<{ id: string; name: string }>;
  editMode: boolean;
  globalMuted: boolean;
  masterVolume: number;
  padSize: number;
  stopMode: StopMode;
  windowWidth: number;
  onUpdatePad: (bankId: string, id: string, updatedPad: unknown) => void | Promise<void>;
  onRemovePad: (bankId: string, id: string) => void;
  onDuplicatePad: (bankId: string, padId: string) => Promise<void>;
  onRelinkMissingPadMedia: (bankId: string, padId: string, file: File) => Promise<void>;
  onRehydratePadMedia: (bankId: string, padId: string) => Promise<boolean | void>;
  onReorderPads: (bankId: string, fromIndex: number, toIndex: number) => void;
  onFileUpload: (file: File, targetBankId?: string) => void | Promise<void>;
  onPadDragStart: (e: React.DragEvent, pad: PadData, sourceBankId: string) => void;
  onTransferPad: (padId: string, sourceBankId: string, targetBankId: string) => void;
  canTransferFromBank: (bankId: string) => boolean;
  midiEnabled: boolean;
  hideShortcutLabels: boolean;
  adminPadColorPaintActive: boolean;
  onAdminPadColorPaint: (bankId: string, pad: PadData) => void | Promise<void>;
  highlightedPadTarget: { bankId: string; padId: string } | null;
  graphicsTier: PerformanceTier;
  editRequest: { padId: string; token: number } | null;
  closeEditRequest: { padId: string; token: number } | null;
  onRequestEditPad: (padId: string) => void;
  onPadEditDialogOpenChange: (padId: string, open: boolean) => void;
  blockedShortcutKeys: Set<string>;
  blockedMidiNotes: Set<number>;
  blockedMidiCCs: Set<number>;
  channelLoadArmed: boolean;
  onSelectPadForChannelLoad: (pad: PadData, bankId: string, bankName: string) => void;
  isBankPlaybackLocked: (bank: SamplerBank | null | undefined) => boolean;
  onRequireLogin: (reason?: string) => void;
  onGuestTrialConsumePlayback: (pad: PadData, bankId: string, bankName: string) => boolean;
  guestTrialSummary: {
    visible: boolean;
    mode: 'guest' | 'free';
    remainingCount: number;
    exhausted: boolean;
  };
  restoreBackupInputRef: React.RefObject<HTMLInputElement | null>;
  recoverBankInputRef: React.RefObject<HTMLInputElement | null>;
  onRestoreBackupFile: (event: React.ChangeEvent<HTMLInputElement>) => void | Promise<void>;
  onRecoverBankFiles: (event: React.ChangeEvent<HTMLInputElement>) => void | Promise<void>;
  remoteSnapshotPrompt: RemoteSnapshotPromptState | null;
  remoteSnapshotRestoreProgress: {
    phase: 'applying' | 'settings' | 'finalizing';
    label: string;
    progress: number;
  } | null;
  onRemoteSnapshotPromptChange: (next: RemoteSnapshotPromptState | null) => void;
  onSkipRemoteSnapshotPrompt: () => void;
  onApplyRemoteSnapshot: () => void;
  onRestoreFromBackupForRemoteSnapshot: () => void;
  missingMediaSummary: MissingMediaSummary;
  onMissingMediaSummaryChange: (next: MissingMediaSummary) => void;
  onRestoreBackupPrompt: () => void;
  onRecoverBankPrompt: () => void;
  showRecoverBankModeDialog: boolean;
  onShowRecoverBankModeDialogChange: (open: boolean) => void;
  onChooseRecoverBankMode: (addAsNewWhenNoTarget: boolean) => void;
  pendingChannelLoadConfirm: PendingChannelLoadConfirm;
  onPendingChannelLoadConfirmChange: (next: PendingChannelLoadConfirm) => void;
  onConfirmChannelLoad: (pending: NonNullable<PendingChannelLoadConfirm>) => void;
  pendingChannelCountConfirm: PendingChannelCountConfirm;
  onPendingChannelCountConfirmChange: (next: PendingChannelCountConfirm) => void;
  onConfirmChannelCountChange: (nextCount: number) => void;
  pendingOfficialPadTransferConfirm: PendingOfficialPadTransferConfirm;
  onPendingOfficialPadTransferConfirmChange: (next: PendingOfficialPadTransferConfirm) => void;
  onConfirmOfficialPadTransfer: (pending: NonNullable<PendingOfficialPadTransferConfirm>) => void;
  showErrorDialog: boolean;
  onShowErrorDialogChange: (open: boolean) => void;
  error: string | null;
  onErrorClose: () => void;
}

const renderEmptyState = (theme: 'light' | 'dark', message: string) => (
  <div
    className={`vdjv-surface flex h-64 items-center justify-center rounded-2xl border-2 border-dashed transition-all duration-300 ${
      theme === 'dark'
        ? 'border-red-400/24'
        : 'border-red-200'
    }`}
  >
    <p className={`text-center text-sm font-medium ${theme === 'dark' ? 'text-slate-300' : 'text-slate-600'}`}>{message}</p>
  </div>
);

const renderPanelFallback = (
  theme: 'light' | 'dark',
  side: 'left' | 'right',
  widthClass: string,
  label: string
) => (
  <div
    className={`vdjv-surface fixed inset-y-0 ${side === 'left' ? 'left-0 border-r' : 'right-0 border-l'} z-50 ${widthClass} max-w-[95vw] ${
      theme === 'dark'
        ? 'text-slate-200'
        : 'text-slate-700'
    } shadow-2xl`}
  >
    <div className="flex h-full items-start justify-center p-4">
      <div className="rounded-full border px-3 py-1 text-xs font-medium tracking-wide">
        {label}
      </div>
    </div>
  </div>
);

export function SamplerPadAppView({
  layoutSizeClass,
  theme,
  sideMenuProps,
  headerControlsProps,
  volumeMixerProps,
  showVolumeMixer,
  isIOSClient,
  audioRecoveryState,
  onRestoreAudio,
  getMainContentMargin,
  getMainContentPadding,
  usePortraitDualStack,
  padInteractionLockClass,
  padInteractionBlockerWidth,
  isDualMode,
  displayPrimary,
  displaySecondary,
  singleBank,
  primaryBankId,
  secondaryBankId,
  currentBankId,
  primaryScrollRef,
  secondaryScrollRef,
  singleScrollRef,
  primaryFallbackScrollRef,
  secondaryFallbackScrollRef,
  singleFallbackScrollRef,
  saveBankScroll,
  allPads,
  banks,
  availableBanks,
  editMode,
  globalMuted,
  masterVolume,
  padSize,
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
  canTransferFromBank,
  midiEnabled,
  hideShortcutLabels,
  adminPadColorPaintActive,
  onAdminPadColorPaint,
  highlightedPadTarget,
  graphicsTier,
  editRequest,
  closeEditRequest,
  onRequestEditPad,
  onPadEditDialogOpenChange,
  blockedShortcutKeys,
  blockedMidiNotes,
  blockedMidiCCs,
  channelLoadArmed,
  onSelectPadForChannelLoad,
  isBankPlaybackLocked,
  onRequireLogin,
  onGuestTrialConsumePlayback,
  guestTrialSummary,
  restoreBackupInputRef,
  recoverBankInputRef,
  onRestoreBackupFile,
  onRecoverBankFiles,
  remoteSnapshotPrompt,
  remoteSnapshotRestoreProgress,
  onRemoteSnapshotPromptChange,
  onSkipRemoteSnapshotPrompt,
  onApplyRemoteSnapshot,
  onRestoreFromBackupForRemoteSnapshot,
  missingMediaSummary,
  onMissingMediaSummaryChange,
  onRestoreBackupPrompt,
  onRecoverBankPrompt,
  showRecoverBankModeDialog,
  onShowRecoverBankModeDialogChange,
  onChooseRecoverBankMode,
  pendingChannelLoadConfirm,
  onPendingChannelLoadConfirmChange,
  onConfirmChannelLoad,
  pendingChannelCountConfirm,
  onPendingChannelCountConfirmChange,
  onConfirmChannelCountChange,
  pendingOfficialPadTransferConfirm,
  onPendingOfficialPadTransferConfirmChange,
  onConfirmOfficialPadTransfer,
  showErrorDialog,
  onShowErrorDialogChange,
  error,
  onErrorClose
}: SamplerPadAppViewProps) {
  const showDialogs = Boolean(
    remoteSnapshotPrompt ||
    missingMediaSummary ||
    showRecoverBankModeDialog ||
    pendingChannelLoadConfirm ||
    pendingChannelCountConfirm ||
    pendingOfficialPadTransferConfirm ||
    showErrorDialog
  );

  React.useEffect(() => {
    let cancelled = false;
    const preloadPanels = () => {
      if (cancelled) return;
      void loadSideMenu();
      if (showVolumeMixer) {
        void loadVolumeMixer();
      }
    };

    if (typeof window === 'undefined') {
      preloadPanels();
      return () => {
        cancelled = true;
      };
    }

    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    if (typeof idleWindow.requestIdleCallback === 'function') {
      const handle = idleWindow.requestIdleCallback(preloadPanels, { timeout: 1200 });
      return () => {
        cancelled = true;
        if (typeof idleWindow.cancelIdleCallback === 'function') {
          idleWindow.cancelIdleCallback(handle);
        }
      };
    }

    const timeoutId = window.setTimeout(preloadPanels, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [showVolumeMixer]);

  const renderPadInteractionBlocker = () => {
    if (padInteractionBlockerWidth <= 0) return null;
    return (
      <div
        aria-hidden="true"
        className="absolute inset-y-0 right-0 z-20 touch-none select-none"
        style={{ width: `${padInteractionBlockerWidth}px` }}
      />
    );
  };

  return (
    <div className={`${layoutSizeClass} vdjv-app-bg transition-colors duration-150 ease-out flex`}>
      <React.Suspense fallback={sideMenuProps.open ? renderPanelFallback(theme, 'left', 'w-64', 'Loading Banks...') : null}>
        <SideMenu {...sideMenuProps} />
      </React.Suspense>

      {isIOSClient && audioRecoveryState === 'blocked' && (
        <div
          className={`vdjv-surface fixed left-1/2 top-3 z-40 -translate-x-1/2 rounded-xl px-3 py-2 shadow-lg ${
            theme === 'dark'
              ? 'text-slate-100'
              : 'text-slate-900'
          }`}
        >
          <div className="flex items-center gap-3 text-xs sm:text-sm">
            <span>Audio needs a quick restore after resume.</span>
            <Button size="sm" className="h-7 px-2 text-xs" onClick={onRestoreAudio}>
              Restore Audio
            </Button>
          </div>
        </div>
      )}

      {showVolumeMixer && (
        <React.Suspense fallback={volumeMixerProps.open ? renderPanelFallback(theme, 'right', 'w-[24rem]', 'Loading Mixer...') : null}>
          <VolumeMixer {...volumeMixerProps} />
        </React.Suspense>
      )}

      <div className={`flex-1 min-h-0 ${getMainContentMargin} ${getMainContentPadding}`}>
        <div className="max-w-full mx-auto pt-2 pb-0 relative z-10 h-full min-h-0 flex flex-col">
          <HeaderControls {...headerControlsProps} guestPlaySummary={guestTrialSummary} />

          {isDualMode ? (
            <div className={`relative ${usePortraitDualStack ? 'flex flex-col gap-2' : 'flex gap-1 md:gap-2'} flex-1 min-h-0 min-w-0 ${padInteractionLockClass}`}>
              <div className="flex-1 min-w-0 min-h-0">
                <div
                  ref={primaryScrollRef}
                  onScroll={() => {
                    const container = primaryScrollRef.current;
                    if (!container || !primaryBankId) return;
                    primaryFallbackScrollRef.current = container.scrollTop;
                    saveBankScroll(primaryBankId, container.scrollTop);
                  }}
                  className={`h-full min-w-0 max-w-full overflow-y-auto overflow-x-hidden overscroll-contain scroll-pb-28 ${usePortraitDualStack ? '' : 'pr-1'}`}
                >
                  <PadGrid
                    pads={displayPrimary?.pads || []}
                    bankId={primaryBankId || ''}
                    bankName={displayPrimary?.name || ''}
                    allBanks={banks}
                    allPads={allPads}
                    editMode={editMode}
                    globalMuted={globalMuted}
                    masterVolume={masterVolume}
                    padSize={padSize}
                    theme={theme}
                    stopMode={stopMode}
                    windowWidth={windowWidth}
                    onUpdatePad={onUpdatePad}
                    onRemovePad={(id) => onRemovePad(primaryBankId || '', id)}
                    onDuplicatePad={onDuplicatePad}
                    onRelinkMissingPadMedia={onRelinkMissingPadMedia}
                    onRehydratePadMedia={async (bankId, padId) => Boolean(await onRehydratePadMedia(bankId, padId))}
                    onReorderPads={(fromIndex, toIndex) => onReorderPads(primaryBankId || '', fromIndex, toIndex)}
                    onFileUpload={(file) => onFileUpload(file, primaryBankId || undefined)}
                    onPadDragStart={onPadDragStart}
                    onTransferPad={onTransferPad}
                    availableBanks={availableBanks}
                    canTransferFromBank={canTransferFromBank}
                    midiEnabled={midiEnabled}
                    hideShortcutLabel={hideShortcutLabels}
                    adminPadColorPaintActive={adminPadColorPaintActive}
                    onAdminPadColorPaint={onAdminPadColorPaint}
                    graphicsTier={graphicsTier}
                    editRequest={editRequest}
                    closeEditRequest={closeEditRequest}
                    onRequestEditPad={onRequestEditPad}
                    onPadEditDialogOpenChange={onPadEditDialogOpenChange}
                    blockedShortcutKeys={blockedShortcutKeys}
                    blockedMidiNotes={blockedMidiNotes}
                    blockedMidiCCs={blockedMidiCCs}
                    channelLoadArmed={channelLoadArmed}
                    onSelectPadForChannelLoad={onSelectPadForChannelLoad}
                    highlightedPadId={highlightedPadTarget?.bankId === (primaryBankId || '') ? highlightedPadTarget.padId : null}
                    requiresAuthToPlay={isBankPlaybackLocked(displayPrimary)}
                    onRequireLogin={onRequireLogin}
                    onGuestTrialConsumePlayback={onGuestTrialConsumePlayback}
                  />
                </div>
              </div>

              <div className="flex-1 min-w-0 min-h-0">
                {displaySecondary ? (
                  <div
                    ref={secondaryScrollRef}
                    onScroll={() => {
                      const container = secondaryScrollRef.current;
                      if (!container || !secondaryBankId) return;
                      secondaryFallbackScrollRef.current = container.scrollTop;
                      saveBankScroll(secondaryBankId, container.scrollTop);
                    }}
                    className={`h-full min-w-0 max-w-full overflow-y-auto overflow-x-hidden overscroll-contain scroll-pb-28 ${usePortraitDualStack ? '' : 'pl-1'}`}
                  >
                    <PadGrid
                      pads={displaySecondary.pads || []}
                      bankId={secondaryBankId || ''}
                      bankName={displaySecondary.name || ''}
                      allBanks={banks}
                      allPads={allPads}
                      editMode={editMode}
                      globalMuted={globalMuted}
                      masterVolume={masterVolume}
                      padSize={padSize}
                      theme={theme}
                      stopMode={stopMode}
                      windowWidth={windowWidth}
                      onUpdatePad={onUpdatePad}
                      onRemovePad={(id) => onRemovePad(secondaryBankId || '', id)}
                      onDuplicatePad={onDuplicatePad}
                      onRelinkMissingPadMedia={onRelinkMissingPadMedia}
                      onRehydratePadMedia={async (bankId, padId) => Boolean(await onRehydratePadMedia(bankId, padId))}
                      onReorderPads={(fromIndex, toIndex) => onReorderPads(secondaryBankId || '', fromIndex, toIndex)}
                      onFileUpload={(file) => onFileUpload(file, secondaryBankId || undefined)}
                      onPadDragStart={onPadDragStart}
                      onTransferPad={onTransferPad}
                      availableBanks={availableBanks}
                      canTransferFromBank={canTransferFromBank}
                      midiEnabled={midiEnabled}
                      hideShortcutLabel={hideShortcutLabels}
                      adminPadColorPaintActive={adminPadColorPaintActive}
                      onAdminPadColorPaint={onAdminPadColorPaint}
                      graphicsTier={graphicsTier}
                      editRequest={editRequest}
                      closeEditRequest={closeEditRequest}
                      onRequestEditPad={onRequestEditPad}
                      onPadEditDialogOpenChange={onPadEditDialogOpenChange}
                      blockedShortcutKeys={blockedShortcutKeys}
                      blockedMidiNotes={blockedMidiNotes}
                      blockedMidiCCs={blockedMidiCCs}
                      channelLoadArmed={channelLoadArmed}
                      onSelectPadForChannelLoad={onSelectPadForChannelLoad}
                      highlightedPadId={highlightedPadTarget?.bankId === (secondaryBankId || '') ? highlightedPadTarget.padId : null}
                      requiresAuthToPlay={isBankPlaybackLocked(displaySecondary)}
                      onRequireLogin={onRequireLogin}
                      onGuestTrialConsumePlayback={onGuestTrialConsumePlayback}
                    />
                  </div>
                ) : (
                  renderEmptyState(theme, 'Select a secondary bank from the sidebar')
                )}
              </div>
              {renderPadInteractionBlocker()}
            </div>
          ) : (
            singleBank ? (
              <div className={`relative flex-1 min-w-0 min-h-0 ${padInteractionLockClass}`}>
                <div
                  ref={singleScrollRef}
                  onScroll={() => {
                    const container = singleScrollRef.current;
                    if (!container || !currentBankId) return;
                    singleFallbackScrollRef.current = container.scrollTop;
                    saveBankScroll(currentBankId, container.scrollTop);
                  }}
                  className="h-full min-w-0 min-h-0 overflow-y-auto overscroll-contain scroll-pb-28"
                >
                  <PadGrid
                    pads={singleBank.pads || []}
                    bankId={currentBankId || ''}
                    bankName={singleBank.name || ''}
                    allBanks={banks}
                    allPads={allPads}
                    editMode={editMode}
                    globalMuted={globalMuted}
                    masterVolume={masterVolume}
                    padSize={padSize}
                    theme={theme}
                    stopMode={stopMode}
                    windowWidth={windowWidth}
                    onUpdatePad={onUpdatePad}
                    onRemovePad={(id) => onRemovePad(currentBankId || '', id)}
                    onDuplicatePad={onDuplicatePad}
                    onRelinkMissingPadMedia={onRelinkMissingPadMedia}
                    onRehydratePadMedia={async (bankId, padId) => Boolean(await onRehydratePadMedia(bankId, padId))}
                    onReorderPads={(fromIndex, toIndex) => onReorderPads(currentBankId || '', fromIndex, toIndex)}
                    onFileUpload={onFileUpload}
                    onPadDragStart={onPadDragStart}
                    onTransferPad={onTransferPad}
                    availableBanks={availableBanks}
                    canTransferFromBank={canTransferFromBank}
                    midiEnabled={midiEnabled}
                    hideShortcutLabel={hideShortcutLabels}
                    adminPadColorPaintActive={adminPadColorPaintActive}
                    onAdminPadColorPaint={onAdminPadColorPaint}
                    graphicsTier={graphicsTier}
                    editRequest={editRequest}
                    closeEditRequest={closeEditRequest}
                    onRequestEditPad={onRequestEditPad}
                    onPadEditDialogOpenChange={onPadEditDialogOpenChange}
                    blockedShortcutKeys={blockedShortcutKeys}
                    blockedMidiNotes={blockedMidiNotes}
                    blockedMidiCCs={blockedMidiCCs}
                    channelLoadArmed={channelLoadArmed}
                    onSelectPadForChannelLoad={onSelectPadForChannelLoad}
                    highlightedPadId={highlightedPadTarget?.bankId === (currentBankId || '') ? highlightedPadTarget.padId : null}
                    requiresAuthToPlay={isBankPlaybackLocked(singleBank)}
                    onRequireLogin={onRequireLogin}
                    onGuestTrialConsumePlayback={onGuestTrialConsumePlayback}
                  />
                </div>
                {renderPadInteractionBlocker()}
              </div>
            ) : (
              renderEmptyState(theme, 'Select a bank from the sidebar to get started')
            )
          )}
        </div>
      </div>

      <input
        ref={restoreBackupInputRef}
        type="file"
        accept=".vdjvbackup,application/octet-stream"
        className="hidden"
        onChange={onRestoreBackupFile}
      />
      <input
        ref={recoverBankInputRef}
        type="file"
        accept=".bank,application/zip,application/octet-stream,*/*"
        multiple
        className="hidden"
        onChange={onRecoverBankFiles}
      />

      {showDialogs && (
        <React.Suspense fallback={null}>
          <SamplerPadAppDialogs
            theme={theme}
            remoteSnapshotPrompt={remoteSnapshotPrompt}
            remoteSnapshotRestoreProgress={remoteSnapshotRestoreProgress}
            onRemoteSnapshotPromptChange={onRemoteSnapshotPromptChange}
            onSkipRemoteSnapshotPrompt={onSkipRemoteSnapshotPrompt}
            onApplyRemoteSnapshot={onApplyRemoteSnapshot}
            onRestoreFromBackupForRemoteSnapshot={onRestoreFromBackupForRemoteSnapshot}
            missingMediaSummary={missingMediaSummary}
            onMissingMediaSummaryChange={onMissingMediaSummaryChange}
            onRestoreBackupPrompt={onRestoreBackupPrompt}
            onRecoverBankPrompt={onRecoverBankPrompt}
            showRecoverBankModeDialog={showRecoverBankModeDialog}
            onShowRecoverBankModeDialogChange={onShowRecoverBankModeDialogChange}
            onChooseRecoverBankMode={onChooseRecoverBankMode}
            pendingChannelLoadConfirm={pendingChannelLoadConfirm}
            onPendingChannelLoadConfirmChange={onPendingChannelLoadConfirmChange}
            onConfirmChannelLoad={onConfirmChannelLoad}
            pendingChannelCountConfirm={pendingChannelCountConfirm}
            onPendingChannelCountConfirmChange={onPendingChannelCountConfirmChange}
            onConfirmChannelCountChange={onConfirmChannelCountChange}
            pendingOfficialPadTransferConfirm={pendingOfficialPadTransferConfirm}
            onPendingOfficialPadTransferConfirmChange={onPendingOfficialPadTransferConfirmChange}
            onConfirmOfficialPadTransfer={onConfirmOfficialPadTransfer}
            showErrorDialog={showErrorDialog}
            onShowErrorDialogChange={onShowErrorDialogChange}
            error={error}
            onErrorClose={onErrorClose}
          />
        </React.Suspense>
      )}
    </div>
  );
}
