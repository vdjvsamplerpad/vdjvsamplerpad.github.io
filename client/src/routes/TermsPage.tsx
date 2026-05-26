import * as React from 'react';
import { edgeFunctionUrl } from '@/lib/edge-api';
import { DEFAULT_LEGAL_DOCUMENTS, normalizeLegalDocument, type LegalDocument } from '@/lib/legal-content';
import { LegalPageLayout } from '@/routes/LegalPageLayout';

export default function TermsPage() {
  const [document, setDocument] = React.useState<LegalDocument>(() => DEFAULT_LEGAL_DOCUMENTS.terms);

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(edgeFunctionUrl('store-api', 'legal/terms'), {
          method: 'GET',
          cache: 'no-store',
          credentials: 'omit',
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.ok === false) throw new Error('Could not load terms');
        const next = normalizeLegalDocument('terms', payload?.data?.document ?? payload?.document);
        if (!cancelled) setDocument(next);
      } catch {
        if (!cancelled) setDocument(DEFAULT_LEGAL_DOCUMENTS.terms);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return <LegalPageLayout document={document} />;
}
