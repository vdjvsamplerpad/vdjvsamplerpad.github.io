export type AudioDisabledSource = 'pad' | 'channel' | 'mixer' | 'trim' | 'shortcut' | 'midi';

export type ChannelPauseDiagPhase = 'command' | 'finalize' | 'guard';
export type ChannelStopDiagPhase = 'command' | 'finalize' | 'guard';
export type ChannelPlayDiagPhase =
  | 'command'
  | 'attempt'
  | 'attempt_ok'
  | 'attempt_fail'
  | 'fallback'
  | 'success'
  | 'failed';
export type ChannelSeekDiagPhase = 'command' | 'finalize' | 'cancelled';
export type ChannelHotcueDiagPhase =
  | 'set'
  | 'clear'
  | 'trigger'
  | 'trigger_blocked'
  | 'trigger_missing'
  | 'trigger_coalesced';

interface ChannelDiagBaseState {
  channelId: number;
  commandToken: number;
  audioElement: HTMLAudioElement | null;
  playheadMs: number;
  isPlaying: boolean;
  isPaused: boolean;
}

interface ChannelPlayDiagPadState {
  audioUrl?: string | null;
  volume: number;
  padGainLinear: number;
}

interface ChannelPlayDiagState extends ChannelDiagBaseState {
  graphConnected: boolean;
  pendingInitialSeekSec: number | null;
  channelVolume: number;
  pad: ChannelPlayDiagPadState | null;
}

interface ChannelPlayDiagRuntimeState {
  audioContextState: AudioContextState | 'none';
  contextUnlocked: boolean;
  globalMuted: boolean;
  masterVolume: number;
  hasSharedGain: boolean;
  targetGain: number | null;
}

interface ChannelPauseDiagArgs {
  stage: string;
  phase: ChannelPauseDiagPhase;
  channelId: number;
  commandToken: number;
  issuedAtMs: number;
  finalizedAtMs?: number;
  nowMs: number;
  audioElement: HTMLAudioElement | null;
  channelPlayheadMs: number;
  channelIsPlaying: boolean;
  channelIsPaused: boolean;
  baselineCurrentTimeMs?: number;
}

interface ChannelStopDiagArgs {
  stage: string;
  phase: ChannelStopDiagPhase;
  channelId: number;
  commandToken: number;
  issuedAtMs: number;
  finalizedAtMs?: number;
  nowMs: number;
  audioElement: HTMLAudioElement | null;
  channelPlayheadMs: number;
  channelIsPlaying: boolean;
  channelIsPaused: boolean;
  baselineCurrentTimeMs?: number;
  extra?: Record<string, unknown>;
}

interface ChannelPlayDiagArgs {
  stage: string;
  phase: ChannelPlayDiagPhase;
  channelId: number;
  commandToken: number;
  nowMs: number;
  audioElement: HTMLAudioElement | null;
  fallbackAudioUrl?: string | null;
  audioContextState: AudioContextState | 'none';
  contextUnlocked: boolean;
  graphConnected: boolean;
  hasSharedGain: boolean;
  pendingInitialSeekSec: number | null;
  globalMuted: boolean;
  masterVolume: number;
  channelVolume: number;
  padVolume: number | null;
  padGainLinear: number | null;
  targetGain: number | null;
  extra?: Record<string, unknown>;
}

interface ChannelSeekDiagArgs {
  stage: string;
  phase: ChannelSeekDiagPhase;
  channelId: number;
  commandToken: number;
  nowMs: number;
  audioElement: HTMLAudioElement | null;
  channelPlayheadMs: number;
  channelIsPlaying: boolean;
  channelIsPaused: boolean;
  detail?: Record<string, unknown>;
}

interface ChannelHotcueDiagArgs {
  stage: string;
  phase: ChannelHotcueDiagPhase;
  channelId: number;
  commandToken: number;
  nowMs: number;
  detail?: Record<string, unknown>;
}

interface AudioEngineDisabledArgs {
  action: string;
  source: AudioDisabledSource;
  stage: string;
}

function resolveCurrentTimeMs(audioElement: HTMLAudioElement | null): number | null {
  if (!audioElement) return null;
  const currentTime = Number.isFinite(audioElement.currentTime) ? audioElement.currentTime : 0;
  return Math.max(0, currentTime * 1000);
}

function resolveGuardAdvanceMs(
  baselineCurrentTimeMs: number | undefined,
  currentTimeMs: number | null
): number | null {
  if (typeof baselineCurrentTimeMs !== 'number' || typeof currentTimeMs !== 'number') return null;
  return Math.max(0, currentTimeMs - baselineCurrentTimeMs);
}

function resolveAudioSrcScheme(rawSrc: string): 'blob' | 'data' | 'http' | 'file' | 'other' | null {
  if (!rawSrc) return null;
  if (rawSrc.startsWith('blob:')) return 'blob';
  if (rawSrc.startsWith('data:')) return 'data';
  if (/^https?:/i.test(rawSrc)) return 'http';
  if (/^file:/i.test(rawSrc)) return 'file';
  return 'other';
}

function dispatchDiagnosticEvent(eventName: string, detail: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(eventName, { detail }));
}

export function emitChannelPauseDiagEvent(args: ChannelPauseDiagArgs): void {
  const currentTimeMs = resolveCurrentTimeMs(args.audioElement);
  const guardAdvanceMs = resolveGuardAdvanceMs(args.baselineCurrentTimeMs, currentTimeMs);
  dispatchDiagnosticEvent('vdjv-audio-channel-pause-diag', {
    stage: args.stage,
    phase: args.phase,
    channelId: args.channelId,
    commandToken: args.commandToken,
    issuedAtMs: args.issuedAtMs,
    finalizedAtMs: typeof args.finalizedAtMs === 'number' ? args.finalizedAtMs : null,
    nowMs: args.nowMs,
    elapsedFromCommandMs: Math.max(0, args.nowMs - args.issuedAtMs),
    elapsedFromFinalizeMs:
      typeof args.finalizedAtMs === 'number' ? Math.max(0, args.nowMs - args.finalizedAtMs) : null,
    audioCurrentTimeMs: currentTimeMs,
    audioPaused: args.audioElement ? args.audioElement.paused : null,
    audioReadyState: args.audioElement ? args.audioElement.readyState : null,
    channelPlayheadMs: args.channelPlayheadMs,
    channelIsPlaying: args.channelIsPlaying,
    channelIsPaused: args.channelIsPaused,
    guardAdvanceMs,
  });
}

export function emitChannelPauseDiagRuntime(
  stage: string,
  nowMs: number,
  channel: ChannelDiagBaseState,
  commandToken: number,
  phase: ChannelPauseDiagPhase,
  issuedAtMs: number,
  finalizedAtMs?: number,
  baselineCurrentTimeMs?: number
): void {
  emitChannelPauseDiagEvent({
    stage,
    phase,
    channelId: channel.channelId,
    commandToken,
    issuedAtMs,
    finalizedAtMs,
    nowMs,
    audioElement: channel.audioElement,
    channelPlayheadMs: channel.playheadMs,
    channelIsPlaying: channel.isPlaying,
    channelIsPaused: channel.isPaused,
    baselineCurrentTimeMs,
  });
}

export function emitChannelStopDiagEvent(args: ChannelStopDiagArgs): void {
  const currentTimeMs = resolveCurrentTimeMs(args.audioElement);
  const guardAdvanceMs = resolveGuardAdvanceMs(args.baselineCurrentTimeMs, currentTimeMs);
  dispatchDiagnosticEvent('vdjv-audio-channel-stop-diag', {
    stage: args.stage,
    phase: args.phase,
    channelId: args.channelId,
    commandToken: args.commandToken,
    issuedAtMs: args.issuedAtMs,
    finalizedAtMs: typeof args.finalizedAtMs === 'number' ? args.finalizedAtMs : null,
    nowMs: args.nowMs,
    elapsedFromCommandMs: Math.max(0, args.nowMs - args.issuedAtMs),
    elapsedFromFinalizeMs:
      typeof args.finalizedAtMs === 'number' ? Math.max(0, args.nowMs - args.finalizedAtMs) : null,
    audioCurrentTimeMs: currentTimeMs,
    audioPaused: args.audioElement ? args.audioElement.paused : null,
    audioReadyState: args.audioElement ? args.audioElement.readyState : null,
    channelPlayheadMs: args.channelPlayheadMs,
    channelIsPlaying: args.channelIsPlaying,
    channelIsPaused: args.channelIsPaused,
    guardAdvanceMs,
    ...(args.extra || {}),
  });
}

export function emitChannelStopDiagRuntime(
  stage: string,
  nowMs: number,
  channel: ChannelDiagBaseState,
  commandToken: number,
  phase: ChannelStopDiagPhase,
  issuedAtMs: number,
  finalizedAtMs?: number,
  baselineCurrentTimeMs?: number,
  extra: Record<string, unknown> = {}
): void {
  emitChannelStopDiagEvent({
    stage,
    phase,
    channelId: channel.channelId,
    commandToken,
    issuedAtMs,
    finalizedAtMs,
    nowMs,
    audioElement: channel.audioElement,
    channelPlayheadMs: channel.playheadMs,
    channelIsPlaying: channel.isPlaying,
    channelIsPaused: channel.isPaused,
    baselineCurrentTimeMs,
    extra,
  });
}

export function emitChannelPlayDiagEvent(args: ChannelPlayDiagArgs): void {
  const currentTimeMs = resolveCurrentTimeMs(args.audioElement);
  const rawSrc = args.audioElement?.currentSrc || args.audioElement?.src || args.fallbackAudioUrl || '';
  const mediaError = args.audioElement?.error || null;

  dispatchDiagnosticEvent('vdjv-audio-channel-play-diag', {
    stage: args.stage,
    phase: args.phase,
    channelId: args.channelId,
    commandToken: args.commandToken,
    nowMs: args.nowMs,
    contextState: args.audioContextState,
    contextUnlocked: args.contextUnlocked,
    graphConnected: args.graphConnected,
    hasSharedGain: args.hasSharedGain,
    pendingInitialSeekSec: args.pendingInitialSeekSec,
    audioCurrentTimeMs: currentTimeMs,
    audioPaused: args.audioElement ? args.audioElement.paused : null,
    audioReadyState: args.audioElement ? args.audioElement.readyState : null,
    audioNetworkState: args.audioElement ? args.audioElement.networkState : null,
    audioSrcScheme: resolveAudioSrcScheme(rawSrc),
    audioSrcLength: rawSrc ? rawSrc.length : 0,
    audioErrorCode: mediaError ? mediaError.code : null,
    audioErrorMessage: mediaError?.message || null,
    globalMuted: args.globalMuted,
    masterVolume: args.masterVolume,
    channelVolume: args.channelVolume,
    padVolume: args.padVolume,
    padGainLinear: args.padGainLinear,
    targetGain: args.targetGain,
    ...(args.extra || {}),
  });
}

export function emitChannelPlayDiagRuntime(
  stage: string,
  nowMs: number,
  channel: ChannelPlayDiagState,
  commandToken: number,
  phase: ChannelPlayDiagPhase,
  runtime: ChannelPlayDiagRuntimeState,
  extra: Record<string, unknown> = {}
): void {
  const padVolume = channel.pad
    ? Math.max(0, Math.min(1, Number.isFinite(channel.pad.volume) ? channel.pad.volume : 1))
    : null;
  const padGainLinear = channel.pad
    ? Math.max(0, Number.isFinite(channel.pad.padGainLinear) ? channel.pad.padGainLinear : 1)
    : null;
  const channelVolume = Math.max(0, Math.min(1, Number.isFinite(channel.channelVolume) ? channel.channelVolume : 1));

  emitChannelPlayDiagEvent({
    stage,
    phase,
    channelId: channel.channelId,
    commandToken,
    nowMs,
    audioElement: channel.audioElement,
    fallbackAudioUrl: channel.pad?.audioUrl || null,
    audioContextState: runtime.audioContextState,
    contextUnlocked: runtime.contextUnlocked,
    graphConnected: channel.graphConnected,
    hasSharedGain: runtime.hasSharedGain,
    pendingInitialSeekSec: channel.pendingInitialSeekSec,
    globalMuted: runtime.globalMuted,
    masterVolume: runtime.masterVolume,
    channelVolume,
    padVolume,
    padGainLinear,
    targetGain: runtime.targetGain,
    extra,
  });
}

export function emitChannelSeekDiagEvent(args: ChannelSeekDiagArgs): void {
  dispatchDiagnosticEvent('vdjv-audio-channel-seek-diag', {
    stage: args.stage,
    phase: args.phase,
    channelId: args.channelId,
    commandToken: args.commandToken,
    nowMs: args.nowMs,
    audioCurrentTimeMs: resolveCurrentTimeMs(args.audioElement),
    channelPlayheadMs: args.channelPlayheadMs,
    channelIsPlaying: args.channelIsPlaying,
    channelIsPaused: args.channelIsPaused,
    ...(args.detail || {}),
  });
}

export function emitChannelSeekDiagRuntime(
  stage: string,
  nowMs: number,
  channel: ChannelDiagBaseState,
  phase: ChannelSeekDiagPhase,
  detail: Record<string, unknown> = {}
): void {
  emitChannelSeekDiagEvent({
    stage,
    phase,
    channelId: channel.channelId,
    commandToken: channel.commandToken,
    nowMs,
    audioElement: channel.audioElement,
    channelPlayheadMs: channel.playheadMs,
    channelIsPlaying: channel.isPlaying,
    channelIsPaused: channel.isPaused,
    detail,
  });
}

export function emitChannelHotcueDiagEvent(args: ChannelHotcueDiagArgs): void {
  dispatchDiagnosticEvent('vdjv-audio-channel-hotcue-diag', {
    stage: args.stage,
    phase: args.phase,
    channelId: args.channelId,
    commandToken: args.commandToken,
    nowMs: args.nowMs,
    ...(args.detail || {}),
  });
}

export function emitChannelHotcueDiagRuntime(
  stage: string,
  nowMs: number,
  channel: ChannelDiagBaseState,
  phase: ChannelHotcueDiagPhase,
  detail: Record<string, unknown> = {}
): void {
  emitChannelHotcueDiagEvent({
    stage,
    phase,
    channelId: channel.channelId,
    commandToken: channel.commandToken,
    nowMs,
    detail,
  });
}

export function emitAudioEngineDisabledEvent(args: AudioEngineDisabledArgs): void {
  dispatchDiagnosticEvent('vdjv-audio-engine-disabled', {
    action: args.action,
    source: args.source,
    stage: args.stage,
  });
}

export function emitAudioEngineDisabledRuntime(
  stage: string,
  action: string,
  source: AudioDisabledSource
): void {
  emitAudioEngineDisabledEvent({
    action,
    source,
    stage,
  });
}
