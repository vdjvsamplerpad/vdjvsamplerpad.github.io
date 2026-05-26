import * as React from 'react';
import { edgeFunctionUrl } from '@/lib/edge-api';
import { DEFAULT_LEGAL_DOCUMENTS, normalizeLegalDocument, type LegalDocument } from '@/lib/legal-content';
import { LegalPageLayout } from '@/routes/LegalPageLayout';

export default function PrivacyPage() {
  const [document, setDocument] = React.useState<LegalDocument>(() => DEFAULT_LEGAL_DOCUMENTS.privacy);

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(edgeFunctionUrl('store-api', 'legal/privacy'), {
          method: 'GET',
          cache: 'no-store',
          credentials: 'omit',
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.ok === false) throw new Error('Could not load privacy policy');
        const next = normalizeLegalDocument('privacy', payload?.data?.document ?? payload?.document);
        if (!cancelled) setDocument(next);
      } catch {
        if (!cancelled) setDocument(DEFAULT_LEGAL_DOCUMENTS.privacy);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return <LegalPageLayout document={document} />;
}
