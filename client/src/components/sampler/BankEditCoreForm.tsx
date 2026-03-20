import * as React from 'react';
import { Copy, Crown, Download, Link2, Loader2, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { HelpTooltip } from '@/components/ui/help-tooltip';
import { SamplerBank } from './types/sampler';
import { canAdminExportBankForSession } from './hooks/useSamplerStore.provenance';

type ShortcutAssignment = {
  name: string;
  key: string | null;
  midi: string | null;
};

type ColorOption = {
  label: string;
  value: string;
  textColor: string;
};

interface BankEditCoreFormProps {
  bank: SamplerBank;
  canDelete: boolean;
  theme: 'light' | 'dark';
  colorOptions: ColorOption[];
  primaryColorOptions?: ColorOption[];
  extraColorOptions?: ColorOption[];
  defaultColor: string;
  setDefaultColor: (value: string) => void;
  name: string;
  setName: (value: string) => void;
  orderedBanks: SamplerBank[];
  selectedBankPosition: string;
  setSelectedBankPosition: (value: string) => void;
  isAdmin: boolean;
  activeAdminThumbnailUrl: string | null;
  adminThumbnailUploading: boolean;
  adminThumbnailNotice: string;
  adminThumbnailUpdatedLabel: string | null;
  adminThumbnailError: string;
  handleThumbnailUpload: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void> | void;
  handleThumbnailRemove: () => Promise<void> | void;
  isAdminOrStoreBank: boolean;
  hideThumbnailPreview: boolean;
  setHideThumbnailPreview: (value: boolean) => void;
  midiEnabled: boolean;
  shortcutKey: string;
  handleShortcutKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  shortcutError: string | null;
  reservedKeysText: string;
  midiNote: number | undefined;
  midiCC: number | undefined;
  midiLearnActive: boolean;
  setMidiLearnActive: (value: boolean) => void;
  clearMidiAssignments: () => void;
  midiError: string | null;
  onClearPadShortcuts?: () => void;
  onClearPadMidi?: () => void;
  shortcutAssignments: ShortcutAssignment[];
  formatDate: (date: Date) => string;
  showDatabaseDescription: boolean;
  canLinkExistingStoreBank?: boolean;
  storeLinkNotice?: string | null;
  storeLinkError?: string | null;
  onSave: () => void;
  onShowDuplicateConfirm: () => void;
  onShowAdminExport: () => void;
  onShowStoreLink?: () => void;
  onShowStoreUpdate: () => void;
  onExport: () => void;
  onDelete: () => void;
  onDuplicate?: () => Promise<void> | void;
  onExportAdmin?: (...args: any[]) => Promise<string>;
  onUpdateStoreBank?: () => Promise<void> | void;
}

export function BankEditCoreForm({
  bank,
  canDelete,
  theme,
  colorOptions,
  primaryColorOptions,
  extraColorOptions,
  defaultColor,
  setDefaultColor,
  name,
  setName,
  orderedBanks,
  selectedBankPosition,
  setSelectedBankPosition,
  isAdmin,
  activeAdminThumbnailUrl,
  adminThumbnailUploading,
  adminThumbnailNotice,
  adminThumbnailUpdatedLabel,
  adminThumbnailError,
  handleThumbnailUpload,
  handleThumbnailRemove,
  isAdminOrStoreBank,
  hideThumbnailPreview,
  setHideThumbnailPreview,
  midiEnabled,
  shortcutKey,
  handleShortcutKeyDown,
  shortcutError,
  reservedKeysText,
  midiNote,
  midiCC,
  midiLearnActive,
  setMidiLearnActive,
  clearMidiAssignments,
  midiError,
  onClearPadShortcuts,
  onClearPadMidi,
  shortcutAssignments,
  formatDate,
  showDatabaseDescription,
  canLinkExistingStoreBank = false,
  storeLinkNotice,
  storeLinkError,
  onSave,
  onShowDuplicateConfirm,
  onShowAdminExport,
  onShowStoreLink,
  onShowStoreUpdate,
  onExport,
  onDelete,
  onDuplicate,
  onExportAdmin,
  onUpdateStoreBank,
}: BankEditCoreFormProps) {
  const canUseAdminExport = isAdmin && Boolean(onExportAdmin) && canAdminExportBankForSession(bank);
  const canUseStoreUpdate = isAdmin && Boolean(onUpdateStoreBank) && Boolean(bank.bankMetadata?.catalogItemId);
  const canUseStoreLink = isAdmin && Boolean(onShowStoreLink) && canLinkExistingStoreBank && !bank.bankMetadata?.catalogItemId;
  const canShowExportButton = canUseAdminExport || bank.exportable !== false;
  const [showAllColors, setShowAllColors] = React.useState(false);
  const visibleColorOptions = showAllColors
    ? colorOptions
    : (primaryColorOptions && primaryColorOptions.length > 0 ? primaryColorOptions : colorOptions);
  const hasExtraColors = (extraColorOptions && extraColorOptions.length > 0)
    || (primaryColorOptions && primaryColorOptions.length < colorOptions.length);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <Label htmlFor="name">Bank Name</Label>
          </div>
          <Input
            id="name"
            value={name}
            onChange={(e) => {
              if (e.target.value.length <= 18) {
                setName(e.target.value);
              }
            }}
            placeholder="Enter bank name"
            className="backdrop-blur-sm"
            maxLength={24}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
            onFocus={(e) => {
              if (window.innerWidth <= 768) {
                setTimeout(() => e.target.focus(), 100);
              }
            }}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <Label>Bank Position</Label>
            <HelpTooltip content="Directly move this bank to another slot in the bank list without repeated move up or down actions." label="Bank position help" />
          </div>
          <Select value={selectedBankPosition} onValueChange={setSelectedBankPosition}>
            <SelectTrigger>
              <SelectValue placeholder="Choose position" />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {orderedBanks.map((entry, index) => (
                <SelectItem key={entry.id} value={String(index)}>
                  {index + 1}. {entry.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2 sm:col-span-2">
          <div className="flex items-center gap-1.5">
            <Label>Bank Color</Label>
          </div>
          <div className="flex gap-1 flex-wrap">
            {visibleColorOptions.map((colorOption) => (
              <button
                type="button"
                key={colorOption.value}
                onClick={() => setDefaultColor(colorOption.value)}
                className={`w-6 h-6 rounded-full border-2 transition-all ${defaultColor === colorOption.value ? 'border-white scale-110 shadow-lg' : 'border-gray-400'}`}
                style={{
                  backgroundColor: colorOption.value,
                  color: colorOption.textColor
                }}
                title={colorOption.label}
              />
            ))}
            {hasExtraColors && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-6 px-1.5 text-[10px] ml-1"
                onClick={() => setShowAllColors((prev) => !prev)}
              >
                {showAllColors ? 'Less' : 'More'}
              </Button>
            )}
          </div>
        </div>
      </div>

      {isAdmin && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <Label htmlFor="bankThumbnail">Bank Thumbnail (Admin)</Label>
          </div>
          <div className="flex items-center gap-4">
            {activeAdminThumbnailUrl ? (
              <img src={activeAdminThumbnailUrl} alt="Bank thumbnail" className="w-16 h-16 rounded-md object-cover border" />
            ) : (
              <div className={`w-16 h-16 rounded-md border flex items-center justify-center text-xs ${theme === 'dark' ? 'border-gray-600 text-gray-400' : 'border-gray-300 text-gray-500'}`}>
                No image
              </div>
            )}
            <div className="flex-1">
              <Input
                id="bankThumbnail"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => { void handleThumbnailUpload(e); }}
                disabled={adminThumbnailUploading}
                className="backdrop-blur-sm"
              />
              {adminThumbnailNotice && (
                <p className="text-xs text-gray-500 mt-1">{adminThumbnailNotice}</p>
              )}
              {!adminThumbnailNotice && !adminThumbnailError && adminThumbnailUpdatedLabel && (
                <p className="text-xs text-gray-500 mt-1">{adminThumbnailUpdatedLabel}</p>
              )}
              {adminThumbnailError && (
                <p className="text-xs text-red-500 mt-1">{adminThumbnailError}</p>
              )}
            </div>
            {adminThumbnailUploading && <Loader2 className="w-5 h-5 animate-spin" />}
            {activeAdminThumbnailUrl && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => { void handleThumbnailRemove(); }}
                disabled={adminThumbnailUploading}
                className={`shrink-0 ${theme === 'dark' ? 'border-red-900 hover:bg-red-900/20 text-red-500' : 'text-red-500'}`}
              >
                Remove
              </Button>
            )}
          </div>
        </div>
      )}

      {isAdminOrStoreBank && (
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Label className="text-xs font-medium">Hide Thumbnail In Bank List</Label>
            <HelpTooltip content="Shows color-only preview in the bank list while keeping the stored thumbnail for export or store use." label="Hide thumbnail help" />
          </div>
          <Switch
            checked={hideThumbnailPreview}
            onCheckedChange={setHideThumbnailPreview}
          />
        </div>
      )}

      <div className={`grid gap-3 ${midiEnabled ? 'grid-cols-2' : 'grid-cols-1'}`}>
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <Label htmlFor="bankShortcutKey">Bank Shortcut Key</Label>
            <HelpTooltip content={`Assign a keyboard shortcut to switch to this bank. Reserved keys stay blocked: ${reservedKeysText}.`} label="Bank shortcut help" />
          </div>
          <Input
            id="bankShortcutKey"
            value={shortcutKey}
            onKeyDown={handleShortcutKeyDown}
            placeholder="Press a key"
            readOnly
          />
          {shortcutError && (
            <p className="text-xs text-red-500">{shortcutError}</p>
          )}
        </div>

        {midiEnabled && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Label>MIDI Assignment</Label>
              <HelpTooltip content="Use Learn MIDI to capture the next incoming Note or CC message for fast bank selection." label="Bank MIDI help" />
            </div>
            <div className="text-xs text-gray-500">
              Note: {midiNote ?? '-'} | CC: {midiCC ?? '-'}
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setMidiLearnActive(true)}
                className="flex-1"
              >
                {midiLearnActive ? 'Listening...' : 'Learn MIDI'}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={clearMidiAssignments}
              >
                Clear
              </Button>
            </div>
            {midiError && <p className="text-xs text-red-500">{midiError}</p>}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Label>Pad Shortcuts (Keyboard/MIDI)</Label>
            <HelpTooltip content="Quick overview of pad-level assignments inside this bank. Use the clear actions to wipe bank-local shortcuts in one step." label="Pad shortcut list help" />
          </div>
          <div className="flex items-center gap-2">
            {onClearPadShortcuts && (
              <Button type="button" variant="outline" size="sm" onClick={onClearPadShortcuts}>
                Clear All Keys
              </Button>
            )}
            {midiEnabled && onClearPadMidi && (
              <Button type="button" variant="outline" size="sm" onClick={onClearPadMidi}>
                Clear All MIDI
              </Button>
            )}
          </div>
        </div>
        {shortcutAssignments.length > 0 ? (
          <div className="max-h-32 overflow-y-auto rounded border p-2 text-sm">
            <div className="grid grid-cols-[1fr_auto_auto] gap-2 text-[11px] uppercase tracking-wide text-gray-500">
              <div>Pad</div>
              <div>Key</div>
              <div>MIDI</div>
            </div>
            <div className="mt-1 space-y-1">
              {shortcutAssignments.map((assignment, index) => (
                <div key={`${assignment.name}-${assignment.key ?? 'none'}-${assignment.midi ?? 'none'}-${index}`} className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
                  <span className="truncate">{assignment.name}</span>
                  <span className="rounded bg-gray-200 px-2 py-0.5 text-xs text-gray-800 dark:bg-gray-700 dark:text-gray-100">
                    {assignment.key ?? '-'}
                  </span>
                  <span className="rounded bg-gray-200 px-2 py-0.5 text-xs text-gray-800 dark:bg-gray-700 dark:text-gray-100">
                    {assignment.midi ?? '-'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-xs text-gray-500">No shortcuts assigned in this bank.</p>
        )}
      </div>

      <div className="space-y-2">
        <Label>Bank Information</Label>
        <div className={`text-sm space-y-1 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>
          <div>Created: {formatDate(bank.createdAt)}</div>
          <div>Pads: {bank.pads.length}</div>
          <div>Created by: {bank.isAdminBank ? (
            <span className="text-yellow-500 font-medium">ADMIN DJ V</span>
          ) : bank.creatorEmail ? (
            <span>{bank.creatorEmail}</span>
          ) : (
            <span className="italic text-gray-400">Unknown</span>
          )}</div>
          {showDatabaseDescription && (
            <div>Description: {bank.bankMetadata?.description ? (
              <span>{bank.bankMetadata.description}</span>
            ) : (
              <span className="italic text-gray-400">No description</span>
            )}</div>
          )}
        </div>
      </div>

      <div className="flex gap-2 pt-4">
        <Button onClick={onSave} className="flex-1">
          Save Changes
        </Button>
        {onDuplicate && (
          <Button
            onClick={onShowDuplicateConfirm}
            variant="outline"
            className="px-3"
            title="Duplicate bank"
          >
            <Copy className="w-4 h-4" />
          </Button>
        )}
        {canUseStoreUpdate ? (
          <Button
            onClick={onShowStoreUpdate}
            variant="outline"
            className="px-3"
            title="Update Store Bank"
          >
            <Upload className="w-4 h-4" />
          </Button>
        ) : null}
        {canUseStoreLink ? (
          <Button
            onClick={onShowStoreLink}
            variant="outline"
            className="px-3"
            title="Link Existing Store Bank"
          >
            <Link2 className="w-4 h-4" />
          </Button>
        ) : null}
        {canShowExportButton && (
          <Button
            onClick={() => {
              if (canUseAdminExport) {
                onShowAdminExport();
              } else {
                onExport();
              }
            }}
            variant="outline"
            className="px-3"
            title={canUseAdminExport ? 'Export (admin)' : 'Export'}
          >
            {canUseAdminExport ? <Crown className="w-4 h-4" /> : <Download className="w-4 h-4" />}
          </Button>
        )}
        {canDelete && (
          <Button onClick={onDelete} variant="destructive" className="px-3">
            <Trash2 className="w-4 h-4" />
          </Button>
        )}
      </div>
      {storeLinkNotice ? (
        <p className="text-xs text-emerald-600 dark:text-emerald-400">{storeLinkNotice}</p>
      ) : null}
      {storeLinkError ? (
        <p className="text-xs text-red-500">{storeLinkError}</p>
      ) : null}
    </div>
  );
}
