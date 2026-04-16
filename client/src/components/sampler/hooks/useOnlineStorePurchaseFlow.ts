import * as React from 'react';
import { edgeFunctionUrl } from '@/lib/edge-api';
import { captureProductEvent } from '@/lib/productAnalytics';
import { optimizeReceiptProofFile, runReceiptOcr } from '@/lib/receipt-ocr';
import {
    PaymentChannel,
    PurchaseReceiptState,
    StoreItem,
} from '@/components/sampler/onlineStore.types';

type EffectiveUserLike = {
    id: string;
    email?: string | null;
} | null;

type UseOnlineStorePurchaseFlowArgs = {
    effectiveUser: EffectiveUserLike;
    selectedItem: StoreItem | null;
    checkoutMode: boolean;
    items: StoreItem[];
    cartItems: StoreItem[];
    cartItemIds: Set<string>;
    formChannel: PaymentChannel;
    formName: string;
    formRef: string;
    formNotes: string;
    formProofFile: File | null;
    proofOcrSeqRef: React.MutableRefObject<number>;
    validateProofFile: (file: File) => string | null;
    formatPhp: (value: number) => string;
    loadData: () => Promise<void>;
    showToast: (message: string, type: 'success' | 'error') => void;
    setProofOcrLoading: React.Dispatch<React.SetStateAction<boolean>>;
    setSubmitLoading: React.Dispatch<React.SetStateAction<boolean>>;
    setPurchaseReceipt: React.Dispatch<React.SetStateAction<PurchaseReceiptState | null>>;
    setSelectedItem: React.Dispatch<React.SetStateAction<StoreItem | null>>;
    setCheckoutMode: React.Dispatch<React.SetStateAction<boolean>>;
    setCartItemIds: React.Dispatch<React.SetStateAction<Set<string>>>;
    setFormName: React.Dispatch<React.SetStateAction<string>>;
    setFormRef: React.Dispatch<React.SetStateAction<string>>;
    setFormNotes: React.Dispatch<React.SetStateAction<string>>;
    setFormProofFile: React.Dispatch<React.SetStateAction<File | null>>;
};

export function useOnlineStorePurchaseFlow({
    effectiveUser,
    selectedItem,
    checkoutMode,
    items,
    cartItems,
    cartItemIds,
    formChannel,
    formName,
    formRef,
    formNotes,
    formProofFile,
    proofOcrSeqRef,
    validateProofFile,
    formatPhp,
    loadData,
    showToast,
    setProofOcrLoading,
    setSubmitLoading,
    setPurchaseReceipt,
    setSelectedItem,
    setCheckoutMode,
    setCartItemIds,
    setFormName,
    setFormRef,
    setFormNotes,
    setFormProofFile,
}: UseOnlineStorePurchaseFlowArgs) {
    const invalidateProofOcr = React.useCallback(() => {
        proofOcrSeqRef.current += 1;
        setProofOcrLoading(false);
    }, [proofOcrSeqRef, setProofOcrLoading]);

    const handleProofUpload = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0] || null;
        if (!file) {
            invalidateProofOcr();
            setFormProofFile(null);
            setFormRef('');
            setFormName('');
            return;
        }
        const validationError = validateProofFile(file);
        if (validationError) {
            invalidateProofOcr();
            showToast(validationError, 'error');
            e.target.value = '';
            return;
        }
        setFormRef('');
        setFormName('');
        if (formChannel !== 'image_proof') {
            setFormProofFile(file);
            invalidateProofOcr();
            return;
        }

        const seq = proofOcrSeqRef.current + 1;
        proofOcrSeqRef.current = seq;
        setProofOcrLoading(true);
        void (async () => {
            const preparedFile = await optimizeReceiptProofFile(file).catch(() => file);
            if (proofOcrSeqRef.current !== seq) return;
            setFormProofFile(preparedFile);
            const result = await runReceiptOcr({
                file: preparedFile,
                context: 'bank_store',
                email: String(effectiveUser?.email || ''),
                subject: selectedItem?.bank?.title || 'bank_store',
                // Avoid immediate server OCR call; submit flow only escalates to backend OCR when automation is enabled.
                fallbackToServer: false,
            });
            if (proofOcrSeqRef.current !== seq) return;
            if (result.detected.referenceNo) setFormRef(result.detected.referenceNo);
            else setFormRef('');
            if (result.detected.payerName) setFormName(result.detected.payerName);
            setProofOcrLoading(false);
        })();
    }, [
        effectiveUser?.email,
        formChannel,
        proofOcrSeqRef,
        selectedItem?.bank?.title,
        invalidateProofOcr,
        setFormName,
        setFormProofFile,
        setFormRef,
        showToast,
        validateProofFile,
    ]);

    const handlePurchaseSubmit = React.useCallback(async (e: React.FormEvent) => {
        e.preventDefault();
        if (!effectiveUser) return;
        if (checkoutMode && cartItemIds.size === 0) return;

        const purchaseItems: Array<{ bankId: string; catalogItemId: string }> = [];
        const requestedItems: StoreItem[] = [];
        if (checkoutMode) {
            cartItems.filter((item) => item.status === 'buy').forEach((item) => {
                purchaseItems.push({ bankId: item.bank_id, catalogItemId: item.id });
                requestedItems.push(item);
            });
        } else if (selectedItem) {
            purchaseItems.push({ bankId: selectedItem.bank_id, catalogItemId: selectedItem.id });
            requestedItems.push(selectedItem);
        }
        if (purchaseItems.length === 0) return;
        const allFreePromotionClaim = requestedItems.length > 0
            && requestedItems.every((item) => item.status === 'buy' && item.is_promotion_free_claim);

        if (!allFreePromotionClaim && formChannel === 'image_proof' && !formProofFile) {
            showToast('Please upload proof of payment to continue.', 'error');
            return;
        }
        if (!allFreePromotionClaim && formProofFile) {
            const proofError = validateProofFile(formProofFile);
            if (proofError) {
                showToast(proofError, 'error');
                return;
            }
        }

        setSubmitLoading(true);
        let uploadedFileName = '';
        let finalProofPath = '';

        try {
            const { supabase } = await import('@/lib/supabase');
            const session = await supabase.auth.getSession();
            const token = session.data.session?.access_token;

            if (!token) throw new Error('Please sign in to continue.');

            if (!allFreePromotionClaim && formProofFile) {
                const ext = formProofFile.name.split('.').pop();
                uploadedFileName = `${effectiveUser.id}/payment-proof-${Date.now()}.${ext}`;

                const { error } = await supabase.storage
                    .from('payment-proof')
                    .upload(uploadedFileName, formProofFile, { upsert: true });

                if (error) throw error;
                finalProofPath = uploadedFileName;
            }

            const res = await fetch(edgeFunctionUrl('store-api', 'purchase-request'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    items: purchaseItems,
                    paymentChannel: allFreePromotionClaim ? null : formChannel,
                    payerName: allFreePromotionClaim ? '' : formName,
                    referenceNo: allFreePromotionClaim ? '' : formRef,
                    proofPath: allFreePromotionClaim ? '' : finalProofPath,
                    notes: formNotes
                })
            });

            if (!res.ok) {
                throw new Error('We could not submit your request. Please try again.');
            }
            const submitPayload = await res.json().catch(() => ({}));
            const submitData = (submitPayload?.data && typeof submitPayload.data === 'object' ? submitPayload.data : submitPayload) as Record<string, unknown>;
            const requestIds = Array.isArray(submitData.requestIds) ? submitData.requestIds : [];
            const fallbackRequestId = requestIds.length > 0 ? String(requestIds[0]) : '';
            const submitStatus = String(submitData.status || 'pending');
            const isApproved = submitStatus === 'approved';
            const isFreeClaim = Boolean(submitData.free_claim) || allFreePromotionClaim;
            const count = purchaseItems.length;
            const totalPaid = purchaseItems.reduce((sum, item) => {
                const storeItem = checkoutMode
                    ? cartItems.find((row) => row.id === item.catalogItemId)
                    : items.find((row) => row.id === item.catalogItemId);
                const amount = storeItem?.price_php;
                return sum + (typeof amount === 'number' && Number.isFinite(amount) ? amount : 0);
            }, 0);
            const hasBundle = purchaseItems.some((item) => {
                const storeItem = checkoutMode
                    ? cartItems.find((row) => row.id === item.catalogItemId)
                    : items.find((row) => row.id === item.catalogItemId);
                return storeItem?.item_type === 'bank_bundle';
            });
            if (isFreeClaim) {
                captureProductEvent('store_free_claim_submitted', {
                    request_type: 'store',
                    payment_channel: 'free_promotion',
                    item_count: count,
                    total_php: totalPaid,
                    status: submitStatus,
                    has_bundle: hasBundle,
                });
            } else {
                captureProductEvent('payment_proof_submitted', {
                    request_type: 'store',
                    payment_channel: formChannel,
                    item_count: count,
                    total_php: totalPaid,
                    status: submitStatus,
                    has_bundle: hasBundle,
                });
            }
            setPurchaseReceipt({
                amountText: isFreeClaim ? 'FREE' : totalPaid > 0 ? formatPhp(totalPaid) : 'To be confirmed',
                itemCount: count,
                submittedAt: new Date().toISOString(),
                receiptNo: String(submitData.receipt_reference || submitData.batchId || fallbackRequestId || 'Pending verification'),
                paymentReference: isFreeClaim
                    ? 'Free promotion claim'
                    : String(
                        submitData.reference_no ||
                        formRef ||
                        (formChannel === 'image_proof' ? 'Not detected' : 'Not provided')
                    ),
                message: isFreeClaim
                    ? (isApproved
                        ? 'Your free promotion was claimed and your bank access is now active.'
                        : 'Your free promotion claim was received and is being verified.')
                    : (isApproved
                        ? 'Your payment passed verification and your bank access is now approved.'
                        : 'Your payment was received and is now waiting for admin review. We will email you after the approval check.'),
                status: isApproved ? 'success' : 'pending',
                statusLabel: isApproved ? 'Approved' : (isFreeClaim ? 'Pending Claim' : 'Pending Approval'),
            });
            await loadData();
            setSelectedItem(null);
            setCheckoutMode(false);
            setCartItemIds(new Set());
            setFormName('');
            setFormRef('');
            setFormNotes('');
            setFormProofFile(null);
        } catch (err: any) {
            if (uploadedFileName) {
                try {
                    const { supabase } = await import('@/lib/supabase');
                    await supabase.storage.from('payment-proof').remove([uploadedFileName]);
                } catch {
                    // no-op
                }
            }
            showToast(err.message, 'error');
        } finally {
            setSubmitLoading(false);
        }
    }, [
        cartItemIds,
        checkoutMode,
        effectiveUser,
        formChannel,
        formName,
        formNotes,
        formProofFile,
        formRef,
        formatPhp,
        cartItems,
        items,
        loadData,
        selectedItem,
        setCartItemIds,
        setCheckoutMode,
        setFormName,
        setFormNotes,
        setFormProofFile,
        setFormRef,
        setPurchaseReceipt,
        setSelectedItem,
        setSubmitLoading,
        showToast,
        validateProofFile,
    ]);

    return {
        handleProofUpload,
        handlePurchaseSubmit,
    };
}
