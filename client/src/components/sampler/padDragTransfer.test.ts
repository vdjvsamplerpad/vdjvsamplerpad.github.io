import { describe, expect, it } from 'vitest';
import {
  createPadDragTransferPayload,
  parsePadDragTransferPayload,
} from './padDragTransfer';

describe('padDragTransfer', () => {
  it('creates a compact payload without embedding the full pad object', () => {
    const payload = createPadDragTransferPayload({
      padId: 'pad-1',
      sourceBankId: 'bank-1',
      isDualMode: true,
      primaryBankId: 'bank-a',
      secondaryBankId: 'bank-b',
    });

    expect(payload).toEqual({
      type: 'pad-transfer',
      padId: 'pad-1',
      sourceBankId: 'bank-1',
      isDualMode: true,
      primaryBankId: 'bank-a',
      secondaryBankId: 'bank-b',
    });
    expect('pad' in payload).toBe(false);
  });

  it('parses the compact payload shape used by the updated drag writer', () => {
    const raw = JSON.stringify({
      type: 'pad-transfer',
      padId: 'pad-2',
      sourceBankId: 'bank-2',
      isDualMode: false,
    });

    expect(parsePadDragTransferPayload(raw)).toEqual({
      type: 'pad-transfer',
      padId: 'pad-2',
      sourceBankId: 'bank-2',
      isDualMode: false,
      primaryBankId: null,
      secondaryBankId: null,
    });
  });

  it('parses the legacy payload shape for backward compatibility', () => {
    const raw = JSON.stringify({
      type: 'pad-transfer',
      sourceBankId: 'bank-3',
      pad: {
        id: 'pad-3',
        imageData: 'x'.repeat(2048),
      },
    });

    expect(parsePadDragTransferPayload(raw)).toEqual({
      type: 'pad-transfer',
      padId: 'pad-3',
      sourceBankId: 'bank-3',
      isDualMode: false,
      primaryBankId: null,
      secondaryBankId: null,
    });
  });

  it('keeps the serialized drag payload much smaller than the legacy full-pad payload', () => {
    const compact = JSON.stringify(createPadDragTransferPayload({
      padId: 'pad-4',
      sourceBankId: 'bank-4',
    }));
    const legacy = JSON.stringify({
      type: 'pad-transfer',
      sourceBankId: 'bank-4',
      pad: {
        id: 'pad-4',
        name: 'Impact FX',
        imageData: 'x'.repeat(10_000),
        audioUrl: 'blob:http://localhost/audio',
        preparedAudioUrl: 'blob:http://localhost/prepared',
      },
    });

    expect(compact.length).toBeLessThan(legacy.length / 10);
  });
});
