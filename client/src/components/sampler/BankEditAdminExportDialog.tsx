import * as React from 'react';
import { Crown } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { SamplerBank } from './types/sampler';

interface BankEditAdminExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  theme: 'light' | 'dark';
  bank: SamplerBank;
  adminTitle: string;
  setAdminTitle: (value: string) => void;
  adminDescription: string;
  setAdminDescription: (value: string) => void;
  adminAddToDatabase: boolean;
  setAdminAddToDatabase: (value: boolean) => void;
  adminAllowExport: boolean;
  setAdminAllowExport: (value: boolean) => void;
  adminPublicCatalogAsset: boolean;
  setAdminPublicCatalogAsset: (value: boolean) => void;
  adminExportMode: 'fast' | 'compact';
  setAdminExportMode: (value: 'fast' | 'compact') => void;
  onExport: () => void;
}

export function BankEditAdminExportDialog({
  open,
  onOpenChange,
  theme,
  bank,
  adminTitle,
  setAdminTitle,
  adminDescription,
  setAdminDescription,
  adminAddToDatabase,
  setAdminAddToDatabase,
  adminAllowExport,
  setAdminAllowExport,
  adminPublicCatalogAsset,
  setAdminPublicCatalogAsset,
  adminExportMode,
  setAdminExportMode,
  onExport,
}: BankEditAdminExportDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`sm:max-w-md backdrop-blur-md ${theme === 'dark' ? 'bg-gray-800/90' : 'bg-white/90'}`} aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Crown className="w-4 h-4" />
            Export as Admin Bank
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="adminTitle">Bank Title</Label>
            <Input
              id="adminTitle"
              value={adminTitle}
              onChange={(e) => setAdminTitle(e.target.value)}
              placeholder="Enter bank title"
              className="backdrop-blur-sm"
              maxLength={50}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="adminDescription">Description</Label>
            <textarea
              id="adminDescription"
              value={adminDescription}
              onChange={(e) => setAdminDescription(e.target.value)}
              placeholder="Enter bank description"
              className={`w-full min-h-[80px] p-3 rounded-md border backdrop-blur-sm resize-none ${
                theme === 'dark'
                  ? 'bg-gray-700/50 border-gray-600 text-white placeholder-gray-400'
                  : 'bg-white/50 border-gray-300 text-gray-900 placeholder-gray-500'
              }`}
              maxLength={200}
            />
          </div>

          <div className="space-y-2">
            <Label>Thumbnail</Label>
            <div className="flex items-center gap-3">
              {bank.bankMetadata?.thumbnailUrl ? (
                <img src={bank.bankMetadata.thumbnailUrl} alt="Thumbnail" className="w-16 h-16 rounded-md object-cover border" />
              ) : (
                <div className={`w-16 h-16 rounded-md border flex items-center justify-center text-xs ${theme === 'dark' ? 'border-gray-600 text-gray-400' : 'border-gray-300 text-gray-500'}`}>
                  None
                </div>
              )}
              <p className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                Uses the saved Bank Edit thumbnail. Edit it from the main Bank Edit dialog.
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="adminAddToDatabase">Add to Database</Label>
              <p className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                Official bank with user access control (export automatically disabled)
              </p>
            </div>
            <Switch
              id="adminAddToDatabase"
              checked={adminAddToDatabase}
              onCheckedChange={(checked) => {
                setAdminAddToDatabase(checked);
                if (checked) {
                  setAdminAllowExport(false);
                } else {
                  setAdminPublicCatalogAsset(false);
                }
              }}
            />
          </div>

          {adminAddToDatabase && (
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="adminPublicCatalogAsset">Unencrypted Output</Label>
                <p className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                  Store file is not encrypted. You can still list it as free or paid later, but users can inspect the file contents.
                </p>
              </div>
              <Switch
                id="adminPublicCatalogAsset"
                checked={adminPublicCatalogAsset}
                onCheckedChange={setAdminPublicCatalogAsset}
              />
            </div>
          )}

          {!adminAddToDatabase && (
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="adminAllowExport">Unencrypted Output</Label>
                <p className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                  No encryption for exported file. Imported users can export it again.
                </p>
              </div>
              <Switch
                id="adminAllowExport"
                checked={adminAllowExport}
                onCheckedChange={setAdminAllowExport}
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="adminExportMode">Audio Processing</Label>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={adminExportMode === 'fast' ? 'default' : 'outline'}
                onClick={() => setAdminExportMode('fast')}
              >
                Fast
              </Button>
              <Button
                type="button"
                variant={adminExportMode === 'compact' ? 'default' : 'outline'}
                onClick={() => setAdminExportMode('compact')}
              >
                Compact
              </Button>
            </div>
            <p className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
              Fast keeps original audio. Compact applies trim window and may reduce size.
            </p>
          </div>

          <div className="flex gap-2 pt-4">
            <Button onClick={onExport} className="flex-1" disabled={!adminTitle.trim()}>
              Export Admin Bank
            </Button>
            <Button onClick={() => onOpenChange(false)} variant="outline">
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
