import * as React from 'react';
import { Check, ArrowRight, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StoreItem } from '@/components/sampler/onlineStore.types';

type OnlineStoreCartBarProps = {
    isDark: boolean;
    itemCount: number;
    cartItems: StoreItem[];
    cartTotal: number;
    cartViewOpen: boolean;
    onToggleCartView: () => void;
    onCloseCartView: () => void;
    onRemoveItem: (itemId: string) => void;
    onClearCart: () => void;
    onCheckout: () => void;
};

export function OnlineStoreCartBar({
    isDark,
    itemCount,
    cartItems,
    cartTotal,
    cartViewOpen,
    onToggleCartView,
    onCloseCartView,
    onRemoveItem,
    onClearCart,
    onCheckout,
}: OnlineStoreCartBarProps) {
    return (
        <div className={`shrink-0 border-t px-4 py-2 ${isDark ? 'bg-gray-800/90 border-gray-700' : 'bg-white/90 border-gray-200'}`}>
            {cartViewOpen && (
                <div className={`mb-2 p-3 rounded-lg border max-h-[200px] overflow-y-auto ${isDark ? 'bg-gray-900 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
                    <div className="flex justify-between items-center mb-2">
                        <span className={`text-xs font-bold uppercase tracking-wide ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Cart Items</span>
                        <button onClick={onCloseCartView} className={`text-xs ${isDark ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'}`}>
                            <X className="w-3.5 h-3.5" />
                        </button>
                    </div>
                    <div className="space-y-1">
                        {cartItems.map(ci => (
                            <div key={ci.id} className={`flex items-center justify-between py-1 text-xs ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                                <span className="truncate flex-1">{ci.bank.title}</span>
                                <span className="shrink-0 font-medium ml-2">{ci.is_paid ? (ci.price_php !== null ? `PHP ${ci.price_php.toLocaleString()}` : 'Price to be announced') : 'Free'}</span>
                                <button onClick={() => onRemoveItem(ci.id)} className="ml-2 text-red-400 hover:text-red-500"><X className="w-3 h-3" /></button>
                            </div>
                        ))}
                    </div>
                    <div className={`border-t pt-1 mt-1 flex justify-between font-semibold text-xs ${isDark ? 'border-gray-700 text-white' : 'border-gray-200 text-gray-900'}`}>
                        <span>Total</span>
                        <span>PHP {cartTotal.toLocaleString()}</span>
                    </div>
                </div>
            )}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <span className={`text-xs font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>{itemCount} item{itemCount > 1 ? 's' : ''}</span>
                    <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>PHP {cartTotal.toLocaleString()}</span>
                </div>
                <div className="flex gap-1.5">
                    <Button size="sm" variant="outline" onClick={onToggleCartView} className={`h-7 px-2 text-xs ${isDark ? 'border-gray-600 text-gray-400' : ''}`}>
                        {cartViewOpen ? <X className="w-3 h-3 mr-1" /> : <Check className="w-3 h-3 mr-1" />}
                        {cartViewOpen ? 'Hide' : 'View'} Cart
                    </Button>
                    <Button size="sm" variant="outline" onClick={onClearCart} className={`h-7 px-2 text-xs ${isDark ? 'border-gray-600 text-gray-300' : ''}`}>
                        Clear
                    </Button>
                    <Button size="sm" onClick={onCheckout} className={`h-7 px-2.5 text-xs ${isDark ? 'bg-indigo-600 hover:bg-indigo-500 text-white' : 'bg-indigo-600 hover:bg-indigo-700 text-white'}`}>
                        Checkout <ArrowRight className="w-3 h-3 ml-1" />
                    </Button>
                </div>
            </div>
        </div>
    );
}
