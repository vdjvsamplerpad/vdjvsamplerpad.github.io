import * as React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import type { PadData } from './types/sampler';
import type { RemoteSnapshotPromptState } from './hooks/useSamplerStore.snapshotMetadata';

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

interface SamplerPadAppDialogsProps {
  theme: 'light' | 'dark';
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

export function SamplerPadAppDialogs({
  theme,
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
  onErrorClose,
}: SamplerPadAppDialogsProps) {
  const normalizedError = error?.trim() || null;
  const isLimitedDialog = Boolean(normalizedError && normalizedError.toLowerCase().startsWith('limited:'));
  const errorDialogTitle = isLimitedDialog ? 'Limited' : 'Error';
  const errorDialogAccentClass = isLimitedDialog ? 'text-amber-500' : 'text-red-600';
  const errorDialogSurfaceClass = theme === 'dark'
    ? (isLimitedDialog ? 'bg-gray-800 border-amber-500' : 'bg-gray-800 border-red-500')
    : (isLimitedDialog ? 'bg-white border-amber-500' : 'bg-white border-red-500');

  return (
    <>
      <Dialog open={Boolean(remoteSnapshotPrompt)} onOpenChange={(open) => { if (!open) onSkipRemoteSnapshotPrompt(); }}>
        <DialogContent className="sm:max-w-lg" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Restore Banks on This Device?</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <p className={theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}>
              We found your latest sampler metadata snapshot online for this account. Choose how you want to restore this device.
            </p>
            <div className={`rounded-md border p-3 text-xs ${theme === 'dark' ? 'border-gray-700 bg-gray-900/60 text-gray-300' : 'border-gray-200 bg-gray-50 text-gray-600'}`}>
              <div>Saved banks: <span className="font-semibold">{remoteSnapshotPrompt?.summary.bankCount || 0}</span></div>
              <div className="mt-1">Paid banks to re-download: <span className="font-semibold">{remoteSnapshotPrompt?.summary.paidBanks || 0}</span></div>
              <div className="mt-1">Custom pads that may need manual relink: <span className="font-semibold">{remoteSnapshotPrompt?.summary.missingCustomPads || 0}</span></div>
            </div>
            <div className="grid grid-cols-1 gap-2">
              <Button onClick={onApplyRemoteSnapshot} variant="default" disabled={Boolean(remoteSnapshotRestoreProgress)}>
                {remoteSnapshotRestoreProgress ? 'Restoring...' : 'Manual Sync Metadata'}
              </Button>
              <Button
                onClick={onRestoreFromBackupForRemoteSnapshot}
                variant="outline"
                disabled={Boolean(remoteSnapshotRestoreProgress)}
              >
                Restore from Full Backup
              </Button>
              <Button
                onClick={onSkipRemoteSnapshotPrompt}
                variant="ghost"
                disabled={Boolean(remoteSnapshotRestoreProgress)}
              >
                Skip for Now
              </Button>
            </div>
            {remoteSnapshotRestoreProgress && (
              <div className={`rounded-md border p-3 ${theme === 'dark' ? 'border-indigo-500/40 bg-indigo-950/40' : 'border-indigo-200 bg-indigo-50'}`}>
                <div className="flex items-center justify-between gap-3 text-xs font-medium">
                  <span>{remoteSnapshotRestoreProgress.label}</span>
                  <span>{remoteSnapshotRestoreProgress.progress}%</span>
                </div>
                <div className={`mt-2 h-2 overflow-hidden rounded-full ${theme === 'dark' ? 'bg-black/30' : 'bg-white/80'}`}>
                  <div
                    className="h-full rounded-full bg-indigo-500 transition-all duration-300"
                    style={{ width: `${remoteSnapshotRestoreProgress.progress}%` }}
                  />
                </div>
              </div>
            )}
            <div className={`rounded-md border p-3 text-xs ${theme === 'dark' ? 'border-gray-700 text-gray-400' : 'border-gray-200 text-gray-500'}`}>
              <div><span className={theme === 'dark' ? 'font-medium text-gray-200' : 'font-medium text-gray-700'}>Manual Sync Metadata:</span> rebuild the bank list first, then recover downloads or missing media per bank.</div>
              <div className="mt-1"><span className={theme === 'dark' ? 'font-medium text-gray-200' : 'font-medium text-gray-700'}>Restore from Full Backup:</span> use your exported backup file for the fastest full-media restore.</div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(missingMediaSummary)} onOpenChange={(open) => { if (!open) onMissingMediaSummaryChange(null); }}>
        <DialogContent className={`${theme === 'dark' ? 'bg-gray-800 border-amber-500' : 'bg-white border-amber-400'}`} aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="text-amber-500">Some pad files are missing</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className={`text-sm ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
              Missing audio: <span className="font-semibold">{missingMediaSummary?.missingAudio || 0}</span> | Missing images: <span className="font-semibold">{missingMediaSummary?.missingImages || 0}</span>
            </p>
            {missingMediaSummary?.affectedBanks?.length ? (
              <p className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                Affected banks: {missingMediaSummary.affectedBanks.join(', ')}
              </p>
            ) : null}
            <div className="grid grid-cols-1 gap-2">
              <Button onClick={onRestoreBackupPrompt} variant="default">Restore from Backup</Button>
              <Button onClick={onRecoverBankPrompt} variant="outline">Import .bank files one by one</Button>
              <Button onClick={() => onMissingMediaSummaryChange(null)} variant="ghost">Continue</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showRecoverBankModeDialog} onOpenChange={onShowRecoverBankModeDialogChange}>
        <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Recover Missing Media</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <p className={theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}>
              Choose how `.bank` recovery should handle files that do not match an existing target bank.
            </p>
            <div className="grid grid-cols-1 gap-2">
              <Button onClick={() => onChooseRecoverBankMode(false)} variant="default">Merge Only</Button>
              <Button onClick={() => onChooseRecoverBankMode(true)} variant="outline">Allow New Banks</Button>
              <Button onClick={() => onShowRecoverBankModeDialogChange(false)} variant="ghost">Cancel</Button>
            </div>
            <div className={`rounded-md border p-3 text-xs ${theme === 'dark' ? 'border-gray-700 text-gray-400' : 'border-gray-200 text-gray-500'}`}>
              <div><span className={theme === 'dark' ? 'font-medium text-gray-200' : 'font-medium text-gray-700'}>Merge Only:</span> restore into matching banks only.</div>
              <div className="mt-1"><span className={theme === 'dark' ? 'font-medium text-gray-200' : 'font-medium text-gray-700'}>Allow New Banks:</span> create a new bank if no target match exists.</div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        open={pendingChannelLoadConfirm !== null}
        onOpenChange={(open) => {
          if (!open) onPendingChannelLoadConfirmChange(null);
        }}
        title="Replace Playing Channel?"
        description={pendingChannelLoadConfirm
          ? `Channel ${pendingChannelLoadConfirm.channelId} is currently playing. Loading "${pendingChannelLoadConfirm.pad.name}" will stop the current channel playback.`
          : 'Loading this pad will replace current channel playback.'}
        confirmText="Load Anyway"
        cancelText="Cancel"
        variant="destructive"
        onConfirm={() => {
          if (!pendingChannelLoadConfirm) return;
          onPendingChannelLoadConfirmChange(null);
          onConfirmChannelLoad(pendingChannelLoadConfirm);
        }}
        theme={theme}
      />

      <ConfirmationDialog
        open={pendingChannelCountConfirm !== null}
        onOpenChange={(open) => {
          if (!open) onPendingChannelCountConfirmChange(null);
        }}
        title="Reduce Deck Channels?"
        description={pendingChannelCountConfirm
          ? `Reduce deck channels to ${pendingChannelCountConfirm.nextCount}? This will stop playback on removed channels.`
          : 'Reducing deck channels will stop playback on removed channels.'}
        confirmText={pendingChannelCountConfirm ? `Reduce to ${pendingChannelCountConfirm.nextCount}` : 'Reduce'}
        cancelText="Cancel"
        variant="destructive"
        onConfirm={() => {
          if (!pendingChannelCountConfirm) return;
          onPendingChannelCountConfirmChange(null);
          onConfirmChannelCountChange(pendingChannelCountConfirm.nextCount);
        }}
        theme={theme}
      />

      <ConfirmationDialog
        open={pendingOfficialPadTransferConfirm !== null}
        onOpenChange={(open) => {
          if (!open) onPendingOfficialPadTransferConfirmChange(null);
        }}
        title="Make Bank Non-Exportable?"
        description={pendingOfficialPadTransferConfirm
          ? `Transferring "${pendingOfficialPadTransferConfirm.padName}" from official content will make "${pendingOfficialPadTransferConfirm.targetBankName}" non-exportable for community sharing. Continue?`
          : 'Transferring official content into this bank will make it non-exportable for community sharing.'}
        confirmText="Transfer Anyway"
        cancelText="Cancel"
        onConfirm={() => {
          if (!pendingOfficialPadTransferConfirm) return;
          onPendingOfficialPadTransferConfirmChange(null);
          onConfirmOfficialPadTransfer(pendingOfficialPadTransferConfirm);
        }}
        theme={theme}
      />

      <Dialog open={showErrorDialog} onOpenChange={onShowErrorDialogChange}>
        <DialogContent className={`sm:max-w-md ${errorDialogSurfaceClass}`} aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className={errorDialogAccentClass}>{errorDialogTitle}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className={`text-sm ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
              {error}
            </p>
            <Button onClick={onErrorClose} className="w-full">
              OK
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
