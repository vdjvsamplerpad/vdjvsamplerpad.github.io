import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { AdminBank, AdminUser, BankAccessEntry } from '@/lib/admin-api';
import { Eye, EyeOff, Loader2, Search, UserPlus, Users } from 'lucide-react';
import {
  colorOptions,
  isUserBanned,
  type AdminDialogTheme,
  type CatalogDraft,
} from './AdminAccessDialog.shared';
import { Pagination } from './AdminAccessDialog.widgets';

interface AdminAccessDialogModalsProps {
  theme: AdminDialogTheme;
  create: {
    open: boolean;
    email: string;
    password: string;
    showPassword: boolean;
    displayName: string;
    loading: boolean;
    onOpenChange: (open: boolean) => void;
    onEmailChange: (value: string) => void;
    onPasswordChange: (value: string) => void;
    onToggleShowPassword: () => void;
    onDisplayNameChange: (value: string) => void;
    onSubmit: () => void;
  };
  details: {
    open: boolean;
    user: AdminUser | null;
    displayName: string;
    ownedBankQuota: string;
    ownedBankPadCap: string;
    deviceTotalBankCap: string;
    saving: boolean;
    onOpenChange: (open: boolean) => void;
    onDisplayNameChange: (value: string) => void;
    onOwnedBankQuotaChange: (value: string) => void;
    onOwnedBankPadCapChange: (value: string) => void;
    onDeviceTotalBankCapChange: (value: string) => void;
    onSaveProfile: () => void;
    onOpenResetPassword: () => void;
    onOpenUnban: () => void;
    onOpenBan: () => void;
    onOpenDeleteUser: () => void;
  };
  ban: {
    open: boolean;
    hours: number;
    onOpenChange: (open: boolean) => void;
    onHoursChange: (value: number) => void;
    onConfirm: () => void;
  };
  bankEdit: {
    open: boolean;
    title: string;
    description: string;
    color: string;
    saving: boolean;
    onOpenChange: (open: boolean) => void;
    onTitleChange: (value: string) => void;
    onDescriptionChange: (value: string) => void;
    onColorChange: (value: string) => void;
    onSave: () => void;
  };
  bankAccess: {
    open: boolean;
    bank: AdminBank | null;
    loading: boolean;
    rows: BankAccessEntry[];
    page: number;
    total: number;
    totalPages: number;
    search: string;
    onOpenChange: (open: boolean) => void;
    onSearchChange: (value: string) => void;
    onPageChange: (page: number) => void;
  };
  confirmations: {
    deleteUserOpen: boolean;
    unbanOpen: boolean;
    resetPasswordOpen: boolean;
    deleteBankOpen: boolean;
    deleteBank: AdminBank | null;
    detailsUser: AdminUser | null;
    onDeleteUserOpenChange: (open: boolean) => void;
    onUnbanOpenChange: (open: boolean) => void;
    onResetPasswordOpenChange: (open: boolean) => void;
    onDeleteBankOpenChange: (open: boolean) => void;
    onDeleteUserConfirm: () => void;
    onUnbanConfirm: () => void;
    onResetPasswordConfirm: () => void;
    onDeleteBankConfirm: () => void;
  };
  storePublish: {
    open: boolean;
    draft: CatalogDraft | null;
    loading: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: () => void;
  };
  storeRequestReject: {
    value: { id: string; message: string } | null;
    onChange: (value: { id: string; message: string } | null) => void;
    onConfirm: (value: { id: string; message: string }) => void;
  };
  accountRequestReject: {
    value: { id: string; message: string } | null;
    onChange: (value: { id: string; message: string } | null) => void;
    onConfirm: (value: { id: string; message: string }) => void;
  };
  accountAssist: {
    value: { id: string } | null;
    onChange: (value: { id: string } | null) => void;
    onConfirm: (value: { id: string }) => void;
  };
}

export function AdminAccessDialogModals({
  theme,
  create,
  details,
  ban,
  bankEdit,
  bankAccess,
  confirmations,
  storePublish,
  storeRequestReject,
  accountRequestReject,
  accountAssist,
}: AdminAccessDialogModalsProps) {
  return (
    <>
      <Dialog open={create.open} onOpenChange={create.onOpenChange} useHistory={false}>
        <DialogContent overlayClassName="z-[110]" aria-describedby={undefined} className={`${theme === 'dark' ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'} z-[120]`}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="w-4 h-4" />
              Add User
            </DialogTitle>
          </DialogHeader>
          <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); create.onSubmit(); }}>
            <div><Label>Email</Label><Input type="email" autoComplete="email" value={create.email} onChange={(event) => create.onEmailChange(event.target.value)} placeholder="user@example.com" /></div>
            <div className="space-y-1">
              <Label>Password</Label>
              <div className="relative">
                <Input type={create.showPassword ? 'text' : 'password'} value={create.password} onChange={(event) => create.onPasswordChange(event.target.value)} placeholder="Minimum 6 characters" autoComplete="new-password" />
                <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-800" onClick={create.onToggleShowPassword} aria-label={create.showPassword ? 'Hide password' : 'Show password'}>
                  {create.showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div><Label>Display Name</Label><Input value={create.displayName} onChange={(event) => create.onDisplayNameChange(event.target.value)} placeholder="Optional" /></div>
            <div className="text-xs opacity-70">User is auto-confirmed.</div>
            <div className="flex gap-2">
              <Button type="submit" className="flex-1" disabled={create.loading}>{create.loading ? 'Creating...' : 'Create User'}</Button>
              <Button type="button" variant="outline" onClick={() => create.onOpenChange(false)}>Cancel</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={details.open} onOpenChange={details.onOpenChange} useHistory={false}>
        <DialogContent overlayClassName="z-[110]" aria-describedby={undefined} className={`${theme === 'dark' ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'} z-[120]`}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="w-4 h-4" />
              User Details
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <div><Label>Display Name</Label><Input value={details.displayName} onChange={(event) => details.onDisplayNameChange(event.target.value)} /></div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <div>
                <Label>Bank Quota</Label>
                <Input
                  type="number"
                  min={1}
                  max={500}
                  value={details.ownedBankQuota}
                  onChange={(event) => details.onOwnedBankQuotaChange(event.target.value)}
                />
              </div>
              <div>
                <Label>Pad Cap</Label>
                <Input
                  type="number"
                  min={1}
                  max={256}
                  value={details.ownedBankPadCap}
                  onChange={(event) => details.onOwnedBankPadCapChange(event.target.value)}
                />
              </div>
              <div>
                <Label>Bank Cap</Label>
                <Input
                  type="number"
                  min={10}
                  max={1000}
                  value={details.deviceTotalBankCap}
                  onChange={(event) => details.onDeviceTotalBankCapChange(event.target.value)}
                />
              </div>
            </div>
            <div><Label>Email</Label><div>{details.user?.email || '-'}</div></div>
            <div><Label>User ID</Label><div className="font-mono text-xs break-all">{details.user?.id || '-'}</div></div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div><Label>Created</Label><div>{details.user?.created_at ? new Date(details.user.created_at).toLocaleString() : '-'}</div></div>
              <div><Label>Last Sign-In</Label><div>{details.user?.last_sign_in_at ? new Date(details.user.last_sign_in_at).toLocaleString() : '-'}</div></div>
            </div>
            <div className="flex gap-2">
              <Button className="flex-1" disabled={details.saving} onClick={details.onSaveProfile}>{details.saving ? 'Saving...' : 'Save Profile'}</Button>
              <Button variant="outline" className="flex-1" onClick={details.onOpenResetPassword}>Send Password Reset</Button>
            </div>
            <div className="flex gap-2">
              {isUserBanned(details.user) ? <Button variant="outline" className="flex-1" onClick={details.onOpenUnban}>Unban User</Button> : <Button variant="outline" className="flex-1" onClick={details.onOpenBan}>Ban User</Button>}
              <Button variant="destructive" className="flex-1" onClick={details.onOpenDeleteUser}>Delete User</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={ban.open} onOpenChange={ban.onOpenChange} useHistory={false}>
        <DialogContent overlayClassName="z-[110]" aria-describedby={undefined} className={`${theme === 'dark' ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'} z-[120]`}>
          <DialogHeader><DialogTitle>Ban User</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <div><Label>Ban Duration (hours)</Label><Input type="number" min={1} max={8760} value={ban.hours} onChange={(event) => ban.onHoursChange(Math.max(1, Math.min(8760, Number(event.target.value) || 24)))} /></div>
            <div className="text-xs opacity-70">Ban until: {new Date(Date.now() + ban.hours * 60 * 60 * 1000).toLocaleString()}</div>
            <div className="flex gap-2">
              <Button variant="destructive" className="flex-1" onClick={ban.onConfirm}>Ban User</Button>
              <Button variant="outline" onClick={() => ban.onOpenChange(false)}>Cancel</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={bankEdit.open} onOpenChange={bankEdit.onOpenChange} useHistory={false}>
        <DialogContent overlayClassName="z-[110]" aria-describedby={undefined} className={`${theme === 'dark' ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'} z-[120]`}>
          <DialogHeader><DialogTitle>Edit Bank</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <div><Label>Title</Label><Input value={bankEdit.title} onChange={(event) => bankEdit.onTitleChange(event.target.value)} /></div>
            <div><Label>Description</Label><textarea className={`w-full min-h-[120px] rounded border p-2 ${theme === 'dark' ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'}`} value={bankEdit.description} onChange={(event) => bankEdit.onDescriptionChange(event.target.value)} /></div>
            <div className="space-y-1">
              <Label>Bank Color</Label>
              <div className="flex flex-wrap gap-1">
                {colorOptions.map((option) => (
                  <button key={option.value} type="button" title={option.label} className={`w-6 h-6 rounded-full border-2 ${bankEdit.color === option.value ? 'border-white scale-110' : 'border-gray-500'}`} style={{ backgroundColor: option.value }} onClick={() => bankEdit.onColorChange(option.value)} />
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <Button className="flex-1" disabled={bankEdit.saving} onClick={bankEdit.onSave}>{bankEdit.saving ? 'Saving...' : 'Save'}</Button>
              <Button variant="outline" onClick={() => bankEdit.onOpenChange(false)}>Cancel</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={bankAccess.open} onOpenChange={bankAccess.onOpenChange} useHistory={false}>
        <DialogContent overlayClassName="z-[110]" aria-describedby={undefined} className={`${theme === 'dark' ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'} z-[120] max-w-3xl`}>
          <DialogHeader>
            <DialogTitle>Bank Access Users</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="text-sm font-medium truncate" title={bankAccess.bank?.title || ''}>{bankAccess.bank?.title || 'Bank'}</div>
              <span className={`text-xs px-2 py-0.5 rounded border ${theme === 'dark' ? 'border-gray-700 text-gray-300' : 'border-gray-300 text-gray-700'}`}>Total {bankAccess.total}</span>
              <div className="flex-1" />
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 opacity-50" />
                <Input value={bankAccess.search} onChange={(event) => bankAccess.onSearchChange(event.target.value)} placeholder="Search display name or full user id..." className={`h-8 pl-7 text-xs w-64 ${theme === 'dark' ? 'bg-gray-800 border-gray-700' : ''}`} />
              </div>
            </div>

            <div className={`rounded border max-h-[52vh] overflow-auto ${theme === 'dark' ? 'border-gray-700' : 'border-gray-200'}`}>
              {bankAccess.loading ? (
                <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin" /></div>
              ) : bankAccess.rows.length === 0 ? (
                <div className="py-8 text-center text-sm opacity-70">No users found for this bank.</div>
              ) : (
                <div className="divide-y divide-gray-200 dark:divide-gray-800">
                  {bankAccess.rows.map((row) => (
                    <div key={row.id} className="p-2.5">
                      <div className="flex items-center gap-2">
                        <div className="font-medium text-sm truncate">{row.user.display_name || 'User'}</div>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase ${row.user.role === 'admin' ? 'bg-violet-500/20 text-violet-500' : 'bg-cyan-500/20 text-cyan-500'}`}>{row.user.role}</span>
                      </div>
                      <div className={`text-xs mt-0.5 truncate ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>{row.user.email || 'No email'}</div>
                      <div className={`text-[11px] mt-1 font-mono truncate ${theme === 'dark' ? 'text-gray-500' : 'text-gray-500'}`} title={row.user_id}>{row.user_id}</div>
                      <div className={`text-[11px] mt-0.5 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>Granted: {row.granted_at ? new Date(row.granted_at).toLocaleString() : '-'}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Pagination page={bankAccess.page} totalPages={bankAccess.totalPages} onPageChange={bankAccess.onPageChange} />
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmationDialog open={confirmations.deleteUserOpen} onOpenChange={confirmations.onDeleteUserOpenChange} title="Delete User" description="This will permanently delete the user account. This action cannot be undone." confirmText="Delete User" variant="destructive" onConfirm={confirmations.onDeleteUserConfirm} theme={theme} />
      <ConfirmationDialog open={confirmations.unbanOpen} onOpenChange={confirmations.onUnbanOpenChange} title="Unban User" description={`Unban "${confirmations.detailsUser?.display_name || confirmations.detailsUser?.email || 'this user'}"?`} confirmText="Unban User" onConfirm={confirmations.onUnbanConfirm} theme={theme} />
      <ConfirmationDialog open={confirmations.resetPasswordOpen} onOpenChange={confirmations.onResetPasswordOpenChange} title="Send Password Reset" description={`Send password reset email to "${confirmations.detailsUser?.email || 'this user'}"?`} confirmText="Send Reset" onConfirm={confirmations.onResetPasswordConfirm} theme={theme} />
      <ConfirmationDialog open={confirmations.deleteBankOpen} onOpenChange={confirmations.onDeleteBankOpenChange} title="Archive Bank" description={`Archive "${confirmations.deleteBank?.title || 'this bank'}", unpublish it from store, and revoke all user access?`} confirmText="Archive Bank" variant="destructive" onConfirm={confirmations.onDeleteBankConfirm} theme={theme} />

      <Dialog open={storePublish.open} onOpenChange={storePublish.onOpenChange} useHistory={false}>
        <DialogContent overlayClassName="z-[110]" aria-describedby={undefined} className={`${theme === 'dark' ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'} z-[120]`}>
          <DialogHeader>
            <DialogTitle>Publish to Store</DialogTitle>
          </DialogHeader>
          {storePublish.draft?.coming_soon ? (
            <>
              <p className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>This will publish a Coming Soon teaser for this catalog item.</p>
              <p className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>No archive upload is required. Users will only see the title, description, and thumbnail until a live bank asset is uploaded later.</p>
            </>
          ) : (
            <>
              <p className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>This will publish the latest uploaded R2 object for this catalog item.</p>
              <p className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>We will verify that <span className="font-mono bg-black/10 px-1 rounded">{storePublish.draft?.expected_asset_name}</span> exists in storage before publish.</p>
            </>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => storePublish.onOpenChange(false)}>Cancel</Button>
            <Button onClick={storePublish.onConfirm} disabled={storePublish.loading} className="bg-indigo-600 hover:bg-indigo-500 text-white">Confirm Publish</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(storeRequestReject.value)} onOpenChange={(nextOpen) => { if (!nextOpen) storeRequestReject.onChange(null); }} useHistory={false}>
        <DialogContent overlayClassName="z-[110]" aria-describedby={undefined} className={`${theme === 'dark' ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'} z-[120]`}>
          <DialogHeader>
            <DialogTitle>Decline Purchase Request</DialogTitle>
          </DialogHeader>
          <p className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>This will reject all banks in this checkout. The user will see your rejection message.</p>
          <textarea value={storeRequestReject.value?.message || ''} onChange={(event) => storeRequestReject.onChange(storeRequestReject.value ? { ...storeRequestReject.value, message: event.target.value } : storeRequestReject.value)} placeholder="Reason for rejection (shown to user)..." rows={3} autoFocus className={`w-full rounded-md border p-2.5 text-sm outline-none focus:ring-2 focus:ring-red-500/50 resize-none ${theme === 'dark' ? 'bg-gray-800 border-gray-700 text-white placeholder:text-gray-500' : 'bg-white border-gray-300 text-gray-900 placeholder:text-gray-400'}`} />
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => storeRequestReject.onChange(null)} className={`flex-1 ${theme === 'dark' ? 'border-gray-700' : ''}`}>Cancel</Button>
            <Button variant="destructive" onClick={() => storeRequestReject.value && storeRequestReject.onConfirm(storeRequestReject.value)} className="flex-1">Reject</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(accountRequestReject.value)} onOpenChange={(nextOpen) => { if (!nextOpen) accountRequestReject.onChange(null); }} useHistory={false}>
        <DialogContent overlayClassName="z-[110]" aria-describedby={undefined} className={`${theme === 'dark' ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'} z-[120]`}>
          <DialogHeader>
            <DialogTitle>Reject Account Registration</DialogTitle>
          </DialogHeader>
          <p className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>Enter a rejection reason. This note will be shown to the user.</p>
          <textarea value={accountRequestReject.value?.message || ''} onChange={(event) => accountRequestReject.onChange(accountRequestReject.value ? { ...accountRequestReject.value, message: event.target.value } : accountRequestReject.value)} placeholder="Reason for rejection..." rows={3} autoFocus className={`w-full rounded-md border p-2.5 text-sm outline-none focus:ring-2 focus:ring-red-500/50 resize-none ${theme === 'dark' ? 'bg-gray-800 border-gray-700 text-white placeholder:text-gray-500' : 'bg-white border-gray-300 text-gray-900 placeholder:text-gray-400'}`} />
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => accountRequestReject.onChange(null)} className={`flex-1 ${theme === 'dark' ? 'border-gray-700' : ''}`}>Cancel</Button>
            <Button variant="destructive" onClick={() => accountRequestReject.value && accountRequestReject.onConfirm(accountRequestReject.value)} className="flex-1">Reject</Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        open={Boolean(accountAssist.value)}
        onOpenChange={(nextOpen) => { if (!nextOpen) accountAssist.onChange(null); }}
        title="Approve Without Email"
        description="Use this only when the email is missing or unusable. The account will be approved without sending notification, and the user will keep the password they submitted during registration."
        confirmText="Approve Without Email"
        theme={theme}
        onConfirm={() => {
          if (!accountAssist.value) return;
          accountAssist.onConfirm(accountAssist.value);
        }}
      />
    </>
  );
}
