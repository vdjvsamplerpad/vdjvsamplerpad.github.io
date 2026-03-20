import type { SamplerBank } from '../types/sampler';

export const RECOVERABLE_DUPLICATE_IMPORT_CODE = 'recoverable_duplicate_import';

export type RecoverableDuplicateImportError = Error & {
  code: typeof RECOVERABLE_DUPLICATE_IMPORT_CODE;
  existingBankId: string;
  restoreStatus: NonNullable<SamplerBank['restoreStatus']>;
};

export const createRecoverableDuplicateImportError = (
  bank: SamplerBank,
  bankName?: string
): RecoverableDuplicateImportError => {
  const error = new Error(
    bankName
      ? `"${bankName}" matches a restored bank already on this device. Repair the existing bank instead of importing a duplicate.`
      : 'This bank matches a restored bank already on this device. Repair the existing bank instead of importing a duplicate.'
  ) as RecoverableDuplicateImportError;
  error.code = RECOVERABLE_DUPLICATE_IMPORT_CODE;
  error.existingBankId = bank.id;
  error.restoreStatus = bank.restoreStatus || 'missing_media';
  return error;
};

export const isRecoverableDuplicateImportError = (
  value: unknown
): value is RecoverableDuplicateImportError => {
  if (!(value instanceof Error)) return false;
  const candidate = value as Partial<RecoverableDuplicateImportError>;
  return (
    candidate.code === RECOVERABLE_DUPLICATE_IMPORT_CODE &&
    typeof candidate.existingBankId === 'string' &&
    candidate.existingBankId.trim().length > 0
  );
};
