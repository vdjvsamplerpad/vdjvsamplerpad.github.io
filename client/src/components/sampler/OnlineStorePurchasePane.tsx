import * as React from 'react';
import { ArrowRight, Download, ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    PaymentChannel,
    PaymentConfig,
    StoreItem,
} from '@/components/sampler/onlineStore.types';

type OnlineStorePurchasePaneProps = {
    isDark: boolean;
    checkoutMode: boolean;
    cartItems: StoreItem[];
    cartTotal: number;
    selectedItem: StoreItem | null;
    paymentConfig: PaymentConfig | null;
    setExpandedQrUrl: (url: string | null) => void;
    downloadQrImage: (url: string) => Promise<void>;
    handlePurchaseSubmit: (e: React.FormEvent) => void | Promise<void>;
    formChannel: PaymentChannel;
    setFormChannel: (channel: PaymentChannel) => void;
    formName: string;
    setFormName: (value: string) => void;
    formRef: string;
    setFormRef: (value: string) => void;
    proofOcrLoading: boolean;
    proofPreviewUrl: string | null;
    formProofFile: File | null;
    handleProofUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
    submitLoading: boolean;
    setFormProofFile: (file: File | null) => void;
    formNotes: string;
    setFormNotes: (value: string) => void;
    onCancel: () => void;
};

export function OnlineStorePurchasePane({
    isDark,
    checkoutMode,
    cartItems,
    cartTotal,
    selectedItem,
    paymentConfig,
    setExpandedQrUrl,
    downloadQrImage,
    handlePurchaseSubmit,
    formChannel,
    setFormChannel,
    formName,
    setFormName,
    formRef,
    setFormRef,
    proofOcrLoading,
    proofPreviewUrl,
    formProofFile,
    handleProofUpload,
    submitLoading,
    setFormProofFile,
    formNotes,
    setFormNotes,
    onCancel,
}: OnlineStorePurchasePaneProps) {
    return (
        <div className="max-w-xl mx-auto space-y-8">
            {checkoutMode && cartItems.length > 0 && (
                <div className={`p-4 rounded-xl border ${isDark ? 'bg-gray-800/50 border-gray-700' : 'bg-white border-gray-200'} shadow-sm`}>
                    <h3 className={`font-semibold text-sm mb-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>Cart Items ({cartItems.length})</h3>
                    <div className="space-y-1">
                        {cartItems.map(ci => (
                            <div key={ci.id} className={`flex items-center justify-between py-1 text-sm ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                                <span className="truncate">{ci.bank.title}</span>
                                <span className="shrink-0 font-medium">{ci.is_paid ? (ci.price_php !== null ? `PHP ${ci.price_php.toLocaleString()}` : 'Price to be announced') : 'Free'}</span>
                            </div>
                        ))}
                        <div className={`border-t pt-1 mt-1 flex justify-between font-semibold text-sm ${isDark ? 'border-gray-700 text-white' : 'border-gray-200 text-gray-900'}`}>
                            <span>Total</span>
                            <span>PHP {cartTotal.toLocaleString()}</span>
                        </div>
                    </div>
                </div>
            )}
            {!checkoutMode && selectedItem && (
                <div className={`p-4 rounded-xl border ${isDark ? 'bg-gray-800/50 border-gray-700' : 'bg-white border-gray-200'} shadow-sm`}>
                    <h3 className={`font-semibold text-sm mb-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>Selected Bank</h3>
                    <div className={`flex items-center justify-between py-1 text-sm ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                        <span className="truncate">{selectedItem.bank.title}</span>
                        <span className="shrink-0 font-medium">
                            {selectedItem.is_paid
                                ? (selectedItem.price_php !== null ? `PHP ${selectedItem.price_php.toLocaleString()}` : 'Price to be announced')
                                : 'Free'}
                        </span>
                    </div>
                    <div className={`border-t pt-1 mt-1 flex justify-between font-semibold text-sm ${isDark ? 'border-gray-700 text-white' : 'border-gray-200 text-gray-900'}`}>
                        <span>Total</span>
                        <span>
                            {selectedItem.is_paid
                                ? (selectedItem.price_php !== null ? `PHP ${selectedItem.price_php.toLocaleString()}` : 'Price to be announced')
                                : 'Free'}
                        </span>
                    </div>
                </div>
            )}
            <div className={`p-5 rounded-xl border ${isDark ? 'bg-gray-800/50 border-gray-700' : 'bg-white border-gray-200'} shadow-sm`}>
                <h3 className={`font-semibold text-lg mb-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>Instructions</h3>
                <div className={`text-sm whitespace-pre-wrap leading-relaxed ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                    {paymentConfig?.instructions || 'Please contact the administrator.'}
                </div>

                {(paymentConfig?.gcash_number || paymentConfig?.maya_number) && (
                    <div className="mt-4 grid grid-cols-2 gap-4">
                        {paymentConfig.gcash_number && (
                            <div className={`p-3 rounded-lg border flex flex-col gap-1 items-center justify-center text-center ${isDark ? 'bg-blue-900/20 border-blue-500/30' : 'bg-blue-50 border-blue-100'}`}>
                                <span className="text-xs font-bold text-blue-500 uppercase tracking-wider">GCash</span>
                                <span className={`font-mono text-lg font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>{paymentConfig.gcash_number}</span>
                            </div>
                        )}
                        {paymentConfig.maya_number && (
                            <div className={`p-3 rounded-lg border flex flex-col gap-1 items-center justify-center text-center ${isDark ? 'bg-green-900/20 border-green-500/30' : 'bg-green-50 border-green-100'}`}>
                                <span className="text-xs font-bold text-green-500 uppercase tracking-wider">Maya</span>
                                <span className={`font-mono text-lg font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>{paymentConfig.maya_number}</span>
                            </div>
                        )}
                    </div>
                )}

                {paymentConfig?.messenger_url && (
                    <div className="mt-4 flex justify-center">
                        <a
                            href={paymentConfig.messenger_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`inline-flex items-center gap-2 text-sm font-medium transition-colors ${isDark ? 'text-indigo-400 hover:text-indigo-300' : 'text-indigo-600 hover:text-indigo-700'}`}
                        >
                            <ExternalLink className="w-4 h-4" /> Message on Facebook
                        </a>
                    </div>
                )}

                {paymentConfig?.qr_image_path && (
                    <div className="mt-4 flex flex-col items-center justify-center pt-4 border-t border-gray-100 dark:border-gray-800">
                        <span className={`text-sm font-medium mb-3 tracking-wide ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>Scan to Pay</span>
                        <button
                            type="button"
                            onClick={() => setExpandedQrUrl(paymentConfig.qr_image_path || null)}
                            className="rounded-xl border p-1 bg-white hover:opacity-90 transition-opacity"
                        >
                            <img src={paymentConfig.qr_image_path} alt="Payment QR" className="w-[180px] h-[180px] rounded-xl shadow-sm object-cover" />
                        </button>
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="mt-2 h-7 text-xs"
                            onClick={() => void downloadQrImage(paymentConfig.qr_image_path!)}
                        >
                            <Download className="w-3.5 h-3.5 mr-1" />
                            Download QR
                        </Button>
                    </div>
                )}
            </div>

            <form onSubmit={handlePurchaseSubmit} className="space-y-5">
                <div className="space-y-1.5">
                    <label className={`text-sm font-medium ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>Payment Channel</label>
                    <select
                        value={formChannel}
                        onChange={e => setFormChannel(e.target.value as PaymentChannel)}
                        className={`w-full rounded-md border p-2.5 outline-none focus:ring-2 focus:ring-indigo-500/50 transition-shadow ${isDark ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'}`}
                        required
                    >
                        <option value="image_proof">Upload Receipt / Image Proof</option>
                        <option value="gcash_manual">GCash Manual</option>
                        <option value="maya_manual">Maya Manual</option>
                    </select>
                </div>

                {(formChannel === 'gcash_manual' || formChannel === 'maya_manual') && (
                    <>
                        <div className="space-y-1.5">
                            <label className={`text-sm font-medium flex items-center justify-between ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>
                                <span>Account Name <span className="text-red-500">*</span></span>
                                <span className={`text-xs font-normal ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>The name used to send payment</span>
                            </label>
                            <input
                                type="text"
                                value={formName}
                                onChange={e => setFormName(e.target.value)}
                                required
                                placeholder="e.g. John Doe"
                                className={`w-full rounded-md border p-2.5 outline-none focus:ring-2 focus:ring-indigo-500/50 transition-shadow ${isDark ? 'bg-gray-800 border-gray-700 text-white placeholder:text-gray-500' : 'bg-white border-gray-300 text-gray-900 placeholder:text-gray-400'}`}
                            />
                        </div>

                        <div className="space-y-1.5">
                            <label className={`text-sm font-medium flex items-center justify-between ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>
                                <span>Reference / Transaction Number <span className="text-red-500">*</span></span>
                            </label>
                            <input
                                type="text"
                                value={formRef}
                                onChange={e => setFormRef(e.target.value)}
                                required
                                placeholder="e.g. 1002348572"
                                className={`w-full rounded-md border p-2.5 outline-none focus:ring-2 focus:ring-indigo-500/50 transition-shadow ${isDark ? 'bg-gray-800 border-gray-700 text-white placeholder:text-gray-500' : 'bg-white border-gray-300 text-gray-900 placeholder:text-gray-400'}`}
                            />
                        </div>
                    </>
                )}

                <div className="space-y-1.5">
                    <label className={`text-sm font-medium flex items-center justify-between ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>
                        <span>Upload Receipt / Image Proof {formChannel === 'image_proof' ? <span className="text-red-500">*</span> : <span className={`text-xs font-normal ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>(Optional)</span>}</span>
                    </label>
                    {formChannel === 'image_proof' && (
                        <>
                            <input type="hidden" name="purchaseReferenceNoHidden" value={formRef} readOnly />
                            {proofOcrLoading && (
                                <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                    Detecting reference number from receipt...
                                </p>
                            )}
                        </>
                    )}
                    <div className="flex items-center gap-4">
                        {proofPreviewUrl && (
                            <img src={proofPreviewUrl} alt="Proof" className="w-16 h-16 rounded-md object-cover border" />
                        )}
                        <div className="flex-1">
                            <input
                                type="file"
                                accept="image/*"
                                required={formChannel === 'image_proof'}
                                onChange={handleProofUpload}
                                disabled={submitLoading}
                                className={`w-full rounded-md border p-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500/50 transition-shadow ${isDark ? 'bg-gray-800 border-gray-700 text-white text-gray-300' : 'bg-white border-gray-300 text-gray-900'}`}
                            />
                        </div>
                        {formProofFile && (
                            <Button type="button" size="sm" variant="outline" onClick={() => { setFormProofFile(null); }} className={`shrink-0 ${isDark ? 'border-red-900 hover:bg-red-900/20 text-red-500' : 'text-red-500'}`}>Remove</Button>
                        )}
                    </div>
                </div>

                <div className="space-y-1.5">
                    <label className={`text-sm font-medium ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>
                        Additional Notes (Optional)
                    </label>
                    <textarea
                        value={formNotes}
                        onChange={e => setFormNotes(e.target.value)}
                        rows={3}
                        className={`w-full rounded-md border p-2.5 outline-none focus:ring-2 focus:ring-indigo-500/50 transition-shadow resize-none ${isDark ? 'bg-gray-800 border-gray-700 text-white placeholder:text-gray-500' : 'bg-white border-gray-300 text-gray-900 placeholder:text-gray-400'}`}
                    />
                </div>

                <div className="flex items-center gap-3 pt-4">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={onCancel}
                        disabled={submitLoading}
                        className={`flex-1 ${isDark ? 'border-gray-700 hover:bg-gray-800 text-gray-300' : 'hover:bg-gray-100'}`}
                    >
                        Cancel
                    </Button>
                    <Button
                        type="submit"
                        disabled={submitLoading}
                        className={`flex-1 ${isDark ? 'bg-indigo-600 hover:bg-indigo-500 text-white' : 'bg-indigo-600 hover:bg-indigo-700 text-white'}`}
                    >
                        {submitLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ArrowRight className="w-4 h-4 mr-2" />}
                        Submit Purchase Request
                    </Button>
                </div>
            </form>
        </div>
    );
}
