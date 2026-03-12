export interface PadData {
  id: string;
  name: string;
  audioUrl: string;
  audioStorageKey?: string; // Persistent media key for native storage recovery
  audioBackend?: 'native' | 'idb'; // Storage backend hint for hybrid persistence
  imageUrl?: string; // For pad image display
  imageStorageKey?: string; // Persistent image key for native storage recovery
  imageBackend?: 'native' | 'idb'; // Storage backend hint for hybrid persistence
  hasImageAsset?: boolean; // Persisted signal that this pad should have an image asset
  imageData?: string; // Base64 encoded image data for persistence
  shortcutKey?: string; // Optional keyboard shortcut
  midiNote?: number; // Optional MIDI note mapping
  midiCC?: number; // Optional MIDI CC mapping
  ignoreChannel?: boolean; // Deprecated compatibility field; no longer used for routing
  savedHotcuesMs?: [number | null, number | null, number | null, number | null];
  color: string;
  triggerMode: 'toggle' | 'hold' | 'stutter' | 'unmute';
  playbackMode: 'once' | 'loop' | 'stopper';
  volume: number;
  gainDb?: number; // Per-pad gain in dB (-24 to +24), default 0dB.
  gain?: number; // Legacy linear gain multiplier kept for backward compatibility.
  fadeInMs: number;
  fadeOutMs: number;
  startTimeMs: number;
  endTimeMs: number;
  pitch: number; // -12 to +12 semitones
  tempoPercent?: number; // Playback tempo change in percent (-50 to +100), 0 = original
  keyLock?: boolean; // Keep original key when tempo changes (media backend support)
  position: number; // For drag-and-drop ordering
  // Audio Engine V3 admission metadata
  audioBytes?: number; // File size in bytes (cached at upload/import)
  audioDurationMs?: number; // Duration in ms (cached at upload/import)
  audioRejectedReason?: 'size_limit' | 'duration_limit'; // Set when admission check fails
  contentOrigin?: 'user' | 'official_store' | 'official_admin'; // Ownership/provenance of this pad's content
  originBankId?: string; // Source official bank id for recovery/export policy
  originPadId?: string; // Source pad id inside the original bank
  originCatalogItemId?: string; // Store catalog item id used to recover official content
  originBankTitle?: string; // Human-friendly source bank title for repair messaging
  restoreAssetKind?: 'default_asset' | 'paid_asset' | 'custom_local_media';
  missingMediaExpected?: boolean; // Metadata snapshot says this pad needs manual media recovery on this device
  missingImageExpected?: boolean; // Metadata snapshot says the image is missing on this device
  sourcePadId?: string; // Source pad id from snapshot provenance used for later asset relink
  sourceCatalogItemId?: string; // Source paid catalog item used for later asset download/relink
}

export interface SamplerBank {
  id: string;
  name: string;
  defaultColor: string;
  pads: PadData[];
  createdAt: Date;
  sortOrder: number; // For bank ordering
  sourceBankId?: string; // Original bank id from import file (for duplicate blocking)
  isLocalDuplicate?: boolean; // Local clone that should not be auto-collapsed by identity dedupe
  duplicateOriginBankId?: string; // Source local bank id used to create this duplicate
  shortcutKey?: string; // Optional keyboard shortcut for bank selection
  midiNote?: number; // Optional MIDI note mapping
  midiCC?: number; // Optional MIDI CC mapping
  // New fields for admin bank management
  isAdminBank?: boolean; // Whether this is an admin-exported bank
  transferable?: boolean; // Whether pads can be transferred from this bank
  exportable?: boolean; // Whether this bank can be exported
  containsOfficialContent?: boolean; // Derived marker used to disable community export
  exportRestrictionReason?: 'official_bank' | 'mixed_official' | null; // Why export is blocked
  officialTransferAcknowledged?: boolean; // One-time confirmation state for mixed official content
  bankMetadata?: BankMetadata; // Metadata for admin banks
  creatorEmail?: string; // Email of the user who created/exported the bank
  disableDefaultPadShortcutLayout?: boolean; // Prevent automatic pad shortcut re-apply for this bank
  disableDefaultBankShortcutLayout?: boolean; // Prevent automatic bank shortcut auto-fill for this bank
  restoreKind?: 'default_bank' | 'paid_bank' | 'custom_bank';
  restoreStatus?: 'ready' | 'needs_download' | 'missing_media' | 'partially_restored';
  remoteSnapshotApplied?: boolean; // Restored from cloud metadata snapshot on this device
}

export interface BankMetadata {
  password: boolean; // Whether the bank is password protected
  transferable: boolean; // Deprecated compatibility field. Official/admin banks are always transferable.
  exportable?: boolean; // Whether export is allowed for this bank
  adminExportToken?: string; // Optional signed admin-export token for quota trust verification
  adminExportTokenKid?: string; // Key id used to sign adminExportToken
  adminExportTokenIssuedAt?: string; // ISO issuance time for adminExportToken
  adminExportTokenExpiresAt?: string; // ISO expiration time for adminExportToken
  adminExportTokenBankSha256?: string; // SHA-256 of bank.json used during token signing
  trustedAdminExport?: boolean; // Runtime flag set only after local signature verification
  entitlementToken?: string; // Optional user-bound entitlement token (signed) for access verification
  entitlementTokenKid?: string; // Key id used to sign entitlement token
  entitlementTokenIssuedAt?: string; // ISO issuance time for entitlement token
  entitlementTokenExpiresAt?: string; // ISO expiration time for entitlement token
  entitlementTokenVerified?: boolean; // Runtime flag set after local entitlement token verification
  bankId?: string; // UUID from database for admin banks
  catalogItemId?: string; // Store catalog item id used for secure redownload
  catalogSha256?: string; // Optional expected SHA-256 for store asset integrity checks
  title?: string; // Bank title from database
  description?: string; // Bank description from database
  color?: string; // Optional bank color override
  thumbnailUrl?: string; // Store catalog thumbnail URL for visual display
  thumbnailStorageKey?: string; // Persistent offline thumbnail media key
  thumbnailBackend?: 'native' | 'idb'; // Storage backend hint for offline thumbnail recovery
  thumbnailAssetPath?: string; // Embedded thumbnail file path inside .bank archive
  hideThumbnailPreview?: boolean; // Hide thumbnail in bank list and show color-only preview
  defaultBankSource?: 'assets' | 'remote'; // Active source for the built-in default bank
  defaultBankReleaseVersion?: number; // Version of the installed remote default-bank release
  defaultBankReleasePublishedAt?: string; // Publication timestamp for the remote default-bank release
  defaultBankReleaseSha256?: string; // Integrity hash for the installed remote default-bank release
  remoteSnapshotThumbnailUrl?: string; // Lightweight thumbnail copied from remote metadata snapshot
}

export interface AdminBank {
  id: string; // UUID from database
  title: string;
  description?: string;
  color?: string;
  created_by: string;
  created_at: string;
  derived_key: string;
}

export interface UserBankAccess {
  id: string;
  user_id: string;
  bank_id: string;
  granted_at: string;
}

export type StopMode = 'fadeout' | 'brake' | 'backspin' | 'filter' | 'instant';

export interface PlayingPadInfo {
  padId: string;
  padName: string;
  bankId: string;
  bankName: string;
  audioUrl?: string;
  color: string;
  volume: number;
  effectiveVolume?: number; // Runtime volume that may differ from original
  currentMs?: number; // Current playback position
  endMs?: number; // Total duration
  playStartTime?: number;
  tempoRate?: number;
  playbackMode?: 'once' | 'loop' | 'stopper';
  timingSource?: 'date' | 'performance';
  channelId?: number | null;
}

export interface ChannelState {
  channelId: number;
  channelVolume: number;
  pad: PlayingPadInfo | null;
}

export interface ChannelLoadedPadRef {
  bankId: string;
  padId: string;
}

export interface ChannelDeckState {
  channelId: number;
  loadedPadRef: ChannelLoadedPadRef | null;
  isPlaying: boolean;
  isPaused: boolean;
  playheadMs: number;
  durationMs: number;
  channelVolume: number;
  hotcuesMs: [number | null, number | null, number | null, number | null];
  hasLocalHotcueOverride: boolean;
  collapsed: boolean;
  waveformKey: string | null;
  pad: PlayingPadInfo | null;
}

export interface AudioControls {
  stop: () => void;
  setMuted: (muted: boolean) => void;
  fadeOutStop: () => void;
  brakeStop: () => void;
  backspinStop: () => void;
  filterStop: () => void;
}
