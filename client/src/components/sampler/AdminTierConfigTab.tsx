import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChevronDown, ChevronUp, Loader2, Plus, Save, Search } from 'lucide-react';
import {
  adminApi,
  type AdminAccountTierConfig,
  type AdminVoucherCampaign,
  type SortDirection,
} from '@/lib/admin-api';
import {
  type AccountTierUiContent,
  type EditableAccountTier,
  normalizeTierUiContent,
} from '@/lib/account-tier-content';
import { ACCOUNT_CAPABILITIES_CACHE_KEY } from '@/lib/account-capabilities';
import type { AdminDialogTheme } from './AdminAccessDialog.shared';
import {
  AdminControlsBar,
  AdminPageScaffold,
  AdminRefreshButton,
  AdminSectionTabs,
  AdminStatsStrip,
  AdminTierConfigLoadingSkeleton,
  AdminToolbar,
} from './AdminAccessDialog.layout';
import { SortHeader } from './AdminAccessDialog.widgets';

type AccountAdminSection = 'vouchers' | 'tiers';

interface TierDraft {
  displayName: string;
  description: string;
  pricePhp: string;
  pricePromoDiscountPercent: string;
  uiContent: AccountTierUiContent;
  limitsJson: string;
  featuresJson: string;
  isActive: boolean;
}

interface AdminTierConfigTabProps {
  panelClass: string;
  cardClass: string;
  theme?: AdminDialogTheme;
  mode?: 'all' | 'tiers' | 'vouchers';
  versionTabs?: React.ReactNode;
  embedded?: boolean;
  externalSaveSignal?: number;
  externalRefreshSignal?: number;
  onTierConfigStateChange?: (state: { dirty: boolean; saving: boolean; loading: boolean }) => void;
  pushNotice: (kind: 'success' | 'error' | 'info', message: string) => void;
}

const formatDateTime = (value?: string | null): string => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

const getTierPromoDiscountPercent = (limits: Record<string, unknown> | null | undefined): number => {
  const raw = limits?.pricePromoDiscountPercent ?? limits?.price_promo_discount_percent;
  const value = Number(raw);
  if (!Number.isFinite(value)) return 30;
  return Math.min(90, Math.max(0, Math.round(value)));
};

const LIMIT_KEY_ALIASES: Record<string, string> = {
  defaultBankDailyPlays: 'default_bank_daily_plays',
  ownedBankQuota: 'owned_bank_quota',
  ownedBankPadCap: 'owned_bank_pad_cap',
  deviceTotalBankCap: 'device_total_bank_cap',
  deckCount: 'deck_count',
};

const FEATURE_KEY_ALIASES: Record<string, string> = {
  bankStoreBrowse: 'bank_store_browse',
  bankStoreCheckout: 'bank_store_checkout',
  bankStoreDownload: 'bank_store_download',
  bankStoreFreeClaim: 'bank_store_free_claim',
  bankStoreAllAccess: 'bank_store_all_access',
  inputMapping: 'input_mapping',
  systemShortcuts: 'system_shortcuts',
  channelShortcuts: 'channel_shortcuts',
  mappingImportExport: 'mapping_import_export',
  backupRepair: 'backup_repair',
  advancedStopModes: 'advanced_stop_modes',
  mixerHotcue: 'mixer_hotcue',
  padEditGroup: 'pad_edit_group',
  padEditTempo: 'pad_edit_tempo',
  padEditKeyboardMidi: 'pad_edit_keyboard_midi',
  padEditHotcue: 'pad_edit_hotcue',
  padEditFades: 'pad_edit_fades',
  bankEditPosition: 'bank_edit_position',
  bankEditKeyboardMidi: 'bank_edit_keyboard_midi',
  storeDemoBanks: 'store_demo_banks',
  ownBankUnlimitedPlay: 'own_bank_unlimited_play',
};

const UPGRADE_OPTIONS_CACHE_PREFIXES = [
  'vdjv-account-upgrade-options-v1',
  'vdjv-account-upgrade-options-v2',
  'vdjv-account-upgrade-options-v3',
];
const CAPABILITY_CACHE_PREFIXES = [
  'vdjv-account-capabilities-v1',
  'vdjv-account-capabilities-v2',
  'vdjv-account-capabilities-v3',
  ACCOUNT_CAPABILITIES_CACHE_KEY,
];

const getAliasedValue = (source: Record<string, unknown>, key: string): unknown =>
  source[key] ?? source[LIMIT_KEY_ALIASES[key]] ?? source[FEATURE_KEY_ALIASES[key]];

const toCamelLimitObject = (limits: Record<string, unknown>): Record<string, unknown> => {
  const next: Record<string, unknown> = { ...limits };
  for (const key of Object.keys(LIMIT_KEY_ALIASES)) {
    const value = getAliasedValue(limits, key);
    if (value !== undefined) next[key] = value;
    delete next[LIMIT_KEY_ALIASES[key]];
  }
  return next;
};

const toCamelFeatureObject = (features: Record<string, unknown>): Record<string, boolean> => {
  const next: Record<string, boolean> = {};
  for (const [key] of COMMON_FEATURE_FIELDS) {
    next[key] = getAliasedValue(features, key) === true;
  }
  return next;
};

const toSnakeLimitObject = (limits: Record<string, unknown>): Record<string, unknown> => {
  const next: Record<string, unknown> = {};
  for (const [key, snakeKey] of Object.entries(LIMIT_KEY_ALIASES)) {
    const value = getAliasedValue(limits, key);
    if (value !== undefined) next[snakeKey] = value;
  }
  const promoValue = limits.pricePromoDiscountPercent ?? limits.price_promo_discount_percent;
  if (promoValue !== undefined) next.price_promo_discount_percent = promoValue;
  return next;
};

const toSnakeFeatureObject = (features: Record<string, unknown>): Record<string, boolean> => {
  const next: Record<string, boolean> = {};
  for (const [key] of COMMON_FEATURE_FIELDS) {
    const snakeKey = FEATURE_KEY_ALIASES[key] || key;
    next[snakeKey] = getAliasedValue(features, key) === true;
  }
  return next;
};

const buildTierDraft = (tier: AdminAccountTierConfig): TierDraft => {
  const limits = toCamelLimitObject(tier.limits || {});
  const features = toCamelFeatureObject(tier.features || {});
  return {
    displayName: tier.display_name || tier.tier,
    description: tier.description || '',
    pricePhp: String(tier.price_php ?? 0),
    pricePromoDiscountPercent: tier.tier === 'free' ? '0' : String(getTierPromoDiscountPercent(limits)),
    uiContent: normalizeTierUiContent(tier.ui_content, tier.tier),
    limitsJson: JSON.stringify(limits, null, 2),
    featuresJson: JSON.stringify(features, null, 2),
    isActive: tier.is_active !== false,
  };
};

const COMMON_LIMIT_FIELDS = [
  ['defaultBankDailyPlays', 'Default plays/day'],
  ['ownedBankQuota', 'Owned banks'],
  ['ownedBankPadCap', 'Pads per owned bank'],
  ['deviceTotalBankCap', 'Total banks/device'],
  ['deckCount', 'Deck channels'],
] as const;

const COMMON_FEATURE_FIELDS = [
  ['bankStoreBrowse', 'Store browse'],
  ['bankStoreCheckout', 'Store checkout'],
  ['bankStoreDownload', 'Store download'],
  ['bankStoreFreeClaim', 'Free promotions'],
  ['bankStoreAllAccess', 'Legacy all-store flag'],
  ['search', 'Search'],
  ['inputMapping', 'Input mapping'],
  ['systemShortcuts', 'System shortcuts'],
  ['channelShortcuts', 'Channel shortcuts'],
  ['mappingImportExport', 'Mapping import/export'],
  ['backupRepair', 'Backup & repair'],
  ['advancedStopModes', 'Advanced stop modes'],
  ['mixerHotcue', 'Mixer hotcue'],
  ['padEditGroup', 'Pad group edit'],
  ['padEditTempo', 'Pad tempo edit'],
  ['padEditKeyboardMidi', 'Pad keyboard/MIDI'],
  ['padEditHotcue', 'Pad hotcue'],
  ['padEditFades', 'Pad fades'],
  ['bankEditPosition', 'Bank position edit'],
  ['bankEditKeyboardMidi', 'Bank keyboard/MIDI'],
  ['storeDemoBanks', 'Store demo banks'],
  ['ownBankUnlimitedPlay', 'Own-bank unlimited play'],
] as const;

const parseJsonObject = (value: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
};

const clearTierRuntimeCaches = () => {
  if (typeof window === 'undefined') return;
  try {
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (!key) continue;
      if (
        UPGRADE_OPTIONS_CACHE_PREFIXES.some((prefix) => key.startsWith(`${prefix}:`)) ||
        CAPABILITY_CACHE_PREFIXES.some((prefix) => key.startsWith(`${prefix}:`))
      ) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
  }
  window.dispatchEvent(new Event('vdjv-account-tier-config-updated'));
};

const TIER_ORDER: Array<AdminAccountTierConfig['tier']> = ['free', 'pro', 'pro_max'];

const moveArrayItem = <T,>(rows: T[], index: number, delta: -1 | 1): T[] => {
  const target = index + delta;
  if (target < 0 || target >= rows.length) return rows;
  const next = [...rows];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
};

const createFallbackTierConfig = (tier: EditableAccountTier): AdminAccountTierConfig => ({
  tier,
  display_name: tier === 'pro_max' ? 'PRO MAX' : tier.toUpperCase(),
  description: '',
  price_php: 0,
  limits: {},
  features: {},
  ui_content: null,
  is_active: true,
});

export function AdminTierConfigTab({
  panelClass,
  cardClass,
  theme = 'light',
  mode = 'all',
  versionTabs,
  embedded = false,
  externalSaveSignal = 0,
  externalRefreshSignal = 0,
  onTierConfigStateChange,
  pushNotice,
}: AdminTierConfigTabProps) {
  const [loading, setLoading] = React.useState(false);
  const [savingTier, setSavingTier] = React.useState<string | null>(null);
  const [savingAllTiers, setSavingAllTiers] = React.useState(false);
  const [voucherBusyId, setVoucherBusyId] = React.useState<string | null>(null);
  const [tierConfigs, setTierConfigs] = React.useState<AdminAccountTierConfig[]>([]);
  const [tierDrafts, setTierDrafts] = React.useState<Record<string, TierDraft>>({});
  const [hasUnsavedTierChanges, setHasUnsavedTierChanges] = React.useState(false);
  const [voucherCampaigns, setVoucherCampaigns] = React.useState<AdminVoucherCampaign[]>([]);
  const [campaignName, setCampaignName] = React.useState('');
  const [campaignTargetTier, setCampaignTargetTier] = React.useState<'pro' | 'pro_max'>('pro');
  const [campaignMaxCodes, setCampaignMaxCodes] = React.useState('1');
  const [campaignExpiresAt, setCampaignExpiresAt] = React.useState('');
  const [campaignTargetEmail, setCampaignTargetEmail] = React.useState('');
  const [campaignNotes, setCampaignNotes] = React.useState('');
  const [voucherSearch, setVoucherSearch] = React.useState('');
  const [voucherStatusFilter, setVoucherStatusFilter] = React.useState<'all' | 'active' | 'inactive'>('all');
  const [voucherSortBy, setVoucherSortBy] = React.useState<'name' | 'tier' | 'used' | 'expires_at' | 'target'>('expires_at');
  const [voucherSortDir, setVoucherSortDir] = React.useState<SortDirection>('asc');
  const [createVoucherOpen, setCreateVoucherOpen] = React.useState(false);
  const [revokeCampaign, setRevokeCampaign] = React.useState<AdminVoucherCampaign | null>(null);
  const [activeSection, setActiveSection] = React.useState<AccountAdminSection>(mode === 'tiers' ? 'tiers' : 'vouchers');
  const pushNoticeRef = React.useRef(pushNotice);
  const hasUnsavedTierChangesRef = React.useRef(false);

  React.useEffect(() => {
    pushNoticeRef.current = pushNotice;
  }, [pushNotice]);

  React.useEffect(() => {
    hasUnsavedTierChangesRef.current = hasUnsavedTierChanges;
  }, [hasUnsavedTierChanges]);

  const loadData = React.useCallback(async (options?: { preserveDirtyDrafts?: boolean }) => {
    setLoading(true);
    try {
      const [tiersResult, vouchersResult] = await Promise.all([
        adminApi.listAccountTierConfigs(),
        adminApi.listVoucherCampaigns(),
      ]);
      const nextTierConfigs = tiersResult.tiers || [];
      const nextDrafts = Object.fromEntries(nextTierConfigs.map((tier) => [tier.tier, buildTierDraft(tier)]));
      setTierConfigs(nextTierConfigs);
      setTierDrafts((current) => (
        options?.preserveDirtyDrafts && hasUnsavedTierChangesRef.current && Object.keys(current).length
          ? current
          : nextDrafts
      ));
      setVoucherCampaigns(vouchersResult.campaigns || []);
      if (!options?.preserveDirtyDrafts) setHasUnsavedTierChanges(false);
    } catch (error) {
      pushNoticeRef.current('error', error instanceof Error ? error.message : 'Failed to load account upgrades.');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadData({ preserveDirtyDrafts: true });
  }, [loadData]);

  const updateTierDraft = (tier: string, patch: Partial<TierDraft>) => {
    setHasUnsavedTierChanges(true);
    const normalizedTier = tier === 'pro' || tier === 'pro_max' ? tier : 'free';
    setTierDrafts((current) => ({
      ...current,
      [tier]: {
        ...(current[tier] || buildTierDraft(createFallbackTierConfig(normalizedTier))),
        ...patch,
      },
    }));
  };

  const updateTierLimit = (tier: string, key: string, value: string) => {
    const draft = tierDrafts[tier];
    const limits = parseJsonObject(draft?.limitsJson || '{}');
    const numberValue = Number(value);
    limits[key] = Number.isFinite(numberValue) ? numberValue : 0;
    updateTierDraft(tier, { limitsJson: JSON.stringify(limits, null, 2) });
  };

  const updateTierFeature = (tier: string, key: string, checked: boolean) => {
    const draft = tierDrafts[tier];
    const features = parseJsonObject(draft?.featuresJson || '{}');
    features[key] = checked;
    updateTierDraft(tier, { featuresJson: JSON.stringify(features, null, 2) });
  };

  const updateTierContent = (tier: EditableAccountTier, patch: Partial<AccountTierUiContent>) => {
    const current = tierDrafts[tier] || buildTierDraft(tierConfigs.find((row) => row.tier === tier) || {
      ...createFallbackTierConfig(tier),
    });
    updateTierDraft(tier, {
      uiContent: {
        ...current.uiContent,
        ...patch,
      },
    });
  };

  const updateContentRow = <T extends { title?: string } | string>(
    tier: EditableAccountTier,
    key: 'shortDescriptions' | 'otherDescriptions' | 'checklist' | 'inclusions',
    rows: T[],
  ) => {
    updateTierContent(tier, { [key]: rows } as Partial<AccountTierUiContent>);
  };

  const moveContentRow = (
    tier: EditableAccountTier,
    key: 'checklist' | 'inclusions',
    index: number,
    delta: -1 | 1,
  ) => {
    const draft = tierDrafts[tier] || buildTierDraft(tierConfigs.find((row) => row.tier === tier) || createFallbackTierConfig(tier));
    if (key === 'checklist') {
      updateContentRow(tier, 'checklist', moveArrayItem(draft.uiContent.checklist, index, delta));
      return;
    }
    updateContentRow(tier, 'inclusions', moveArrayItem(draft.uiContent.inclusions, index, delta));
  };

  const uploadTierVideo = async (tier: EditableAccountTier, file: File | null) => {
    if (!file) return;
    if (!/^video\//i.test(file.type) && !/\.(mp4|webm|mov|m4v)$/i.test(file.name)) {
      pushNotice('error', 'Tier video must be MP4, WEBM, MOV, or M4V.');
      return;
    }
    setSavingTier(`${tier}:video`);
    try {
      const started = await adminApi.startTierVideoUpload({
        tier,
        fileName: file.name,
        contentType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
      });
      const uploadResponse = await fetch(started.uploadUrl, {
        method: started.uploadMethod,
        headers: started.uploadHeaders,
        body: file,
      });
      if (!uploadResponse.ok) {
        await adminApi.completeTierVideoUpload({
          tier,
          sessionId: started.sessionId,
          status: 'failed',
          failureReason: `UPLOAD_HTTP_${uploadResponse.status}`,
        }).catch(() => undefined);
        throw new Error(`Video upload failed: HTTP ${uploadResponse.status}`);
      }
      const completed = await adminApi.completeTierVideoUpload({
        tier,
        sessionId: started.sessionId,
        status: 'success',
        etag: uploadResponse.headers.get('etag') || undefined,
      });
      const draft = tierDrafts[tier] || buildTierDraft(tierConfigs.find((row) => row.tier === tier) || createFallbackTierConfig(tier));
      updateTierDraft(tier, {
        uiContent: {
          ...draft.uiContent,
          video: {
            storageProvider: 'r2',
            storageBucket: completed.video.storageBucket,
            storageKey: completed.video.storageKey,
            assetName: completed.video.assetName,
          },
        },
      });
      pushNotice('success', 'Tier video uploaded. Save the tier to publish it.');
    } catch (error) {
      pushNotice('error', error instanceof Error ? error.message : 'Tier video upload failed.');
    } finally {
      setSavingTier(null);
    }
  };

  const saveOneTierConfig = async (tier: AdminAccountTierConfig['tier']) => {
    const draft = tierDrafts[tier];
    if (!draft) return;
    const pricePhp = Number(draft.pricePhp);
    const limits = parseJsonObject(draft.limitsJson);
    const promoPercent = Number(draft.pricePromoDiscountPercent);
    limits.pricePromoDiscountPercent = tier === 'free'
      ? 0
      : Math.min(90, Math.max(0, Math.round(Number.isFinite(promoPercent) ? promoPercent : 30)));
    const features = parseJsonObject(draft.featuresJson);
    const expectedUiContent = normalizeTierUiContent(draft.uiContent, tier);
    const saved = await adminApi.saveAccountTierConfig({
      tier,
      displayName: draft.displayName,
      description: draft.description,
      pricePhp: Number.isFinite(pricePhp) ? pricePhp : 0,
      limits: toSnakeLimitObject(limits),
      features: toSnakeFeatureObject(features),
      uiContent: expectedUiContent,
      isActive: draft.isActive,
    });
    const returnedUiContent = normalizeTierUiContent(saved.tier?.ui_content, tier);
    if (JSON.stringify(returnedUiContent) !== JSON.stringify(expectedUiContent)) {
      throw new Error(`${tier.toUpperCase()} UI content did not persist. Refresh and try again.`);
    }
  };

  const saveAllTierConfigs = async () => {
    setSavingAllTiers(true);
    setSavingTier('all');
    try {
      const tiersToSave = TIER_ORDER.filter((tier) => tierDrafts[tier]);
      for (const tier of tiersToSave) {
        await saveOneTierConfig(tier);
      }
      clearTierRuntimeCaches();
      setHasUnsavedTierChanges(false);
      pushNoticeRef.current('success', `Saved ${tiersToSave.length} tier configuration${tiersToSave.length === 1 ? '' : 's'}.`);
      await loadData({ preserveDirtyDrafts: false });
    } catch (error) {
      pushNoticeRef.current('error', error instanceof Error ? error.message : 'Tier config save failed.');
    } finally {
      setSavingTier(null);
      setSavingAllTiers(false);
    }
  };

  const createVoucherCampaign = async () => {
    const name = campaignName.trim();
    if (!name) {
      pushNotice('error', 'Voucher campaign name is required.');
      return;
    }
    const maxCodes = Math.max(1, Math.floor(Number(campaignMaxCodes) || 1));
    setVoucherBusyId('create');
    try {
      await adminApi.createVoucherCampaign({
        name,
        targetTier: campaignTargetTier,
        maxCodes,
        expiresAt: campaignExpiresAt || null,
        targetEmail: campaignTargetEmail.trim() || null,
        notes: campaignNotes.trim() || null,
      });
      setCampaignName('');
      setCampaignMaxCodes('1');
      setCampaignExpiresAt('');
      setCampaignTargetEmail('');
      setCampaignNotes('');
      setCreateVoucherOpen(false);
      pushNotice('success', 'Voucher campaign created.');
      await loadData();
    } catch (error) {
      pushNotice('error', error instanceof Error ? error.message : 'Voucher campaign create failed.');
    } finally {
      setVoucherBusyId(null);
    }
  };

  const copyNextVoucher = async (campaign: AdminVoucherCampaign) => {
    setVoucherBusyId(campaign.id);
    try {
      const result = await adminApi.copyNextVoucher(campaign.id);
      const code = result.code || '';
      if (navigator.clipboard && code) {
        await navigator.clipboard.writeText(code);
      }
      pushNotice('success', code ? `Voucher copied: ${code}` : 'Voucher created.');
      await loadData();
    } catch (error) {
      pushNotice('error', error instanceof Error ? error.message : 'Copy next voucher failed.');
    } finally {
      setVoucherBusyId(null);
    }
  };

  const revokeLatestVoucher = async (campaign: AdminVoucherCampaign) => {
    setVoucherBusyId(`revoke:${campaign.id}`);
    try {
      await adminApi.revokeLatestVoucher(campaign.id);
      pushNotice('success', 'Latest unused voucher revoked. You can copy a replacement code.');
      await loadData();
    } catch (error) {
      pushNotice('error', error instanceof Error ? error.message : 'Voucher revoke failed.');
    } finally {
      setVoucherBusyId(null);
    }
  };

  const tierStats = React.useMemo(() => {
    const activeTiers = tierConfigs.filter((tier) => tier.is_active !== false).length;
    const liveCampaigns = voucherCampaigns.filter((campaign) => campaign.is_active).length;
    const reservedCodes = voucherCampaigns.reduce((sum, campaign) => sum + Number(campaign.reserved_count || 0), 0);
    const redeemedCodes = voucherCampaigns.reduce((sum, campaign) => sum + Number(campaign.redeemed_count || 0), 0);
    return [
      { label: 'Active Tiers', value: activeTiers, detail: `${tierConfigs.length} configured`, toneClass: 'text-violet-500' },
      { label: 'Voucher Campaigns', value: voucherCampaigns.length, detail: `${liveCampaigns} live`, toneClass: 'text-fuchsia-500' },
      { label: 'Reserved Codes', value: reservedCodes, detail: 'Issued once via copy-next', toneClass: 'text-amber-500' },
      { label: 'Redeemed Codes', value: redeemedCodes, detail: 'Single-use activations', toneClass: 'text-emerald-500' },
    ];
  }, [tierConfigs, voucherCampaigns]);

  const resolvedActiveSection: AccountAdminSection = mode === 'tiers'
    ? 'tiers'
    : mode === 'vouchers'
      ? 'vouchers'
      : activeSection;
  const filteredVoucherCampaigns = React.useMemo(() => {
    const needle = voucherSearch.trim().toLowerCase();
    const filtered = voucherCampaigns.filter((campaign) => {
      if (voucherStatusFilter === 'active' && !campaign.is_active) return false;
      if (voucherStatusFilter === 'inactive' && campaign.is_active) return false;
      if (!needle) return true;
      return [
        campaign.name,
        campaign.target_tier,
        campaign.target_email,
        campaign.target_user_id,
        campaign.notes,
      ].some((value) => String(value || '').toLowerCase().includes(needle));
    });
    const sorted = [...filtered].sort((left, right) => {
      if (voucherSortBy === 'name') return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
      if (voucherSortBy === 'tier') return left.target_tier.localeCompare(right.target_tier, undefined, { sensitivity: 'base' });
      if (voucherSortBy === 'used') {
        const leftRatio = Number(left.redeemed_count || 0) / Math.max(1, Number(left.max_codes || 1));
        const rightRatio = Number(right.redeemed_count || 0) / Math.max(1, Number(right.max_codes || 1));
        return leftRatio - rightRatio;
      }
      if (voucherSortBy === 'target') {
        return String(left.target_email || left.target_user_id || '').localeCompare(String(right.target_email || right.target_user_id || ''), undefined, { sensitivity: 'base' });
      }
      const leftTime = left.expires_at ? new Date(left.expires_at).getTime() : Number.POSITIVE_INFINITY;
      const rightTime = right.expires_at ? new Date(right.expires_at).getTime() : Number.POSITIVE_INFINITY;
      return leftTime - rightTime;
    });
    return voucherSortDir === 'asc' ? sorted : sorted.reverse();
  }, [voucherCampaigns, voucherSearch, voucherSortBy, voucherSortDir, voucherStatusFilter]);
  const toggleVoucherSort = (next: typeof voucherSortBy) => {
    if (voucherSortBy === next) {
      setVoucherSortDir((current) => current === 'asc' ? 'desc' : 'asc');
      return;
    }
    setVoucherSortBy(next);
    setVoucherSortDir(next === 'expires_at' ? 'asc' : 'desc');
  };

  const renderV1PortraitVideoConfig = () => {
    const draft = tierDrafts.free || buildTierDraft(tierConfigs.find((row) => row.tier === 'free') || createFallbackTierConfig('free'));
    return (
      <div className={`mb-3 rounded-lg border p-3 ${cardClass}`}>
        <div className="mb-2">
          <div className="text-sm font-semibold">V1 Portrait Video</div>
          <div className="text-xs text-gray-500">Used by the V1 mobile pricing preview and upgrade dialog. Upload publishes through the FREE tier video slot for backward compatibility.</div>
        </div>
        <Input
          value={draft.uiContent.video.src || ''}
          onChange={(event) => updateTierContent('free', {
            video: {
              src: event.target.value,
              storageProvider: 'local',
              storageBucket: null,
              storageKey: null,
              assetName: null,
            },
          })}
          className="mb-2 h-8 text-xs"
          placeholder="/assets/v1-preview.mp4 or signed URL fallback"
        />
        <Input
          type="file"
          accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.m4v"
          onChange={(event) => {
            const file = event.target.files?.[0] || null;
            void uploadTierVideo('free', file);
            event.currentTarget.value = '';
          }}
          className="h-9 text-xs"
          disabled={savingTier === 'free:video'}
        />
        {draft.uiContent.video.storageKey && (
          <div className="mt-1 truncate text-[11px] text-gray-500" title={draft.uiContent.video.storageKey}>
            R2: {draft.uiContent.video.storageKey}
          </div>
        )}
      </div>
    );
  };

  const tierSaveDisabled = savingAllTiers || !hasUnsavedTierChanges;
  const lastExternalSaveSignal = React.useRef(externalSaveSignal);
  const lastExternalRefreshSignal = React.useRef(externalRefreshSignal);

  React.useEffect(() => {
    if (mode !== 'tiers') return;
    onTierConfigStateChange?.({
      dirty: hasUnsavedTierChanges,
      saving: savingAllTiers,
      loading,
    });
  }, [hasUnsavedTierChanges, loading, mode, onTierConfigStateChange, savingAllTiers]);

  React.useEffect(() => {
    if (mode !== 'tiers') return;
    if (lastExternalSaveSignal.current === externalSaveSignal) return;
    lastExternalSaveSignal.current = externalSaveSignal;
    void saveAllTierConfigs();
  }, [externalSaveSignal, mode]);

  React.useEffect(() => {
    if (mode !== 'tiers') return;
    if (lastExternalRefreshSignal.current === externalRefreshSignal) return;
    lastExternalRefreshSignal.current = externalRefreshSignal;
    void loadData();
  }, [externalRefreshSignal, loadData, mode]);

  return (
    <AdminPageScaffold
      embedded={embedded && mode === 'tiers'}
      panelClass={panelClass}
      title={mode === 'tiers' ? 'V1 Tier Config' : mode === 'vouchers' ? 'Vouchers' : 'Tier & Vouchers'}
      description={mode === 'tiers'
        ? 'Configure the V1 account pricing cards, capability limits, feature gates, and mobile portrait video.'
        : mode === 'vouchers'
          ? 'Issue one-time upgrade codes. Upgrade approvals stay unified under Account Requests.'
          : 'Configure account tiers and issue one-time upgrade codes from the same admin shell. Upgrade approvals stay unified under Account Requests.'}
      actions={(
        <>
          {mode === 'tiers' && !embedded ? (
            <Button
              type="button"
              size="sm"
              variant="success"
              onClick={() => void saveAllTierConfigs()}
              disabled={tierSaveDisabled}
              className="rounded-[14px]"
            >
              {savingAllTiers ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-2 h-3.5 w-3.5" />}
              {savingAllTiers ? 'Saving...' : 'Save Changes'}
            </Button>
          ) : null}
          {mode === 'vouchers' ? (
            <Button type="button" size="sm" variant="success" className="rounded-[14px]" onClick={() => setCreateVoucherOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              Create Campaign
            </Button>
          ) : null}
          {!embedded ? <AdminRefreshButton loading={loading} onClick={() => void loadData()} /> : null}
        </>
      )}
      stats={mode === 'tiers' ? null : <AdminStatsStrip items={tierStats} />}
      stickySave={mode === 'tiers' && !embedded ? {
        dirty: hasUnsavedTierChanges,
        saving: savingAllTiers,
        disabled: tierSaveDisabled,
        label: 'Save Changes',
        savingLabel: 'Saving V1...',
        message: 'Unsaved V1 tier edits are local until saved.',
        onSave: () => void saveAllTierConfigs(),
      } : undefined}
      controls={(
        mode === 'tiers' && !embedded ? versionTabs : mode === 'all' ? (
        <AdminControlsBar
          left={(
            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide opacity-70">Sections</div>
              <AdminSectionTabs
                sections={[
                  { key: 'vouchers', label: 'Vouchers' },
                  { key: 'tiers', label: 'Tier Config' },
                ]}
                active={activeSection}
                onChange={(next) => setActiveSection(next as AccountAdminSection)}
              />
            </div>
          )}
          right={(
            <div className="rounded-xl border px-3 py-2 text-xs bg-black/[0.02] dark:bg-white/[0.03]">
              Voucher plaintext is only shown once when copied. Revoke latest unused code to rotate safely.
            </div>
          )}
        />
        ) : null
      )}
    >

      {resolvedActiveSection === 'tiers' && (
      <div className={`rounded-lg border p-3 ${cardClass}`}>
        {loading ? (
          <AdminTierConfigLoadingSkeleton theme={theme} />
        ) : (
        <>
          {renderV1PortraitVideoConfig()}
          <div className="grid gap-3 lg:grid-cols-3">
          {tierConfigs.map((tier) => {
            const draft = tierDrafts[tier.tier] || buildTierDraft(tier);
            const limits = parseJsonObject(draft.limitsJson);
            const features = parseJsonObject(draft.featuresJson) as Record<string, unknown>;
            return (
              <div key={tier.tier} className="space-y-2 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold uppercase">{tier.tier.replace('_', ' ')}</div>
                  <Label className="flex items-center gap-2 text-xs">
                    <Checkbox
                      checked={draft.isActive}
                      onCheckedChange={(checked) => updateTierDraft(tier.tier, { isActive: checked === true })}
                    />
                    Active
                  </Label>
                </div>
                <Input value={draft.displayName} onChange={(event) => updateTierDraft(tier.tier, { displayName: event.target.value })} placeholder="Display name" />
                <Input value={draft.pricePhp} onChange={(event) => updateTierDraft(tier.tier, { pricePhp: event.target.value })} placeholder="Price PHP" inputMode="numeric" />
                <div className="grid grid-cols-[auto_1fr] items-center gap-2 rounded-md border px-3 py-2 text-xs">
                  <input
                    type="color"
                    value={draft.uiContent.color}
                    onChange={(event) => updateTierContent(tier.tier, { color: event.target.value })}
                    className="h-8 w-10 rounded border bg-transparent p-0"
                    aria-label={`${tier.display_name} card color`}
                  />
                  <Input
                    value={draft.uiContent.color}
                    onChange={(event) => updateTierContent(tier.tier, { color: event.target.value })}
                    className="h-8 text-xs"
                    placeholder="#f21984"
                  />
                </div>
                <div className="grid grid-cols-[1fr_5rem] items-center gap-2 rounded-md border px-3 py-2 text-xs">
                  <label>
                    <span className="mb-1 block font-semibold">Tier line bar</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={draft.uiContent.meterPercent}
                      onChange={(event) => updateTierContent(tier.tier, { meterPercent: Number(event.target.value) })}
                      className="w-full"
                    />
                  </label>
                  <Input
                    value={String(draft.uiContent.meterPercent)}
                    onChange={(event) => updateTierContent(tier.tier, { meterPercent: Number(event.target.value) })}
                    className="h-8 text-xs"
                    inputMode="numeric"
                  />
                </div>
                {tier.tier !== 'free' && (
                  <label className="grid grid-cols-[1fr_7rem] items-center gap-2 rounded-md border px-3 py-2 text-xs">
                    <span>
                      <span className="block font-semibold">Promo discount label</span>
                      <span className="text-gray-500">Shown as crossed-out offer math. Payment still uses Price PHP.</span>
                    </span>
                    <Input
                      value={draft.pricePromoDiscountPercent}
                      onChange={(event) => updateTierDraft(tier.tier, { pricePromoDiscountPercent: event.target.value })}
                      className="h-8 text-xs"
                      inputMode="numeric"
                    />
                  </label>
                )}
                <textarea
                  value={draft.description}
                  onChange={(event) => updateTierDraft(tier.tier, { description: event.target.value })}
                  className="min-h-16 w-full rounded-md border bg-transparent px-3 py-2 text-xs"
                  placeholder="Description"
                />
                <div className="rounded-md border p-2">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Card Header</div>
                    <Label className="flex items-center gap-2 text-xs">
                      <Checkbox
                        checked={draft.uiContent.cardHeader.enabled}
                        onCheckedChange={(checked) => updateTierContent(tier.tier, {
                          cardHeader: { ...draft.uiContent.cardHeader, enabled: checked === true },
                        })}
                      />
                      Enabled
                    </Label>
                  </div>
                  <Input
                    value={draft.uiContent.cardHeader.label}
                    onChange={(event) => updateTierContent(tier.tier, {
                      cardHeader: { ...draft.uiContent.cardHeader, label: event.target.value },
                    })}
                    className="h-8 text-xs"
                    placeholder="Most Popular"
                  />
                </div>
                {tier.tier !== 'free' && (
                  <div className="rounded-md border p-2">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Title Badge</div>
                      <Label className="flex items-center gap-2 text-xs">
                        <Checkbox
                          checked={draft.uiContent.versionBadge.enabled}
                          onCheckedChange={(checked) => updateTierContent(tier.tier, {
                            versionBadge: { ...draft.uiContent.versionBadge, enabled: checked === true },
                          })}
                        />
                        Enabled
                      </Label>
                    </div>
                    <Input
                      value={draft.uiContent.versionBadge.label}
                      onChange={(event) => updateTierContent(tier.tier, {
                        versionBadge: { ...draft.uiContent.versionBadge, label: event.target.value },
                      })}
                      className="h-8 text-xs"
                      placeholder="VDJV 2.0"
                    />
                  </div>
                )}
                <div className="rounded-md border p-2">
                  <div className="mb-2">
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Short Description</div>
                  </div>
                  <Input
                    value={draft.uiContent.shortDescriptions[0] || ''}
                    onChange={(event) => updateContentRow(tier.tier, 'shortDescriptions', [event.target.value])}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="rounded-md border p-2">
                  <div className="mb-2">
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Other Description</div>
                  </div>
                  <div className="space-y-1 rounded border p-2">
                    <Input
                      value={draft.uiContent.otherDescriptions[0]?.title || ''}
                      onChange={(event) => updateContentRow(tier.tier, 'otherDescriptions', [{
                        ...(draft.uiContent.otherDescriptions[0] || { title: '', body: '' }),
                        title: event.target.value,
                      }])}
                      className="h-8 text-xs"
                      placeholder="Title"
                    />
                    <textarea
                      value={draft.uiContent.otherDescriptions[0]?.body || ''}
                      onChange={(event) => updateContentRow(tier.tier, 'otherDescriptions', [{
                        ...(draft.uiContent.otherDescriptions[0] || { title: '', body: '' }),
                        body: event.target.value,
                      }])}
                      className="min-h-14 w-full rounded-md border bg-transparent px-2 py-1 text-xs"
                      placeholder="Description"
                    />
                  </div>
                </div>
                <div className="rounded-md border p-2">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Common Limits</div>
                  <div className="grid gap-2">
                    {COMMON_LIMIT_FIELDS.map(([key, label]) => (
                      <label key={key} className="grid grid-cols-[1fr_6rem] items-center gap-2 text-xs">
                        <span>{label}</span>
                        <Input
                          value={String(limits[key] ?? '')}
                          onChange={(event) => updateTierLimit(tier.tier, key, event.target.value)}
                          className="h-8 text-xs"
                          inputMode="numeric"
                        />
                      </label>
                    ))}
                  </div>
                </div>
                <div className="rounded-md border p-2">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Feature Gates</div>
                  <div className="grid gap-2">
                    {COMMON_FEATURE_FIELDS.map(([key, label]) => (
                      <Label key={key} className="flex items-center justify-between gap-2 text-xs">
                        <span>{label}</span>
                        <Checkbox
                          checked={features[key] === true}
                          onCheckedChange={(checked) => updateTierFeature(tier.tier, key, checked === true)}
                        />
                      </Label>
                    ))}
                  </div>
                </div>
                <div className="rounded-md border p-2">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Checklist Rows</div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-[11px]"
                      onClick={() => updateContentRow(tier.tier, 'checklist', [...draft.uiContent.checklist, 'New checklist item'])}
                    >
                      Add
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {draft.uiContent.checklist.map((row, index) => (
                      <div key={`check-${index}`} className="grid grid-cols-[auto_1fr_auto] gap-2">
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 w-8 p-0"
                            disabled={index === 0}
                            aria-label="Move checklist row up"
                            onClick={() => moveContentRow(tier.tier, 'checklist', index, -1)}
                          >
                            <ChevronUp className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 w-8 p-0"
                            disabled={index >= draft.uiContent.checklist.length - 1}
                            aria-label="Move checklist row down"
                            onClick={() => moveContentRow(tier.tier, 'checklist', index, 1)}
                          >
                            <ChevronDown className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        <Input
                          value={row}
                          onChange={(event) => {
                            const rows = [...draft.uiContent.checklist];
                            rows[index] = event.target.value;
                            updateContentRow(tier.tier, 'checklist', rows);
                          }}
                          className="h-8 text-xs"
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 px-2 text-[11px]"
                          onClick={() => updateContentRow(tier.tier, 'checklist', draft.uiContent.checklist.filter((_, rowIndex) => rowIndex !== index))}
                        >
                          Delete
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-md border p-2">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Bottom Inclusions</div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-[11px]"
                      onClick={() => updateContentRow(tier.tier, 'inclusions', [...draft.uiContent.inclusions, { title: 'New included tool', badge: 'ENABLED', enabled: true }])}
                    >
                      Add
                    </Button>
                  </div>
                  <Input
                    value={draft.uiContent.inclusionTitle}
                    onChange={(event) => updateTierContent(tier.tier, { inclusionTitle: event.target.value })}
                    className="mb-2 h-8 text-xs"
                    placeholder="Included Tools"
                  />
                  <div className="space-y-2">
                    {draft.uiContent.inclusions.map((row, index) => (
                      <div key={`inclusion-${index}`} className="space-y-1 rounded border p-2">
                        <div className="grid grid-cols-[auto_1fr_7rem] gap-2">
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 w-8 p-0"
                              disabled={index === 0}
                              aria-label="Move inclusion row up"
                              onClick={() => moveContentRow(tier.tier, 'inclusions', index, -1)}
                            >
                              <ChevronUp className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 w-8 p-0"
                              disabled={index >= draft.uiContent.inclusions.length - 1}
                              aria-label="Move inclusion row down"
                              onClick={() => moveContentRow(tier.tier, 'inclusions', index, 1)}
                            >
                              <ChevronDown className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                          <Input
                            value={row.title}
                            onChange={(event) => {
                              const rows = [...draft.uiContent.inclusions];
                              rows[index] = { ...row, title: event.target.value };
                              updateContentRow(tier.tier, 'inclusions', rows);
                            }}
                            className="h-8 text-xs"
                            placeholder="Included tool"
                          />
                          <Input
                            value={row.badge}
                            onChange={(event) => {
                              const rows = [...draft.uiContent.inclusions];
                              rows[index] = { ...row, badge: event.target.value };
                              updateContentRow(tier.tier, 'inclusions', rows);
                            }}
                            className="h-8 text-xs"
                            placeholder="ENABLED"
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <Label className="flex items-center gap-2 text-xs">
                            <Checkbox
                              checked={row.enabled}
                              onCheckedChange={(checked) => {
                                const rows = [...draft.uiContent.inclusions];
                                rows[index] = { ...row, enabled: checked === true };
                                updateContentRow(tier.tier, 'inclusions', rows);
                              }}
                            />
                            Enabled badge style
                          </Label>
                          <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => updateContentRow(tier.tier, 'inclusions', draft.uiContent.inclusions.filter((_, rowIndex) => rowIndex !== index))}>
                            Delete
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
          </div>
        </>
        )}
      </div>
      )}

      {resolvedActiveSection === 'vouchers' && (
      <div className={`rounded-lg border p-3 ${cardClass}`}>
        <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h4 className="text-sm font-semibold">Voucher Campaigns</h4>
            <div className="text-xs opacity-70">Create campaigns in a dialog, then copy or revoke unused codes from the table.</div>
          </div>
          <Button type="button" size="sm" variant="success" className="hidden rounded-[14px]" onClick={() => setCreateVoucherOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            Create Campaign
          </Button>
        </div>
        <AdminToolbar
          search={{
            value: voucherSearch,
            onChange: setVoucherSearch,
            placeholder: 'Search campaign, email, tier...',
          }}
          primaryFilters={(
            <select
              value={voucherStatusFilter}
              onChange={(event) => setVoucherStatusFilter(event.target.value as 'all' | 'active' | 'inactive')}
              className={`h-9 rounded-md border px-3 text-sm ${theme === 'dark' ? 'border-gray-700 bg-gray-900 text-gray-100 [&>option]:bg-gray-950 [&>option]:text-gray-100' : 'border-gray-300 bg-white text-gray-900'}`}
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          )}
          activeFilterCount={Number(Boolean(voucherSearch.trim())) + Number(voucherStatusFilter !== 'all')}
          onClearFilters={() => {
            setVoucherSearch('');
            setVoucherStatusFilter('all');
          }}
          resultLabel={`${filteredVoucherCampaigns.length}/${voucherCampaigns.length} campaigns`}
        />
        <div className="overflow-x-auto rounded border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead><SortHeader title="Campaign" active={voucherSortBy === 'name'} direction={voucherSortDir} onClick={() => toggleVoucherSort('name')} /></TableHead>
                <TableHead><SortHeader title="Tier" active={voucherSortBy === 'tier'} direction={voucherSortDir} onClick={() => toggleVoucherSort('tier')} /></TableHead>
                <TableHead><SortHeader title="Used" active={voucherSortBy === 'used'} direction={voucherSortDir} onClick={() => toggleVoucherSort('used')} /></TableHead>
                <TableHead><SortHeader title="Expires" active={voucherSortBy === 'expires_at'} direction={voucherSortDir} onClick={() => toggleVoucherSort('expires_at')} /></TableHead>
                <TableHead><SortHeader title="Target" active={voucherSortBy === 'target'} direction={voucherSortDir} onClick={() => toggleVoucherSort('target')} /></TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredVoucherCampaigns.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-sm text-gray-500">No voucher campaigns yet.</TableCell>
                </TableRow>
              ) : filteredVoucherCampaigns.map((campaign) => (
                <TableRow key={campaign.id}>
                  <TableCell>
                    <div className="font-medium">{campaign.name}</div>
                    <div className="text-xs text-gray-500">{campaign.is_active ? 'Active' : 'Inactive'}</div>
                  </TableCell>
                  <TableCell className="uppercase">{campaign.target_tier.replace('_', ' ')}</TableCell>
                  <TableCell>{campaign.redeemed_count}/{campaign.reserved_count}/{campaign.max_codes}</TableCell>
                  <TableCell>{formatDateTime(campaign.expires_at)}</TableCell>
                  <TableCell>{campaign.target_email || campaign.target_user_id || '-'}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => setRevokeCampaign(campaign)}
                        disabled={voucherBusyId === `revoke:${campaign.id}` || campaign.reserved_count <= campaign.redeemed_count}
                      >
                        {voucherBusyId === `revoke:${campaign.id}` ? 'Revoking...' : 'Revoke Latest'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void copyNextVoucher(campaign)}
                        disabled={voucherBusyId === campaign.id || !campaign.is_active || campaign.reserved_count >= campaign.max_codes}
                      >
                        {voucherBusyId === campaign.id ? 'Copying...' : 'Copy Next Code'}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <Dialog open={createVoucherOpen} onOpenChange={setCreateVoucherOpen}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Create Voucher Campaign</DialogTitle>
              <DialogDescription>Reserve one-time upgrade vouchers for PRO or PRO MAX.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1 sm:col-span-2">
                <Label>Campaign Name</Label>
                <Input value={campaignName} onChange={(event) => setCampaignName(event.target.value)} placeholder="Campaign name" />
              </div>
              <div className="space-y-1">
                <Label>Target Tier</Label>
                <select
                  value={campaignTargetTier}
                  onChange={(event) => setCampaignTargetTier(event.target.value as 'pro' | 'pro_max')}
                  className="h-9 w-full rounded-md border bg-transparent px-2 text-sm"
                >
                  <option value="pro">PRO</option>
                  <option value="pro_max">PRO MAX</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label>Codes</Label>
                <Input value={campaignMaxCodes} onChange={(event) => setCampaignMaxCodes(event.target.value)} inputMode="numeric" />
              </div>
              <div className="space-y-1">
                <Label>Expires At</Label>
                <Input value={campaignExpiresAt} onChange={(event) => setCampaignExpiresAt(event.target.value)} type="datetime-local" />
              </div>
              <div className="space-y-1">
                <Label>Target Email</Label>
                <Input value={campaignTargetEmail} onChange={(event) => setCampaignTargetEmail(event.target.value)} placeholder="Optional" />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label>Notes</Label>
                <textarea
                  value={campaignNotes}
                  onChange={(event) => setCampaignNotes(event.target.value)}
                  className="min-h-20 w-full rounded-md border bg-transparent px-3 py-2 text-sm"
                  placeholder="Optional voucher notes"
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateVoucherOpen(false)}>Cancel</Button>
              <Button type="button" variant="success" onClick={() => void createVoucherCampaign()} disabled={voucherBusyId === 'create'}>
                {voucherBusyId === 'create' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {voucherBusyId === 'create' ? 'Creating...' : 'Create Campaign'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <ConfirmationDialog
          open={Boolean(revokeCampaign)}
          onOpenChange={(open) => {
            if (!open) setRevokeCampaign(null);
          }}
          theme={theme}
          variant="destructive"
          title="Revoke latest voucher?"
          description={`Revoke the latest unused code from "${revokeCampaign?.name || 'this campaign'}". This cannot be used by a customer after revocation.`}
          confirmText="Revoke"
          onConfirm={() => {
            if (revokeCampaign) void revokeLatestVoucher(revokeCampaign);
            setRevokeCampaign(null);
          }}
        />
      </div>
      )}

    </AdminPageScaffold>
  );
}
