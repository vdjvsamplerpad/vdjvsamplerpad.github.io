export interface PadDragTransferPayload {
  type: 'pad-transfer';
  padId: string;
  sourceBankId: string;
  isDualMode?: boolean;
  primaryBankId?: string | null;
  secondaryBankId?: string | null;
}

type LegacyPadDragTransferPayload = {
  type?: unknown;
  padId?: unknown;
  sourceBankId?: unknown;
  isDualMode?: unknown;
  primaryBankId?: unknown;
  secondaryBankId?: unknown;
  pad?: {
    id?: unknown;
  } | null;
};

export const createPadDragTransferPayload = (input: {
  padId: string;
  sourceBankId: string;
  isDualMode?: boolean;
  primaryBankId?: string | null;
  secondaryBankId?: string | null;
}): PadDragTransferPayload => ({
  type: 'pad-transfer',
  padId: input.padId,
  sourceBankId: input.sourceBankId,
  isDualMode: input.isDualMode,
  primaryBankId: input.primaryBankId ?? null,
  secondaryBankId: input.secondaryBankId ?? null,
});

export const parsePadDragTransferPayload = (value: string | null | undefined): PadDragTransferPayload | null => {
  if (typeof value !== 'string' || value.trim().length === 0) return null;

  try {
    const parsed = JSON.parse(value) as LegacyPadDragTransferPayload;
    if (parsed.type !== 'pad-transfer') return null;

    const sourceBankId =
      typeof parsed.sourceBankId === 'string' && parsed.sourceBankId.trim().length > 0
        ? parsed.sourceBankId.trim()
        : null;
    const padId =
      typeof parsed.padId === 'string' && parsed.padId.trim().length > 0
        ? parsed.padId.trim()
        : (typeof parsed.pad?.id === 'string' && parsed.pad.id.trim().length > 0
          ? parsed.pad.id.trim()
          : null);

    if (!sourceBankId || !padId) return null;

    return {
      type: 'pad-transfer',
      padId,
      sourceBankId,
      isDualMode: parsed.isDualMode === true,
      primaryBankId: typeof parsed.primaryBankId === 'string' ? parsed.primaryBankId : null,
      secondaryBankId: typeof parsed.secondaryBankId === 'string' ? parsed.secondaryBankId : null,
    };
  } catch {
    return null;
  }
};
