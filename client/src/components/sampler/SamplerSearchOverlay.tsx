import * as React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, X } from 'lucide-react';
import type { ChannelDeckState } from './types/sampler';
import {
  describeChannelSearchLoadState,
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
  results: SamplerSearchResult[];
  totalMatchCount: number;
  onGo: (result: SamplerSearchResult) => void;
  onEdit: (result: SamplerSearchResult) => void;
  onLoad: (result: SamplerSearchResult) => void;
  showEditAction: boolean;
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

export function SamplerSearchOverlay({
  open,
  onOpenChange,
  theme,
  query,
  onQueryChange,
  scope,
  scopeOptions,
  onScopeChange,
  results,
  totalMatchCount,
  onGo,
  onEdit,
  onLoad,
  showEditAction,
  loadTargetSelection,
  channelStates,
  armedLoadChannelId,
  onChooseLoadChannel,
  onCancelLoadTargetSelection,
  errorMessage,
}: SamplerSearchOverlayProps) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const isDark = theme === 'dark';

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
            <div>
              <DialogTitle>Global Pad Search</DialogTitle>
              <div className={`mt-1 text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                Search loaded pads by pad name or bank name. Press <span className="font-medium">Go</span> to jump, or <span className="font-medium">Load</span> to send a pad to a deck.
              </div>
            </div>
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
                placeholder="Search pad or bank name..."
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
                {totalMatchCount > results.length
                  ? `Showing ${results.length} of ${totalMatchCount} matches`
                  : `${results.length} match${results.length === 1 ? '' : 'es'}`}
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

          <div className="max-h-[60vh] overflow-y-auto pr-1 space-y-2">
            {results.length === 0 ? (
              <div className={`rounded-2xl border px-4 py-8 text-center text-sm ${isDark ? 'border-gray-800 bg-gray-950/40 text-gray-400' : 'border-gray-200 bg-gray-50 text-gray-500'}`}>
                No loaded pads match this search.
              </div>
            ) : results.map((result) => (
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
