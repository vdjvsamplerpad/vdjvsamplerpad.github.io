import * as React from 'react';
import { AlertCircle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StoreItem } from '@/components/sampler/onlineStore.types';

type OnlineStoreRejectedOverlayProps = {
    isDark: boolean;
    item: StoreItem;
    isOnline: boolean;
    onClose: () => void;
    onRetry: () => void;
};

export function OnlineStoreRejectedOverlay({
    isDark,
    item,
    isOnline,
    onClose,
    onRetry,
}: OnlineStoreRejectedOverlayProps) {
    return (
        <div className="absolute inset-0 z-[70] flex items-center justify-center bg-black/65 p-4">
            <div className={`w-full max-w-md rounded-xl border p-5 shadow-2xl ${isDark ? 'bg-gray-900 border-gray-700 text-white' : 'bg-white border-gray-200 text-gray-900'}`}>
                <div className="space-y-4">
                    <div>
                        <h3 className="flex items-center gap-2 text-lg font-semibold">
                            <AlertCircle className="w-5 h-5 text-red-500" />
                            Purchase Not Approved
                        </h3>
                        <p className={`mt-2 text-sm font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                            {item.bank.title}
                        </p>
                    </div>
                    <div className={`rounded-lg border p-3 text-sm ${isDark ? 'bg-red-500/10 border-red-500/30 text-red-300' : 'bg-red-50 border-red-200 text-red-700'}`}>
                        {item.rejection_message || 'No reason was provided.'}
                    </div>
                    <div className="flex gap-2">
                        <Button
                            variant="outline"
                            onClick={onClose}
                            className={`flex-1 ${isDark ? 'border-gray-700' : ''}`}
                        >
                            Close
                        </Button>
                        <Button
                            disabled={!isOnline}
                            onClick={onRetry}
                            className="flex-1 disabled:opacity-50 bg-indigo-600 hover:bg-indigo-500 text-white"
                        >
                            <RotateCcw className="w-4 h-4 mr-1" /> Try Again
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
