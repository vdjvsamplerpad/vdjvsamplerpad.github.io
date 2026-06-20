import { describe, expect, it } from 'vitest';
import type { PadData, SamplerBank } from '../types/sampler';
import {
  DEFAULT_BANK_SOURCE_ID,
  isExplicitDefaultBankIdentity,
  isOwnedCountedBankForQuota,
  isProtectedDefaultBankIdentity,
} from './useSamplerStore.bankIdentity';
import { runDuplicateBankPipeline } from './useSamplerStore.bankDuplication';

const makeBank = (id: string, pads: PadData[] = [], patch: Partial<SamplerBank> = {}): SamplerBank => ({
  id,
  name: id,
  defaultColor: '#111827',
  pads,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  sortOrder: 0,
  ...patch,
});

describe('runDuplicateBankPipeline', () => {
  it('turns a Default Bank copy into a deletable local bank without protected default metadata', async () => {
    const sourceBank = makeBank('default-bank', [], {
      sourceBankId: DEFAULT_BANK_SOURCE_ID,
      bankMetadata: {
        password: false,
        transferable: true,
        defaultBankSource: 'remote',
        defaultBankReleaseVersion: 4,
        defaultBankReleasePublishedAt: '2026-06-01T00:00:00.000Z',
        defaultBankReleaseSha256: 'default-bank-sha',
      },
    });
    let banks = [sourceBank];

    const duplicated = await runDuplicateBankPipeline(
      {
        bankId: sourceBank.id,
        profileRole: 'admin',
        quotaPolicy: {
          deviceTotalBankCap: 8,
          ownedBankQuota: 4,
          ownedBankPadCap: 32,
        },
      },
      {
        banksRef: { current: banks },
        setBanks: (next) => {
          banks = typeof next === 'function' ? next(banks) : next;
        },
        isOwnedCountedBankForQuota,
        countOwnedCountedBanks: (items) => items.filter(isOwnedCountedBankForQuota).length,
        generateId: () => 'duplicated-default-bank',
        buildDuplicateBankName: () => 'Default Bank (Copy)',
        loadPadMediaBlobWithUrlFallback: async () => null,
        storeFile: async () => ({ backend: 'idb' }),
        padHasExpectedImageAsset: () => false,
        deletePadMediaArtifacts: async () => undefined,
        yieldToMainThread: async () => undefined,
      }
    );

    expect(duplicated.isLocalDuplicate).toBe(true);
    expect(duplicated.sourceBankId).toBeUndefined();
    expect(duplicated.bankMetadata?.defaultBankSource).toBeUndefined();
    expect(duplicated.bankMetadata?.defaultBankReleaseVersion).toBeUndefined();
    expect(duplicated.bankMetadata?.defaultBankReleasePublishedAt).toBeUndefined();
    expect(duplicated.bankMetadata?.defaultBankReleaseSha256).toBeUndefined();
    expect(isExplicitDefaultBankIdentity(duplicated)).toBe(false);
    expect(isProtectedDefaultBankIdentity(duplicated)).toBe(false);
    expect(isOwnedCountedBankForQuota(duplicated)).toBe(true);
    expect(banks.map((bank) => bank.id)).toEqual(['default-bank', 'duplicated-default-bank']);
  });
});
