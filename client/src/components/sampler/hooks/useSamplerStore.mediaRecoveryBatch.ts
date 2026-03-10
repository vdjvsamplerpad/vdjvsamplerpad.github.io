import type { SamplerBank } from '../types/sampler';
import type { ImportBankOptions } from './useSamplerStore.importBank';

type ExportActivityPayload = {
  status: 'success' | 'failed';
  phase: 'media_recovery';
  bankName: string;
  padNames: string[];
  exportOperationId?: string;
  source: string;
  errorMessage?: string;
  meta?: Record<string, unknown>;
};

export const runRecoverMissingMediaFromBanksPipeline = async (
  input: {
    files: File[];
    options?: { addAsNewWhenNoTarget?: boolean };
  },
  deps: {
    generateOperationId: () => string;
    resolveOwnerId: () => string | null;
    importBank: (
      file: File,
      onProgress?: (progress: number) => void,
      options?: ImportBankOptions
    ) => Promise<SamplerBank | null>;
    mergeImportedBankMissingMedia: (
      imported: SamplerBank,
      options?: { ownerId?: string | null; addAsNewWhenNoTarget?: boolean }
    ) => Promise<{ merged: boolean; recoveredItems: number; addedBank: boolean }>;
    logExportActivity: (payload: ExportActivityPayload) => void;
  }
): Promise<string> => {
  const {
    files,
    options,
  } = input;
  const {
    generateOperationId,
    resolveOwnerId,
    importBank,
    mergeImportedBankMissingMedia,
    logExportActivity,
  } = deps;

  if (!files.length) throw new Error('No bank files selected.');

  const recoveryOperationId = generateOperationId();
  let recoveredItems = 0;
  let mergedBanks = 0;
  let addedBanks = 0;
  let skippedNonBank = 0;
  let failedImports = 0;
  let processedBankFiles = 0;
  const ownerId = resolveOwnerId();
  const addAsNewWhenNoTarget = options?.addAsNewWhenNoTarget === true;
  logExportActivity({
    status: 'success',
    phase: 'media_recovery',
    bankName: 'Missing Media Recovery',
    padNames: [],
    exportOperationId: recoveryOperationId,
    source: 'useSamplerStore.recoverMissingMediaFromBanks',
    meta: {
      stage: 'start',
      selectedFiles: files.length,
      addAsNewWhenNoTarget,
    },
  });

  try {
    for (const file of files) {
      if (!/\.bank$/i.test(file.name)) {
        skippedNonBank += 1;
        continue;
      }
      processedBankFiles += 1;
      let imported: SamplerBank | null = null;
      try {
        imported = await importBank(file, undefined, { allowDuplicateImport: true, skipActivityLog: true });
      } catch (error) {
        failedImports += 1;
        if (processedBankFiles <= 3 || processedBankFiles % 5 === 0) {
          logExportActivity({
            status: 'failed',
            phase: 'media_recovery',
            bankName: 'Missing Media Recovery',
            padNames: [],
            exportOperationId: recoveryOperationId,
            source: 'useSamplerStore.recoverMissingMediaFromBanks',
            errorMessage: error instanceof Error ? error.message : String(error),
            meta: {
              stage: 'import-failed',
              processedBankFiles,
              failedImports,
              fileName: file.name,
            },
          });
        }
        continue;
      }
      if (!imported) continue;
      const mergeResult = await mergeImportedBankMissingMedia(imported, {
        ownerId,
        addAsNewWhenNoTarget,
      });
      if (mergeResult.merged) mergedBanks += 1;
      if (mergeResult.addedBank) addedBanks += 1;
      recoveredItems += mergeResult.recoveredItems;

      if (processedBankFiles <= 3 || processedBankFiles % 5 === 0) {
        logExportActivity({
          status: 'success',
          phase: 'media_recovery',
          bankName: 'Missing Media Recovery',
          padNames: [],
          exportOperationId: recoveryOperationId,
          source: 'useSamplerStore.recoverMissingMediaFromBanks',
          meta: {
            stage: 'progress',
            processedBankFiles,
            mergedBanks,
            recoveredItems,
            addedBanks,
            failedImports,
          },
        });
      }
    }

    if (processedBankFiles === 0) {
      throw new Error('No valid bank files were selected.');
    }

    if (failedImports === processedBankFiles) {
      throw new Error(
        'Recovery failed. None of the selected .bank files could be imported. ' +
        'You may not have access grant to those banks, or the files are invalid/corrupted.'
      );
    }

    const extras: string[] = [];
    if (skippedNonBank > 0) extras.push(`skipped ${skippedNonBank} non-bank file(s)`);
    if (failedImports > 0) extras.push(`failed ${failedImports} bank import(s)`);
    const extraSuffix = extras.length > 0 ? ` (${extras.join(', ')})` : '';
    const message = `Recovery complete. Merged ${mergedBanks} bank(s), restored ${recoveredItems} missing pad media item(s), added ${addedBanks} new bank(s)${extraSuffix}.`;

    logExportActivity({
      status: 'success',
      phase: 'media_recovery',
      bankName: 'Missing Media Recovery',
      padNames: [],
      exportOperationId: recoveryOperationId,
      source: 'useSamplerStore.recoverMissingMediaFromBanks',
      meta: {
        stage: 'complete',
        processedBankFiles,
        skippedNonBank,
        failedImports,
        mergedBanks,
        addedBanks,
        recoveredItems,
      },
    });

    return message;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logExportActivity({
      status: 'failed',
      phase: 'media_recovery',
      bankName: 'Missing Media Recovery',
      padNames: [],
      exportOperationId: recoveryOperationId,
      source: 'useSamplerStore.recoverMissingMediaFromBanks',
      errorMessage,
      meta: {
        stage: 'failed',
        processedBankFiles,
        skippedNonBank,
        failedImports,
        mergedBanks,
        addedBanks,
        recoveredItems,
      },
    });
    throw error;
  }
};

