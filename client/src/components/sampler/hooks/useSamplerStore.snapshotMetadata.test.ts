import { describe, expect, it } from 'vitest';
import type { PadData, SamplerBank } from '../types/sampler';
import { DEFAULT_BANK_SOURCE_ID } from './useSamplerStore.bankIdentity';
import { applyResolvedOfficialPadMedia } from './useSamplerStore.snapshotMetadata';

const makePad = (id: string, patch: Partial<PadData> = {}): PadData => ({
  id,
  name: id,
  audioUrl: '',
  color: '#22c55e',
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

describe('applyResolvedOfficialPadMedia', () => {
  it('hydrates transferred Default Bank pads by sourcePadId even when missingMediaExpected is false', () => {
    const sourcePad = makePad('default-pad-1', {
      audioUrl: 'blob:default-pad-audio',
      imageUrl: 'blob:default-pad-image',
      contentOrigin: 'official_admin',
    });
    const transferredPad = makePad('copied-pad-1', {
      audioUrl: '',
      sourcePadId: 'default-pad-1',
      originPadId: 'default-pad-1',
      originBankId: DEFAULT_BANK_SOURCE_ID,
      restoreAssetKind: 'default_asset',
      missingMediaExpected: false,
      contentOrigin: 'official_admin',
    });

    const banks = applyResolvedOfficialPadMedia([
      makeBank('default-bank', [sourcePad], {
        sourceBankId: DEFAULT_BANK_SOURCE_ID,
        bankMetadata: {
          password: false,
          transferable: true,
          defaultBankSource: 'assets',
        },
      }),
      makeBank('owned-bank', [transferredPad], {
        restoreKind: 'custom_bank',
        restoreStatus: 'missing_media',
      }),
    ]);

    const restored = banks.find((bank) => bank.id === 'owned-bank')?.pads[0];
    expect(restored?.audioUrl).toBe('blob:default-pad-audio');
    expect(restored?.imageUrl).toBe('blob:default-pad-image');
    expect(restored?.missingMediaExpected).toBe(false);
  });
});
