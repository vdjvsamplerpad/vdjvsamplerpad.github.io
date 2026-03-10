import { PadData, SamplerBank } from '../types/sampler';
import type { ImportBankOptions } from './useSamplerStore.importBank';
import type { ExportAudioMode } from './useSamplerStore.helpers';
import type { SamplerMetadataSnapshot } from './useSamplerStore.snapshotMetadata';
export type { ExportAudioMode } from './useSamplerStore.helpers';

export type ExportActivityPhase =
  | 'requested'
  | 'local_export'
  | 'remote_upload'
  | 'backup_export'
  | 'backup_restore'
  | 'media_recovery';

export type ExportUploadMeta = {
  releaseTag?: string | null;
  assetName?: string | null;
  attempt?: number;
  result?: 'success' | 'failed' | 'duplicate_no_change';
  reason?: string | null;
  verified?: boolean;
  fileSize?: number;
  fileSha256?: string | null;
  duplicateOfExportOperationId?: string | null;
};

export interface SamplerStore {
  banks: SamplerBank[];
  startupRestoreCompleted: boolean;
  primaryBankId: string | null;
  secondaryBankId: string | null;
  currentBankId: string | null;
  primaryBank: SamplerBank | null;
  secondaryBank: SamplerBank | null;
  currentBank: SamplerBank | null;
  isDualMode: boolean;
  addPad: (
    file: File,
    bankId?: string,
    options?: { defaultTriggerMode?: PadData['triggerMode'] }
  ) => Promise<void>;
  addPads: (
    files: File[],
    bankId?: string,
    options?: { defaultTriggerMode?: PadData['triggerMode'] }
  ) => Promise<void>;
  updatePad: (bankId: string, id: string, updatedPad: PadData) => void;
  removePad: (bankId: string, id: string) => void;
  createBank: (name: string, defaultColor: string) => void;
  setPrimaryBank: (id: string | null) => void;
  setSecondaryBank: (id: string | null) => void;
  setCurrentBank: (id: string | null) => void;
  updateBank: (id: string, updates: Partial<SamplerBank>) => void;
  deleteBank: (id: string) => void;
  duplicateBank: (bankId: string, onProgress?: (progress: number) => void) => Promise<SamplerBank>;
  duplicatePad: (bankId: string, padId: string) => Promise<PadData>;
  importBank: (
    file: File,
    onProgress?: (progress: number) => void,
    options?: ImportBankOptions
  ) => Promise<SamplerBank | null>;
  exportBank: (id: string, onProgress?: (progress: number) => void) => Promise<string>;
  reorderPads: (bankId: string, fromIndex: number, toIndex: number) => void;
  moveBankUp: (id: string) => void;
  moveBankDown: (id: string) => void;
  transferPad: (padId: string, sourceBankId: string, targetBankId: string) => void;
  exportAdminBank: (
    id: string,
    title: string,
    description: string,
    addToDatabase: boolean,
    allowExport: boolean,
    publicCatalogAsset: boolean,
    exportMode: ExportAudioMode,
    thumbnailPath?: string,
    onProgress?: (progress: number) => void
  ) => Promise<string>;
  publishDefaultBankRelease: (
    bankId: string,
    options?: { releaseNotes?: string; minAppVersion?: string }
  ) => Promise<string>;
  canTransferFromBank: (bankId: string) => boolean;
  exportAppBackup: (payload: {
    settings: Record<string, unknown>;
    mappings: Record<string, unknown>;
    state: { primaryBankId: string | null; secondaryBankId: string | null; currentBankId: string | null };
  }, options?: { riskMode?: boolean }) => Promise<string>;
  restoreAppBackup: (file: File, companionFiles?: File[]) => Promise<{
    message: string;
    settings: Record<string, unknown> | null;
    mappings: Record<string, unknown> | null;
    state: { primaryBankId: string | null; secondaryBankId: string | null; currentBankId: string | null } | null;
  }>;
  applySamplerMetadataSnapshot: (snapshot: SamplerMetadataSnapshot) => Promise<{
    message: string;
    settings: Record<string, unknown> | null;
    mappings: Record<string, unknown> | null;
    state: { primaryBankId: string | null; secondaryBankId: string | null; currentBankId: string | null } | null;
  }>;
  relinkPadAudioFromFile: (bankId: string, padId: string, file: File) => Promise<void>;
  rehydratePadMedia: (bankId: string, padId: string) => Promise<boolean>;
  rehydrateMissingMediaInBank: (bankId: string) => Promise<{
    missingBefore: number;
    restored: number;
    remaining: number;
    remainingOfficial: number;
    remainingUser: number;
  }>;
  recoverMissingMediaFromBanks: (
    files: File[],
    options?: { addAsNewWhenNoTarget?: boolean }
  ) => Promise<string>;
}
