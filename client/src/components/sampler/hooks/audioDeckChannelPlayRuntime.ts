export interface ChannelPlayAttemptResult {
  started: boolean;
  attempt: string;
  errorName?: string;
  errorMessage?: string;
}

interface ExecuteChannelPlayAttemptInput {
  attempt: string;
  isCommandCurrent: () => boolean;
  play: () => Promise<void>;
  onDiag: (
    phase: 'attempt' | 'attempt_ok' | 'attempt_fail',
    detail: Record<string, unknown>
  ) => void;
}

export const createInitialChannelPlayAttemptResult = (): ChannelPlayAttemptResult => ({
  started: false,
  attempt: 'not_started',
});

export const createStaleCommandChannelPlayAttemptResult = (attempt: string): ChannelPlayAttemptResult => ({
  started: false,
  attempt,
  errorName: 'stale_command_token',
  errorMessage: 'command token mismatch',
});

export const parseChannelPlayAttemptError = (error: unknown): { errorName: string; errorMessage: string } => {
  const errorName =
    typeof error === 'object' && error !== null && 'name' in error
      ? String((error as { name?: unknown }).name || 'play_error')
      : 'play_error';
  const errorMessage =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message?: unknown }).message || '')
      : String(error || '');
  return { errorName, errorMessage };
};

export const executeChannelPlayAttempt = async (
  input: ExecuteChannelPlayAttemptInput
): Promise<ChannelPlayAttemptResult> => {
  if (!input.isCommandCurrent()) {
    return createStaleCommandChannelPlayAttemptResult(input.attempt);
  }
  input.onDiag('attempt', { attempt: input.attempt });
  try {
    await input.play();
    input.onDiag('attempt_ok', { attempt: input.attempt });
    return { started: true, attempt: input.attempt };
  } catch (error) {
    const { errorName, errorMessage } = parseChannelPlayAttemptError(error);
    input.onDiag('attempt_fail', {
      attempt: input.attempt,
      errorName,
      errorMessage,
    });
    return {
      started: false,
      attempt: input.attempt,
      errorName,
      errorMessage,
    };
  }
};

export const shouldAttemptIOSSourceRehydrate = (
  isIOS: boolean,
  attempt: ChannelPlayAttemptResult
): boolean => !attempt.started && isIOS && attempt.errorName === 'NotSupportedError';

export const resolveExpectedChannelSourceUrl = (
  audioElement: HTMLAudioElement | null,
  padAudioUrl?: string | null
): string | undefined => (
  audioElement?.currentSrc ||
  audioElement?.src ||
  padAudioUrl ||
  undefined
);
