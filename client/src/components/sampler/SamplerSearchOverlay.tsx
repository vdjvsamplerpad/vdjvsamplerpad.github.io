import * as React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FolderOpen, Search, X } from 'lucide-react';
import type { PerformanceTier } from '@/lib/performance-monitor';
import type { ChannelDeckState } from './types/sampler';
import {
  describeChannelSearchLoadState,
  type SamplerBankSearchResult,
  type SamplerSearchResult,
  type SamplerSearchScope,
} from './samplerSearch';

interface SamplerSearchOverlayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  theme: 'light' | 'dark';
  query: string;
  onQueryChange: (value: string) => void;
  scope: SamplerSearchScope;
  scopeOptions: Array<{ key: SamplerSearchScope; label: string }>;
  onScopeChange: (scope: SamplerSearchScope) => void;
  bankResults: SamplerBankSearchResult[];
  padResults: SamplerSearchResult[];
  totalMatchCount: number;
  onGo: (result: SamplerSearchResult) => void;
  onOpenBank: (result: SamplerBankSearchResult, target?: 'auto' | 'primary' | 'secondary') => void;
  onEdit: (result: SamplerSearchResult) => void;
  onLoad: (result: SamplerSearchResult) => void;
  showEditAction: boolean;
  isDualMode: boolean;
  graphicsTier: PerformanceTier;
  loadTargetSelection: SamplerSearchResult | null;
  channelStates: ChannelDeckState[];
  armedLoadChannelId: number | null;
  onChooseLoadChannel: (channelId: number) => void;
  onCancelLoadTargetSelection: () => void;
  errorMessage: string | null;
}

const statusToneClass = (
  theme: 'light' | 'dark',
  tone: 'ready' | 'warn' | 'muted'
): string => {
  if (tone === 'ready') {
    return theme === 'dark'
      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
      : 'border-emerald-200 bg-emerald-50 text-emerald-700';
  }
  if (tone === 'warn') {
    return theme === 'dark'
      ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
      : 'border-amber-200 bg-amber-50 text-amber-700';
  }
  return theme === 'dark'
    ? 'border-gray-700 bg-gray-900/60 text-gray-300'
    : 'border-gray-200 bg-gray-50 text-gray-600';
};

const getBankColorLuminance = (hex: string): number => {
  const normalized = hex.trim().replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return 0.5;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
};

export function SamplerSearchOverlay({
  open,
  onOpenChange,
  theme,
  query,
  onQueryChange,
  scope,
  scopeOptions,
  onScopeChange,
  bankResults,
  padResults,
  totalMatchCount,
  onGo,
  onOpenBank,
  onEdit,
  onLoad,
  showEditAction,
  isDualMode,
  graphicsTier,
  loadTargetSelection,
  channelStates,
  armedLoadChannelId,
  onChooseLoadChannel,
  onCancelLoadTargetSelection,
  errorMessage,
}: SamplerSearchOverlayProps) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const isDark = theme === 'dark';
  const visibleResultCount = bankResults.length + padResults.length;
  const showThumbnailPreview = graphicsTier === 'high' || graphicsTier === 'medium';
  const compactBankVisual = graphicsTier === 'lowest' || graphicsTier === 'low';
  const highBankCard = graphicsTier === 'high';

  React.useEffect(() => {
    if (!open) return;
    const timeoutId = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(timeoutId);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className={`sm:max-w-3xl p-0 overflow-hidden ${isDark ? 'bg-gray-900 border-gray-700 text-gray-100' : 'bg-white border-gray-200 text-gray-900'}`}
      >
        <DialogHeader className={`px-4 pt-4 pb-3 border-b ${isDark ? 'border-gray-800' : 'border-gray-200'}`}>
          <div className="flex items-start justify-between gap-3">
            <DialogTitle>SEARCH</DialogTitle>
            <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        <div className="px-4 py-4 space-y-4">
          <div className="space-y-3">
            <div className="relative">
              <Search className={`absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`} />
              <Input
                ref={inputRef}
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder="Search bank or pad name..."
                className={`h-11 pl-9 text-sm ${isDark ? 'bg-gray-950 border-gray-700' : 'bg-white border-gray-300'}`}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {scopeOptions.map((option) => (
                <Button
                  key={option.key}
                  type="button"
                  size="sm"
                  variant={scope === option.key ? 'default' : 'outline'}
                  onClick={() => onScopeChange(option.key)}
                  className="h-8 px-3 text-xs"
                >
                  {option.label}
                </Button>
              ))}
              <div className={`ml-auto text-xs self-center ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                {totalMatchCount > visibleResultCount
                  ? `Showing ${visibleResultCount} of ${totalMatchCount} matches`
                  : `${totalMatchCount} match${totalMatchCount === 1 ? '' : 'es'}`}
              </div>
            </div>
          </div>

          {errorMessage ? (
            <div className={`rounded-xl border px-3 py-2 text-sm ${isDark ? 'border-red-500/40 bg-red-500/10 text-red-200' : 'border-red-200 bg-red-50 text-red-700'}`}>
              {errorMessage}
            </div>
          ) : null}

          {loadTargetSelection ? (
            <div className={`rounded-2xl border p-3 space-y-3 ${isDark ? 'border-cyan-500/30 bg-cyan-500/10' : 'border-cyan-200 bg-cyan-50'}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">Choose Target Channel</div>
                  <div className={`text-xs mt-1 ${isDark ? 'text-cyan-100/80' : 'text-cyan-800/80'}`}>
                    Load "{loadTargetSelection.padName}" from {loadTargetSelection.bankName}. Pick the target deck below. If a load deck is armed, it stays highlighted for quick selection.
                  </div>
                </div>
                <Button size="sm" variant="ghost" className="h-8 px-2" onClick={onCancelLoadTargetSelection}>
                  Cancel
                </Button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {channelStates.map((channel) => {
                  const summary = describeChannelSearchLoadState(channel);
                  const isArmed = armedLoadChannelId === channel.channelId;
                  return (
                    <button
                      key={`search-channel-${channel.channelId}`}
                      type="button"
                      onClick={() => onChooseLoadChannel(channel.channelId)}
                      className={`rounded-xl border px-3 py-3 text-left transition-colors ${
                        isArmed
                          ? (isDark ? 'border-emerald-400 bg-emerald-500/15' : 'border-emerald-300 bg-emerald-50')
                          : (isDark ? 'border-gray-700 bg-gray-950/50 hover:border-cyan-400/60' : 'border-white bg-white hover:border-cyan-300')
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold">Channel {channel.channelId}</div>
                        {isArmed ? (
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${statusToneClass(theme, 'ready')}`}>
                            Armed
                          </span>
                        ) : null}
                      </div>
                      <div className={`mt-1 text-xs ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                        {summary}
                        {channel.pad?.padName ? ` - ${channel.pad.padName}` : ''}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="max-h-[60vh] overflow-y-auto pr-1 space-y-4">
            {visibleResultCount === 0 ? (
              <div className={`rounded-2xl border px-4 py-8 text-center text-sm ${isDark ? 'border-gray-800 bg-gray-950/40 text-gray-400' : 'border-gray-200 bg-gray-50 text-gray-500'}`}>
                No banks or loaded pads match this search.
              </div>
            ) : (
              <>
                {bankResults.length > 0 ? (
                  <div className="space-y-2">
                    <div className={`px-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                      Banks
                    </div>
                    {bankResults.map((result) => (
                      (() => {
                        const bankLuminance = getBankColorLuminance(result.bankColor);
                        const isLightBankColor = bankLuminance > 0.72;
                        const useDarkBankText = isLightBankColor && isDark;
                        const folderIconClass = isLightBankColor ? 'text-gray-950/85' : 'text-white';
                        const bankTitleClass = useDarkBankText ? 'text-gray-950' : 'text-white';
                        const bankMetaClass = useDarkBankText ? 'text-gray-900/85' : (isDark ? 'text-gray-300' : 'text-gray-700');
                        const bankDescriptionClass = useDarkBankText ? 'text-gray-900/80' : (isDark ? 'text-gray-300/90' : 'text-gray-700/80');
                        const bankTextShadow = useDarkBankText
                          ? '0 1px 0 rgba(255,255,255,0.32), 0 0 12px rgba(255,255,255,0.18)'
                          : '0 1px 2px rgba(0,0,0,0.78), 0 0 12px rgba(0,0,0,0.42)';
                        return (
                      <div
                        key={result.key}
                        role="button"
                        tabIndex={0}
                        onClick={() => onOpenBank(result, 'auto')}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            onOpenBank(result, 'auto');
                          }
                        }}
                        className={`w-full rounded-2xl border ${highBankCard ? 'p-4' : 'p-3'} text-left transition-colors focus:outline-none focus:ring-2 ${isDark ? 'border-gray-800 bg-gray-950/40 hover:border-cyan-400/40 hover:bg-gray-950/70 focus:ring-cyan-400/50' : 'border-gray-200 bg-white hover:border-cyan-300 hover:bg-cyan-50/40 focus:ring-cyan-300/70'}`}
                        style={{
                          backgroundColor: !showThumbnailPreview || !result.thumbnailUrl || result.hideThumbnailPreview
                            ? undefined
                            : (isDark ? `${result.bankColor}1F` : `${result.bankColor}12`),
                          backgroundImage: showThumbnailPreview && result.thumbnailUrl && !result.hideThumbnailPreview
                            ? `linear-gradient(to right, ${
                                isDark && isLightBankColor
                                  ? `${result.bankColor}D8`
                                  : `${result.bankColor}E6`
                              } 0%, ${
                                isDark && isLightBankColor
                                  ? `${result.bankColor}7A`
                                  : `${result.bankColor}9C`
                              } 36%, ${isDark ? 'rgba(3,7,18,0.82)' : 'rgba(255,255,255,0.74)'} 72%), url(${result.thumbnailUrl})`
                            : undefined,
                          backgroundSize: showThumbnailPreview && result.thumbnailUrl && !result.hideThumbnailPreview ? 'cover' : undefined,
                          backgroundPosition: showThumbnailPreview && result.thumbnailUrl && !result.hideThumbnailPreview ? 'center' : undefined,
                        }}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className={`min-w-0 flex items-start ${highBankCard ? 'gap-4' : 'gap-3'}`}>
                            <div
                              className={`shrink-0 overflow-hidden rounded-xl border ${compactBankVisual ? 'h-10 w-10' : highBankCard ? 'h-14 w-14' : 'h-12 w-12'} ${isDark ? 'border-white/10 bg-gray-950/70' : 'border-black/10 bg-white'}`}
                              style={{
                                backgroundColor: result.bankColor,
                              }}
                            >
                              <div className="flex h-full w-full items-center justify-center">
                                <FolderOpen className={`${compactBankVisual ? 'h-4 w-4' : highBankCard ? 'h-6 w-6' : 'h-5 w-5'} ${folderIconClass}`} />
                              </div>
                            </div>
                            <div className="min-w-0">
                              <div
                                className={`truncate font-semibold ${highBankCard ? 'text-[15px]' : 'text-sm'} ${bankTitleClass}`}
                                style={{ textShadow: bankTextShadow }}
                              >
                                {result.bankName}
                              </div>
                              <div
                                className={`mt-2 flex items-center gap-2 text-xs ${bankMetaClass}`}
                                style={{ textShadow: bankTextShadow }}
                              >
                                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${statusToneClass(theme, 'muted')}`}>
                                  Bank
                                </span>
                                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${statusToneClass(theme, 'ready')}`}>
                                  {result.padCount} Pad{result.padCount === 1 ? '' : 's'}
                                </span>
                                {result.bankDescription ? (
                                  <span className={`min-w-0 truncate ${bankDescriptionClass}`}>
                                    {result.bankDescription}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {isDualMode ? (
                              <>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-8 px-3 text-xs"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    onOpenBank(result, 'primary');
                                  }}
                                >
                                  Primary
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  className="h-8 px-3 text-xs"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    onOpenBank(result, 'secondary');
                                  }}
                                >
                                  Secondary
                                </Button>
                              </>
                            ) : (
                              <Button
                                type="button"
                                size="sm"
                                className="h-8 px-3 text-xs"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onOpenBank(result, 'auto');
                                }}
                              >
                                Open
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                        );
                      })()
                    ))}
                  </div>
                ) : null}

                {padResults.length > 0 ? (
                  <div className="space-y-2">
                    <div className={`px-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                      Pads
                    </div>
                    {padResults.map((result) => (
                      <div
                        key={result.key}
                        role="button"
                        tabIndex={0}
                        onClick={() => onGo(result)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            onGo(result);
                          }
                        }}
                        className={`w-full rounded-2xl border p-3 text-left transition-colors focus:outline-none focus:ring-2 ${isDark ? 'border-gray-800 bg-gray-950/40 hover:border-cyan-400/40 hover:bg-gray-950/70 focus:ring-cyan-400/50' : 'border-gray-200 bg-white hover:border-cyan-300 hover:bg-cyan-50/40 focus:ring-cyan-300/70'}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold">{result.padName}</div>
                            <div className={`mt-1 truncate text-xs ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                              {result.bankName}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${statusToneClass(theme, 'muted')}`}>
                                Go
                              </span>
                              {result.canLoad ? (
                                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${statusToneClass(theme, 'ready')}`}>
                                  Load Ready
                                </span>
                              ) : result.loadAvailability === 'login_required' ? (
                                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${statusToneClass(theme, 'warn')}`}>
                                  Login Required
                                </span>
                              ) : (
                                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${statusToneClass(theme, 'warn')}`}>
                                  Missing Audio
                                </span>
                              )}
                              {result.hasMissingImage ? (
                                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${statusToneClass(theme, 'muted')}`}>
                                  Missing Image
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {showEditAction ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                className="h-8 px-3 text-xs"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onEdit(result);
                                }}
                              >
                                Edit
                              </Button>
                            ) : null}
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-8 px-3 text-xs"
                              onClick={(event) => {
                                event.stopPropagation();
                                onGo(result);
                              }}
                            >
                              Go
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              className="h-8 px-3 text-xs"
                              disabled={!result.canLoad}
                              onClick={(event) => {
                                event.stopPropagation();
                                onLoad(result);
                              }}
                            >
                              Load
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
