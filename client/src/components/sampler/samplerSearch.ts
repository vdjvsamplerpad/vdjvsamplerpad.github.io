import type { ChannelDeckState } from './types/sampler';

export type SamplerSearchScope =
  | 'all_banks'
  | 'current_bank'
  | 'visible_banks';

export const getSamplerSearchScopeOptions = (
  isDualMode: boolean
): Array<{ key: SamplerSearchScope; label: string }> => (
  isDualMode
    ? [
        { key: 'all_banks', label: 'All Banks' },
        { key: 'visible_banks', label: 'Current View' },
      ]
    : [
        { key: 'all_banks', label: 'All Banks' },
        { key: 'current_bank', label: 'Current Bank' },
      ]
);

export type SamplerSearchLoadAvailability = 'ready' | 'sync_on_open' | 'missing_audio' | 'login_required';

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

export interface SamplerBankSearchResult {
  key: string;
  bankId: string;
  bankName: string;
  bankDescription: string;
  bankOrder: number;
  padCount: number;
  bankNameToken: string;
  bankDescriptionToken: string;
  bankDescriptionKeywords: string[];
  bankColor: string;
  thumbnailUrl?: string;
  hideThumbnailPreview?: boolean;
}

export const buildPadSearchAnchorId = (bankId: string, padId: string): string =>
  `sampler-pad-anchor-${bankId}-${padId}`;

export const normalizeSamplerSearchToken = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

const SAMPLER_SEARCH_STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from',
  'in', 'is', 'it', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'was',
  'were', 'with', 'you', 'your',
]);

export const normalizeSamplerSearchKeywords = (value: unknown): string[] => {
  if (typeof value !== 'string') return [];
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !SAMPLER_SEARCH_STOPWORDS.has(token));
};

export const normalizeSamplerSearchKeywordText = (value: unknown): string =>
  normalizeSamplerSearchKeywords(value).join(' ');

export const describeChannelSearchLoadState = (channel: ChannelDeckState): string => {
  if (channel.isPlaying) return 'Playing';
  if (channel.loadedPadRef) return 'Loaded';
  return 'Empty';
};
