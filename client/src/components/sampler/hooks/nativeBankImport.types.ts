export interface NativeAndroidStoreImportSource {
  kind: 'android-store';
  signedUrl: string;
  bankId: string;
  catalogItemId: string;
  fileName?: string;
  expectedSha256?: string;
}

export interface NativeAndroidSharedImportSource {
  kind: 'android-shared-uri';
  uri: string;
  displayName?: string;
  size?: number | null;
}

export interface NativeElectronStoreImportSource {
  kind: 'electron-store';
  signedUrl: string;
  bankId: string;
  catalogItemId: string;
  fileName?: string;
  expectedSha256?: string;
}

export interface SegmentedStoreImportSource {
  kind: 'segmented-store';
  catalogItemId: string;
  bankId: string;
  variantId: string;
  fileName?: string;
  fileSizeBytes?: number | null;
  derivedKey?: string | null;
  entitlementToken?: string | null;
  entitlementTokenKid?: string | null;
  entitlementTokenIssuedAt?: string | null;
  entitlementTokenExpiresAt?: string | null;
  manifest: {
    downloadUrl: string;
    urlExpiresAt?: string | null;
  };
  parts: Array<{
    partIndex: number;
    storageBucket: string;
    storageKey: string;
    fileSizeBytes: number;
    sha256?: string | null;
    padStartIndex: number;
    padEndIndex: number;
    downloadUrl: string;
    urlExpiresAt?: string | null;
  }>;
}

export type ImportBankSource =
  | File
  | NativeAndroidStoreImportSource
  | NativeAndroidSharedImportSource
  | NativeElectronStoreImportSource
  | SegmentedStoreImportSource;

export const isNativeAndroidStoreImportSource = (value: unknown): value is NativeAndroidStoreImportSource =>
  Boolean(
    value &&
    typeof value === 'object' &&
    (value as { kind?: string }).kind === 'android-store' &&
    typeof (value as { signedUrl?: string }).signedUrl === 'string'
  );

export const isNativeAndroidSharedImportSource = (value: unknown): value is NativeAndroidSharedImportSource =>
  Boolean(
    value &&
    typeof value === 'object' &&
    (value as { kind?: string }).kind === 'android-shared-uri' &&
    typeof (value as { uri?: string }).uri === 'string'
  );

export const isNativeElectronStoreImportSource = (value: unknown): value is NativeElectronStoreImportSource =>
  Boolean(
    value &&
    typeof value === 'object' &&
    (value as { kind?: string }).kind === 'electron-store' &&
    typeof (value as { signedUrl?: string }).signedUrl === 'string'
  );

export const isSegmentedStoreImportSource = (value: unknown): value is SegmentedStoreImportSource =>
  Boolean(
    value &&
    typeof value === 'object' &&
    (value as { kind?: string }).kind === 'segmented-store' &&
    typeof (value as { catalogItemId?: string }).catalogItemId === 'string' &&
    typeof (value as { variantId?: string }).variantId === 'string' &&
    Array.isArray((value as { parts?: unknown[] }).parts)
  );
