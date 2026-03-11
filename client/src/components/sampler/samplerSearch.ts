import type { ChannelDeckState } from './types/sampler';

export type SamplerSearchScope =
  | 'all_banks'
  | 'current_bank'
  | 'visible_banks'
  | 'primary_bank'
  | 'secondary_bank';

export const getSamplerSearchScopeOptions = (
  isDualMode: boolean
): Array<{ key: SamplerSearchScope; label: string }> => (
  isDualMode
    ? [
        { key: 'all_banks', label: 'All Banks' },
        { key: 'primary_bank', label: 'Primary Bank' },
        { key: 'secondary_bank', label: 'Secondary Bank' },
        { key: 'visible_banks', label: 'Visible Banks' },
      ]
    : [
        { key: 'all_banks', label: 'All Banks' },
        { key: 'current_bank', label: 'Current Bank' },
      ]
);

export type SamplerSearchLoadAvailability = 'ready' | 'missing_audio' | 'login_required';

export interface SamplerSearchResult {
  key: string;
  bankId: string;
  bankName: string;
  padId: string;
  padName: string;
  bankOrder: number;
  padOrder: number;
  padNameToken: string;
  bankNameToken: string;
  canLoad: boolean;
  loadAvailability: SamplerSearchLoadAvailability;
  hasMissingImage: boolean;
}

export const buildPadSearchAnchorId = (bankId: string, padId: string): string =>
  `sampler-pad-anchor-${bankId}-${padId}`;

export const normalizeSamplerSearchToken = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

export const describeChannelSearchLoadState = (channel: ChannelDeckState): string => {
  if (channel.isPlaying) return 'Playing';
  if (channel.loadedPadRef) return 'Loaded';
  return 'Empty';
};
