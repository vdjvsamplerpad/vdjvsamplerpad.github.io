import * as React from 'react';
import { Copy, Crown, Download, Loader2, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
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
  defaultColor: string;
  setDefaultColor: (value: string) => void;
  name: string;
  setName: (value: string) => void;
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
  onSave: () => void;
  onShowDuplicateConfirm: () => void;
  onShowAdminExport: () => void;
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
  defaultColor,
  setDefaultColor,
  name,
  setName,
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
  onSave,
  onShowDuplicateConfirm,
  onShowAdminExport,
  onShowStoreUpdate,
  onExport,
  onDelete,
  onDuplicate,
  onExportAdmin,
  onUpdateStoreBank,
}: BankEditCoreFormProps) {
  const canUseAdminExport = isAdmin && Boolean(onExportAdmin) && canAdminExportBankForSession(bank);
  const canUseStoreUpdate = isAdmin && Boolean(onUpdateStoreBank) && Boolean(bank.bankMetadata?.catalogItemId);
  const canShowExportButton = canUseAdminExport || bank.exportable !== false;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="name">Bank Name</Label>
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
          <Label>Bank Color</Label>
          <div className="flex gap-1 flex-wrap">
            {colorOptions.map((colorOption) => (
              <button
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
          </div>
        </div>
      </div>

      {isAdmin && (
        <div className="space-y-2">
          <Label htmlFor="bankThumbnail">Bank Thumbnail (Admin)</Label>
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
          <Label className="text-xs font-medium">Hide Thumbnail In Bank List</Label>
          <Switch
            checked={hideThumbnailPreview}
            onCheckedChange={setHideThumbnailPreview}
          />
        </div>
      )}

      <div className={`grid gap-3 ${midiEnabled ? 'grid-cols-2' : 'grid-cols-1'}`}>
        <div className="space-y-2">
          <Label htmlFor="bankShortcutKey">Bank Shortcut Key</Label>
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
          {!shortcutError && (
            <p className="text-xs text-gray-500">
              Reserved keys: {reservedKeysText}
            </p>
          )}
        </div>

        {midiEnabled && (
          <div className="space-y-2">
            <Label>MIDI Assignment</Label>
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
          <Label>Pad Shortcuts (Keyboard/MIDI)</Label>
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
        ) : canShowExportButton && (
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
    </div>
  );
}
