import type { StopMode } from './audioDeckRuntime';

export interface PadGroupSnapshotLike {
  bankId: string;
  padGroup?: number | null;
  padGroupUniversal?: boolean;
}

const VALID_GROUP_STOP_MODES: ReadonlySet<StopMode> = new Set(['instant', 'fadeout', 'brake', 'backspin', 'filter']);

export const normalizePadGroupValue = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const normalized = Math.trunc(value);
  return normalized > 0 ? normalized : null;
};

export const normalizePadGroupUniversalValue = (value: unknown): boolean => value === true;

export const resolvePadGroupStopMode = (value: unknown): StopMode => (
  typeof value === 'string' && VALID_GROUP_STOP_MODES.has(value as StopMode)
    ? value as StopMode
    : 'instant'
);

export const shouldStopPadForGroup = (
  targetPadId: string,
  target: PadGroupSnapshotLike,
  candidatePadId: string,
  candidate: PadGroupSnapshotLike
): boolean => {
  if (candidatePadId === targetPadId) return false;
  const targetGroup = normalizePadGroupValue(target.padGroup);
  if (targetGroup === null) return false;
  const candidateGroup = normalizePadGroupValue(candidate.padGroup);
  if (candidateGroup !== targetGroup) return false;
  if (normalizePadGroupUniversalValue(target.padGroupUniversal)) return true;
  return candidate.bankId === target.bankId;
};
