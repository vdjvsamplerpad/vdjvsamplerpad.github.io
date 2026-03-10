import * as React from 'react';
import { getAudioTelemetry } from '@/lib/audio-telemetry';
import { useGlobalPlaybackManagerApi, type AudioRuntimeInfo } from './hooks/useGlobalPlaybackManager';

const AUDIO_TEST_LAST_CHANGE_TAG = 'step10-waveform-bounded-lowest-zoom';

type TrimPreviewDiag = {
  state: string;
  updatedAt: number;
  reason?: string;
  previewStartMs?: number;
  previewEndMs?: number;
};

interface HeaderAdminDebugPanelProps {
  currentBankId: string | null;
  isDualMode: boolean;
  primaryBankId: string | null;
  secondaryBankId: string | null;
  theme: 'light' | 'dark';
  pushNotice: (notice: { variant: 'success' | 'error' | 'info'; message: string }) => void;
}

export function HeaderAdminDebugPanel({
  currentBankId,
  isDualMode,
  primaryBankId,
  secondaryBankId,
  theme,
  pushNotice,
}: HeaderAdminDebugPanelProps) {
  const playbackManager = useGlobalPlaybackManagerApi();
  const appVersion = (import.meta as any).env?.VITE_APP_VERSION || 'unknown';
  const telemetry = React.useMemo(() => getAudioTelemetry(appVersion), [appVersion]);
  const [audioRuntimeInfo, setAudioRuntimeInfo] = React.useState<AudioRuntimeInfo>(() => playbackManager.getAudioRuntimeInfo());
  const [telemetryUi, setTelemetryUi] = React.useState(() => telemetry.getUiState());
  const [headerDebugExpanded, setHeaderDebugExpanded] = React.useState(false);
  const heartbeatTickRef = React.useRef(0);
  const isIOSClient = React.useMemo(
    () => typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent),
    []
  );
  const [trimPreviewDiag, setTrimPreviewDiag] = React.useState<TrimPreviewDiag>({ state: 'idle', updatedAt: Date.now() });

  React.useEffect(() => {
    if (typeof window === 'undefined') return;

    const syncRuntimeInfo = (event?: Event) => {
      setAudioRuntimeInfo(playbackManager.getAudioRuntimeInfo());
      const detail = (event as CustomEvent<Record<string, unknown>> | undefined)?.detail;
      if (detail) {
        telemetry.log('audio_stage', detail);
      }
    };

    syncRuntimeInfo();
    window.addEventListener('vdjv-audio-stage-info', syncRuntimeInfo as EventListener);
    return () => {
      window.removeEventListener('vdjv-audio-stage-info', syncRuntimeInfo as EventListener);
    };
  }, [playbackManager, telemetry]);

  React.useEffect(() => {
    if (typeof window === 'undefined' || !isIOSClient) return;
    const onTrimPreviewDiag = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail || {};
      setTrimPreviewDiag({
        state: typeof detail.state === 'string' ? detail.state : 'unknown',
        updatedAt: typeof detail.updatedAt === 'number' ? detail.updatedAt : Date.now(),
        reason: typeof detail.reason === 'string' ? detail.reason : undefined,
        previewStartMs: typeof detail.previewStartMs === 'number' ? detail.previewStartMs : undefined,
        previewEndMs: typeof detail.previewEndMs === 'number' ? detail.previewEndMs : undefined
      });
    };
    window.addEventListener('vdjv-trim-preview-diag', onTrimPreviewDiag as EventListener);
    return () => {
      window.removeEventListener('vdjv-trim-preview-diag', onTrimPreviewDiag as EventListener);
    };
  }, [isIOSClient]);

  React.useEffect(() => {
    const unsubscribe = telemetry.subscribe(() => {
      setTelemetryUi(telemetry.getUiState());
    });
    setTelemetryUi(telemetry.getUiState());
    return unsubscribe;
  }, [telemetry]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;

    const onDisabled = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail || {};
      telemetry.log('audio_engine_disabled', detail, 'warn');
    };
    const onUnlockRequired = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail || {};
      telemetry.log('audio_unlock_required', detail, 'warn');
    };
    const onUnlockRestored = () => {
      telemetry.log('audio_unlock_restored');
    };
    const onTransportEvict = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail || {};
      telemetry.log('transport_evict', detail, 'warn');
    };
    const onBudgetBlocked = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail || {};
      telemetry.log('transport_budget_blocked', detail, 'warn');
    };
    const onPadPlayFailed = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail || {};
      telemetry.log('pad_play_failed', detail, 'warn');
    };
    const onPadQuarantine = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail || {};
      telemetry.log('pad_quarantine', detail, 'warn');
    };
    const onChannelPauseDiag = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail || {};
      const phase = typeof detail.phase === 'string' ? detail.phase : '';
      const guardAdvanceMs = typeof detail.guardAdvanceMs === 'number' ? detail.guardAdvanceMs : 0;
      const level: 'info' | 'warn' = phase === 'guard' && guardAdvanceMs > 4 ? 'warn' : 'info';
      telemetry.log('channel_pause_diag', detail, level);
    };
    const onChannelPlayDiag = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail || {};
      const phase = typeof detail.phase === 'string' ? detail.phase : '';
      const level: 'info' | 'warn' =
        phase === 'attempt_fail' || phase === 'failed'
          ? 'warn'
          : 'info';
      telemetry.log('channel_play_diag', detail, level);
    };
    const onChannelStopDiag = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail || {};
      const phase = typeof detail.phase === 'string' ? detail.phase : '';
      const guardAdvanceMs = typeof detail.guardAdvanceMs === 'number' ? detail.guardAdvanceMs : 0;
      const reason = typeof detail.reason === 'string' ? detail.reason : '';
      const level: 'info' | 'warn' =
        (phase === 'guard' && guardAdvanceMs > 4) || reason === 'missing_audio_or_pad'
          ? 'warn'
          : 'info';
      telemetry.log('channel_stop_diag', detail, level);
    };
    const onChannelSeekDiag = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail || {};
      const phase = typeof detail.phase === 'string' ? detail.phase : '';
      const level: 'info' | 'warn' = phase === 'cancelled' ? 'warn' : 'info';
      telemetry.log('channel_seek_diag', detail, level);
    };
    const onChannelHotcueDiag = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail || {};
      const phase = typeof detail.phase === 'string' ? detail.phase : '';
      const level: 'info' | 'warn' =
        phase === 'trigger_blocked' || phase === 'trigger_missing'
          ? 'warn'
          : 'info';
      telemetry.log('channel_hotcue_diag', detail, level);
    };

    window.addEventListener('vdjv-audio-engine-disabled', onDisabled as EventListener);
    window.addEventListener('vdjv-audio-unlock-required', onUnlockRequired as EventListener);
    window.addEventListener('vdjv-audio-unlock-restored', onUnlockRestored as EventListener);
    window.addEventListener('vdjv-audio-transport-evict', onTransportEvict as EventListener);
    window.addEventListener('vdjv-audio-transport-budget-blocked', onBudgetBlocked as EventListener);
    window.addEventListener('vdjv-audio-pad-play-failed', onPadPlayFailed as EventListener);
    window.addEventListener('vdjv-audio-pad-quarantine', onPadQuarantine as EventListener);
    window.addEventListener('vdjv-audio-channel-pause-diag', onChannelPauseDiag as EventListener);
    window.addEventListener('vdjv-audio-channel-play-diag', onChannelPlayDiag as EventListener);
    window.addEventListener('vdjv-audio-channel-stop-diag', onChannelStopDiag as EventListener);
    window.addEventListener('vdjv-audio-channel-seek-diag', onChannelSeekDiag as EventListener);
    window.addEventListener('vdjv-audio-channel-hotcue-diag', onChannelHotcueDiag as EventListener);

    return () => {
      window.removeEventListener('vdjv-audio-engine-disabled', onDisabled as EventListener);
      window.removeEventListener('vdjv-audio-unlock-required', onUnlockRequired as EventListener);
      window.removeEventListener('vdjv-audio-unlock-restored', onUnlockRestored as EventListener);
      window.removeEventListener('vdjv-audio-transport-evict', onTransportEvict as EventListener);
      window.removeEventListener('vdjv-audio-transport-budget-blocked', onBudgetBlocked as EventListener);
      window.removeEventListener('vdjv-audio-pad-play-failed', onPadPlayFailed as EventListener);
      window.removeEventListener('vdjv-audio-pad-quarantine', onPadQuarantine as EventListener);
      window.removeEventListener('vdjv-audio-channel-pause-diag', onChannelPauseDiag as EventListener);
      window.removeEventListener('vdjv-audio-channel-play-diag', onChannelPlayDiag as EventListener);
      window.removeEventListener('vdjv-audio-channel-stop-diag', onChannelStopDiag as EventListener);
      window.removeEventListener('vdjv-audio-channel-seek-diag', onChannelSeekDiag as EventListener);
      window.removeEventListener('vdjv-audio-channel-hotcue-diag', onChannelHotcueDiag as EventListener);
    };
  }, [telemetry]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    let cancelled = false;

    const logHeartbeat = async () => {
      if (cancelled) return;
      heartbeatTickRef.current += 1;
      const audioState = playbackManager.getAudioState();
      const runtime = playbackManager.getAudioRuntimeInfo();
      const health = playbackManager.getEngineHealth();
      let storageUsageMb: number | null = null;
      let storageQuotaMb: number | null = null;

      if (heartbeatTickRef.current % 3 === 0 && navigator.storage?.estimate) {
        try {
          const estimate = await navigator.storage.estimate();
          if (typeof estimate.usage === 'number' && Number.isFinite(estimate.usage)) {
            storageUsageMb = Math.round((estimate.usage / (1024 * 1024)) * 10) / 10;
          }
          if (typeof estimate.quota === 'number' && Number.isFinite(estimate.quota)) {
            storageQuotaMb = Math.round((estimate.quota / (1024 * 1024)) * 10) / 10;
          }
        } catch {
        }
      }

      const activeBank = isDualMode
        ? `${primaryBankId || 'none'}|${secondaryBankId || 'none'}`
        : (currentBankId || 'none');

      telemetry.log('heartbeat', {
        contextState: audioState.contextState,
        isUnlocked: audioState.isUnlocked,
        playingCount: audioState.playingCount,
        totalInstances: audioState.totalInstances,
        bufferedCount: audioState.bufferedCount,
        stage: runtime.stage,
        activePadId: runtime.activePadId,
        activePadBackend: runtime.activePadBackend,
        quarantinedPads: runtime.quarantinedPads,
        lastBlockedPadId: runtime.lastBlockedPadId,
        lastBlockedReason: runtime.lastBlockedReason,
        loadedTransports: health.loadedTransports,
        totalTransports: health.totalTransports,
        totalTransportCap: health.totalTransportCap,
        playingTransports: health.playingTransports,
        transportBudget: health.transportBudget,
        transportEvictions: health.transportEvictions,
        lastEvictedPadId: health.lastEvictedPadId,
        storageUsageMb,
        storageQuotaMb,
        online: navigator.onLine,
        activeBank
      });
    };

    void logHeartbeat();
    const timer = window.setInterval(() => {
      void logHeartbeat();
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [currentBankId, isDualMode, playbackManager, primaryBankId, secondaryBankId, telemetry]);

  const handleExportCurrentTelemetry = React.useCallback(() => {
    const ok = telemetry.exportCurrentSession();
    pushNotice({
      variant: ok ? 'success' : 'error',
      message: ok ? 'Current telemetry log exported.' : 'Failed to export current telemetry log.'
    });
  }, [pushNotice, telemetry]);

  const handleExportRecoveredTelemetry = React.useCallback(() => {
    const ok = telemetry.exportRecoveredSession();
    pushNotice({
      variant: ok ? 'success' : 'error',
      message: ok ? 'Recovered crash log exported.' : 'No recovered crash log to export.'
    });
  }, [pushNotice, telemetry]);

  const handleClearRecoveredTelemetry = React.useCallback(() => {
    telemetry.clearRecoveredSession();
    pushNotice({
      variant: 'info',
      message: 'Recovered crash log cleared.'
    });
  }, [pushNotice, telemetry]);

  const trimRangeLabel = trimPreviewDiag.previewStartMs !== undefined && trimPreviewDiag.previewEndMs !== undefined
    ? `${Math.round(trimPreviewDiag.previewStartMs)}-${Math.round(trimPreviewDiag.previewEndMs)}ms`
    : '-';

  return (
    <div className="mb-1">
      <div className="flex items-center justify-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => setHeaderDebugExpanded((prev) => !prev)}
          className={`px-2 py-0.5 rounded border text-[10px] leading-tight ${theme === 'dark'
            ? 'border-amber-500/60 text-amber-200 hover:bg-amber-500/20'
            : 'border-amber-500/60 text-amber-700 hover:bg-amber-100'
            }`}
        >
          {headerDebugExpanded ? 'Hide Header Debug' : 'Show Header Debug'}
        </button>
      </div>
      {headerDebugExpanded && (
        <>
          <div className={`text-[10px] leading-tight mt-1 ${theme === 'dark' ? 'text-amber-300' : 'text-amber-700'}`}>
            TEST: {audioRuntimeInfo.stage} | chg: {AUDIO_TEST_LAST_CHANGE_TAG}
          </div>
          <div className={`text-[9px] leading-tight font-mono ${theme === 'dark' ? 'text-sky-300' : 'text-sky-700'}`}>
            diag:{' '}
            ev={telemetryUi.eventCount}
            {' '}warm={telemetryUi.counters.warmSucceeded}/{telemetryUi.counters.warmStarted}
            {' '}play={telemetryUi.counters.playStarted}/{telemetryUi.counters.playRequested}
            {' '}err={telemetryUi.counters.errors}
            {' '}evict={telemetryUi.counters.evictions}
            {' '}q={audioRuntimeInfo.quarantinedPads}
            {' '}pool={telemetryUi.latestHeartbeat?.loadedTransports ?? 0}/{telemetryUi.latestHeartbeat?.transportBudget ?? 0}
          </div>
          {isIOSClient && (
            <div className={`text-[9px] leading-tight font-mono ${theme === 'dark' ? 'text-emerald-300' : 'text-emerald-700'}`}>
              ios-diag:{' '}
              ch={audioRuntimeInfo.lastChannelId ?? '-'}
              {' '}act={audioRuntimeInfo.lastChannelAction}#{audioRuntimeInfo.lastChannelCommandToken}
              {' '}trim={trimPreviewDiag.state}
              {trimPreviewDiag.reason ? `(${trimPreviewDiag.reason})` : ''}
              {' '}rng={trimRangeLabel}
            </div>
          )}
          <div className="flex items-center justify-center gap-1 flex-wrap mt-0.5">
            <button
              type="button"
              onClick={handleExportCurrentTelemetry}
              className={`px-1.5 py-0.5 rounded border text-[9px] leading-tight ${theme === 'dark'
                ? 'border-cyan-500/60 text-cyan-200 hover:bg-cyan-500/20'
                : 'border-cyan-500/60 text-cyan-700 hover:bg-cyan-100'
                }`}
            >
              Export Log
            </button>
            {telemetryUi.recoveredCrash && (
              <>
                <button
                  type="button"
                  onClick={handleExportRecoveredTelemetry}
                  className={`px-1.5 py-0.5 rounded border text-[9px] leading-tight ${theme === 'dark'
                    ? 'border-rose-500/60 text-rose-200 hover:bg-rose-500/20'
                    : 'border-rose-500/60 text-rose-700 hover:bg-rose-100'
                    }`}
                >
                  Export Last Crash
                </button>
                <button
                  type="button"
                  onClick={handleClearRecoveredTelemetry}
                  className={`px-1.5 py-0.5 rounded border text-[9px] leading-tight ${theme === 'dark'
                    ? 'border-amber-500/60 text-amber-200 hover:bg-amber-500/20'
                    : 'border-amber-500/60 text-amber-700 hover:bg-amber-100'
                    }`}
                >
                  Clear Crash Log
                </button>
              </>
            )}
          </div>
          {telemetryUi.recoveredCrash && (
            <div className={`text-[9px] leading-tight ${theme === 'dark' ? 'text-rose-300' : 'text-rose-700'}`}>
              Recovered unclean session {telemetryUi.recoveredCrash.sessionId} ({telemetryUi.recoveredCrash.eventCount} events)
            </div>
          )}
          {telemetryUi.recentLines.length > 0 && (
            <div className={`mt-0.5 mx-auto max-w-[96vw] text-left rounded border px-1.5 py-1 max-h-24 overflow-y-auto text-[9px] font-mono leading-tight ${theme === 'dark'
              ? 'border-gray-700 bg-gray-900/70 text-gray-200'
              : 'border-gray-300 bg-white/80 text-gray-700'
              }`}>
              {telemetryUi.recentLines.map((line, index) => (
                <div key={`${line}-${index}`} className="truncate">
                  {line}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
