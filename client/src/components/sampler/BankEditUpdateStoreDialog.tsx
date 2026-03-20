import * as React from 'react';
import { AlertTriangle, ShieldAlert, Upload } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { SamplerBank } from './types/sampler';
import type { ExportAudioMode } from './hooks/useSamplerStore.types';

interface BankEditUpdateStoreDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  theme: 'light' | 'dark';
  bank: SamplerBank;
  title: string;
  setTitle: (value: string) => void;
  description: string;
  setDescription: (value: string) => void;
  syncMetadata: boolean;
  setSyncMetadata: (value: boolean) => void;
  assetProtection: 'encrypted' | 'public';
  setAssetProtection: (value: 'encrypted' | 'public') => void;
  exportMode: ExportAudioMode;
  setExportMode: (value: ExportAudioMode) => void;
  onSubmit: () => void;
}

export function BankEditUpdateStoreDialog({
  open,
  onOpenChange,
  theme,
  bank,
  title,
  setTitle,
  description,
  setDescription,
  syncMetadata,
  setSyncMetadata,
  assetProtection,
  setAssetProtection,
  exportMode,
  setExportMode,
  onSubmit,
}: BankEditUpdateStoreDialogProps) {
  const catalogItemId = typeof bank.bankMetadata?.catalogItemId === 'string' ? bank.bankMetadata.catalogItemId.trim() : '';
  const protectionLabel = assetProtection === 'public' ? 'Unencrypted' : 'Encrypted';
  const isDark = theme === 'dark';
  const isNativeCapacitor = typeof window !== 'undefined' && Boolean((window as any).Capacitor?.isNativePlatform?.());
  const isElectronDesktop = typeof window !== 'undefined' && /Electron/i.test(window.navigator.userAgent || '');
  const hasElectronMp3Bridge = typeof window !== 'undefined' && Boolean(window.electronAPI?.transcodeAudioToMp3);

  React.useEffect(() => {
    if (!hasElectronMp3Bridge && exportMode === 'trim_mp3') {
      setExportMode('fast');
    }
  }, [exportMode, hasElectronMp3Bridge, setExportMode]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`sm:max-w-lg backdrop-blur-md ${isDark ? 'bg-gray-800/90' : 'bg-white/90'}`} aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="w-4 h-4" />
            Update Store Bank
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div className={`rounded-lg border p-3 text-sm ${isDark ? 'border-gray-700 bg-gray-900/40 text-gray-200' : 'border-gray-200 bg-gray-50 text-gray-700'}`}>
            <div><span className="font-medium">Linked bank:</span> {bank.name}</div>
            <div className="mt-1"><span className="font-medium">Catalog item:</span> <span className="font-mono text-xs">{catalogItemId || 'Not linked'}</span></div>
            <div className="mt-1"><span className="font-medium">Current output:</span> {protectionLabel}</div>
            <div className="mt-2 text-xs opacity-80">This always saves a local <span className="font-mono">.bank</span> file first, then uploads a new draft asset for the same catalog item.</div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="updateStoreTitle">Store Title</Label>
            <Input
              id="updateStoreTitle"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Bank title"
              maxLength={50}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="updateStoreDescription">Store Description</Label>
            <textarea
              id="updateStoreDescription"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Describe this bank for the store listing"
              maxLength={400}
              className={`min-h-[96px] w-full rounded-md border px-3 py-2 text-sm outline-none ${
                isDark
                  ? 'border-gray-700 bg-gray-900/60 text-white placeholder:text-gray-500'
                  : 'border-gray-300 bg-white text-gray-900 placeholder:text-gray-400'
              }`}
            />
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <div>
              <Label htmlFor="updateStoreSync">Sync title, description, color, and thumbnail</Label>
              <p className={`mt-1 text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                Applies catalog metadata together with this update.
              </p>
            </div>
            <Switch
              id="updateStoreSync"
              checked={syncMetadata}
              onCheckedChange={setSyncMetadata}
            />
          </div>

          <div className="space-y-2">
            <Label>Protection Mode</Label>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={assetProtection === 'encrypted' ? 'default' : 'outline'}
                onClick={() => setAssetProtection('encrypted')}
              >
                Encrypted
              </Button>
              <Button
                type="button"
                variant={assetProtection === 'public' ? 'default' : 'outline'}
                onClick={() => setAssetProtection('public')}
              >
                Unencrypted
              </Button>
            </div>
          </div>

          {assetProtection === 'public' && (
            <div className={`rounded-lg border p-3 text-sm ${isDark ? 'border-amber-800/60 bg-amber-950/30 text-amber-200' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
              <div className="flex items-start gap-2">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <p>Unencrypted output lets anyone inspect the downloaded <span className="font-mono">.bank</span> contents if they get the file.</p>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label>Audio Processing</Label>
            <div className={`grid gap-2 ${hasElectronMp3Bridge ? 'grid-cols-3' : 'grid-cols-2'}`}>
              <Button
                type="button"
                variant={exportMode === 'fast' ? 'default' : 'outline'}
                onClick={() => setExportMode('fast')}
              >
                Fast
              </Button>
              <Button
                type="button"
                variant={exportMode === 'compact' ? 'default' : 'outline'}
                onClick={() => setExportMode('compact')}
              >
                Compact
              </Button>
              {hasElectronMp3Bridge ? (
                <Button
                  type="button"
                  variant={exportMode === 'trim_mp3' ? 'default' : 'outline'}
                  onClick={() => setExportMode('trim_mp3')}
                >
                  Trim + MP3
                </Button>
              ) : null}
            </div>
            <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              {hasElectronMp3Bridge
                ? 'Fast keeps original audio. Compact applies trim windows and can reduce file size. Trim + MP3 trims first when applicable and always exports MP3 at 128 kbps.'
                : 'Fast keeps original audio. Compact applies trim windows and can reduce file size.'}
            </p>
            {!hasElectronMp3Bridge ? (
              <p className={`text-xs ${isDark ? 'text-blue-300' : 'text-blue-700'}`}>
                {isElectronDesktop
                  ? 'Trim + MP3 is unavailable in this Electron build because the MP3 export bridge is missing.'
                  : 'Trim + MP3 is available only in the Electron desktop build.'}
              </p>
            ) : null}
            {isNativeCapacitor && exportMode === 'trim_mp3' ? (
              <p className={`text-xs ${isDark ? 'text-amber-300' : 'text-amber-700'}`}>
                Mobile warning: Trim + MP3 is slower and may fail on very large banks.
              </p>
            ) : null}
          </div>

          <div className={`rounded-lg border p-3 text-sm ${isDark ? 'border-blue-900/60 bg-blue-950/30 text-blue-100' : 'border-blue-200 bg-blue-50 text-blue-900'}`}>
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>The upload only updates the draft asset. Buyers keep access, but they receive the new version only after you publish it and they redownload or refresh assets.</p>
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <Button onClick={onSubmit} className="flex-1" disabled={!title.trim() || !catalogItemId}>
              Update Store Bank
            </Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
