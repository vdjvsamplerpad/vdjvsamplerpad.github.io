import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  adminApi,
  type AdminAccountTierConfig,
  type AdminAccountUpgradeRequest,
  type AdminVoucherCampaign,
} from '@/lib/admin-api';

type UpgradeStatusFilter = 'all' | 'pending' | 'approved' | 'rejected' | 'cancelled';
type AccountAdminSection = 'requests' | 'vouchers' | 'tiers';

interface TierDraft {
  displayName: string;
  description: string;
  pricePhp: string;
  limitsJson: string;
  featuresJson: string;
  isActive: boolean;
}

interface AdminAccountUpgradesTabProps {
  panelClass: string;
  cardClass: string;
  pushNotice: (kind: 'success' | 'error' | 'info', message: string) => void;
}

const formatMoney = (value: number): string => {
  if (!Number.isFinite(value)) return 'PHP 0';
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 0,
  }).format(value);
};

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

const buildTierDraft = (tier: AdminAccountTierConfig): TierDraft => ({
  displayName: tier.display_name || tier.tier,
  description: tier.description || '',
  pricePhp: String(tier.price_php ?? 0),
  limitsJson: JSON.stringify(tier.limits || {}, null, 2),
  featuresJson: JSON.stringify(tier.features || {}, null, 2),
  isActive: tier.is_active !== false,
});

const COMMON_LIMIT_FIELDS = [
  ['defaultBankDailyPlays', 'Default plays/day'],
  ['ownedBankQuota', 'Owned banks'],
  ['ownedBankPadCap', 'Pads per owned bank'],
  ['deviceTotalBankCap', 'Total banks/device'],
  ['deckCount', 'Deck channels'],
] as const;

const COMMON_FEATURE_FIELDS = [
  ['bankStoreCheckout', 'Store checkout'],
  ['bankStoreDownload', 'Store download'],
  ['storeFreePromotions', 'Free promotions'],
  ['search', 'Search'],
  ['inputMapping', 'Input mapping'],
  ['backupRepair', 'Backup & repair'],
  ['mixerHotcue', 'Mixer hotcue'],
  ['padEditAdvanced', 'Advanced pad edit'],
  ['bankEditAdvanced', 'Advanced bank edit'],
] as const;

const parseJsonObject = (value: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
};

export function AdminAccountUpgradesTab({ panelClass, cardClass, pushNotice }: AdminAccountUpgradesTabProps) {
  const [loading, setLoading] = React.useState(false);
  const [savingTier, setSavingTier] = React.useState<string | null>(null);
  const [upgradeBusyId, setUpgradeBusyId] = React.useState<string | null>(null);
  const [voucherBusyId, setVoucherBusyId] = React.useState<string | null>(null);
  const [tierConfigs, setTierConfigs] = React.useState<AdminAccountTierConfig[]>([]);
  const [tierDrafts, setTierDrafts] = React.useState<Record<string, TierDraft>>({});
  const [upgradeRows, setUpgradeRows] = React.useState<AdminAccountUpgradeRequest[]>([]);
  const [upgradeStatus, setUpgradeStatus] = React.useState<UpgradeStatusFilter>('pending');
  const [upgradeSearch, setUpgradeSearch] = React.useState('');
  const [voucherCampaigns, setVoucherCampaigns] = React.useState<AdminVoucherCampaign[]>([]);
  const [campaignName, setCampaignName] = React.useState('');
  const [campaignTargetTier, setCampaignTargetTier] = React.useState<'pro' | 'pro_max'>('pro');
  const [campaignMaxCodes, setCampaignMaxCodes] = React.useState('1');
  const [campaignExpiresAt, setCampaignExpiresAt] = React.useState('');
  const [campaignTargetEmail, setCampaignTargetEmail] = React.useState('');
  const [campaignNotes, setCampaignNotes] = React.useState('');
  const [activeSection, setActiveSection] = React.useState<AccountAdminSection>('requests');

  const loadData = React.useCallback(async () => {
    setLoading(true);
    try {
      const [tiersResult, upgradesResult, vouchersResult] = await Promise.all([
        adminApi.listAccountTierConfigs(),
        adminApi.listAccountUpgradeRequests({ q: upgradeSearch, status: upgradeStatus, page: 1, perPage: 50 }),
        adminApi.listVoucherCampaigns(),
      ]);
      setTierConfigs(tiersResult.tiers || []);
      setTierDrafts(Object.fromEntries((tiersResult.tiers || []).map((tier) => [tier.tier, buildTierDraft(tier)])));
      setUpgradeRows(upgradesResult.requests || []);
      setVoucherCampaigns(vouchersResult.campaigns || []);
    } catch (error) {
      pushNotice('error', error instanceof Error ? error.message : 'Failed to load account upgrades.');
    } finally {
      setLoading(false);
    }
  }, [pushNotice, upgradeSearch, upgradeStatus]);

  React.useEffect(() => {
    void loadData();
  }, [loadData]);

  const updateTierDraft = (tier: string, patch: Partial<TierDraft>) => {
    setTierDrafts((current) => ({
      ...current,
      [tier]: {
        ...(current[tier] || {
          displayName: tier,
          description: '',
          pricePhp: '0',
          limitsJson: '{}',
          featuresJson: '{}',
          isActive: true,
        }),
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

  const saveTierConfig = async (tier: AdminAccountTierConfig['tier']) => {
    const draft = tierDrafts[tier];
    if (!draft) return;
    setSavingTier(tier);
    try {
      const pricePhp = Number(draft.pricePhp);
      const limits = JSON.parse(draft.limitsJson || '{}') as Record<string, unknown>;
      const features = JSON.parse(draft.featuresJson || '{}') as Record<string, boolean>;
      await adminApi.saveAccountTierConfig({
        tier,
        displayName: draft.displayName,
        description: draft.description,
        pricePhp: Number.isFinite(pricePhp) ? pricePhp : 0,
        limits,
        features,
        isActive: draft.isActive,
      });
      pushNotice('success', `${draft.displayName || tier} tier config saved.`);
      await loadData();
    } catch (error) {
      pushNotice('error', error instanceof Error ? error.message : 'Tier config save failed.');
    } finally {
      setSavingTier(null);
    }
  };

  const decideUpgrade = async (request: AdminAccountUpgradeRequest, action: 'approve' | 'reject') => {
    const rejectionMessage = action === 'reject'
      ? window.prompt('Reason for rejection?', request.rejection_message || '')
      : undefined;
    if (action === 'reject' && rejectionMessage === null) return;
    setUpgradeBusyId(request.id);
    try {
      await adminApi.accountUpgradeDecision(request.id, action, rejectionMessage || undefined);
      pushNotice('success', action === 'approve' ? 'Upgrade approved.' : 'Upgrade rejected.');
      await loadData();
    } catch (error) {
      pushNotice('error', error instanceof Error ? error.message : 'Upgrade decision failed.');
    } finally {
      setUpgradeBusyId(null);
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

  return (
    <div className={`${panelClass} space-y-4`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Account Upgrades</h3>
          <p className="text-xs text-gray-500">Approve PRO/PRO MAX requests, tune tier rules, and issue one-time voucher codes.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadData()} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {([
          ['requests', 'Upgrade Requests'],
          ['vouchers', 'Vouchers'],
          ['tiers', 'Tier Config'],
        ] as Array<[AccountAdminSection, string]>).map(([section, label]) => (
          <Button
            key={section}
            type="button"
            size="sm"
            variant={activeSection === section ? 'default' : 'outline'}
            onClick={() => setActiveSection(section)}
          >
            {label}
          </Button>
        ))}
      </div>

      {activeSection === 'tiers' && (
      <div className={`rounded-lg border p-3 ${cardClass}`}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h4 className="text-sm font-semibold">Tier Config</h4>
          <span className="text-xs text-gray-500">Limits and features are JSON so every restriction remains admin-configurable.</span>
        </div>
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
                <textarea
                  value={draft.description}
                  onChange={(event) => updateTierDraft(tier.tier, { description: event.target.value })}
                  className="min-h-16 w-full rounded-md border bg-transparent px-3 py-2 text-xs"
                  placeholder="Description"
                />
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
                <details className="rounded-md border p-2">
                  <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-gray-500">Advanced JSON</summary>
                  <div className="mt-2 space-y-2">
                    <textarea
                      value={draft.limitsJson}
                      onChange={(event) => updateTierDraft(tier.tier, { limitsJson: event.target.value })}
                      className="min-h-32 w-full rounded-md border bg-transparent px-3 py-2 font-mono text-[11px]"
                      spellCheck={false}
                    />
                    <textarea
                      value={draft.featuresJson}
                      onChange={(event) => updateTierDraft(tier.tier, { featuresJson: event.target.value })}
                      className="min-h-40 w-full rounded-md border bg-transparent px-3 py-2 font-mono text-[11px]"
                      spellCheck={false}
                    />
                  </div>
                </details>
                <Button size="sm" className="w-full" onClick={() => void saveTierConfig(tier.tier)} disabled={savingTier === tier.tier}>
                  {savingTier === tier.tier ? 'Saving...' : 'Save Tier'}
                </Button>
              </div>
            );
          })}
        </div>
      </div>
      )}

      {activeSection === 'requests' && (
      <div className={`rounded-lg border p-3 ${cardClass}`}>
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label>Status</Label>
            <select
              value={upgradeStatus}
              onChange={(event) => setUpgradeStatus(event.target.value as UpgradeStatusFilter)}
              className="h-9 rounded-md border bg-transparent px-2 text-sm"
            >
              <option value="pending">Pending</option>
              <option value="all">All</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          <div className="min-w-64 flex-1 space-y-1">
            <Label>Search</Label>
            <Input value={upgradeSearch} onChange={(event) => setUpgradeSearch(event.target.value)} placeholder="Email, name, reference, receipt" />
          </div>
          <Button variant="outline" onClick={() => void loadData()}>Apply</Button>
        </div>
        <div className="overflow-x-auto rounded border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead>Quote</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {upgradeRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-6 text-center text-sm text-gray-500">No upgrade requests found.</TableCell>
                </TableRow>
              ) : upgradeRows.map((request) => (
                <TableRow key={request.id}>
                  <TableCell>
                    <div className="font-medium">{request.display_name || request.email}</div>
                    <div className="text-xs text-gray-500">{request.email}</div>
                  </TableCell>
                  <TableCell className="uppercase">{request.target_tier.replace('_', ' ')}</TableCell>
                  <TableCell>
                    <div>{request.payment_channel || '-'}</div>
                    <div className="text-xs text-gray-500">{request.reference_no || request.receipt_reference || '-'}</div>
                  </TableCell>
                  <TableCell>
                    <div>{formatMoney(request.quote_price_php_snapshot)}</div>
                    <div className="text-xs text-gray-500">
                      Base {formatMoney(request.base_price_php_snapshot)} - credit {formatMoney(request.store_credit_php_snapshot)}
                    </div>
                  </TableCell>
                  <TableCell className="uppercase">{request.status}</TableCell>
                  <TableCell>{formatDateTime(request.created_at)}</TableCell>
                  <TableCell className="text-right">
                    {request.status === 'pending' ? (
                      <div className="flex justify-end gap-2">
                        <Button size="sm" onClick={() => void decideUpgrade(request, 'approve')} disabled={upgradeBusyId === request.id}>Approve</Button>
                        <Button size="sm" variant="outline" onClick={() => void decideUpgrade(request, 'reject')} disabled={upgradeBusyId === request.id}>Reject</Button>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-500">{request.reviewed_at ? formatDateTime(request.reviewed_at) : '-'}</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
      )}

      {activeSection === 'vouchers' && (
      <div className={`rounded-lg border p-3 ${cardClass}`}>
        <h4 className="mb-3 text-sm font-semibold">Voucher Campaigns</h4>
        <div className="mb-4 grid gap-2 lg:grid-cols-[1fr_auto_auto_auto_1fr_auto]">
          <Input value={campaignName} onChange={(event) => setCampaignName(event.target.value)} placeholder="Campaign name" />
          <select
            value={campaignTargetTier}
            onChange={(event) => setCampaignTargetTier(event.target.value as 'pro' | 'pro_max')}
            className="h-9 rounded-md border bg-transparent px-2 text-sm"
          >
            <option value="pro">PRO</option>
            <option value="pro_max">PRO MAX</option>
          </select>
          <Input value={campaignMaxCodes} onChange={(event) => setCampaignMaxCodes(event.target.value)} placeholder="Codes" inputMode="numeric" />
          <Input value={campaignExpiresAt} onChange={(event) => setCampaignExpiresAt(event.target.value)} type="datetime-local" />
          <Input value={campaignTargetEmail} onChange={(event) => setCampaignTargetEmail(event.target.value)} placeholder="Optional target email" />
          <Button onClick={() => void createVoucherCampaign()} disabled={voucherBusyId === 'create'}>{voucherBusyId === 'create' ? 'Creating...' : 'Create'}</Button>
        </div>
        <textarea
          value={campaignNotes}
          onChange={(event) => setCampaignNotes(event.target.value)}
          className="mb-4 min-h-16 w-full rounded-md border bg-transparent px-3 py-2 text-sm"
          placeholder="Optional voucher notes"
        />
        <div className="overflow-x-auto rounded border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campaign</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead>Used</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Target</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {voucherCampaigns.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-sm text-gray-500">No voucher campaigns yet.</TableCell>
                </TableRow>
              ) : voucherCampaigns.map((campaign) => (
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
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void copyNextVoucher(campaign)}
                      disabled={voucherBusyId === campaign.id || !campaign.is_active || campaign.reserved_count >= campaign.max_codes}
                    >
                      {voucherBusyId === campaign.id ? 'Copying...' : 'Copy Next Code'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
      )}
    </div>
  );
}
