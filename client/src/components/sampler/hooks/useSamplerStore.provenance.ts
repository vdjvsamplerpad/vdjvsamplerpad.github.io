import type { PadData, SamplerBank } from '../types/sampler';

export const getPadContentOrigin = (pad: Partial<PadData> | null | undefined): PadData['contentOrigin'] =>
  pad?.contentOrigin === 'official_store' || pad?.contentOrigin === 'official_admin'
    ? pad.contentOrigin
    : 'user';

export const isOfficialPadContent = (pad: Partial<PadData> | null | undefined): boolean =>
  getPadContentOrigin(pad) !== 'user';

export const isOfficialBankSource = (bank: Partial<SamplerBank> | null | undefined): boolean => {
  if (!bank) return false;
  if (bank.bankMetadata?.defaultBankSource) return true;
  return Boolean(
    bank.isAdminBank ||
    bank.bankMetadata?.catalogItemId ||
    bank.bankMetadata?.bankId ||
    bank.bankMetadata?.trustedAdminExport
  );
};

export const hasOfficialStoreBankSource = (bank: Partial<SamplerBank> | null | undefined): boolean =>
  Boolean(bank?.bankMetadata?.catalogItemId || bank?.bankMetadata?.bankId);

export const hasOfficialStorePadContent = (bank: Partial<SamplerBank> | null | undefined): boolean =>
  Array.isArray(bank?.pads) && bank!.pads.some((pad) => getPadContentOrigin(pad) === 'official_store');

export const canAdminExportBankForSession = (bank: Partial<SamplerBank> | null | undefined): boolean => {
  if (!bank) return false;
  if (bank.bankMetadata?.defaultBankSource) return false;
  if (hasOfficialStoreBankSource(bank) || hasOfficialStorePadContent(bank)) return false;
  if (getExportRestrictionReason(bank) === null) return true;
  return Boolean(
    bank.isAdminBank ||
    bank.bankMetadata?.trustedAdminExport ||
    (Array.isArray(bank.pads) && bank.pads.some((pad) => getPadContentOrigin(pad) === 'official_admin'))
  );
};

export const getExportRestrictionReason = (
  bank: Partial<SamplerBank> | null | undefined
): SamplerBank['exportRestrictionReason'] => {
  if (!bank) return null;
  if (isOfficialBankSource(bank)) return 'official_bank';
  return Array.isArray(bank.pads) && bank.pads.some((pad) => isOfficialPadContent(pad))
    ? 'mixed_official'
    : null;
};

export const isBankExportableByPolicy = (bank: Partial<SamplerBank> | null | undefined): boolean =>
  getExportRestrictionReason(bank) === null;

export const applyBankContentPolicy = <T extends SamplerBank>(bank: T): T => {
  const exportRestrictionReason = getExportRestrictionReason(bank);
  return {
    ...bank,
    transferable: true,
    containsOfficialContent: exportRestrictionReason !== null,
    exportRestrictionReason,
    exportable: exportRestrictionReason === null,
  };
};

export const getOfficialPadRecoveryRef = (
  pad: Partial<PadData> | null | undefined,
  bank?: Partial<SamplerBank> | null
): { bankId: string | null; catalogItemId: string | null; padId: string | null; bankTitle: string | null } => ({
  bankId:
    typeof pad?.originBankId === 'string' && pad.originBankId.trim().length > 0
      ? pad.originBankId.trim()
      : (typeof bank?.bankMetadata?.bankId === 'string' && bank.bankMetadata.bankId.trim().length > 0
        ? bank.bankMetadata.bankId.trim()
        : null),
  catalogItemId:
    typeof pad?.originCatalogItemId === 'string' && pad.originCatalogItemId.trim().length > 0
      ? pad.originCatalogItemId.trim()
      : (typeof bank?.bankMetadata?.catalogItemId === 'string' && bank.bankMetadata.catalogItemId.trim().length > 0
        ? bank.bankMetadata.catalogItemId.trim()
        : null),
  padId:
    typeof pad?.originPadId === 'string' && pad.originPadId.trim().length > 0
      ? pad.originPadId.trim()
      : (typeof pad?.id === 'string' && pad.id.trim().length > 0 ? pad.id.trim() : null),
  bankTitle:
    typeof pad?.originBankTitle === 'string' && pad.originBankTitle.trim().length > 0
      ? pad.originBankTitle.trim()
      : (typeof bank?.name === 'string' && bank.name.trim().length > 0 ? bank.name.trim() : null),
});
