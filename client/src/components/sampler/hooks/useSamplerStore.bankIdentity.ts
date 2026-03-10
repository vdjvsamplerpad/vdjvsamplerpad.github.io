import { SamplerBank } from '../types/sampler';

export const DEFAULT_BANK_SOURCE_ID = 'vdjv-default-bank-source';

export const normalizeIdentityToken = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
};

export const isDefaultBankIdentity = (bank: Pick<SamplerBank, 'name' | 'sourceBankId'>): boolean =>
  bank.name === 'Default Bank' || bank.sourceBankId === DEFAULT_BANK_SOURCE_ID;

export const isTrustedStoreBankForQuota = (bank: SamplerBank): boolean =>
  Boolean(
    bank.isAdminBank ||
      bank.bankMetadata?.catalogItemId ||
      bank.bankMetadata?.bankId ||
      bank.bankMetadata?.trustedAdminExport
  );

export const isOwnedCountedBankForQuota = (bank: SamplerBank): boolean => {
  if (isDefaultBankIdentity(bank)) return false;
  return !isTrustedStoreBankForQuota(bank);
};

export const countOwnedCountedBanks = (banks: SamplerBank[]): number =>
  banks.reduce((count, bank) => count + (isOwnedCountedBankForQuota(bank) ? 1 : 0), 0);

export const pruneBanksForGuestLock = (banks: SamplerBank[]): SamplerBank[] => {
  if (!Array.isArray(banks) || banks.length === 0) return [];
  const defaultCandidates = banks.filter((bank) => isDefaultBankIdentity(bank));
  if (defaultCandidates.length === 0) return [];

  const preferredDefault =
    defaultCandidates.find((bank) => Array.isArray(bank.pads) && bank.pads.length > 0) ||
    defaultCandidates[0];

  return preferredDefault ? [preferredDefault] : [];
};

const getBankIdentityToken = (bank: SamplerBank): string | null => {
  if (bank.isLocalDuplicate) return null;
  if (isDefaultBankIdentity(bank)) return `default:${DEFAULT_BANK_SOURCE_ID}`;

  const sourceId = normalizeIdentityToken(bank.sourceBankId);
  if (sourceId) return `source:${sourceId}`;

  const metadataBankId = normalizeIdentityToken(bank.bankMetadata?.bankId);
  if (metadataBankId) return `meta:${metadataBankId}`;

  return null;
};

const pickPreferredBank = (group: SamplerBank[]): SamplerBank => {
  return [...group].sort((a, b) => {
    const padDiff = (b.pads?.length || 0) - (a.pads?.length || 0);
    if (padDiff !== 0) return padDiff;
    return (a.sortOrder || 0) - (b.sortOrder || 0);
  })[0];
};

export const dedupeBanksByIdentity = (inputBanks: SamplerBank[]) => {
  const grouped = new Map<string, SamplerBank[]>();
  inputBanks.forEach((bank) => {
    const token = getBankIdentityToken(bank);
    if (!token) return;
    const list = grouped.get(token) || [];
    list.push(bank);
    grouped.set(token, list);
  });

  const removedIdToKeptId = new Map<string, string>();
  grouped.forEach((group) => {
    if (group.length <= 1) return;
    const keepBank = pickPreferredBank(group);
    group.forEach((bank) => {
      if (bank.id === keepBank.id) return;
      removedIdToKeptId.set(bank.id, keepBank.id);
    });
  });

  if (removedIdToKeptId.size === 0) {
    return { banks: inputBanks, removedIdToKeptId };
  }

  return {
    banks: inputBanks.filter((bank) => !removedIdToKeptId.has(bank.id)),
    removedIdToKeptId,
  };
};

