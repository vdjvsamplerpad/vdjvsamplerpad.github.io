import { describe, expect, it } from 'vitest';
import type { PadData, SamplerBank } from '../types/sampler';
import { DEFAULT_BANK_SOURCE_ID } from './useSamplerStore.bankIdentity';
import { runTransferPadPipeline } from './useSamplerStore.bankCrud';

const makePad = (id: string, patch: Partial<PadData> = {}): PadData => ({
  id,
  name: id,
  audioUrl: `blob:${id}`,
  color: '#ef4444',
  triggerMode: 'toggle',
  playbackMode: 'once',
  volume: 1,
  fadeInMs: 0,
  fadeOutMs: 0,
  startTimeMs: 0,
  endTimeMs: 0,
  pitch: 0,
  position: 0,
  ...patch,
});

const makeBank = (id: string, pads: PadData[], patch: Partial<SamplerBank> = {}): SamplerBank => ({
  id,
  name: id,
  defaultColor: '#111827',
  pads,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  sortOrder: 0,
  ...patch,
});

const runTransfer = (
  initialBanks: SamplerBank[],
  input: { padId: string; sourceBankId: string; targetBankId: string },
  ids: string[] = ['generated-pad-id']
): SamplerBank[] => {
  let banks = initialBanks;
  runTransferPadPipeline(
    {
      ...input,
      profileRole: 'user',
      quotaOwnedBankPadCap: 32,
    },
    {
      setBanks: (next) => {
        banks = typeof next === 'function' ? next(banks) : next;
      },
      isOwnedCountedBankForQuota: () => true,
      generateId: () => ids.shift() || 'generated-pad-id-fallback',
    }
  );
  return banks;
};

describe('runTransferPadPipeline', () => {
  it('copies from the canonical Default Bank with a unique pad id and default-asset provenance', () => {
    const defaultPad = makePad('default-pad-1', {
      contentOrigin: 'official_admin',
      restoreAssetKind: 'default_asset',
    });
    const banks = runTransfer(
      [
        makeBank('default-bank', [defaultPad], {
          sourceBankId: DEFAULT_BANK_SOURCE_ID,
          bankMetadata: {
            password: false,
            transferable: true,
            defaultBankSource: 'assets',
          },
        }),
        makeBank('owned-bank', []),
      ],
      {
        padId: 'default-pad-1',
        sourceBankId: 'default-bank',
        targetBankId: 'owned-bank',
      }
    );

    const source = banks.find((bank) => bank.id === 'default-bank');
    const target = banks.find((bank) => bank.id === 'owned-bank');
    expect(source?.pads.map((pad) => pad.id)).toEqual(['default-pad-1']);
    expect(target?.pads).toHaveLength(1);
    expect(target?.pads[0]).toMatchObject({
      id: 'generated-pad-id',
      originPadId: 'default-pad-1',
      originBankId: DEFAULT_BANK_SOURCE_ID,
      restoreAssetKind: 'default_asset',
      sourcePadId: 'default-pad-1',
    });
  });

  it('moves pads out of regular banks without changing the pad id', () => {
    const banks = runTransfer(
      [
        makeBank('source-bank', [makePad('pad-1')]),
        makeBank('target-bank', []),
      ],
      {
        padId: 'pad-1',
        sourceBankId: 'source-bank',
        targetBankId: 'target-bank',
      }
    );

    expect(banks.find((bank) => bank.id === 'source-bank')?.pads).toHaveLength(0);
    expect(banks.find((bank) => bank.id === 'target-bank')?.pads[0]?.id).toBe('pad-1');
  });
});
