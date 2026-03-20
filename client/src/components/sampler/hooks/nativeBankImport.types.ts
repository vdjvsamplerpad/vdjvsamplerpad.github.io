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

export type ImportBankSource =
  | File
  | NativeAndroidStoreImportSource
  | NativeAndroidSharedImportSource
  | NativeElectronStoreImportSource;

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
