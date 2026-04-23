export type LegalDocumentKey = 'privacy' | 'terms';
export type LegalDocumentStatus = 'draft' | 'published';

export interface LegalSection {
  title: string;
  body: string;
}

export interface LegalDocument {
  documentKey: LegalDocumentKey;
  status: LegalDocumentStatus;
  title: string;
  intro: string;
  sections: LegalSection[];
  updatedAt: string;
  publishedAt: string | null;
}

export interface AdminLegalDocumentPair {
  draft: LegalDocument;
  published: LegalDocument;
}

export type AdminLegalDocumentState = Record<LegalDocumentKey, AdminLegalDocumentPair>;

export const LEGAL_DOCUMENT_KEYS: LegalDocumentKey[] = ['privacy', 'terms'];

const TODAY_LABEL = 'April 23, 2026';

export const DEFAULT_LEGAL_DOCUMENTS: Record<LegalDocumentKey, LegalDocument> = {
  privacy: {
    documentKey: 'privacy',
    status: 'published',
    title: 'Privacy Policy',
    updatedAt: TODAY_LABEL,
    publishedAt: null,
    intro:
      'This Privacy Policy explains what information VDJV Sampler Pad collects, how that information is used, when it is shared, how long it is kept, and what choices you have when you use the website, sign in with Google, create backups, request upgrades, purchase digital content, or contact support.',
    sections: [
      {
        title: 'Scope and Coverage',
        body: `This Privacy Policy applies to VDJV Sampler Pad services that link to it, including the public website, the web app, supported mobile and desktop builds, account login flows, digital store features, backup and recovery tools, account upgrade requests, and support or crash-reporting flows.

This Policy describes how we handle information collected by or for VDJV Sampler Pad. It does not control the privacy practices of third-party websites, payment channels, app stores, social networks, cloud tools, or identity providers that may be linked from the app or used separately by you.`,
      },
      {
        title: 'Account, Identity, and Profile Information',
        body: `When you create or access an account, we may receive and store information such as your email address, display name, account identifier, profile image, account tier, granted entitlements, purchase status, and similar account metadata needed to operate the service.

If you contact support, request an upgrade, submit a registration request, or send us information through forms or messages, we may also store the information you provide directly, including payer name, reference number, notes, screenshots, receipt images, or other materials needed to review your request and respond.`,
      },
      {
        title: 'App Activity, Device Data, and Local Storage',
        body: `We may collect technical and operational information needed to run, secure, and improve the app, such as browser type, operating system, device category, app version, timestamps, session activity, error states, and general usage events related to authentication, downloads, exports, backups, restore attempts, and store access.

VDJV Sampler Pad also uses local browser storage, device storage, and application caches to keep features working. Depending on the platform, imported banks, audio files, settings, cached assets, and local backup copies may remain on your device unless you remove them yourself.`,
      },
      {
        title: 'Purchases, Payments, and Review Records',
        body: `If you request paid access, account upgrades, installer packages, or digital store items, we may store request records such as selected item details, payment channel, payer name, reference number, proof image paths, review notes, approval or rejection status, entitlement grants, and related fraud or audit signals.

Some payments or proof submissions may be handled through third-party channels or manual review. We do not claim to store full banking credentials or card numbers inside the app unless a future payment provider page expressly asks for them through its own controlled checkout flow.`,
      },
      {
        title: 'Backups, Support, and Crash Diagnostics',
        body: `If you use online backup, restore, or repair features, we may process backup metadata, uploaded archive files, storage keys, restore results, and operational logs necessary to complete those features. If you choose to send support materials or crash diagnostics, we may receive error logs, device context, report summaries, and uploaded report files.

We use this information to troubleshoot failures, improve reliability, investigate misuse, recover supported account-linked data, and respond to support requests. Diagnostic submissions are used for service operations and are not sold or used for advertising.`,
      },
      {
        title: 'Google Sign-In and Third-Party Identity Data',
        body: `When you sign in with Google, we use the Google account information made available to us for authentication, account linking, identity display inside the app, and account security. This may include your Google account identifier, email address, name, and profile image when provided by Google.

We do not sell Google user data, use Google user data for advertising, or use it for unrelated profiling. If we support additional identity providers in the future, we will use comparable account data only for sign-in, account administration, and service security unless we clearly tell you otherwise.`,
      },
      {
        title: 'How We Use Information',
        body: `We use personal and technical information to provide and maintain the app, authenticate users, grant account tiers and store access, process purchases and upgrade requests, deliver downloads, operate backups, secure the platform, prevent fraud or abuse, respond to support requests, and communicate important service or account notices.

We may also use aggregated or less identifiable operational data to understand feature usage, improve performance, diagnose reliability problems, monitor demand, and plan product changes. Where possible, we limit access to information to people and systems with a legitimate operational need.`,
      },
      {
        title: 'Sharing and Service Providers',
        body: `We may share information with vendors and infrastructure providers that help us operate VDJV Sampler Pad, such as authentication, hosting, database, file storage, messaging, diagnostics, OCR, customer support, or other technical service providers. These providers may process information on our behalf only as needed to deliver the service.

We may also disclose information when reasonably necessary to investigate fraud, enforce our Terms, protect users or the service, comply with legal obligations, respond to valid legal requests, or preserve records relevant to disputes or security incidents.`,
      },
      {
        title: 'Retention, Deletion, and Recovery Limits',
        body: `We retain information for as long as reasonably necessary to operate the service, maintain account access, deliver purchased items, support backups, investigate abuse, keep audit trails, comply with law, and resolve disputes. Different categories of information may be retained for different periods depending on operational and legal need.

If you delete your account, we will attempt to remove or deactivate account-linked personal data from active systems where deletion is technically available. Some information may still be retained in logs, backups, fraud records, entitlement history, or legal archives for a limited period. Local files already stored on your own device are not automatically removed from your device by remote account deletion.`,
      },
      {
        title: 'Your Choices and Rights',
        body: `You can sign out of the app, manage many local files directly on your device, and delete your account from Settings, Backup inside the app. You may also contact support to ask about account records, corrections, deletion requests, or operational questions, subject to identity verification and any limits required by law, security, or fraud-prevention obligations.

Depending on your location, you may have additional privacy rights such as requesting access to information we hold about you, asking us to correct inaccurate data, objecting to certain processing, or requesting deletion. We will review such requests in light of applicable law and our need to maintain secure and reliable service operations.`,
      },
      {
        title: 'Security, Children, and Policy Updates',
        body: `We use reasonable technical and organizational safeguards such as authenticated access controls, secure transport, restricted administrative access, and operational monitoring. No system can be guaranteed perfectly secure, so you should also protect your own device, credentials, and local files.

VDJV Sampler Pad is not intended for children under the age required by applicable law to use the service independently. We may update this Privacy Policy from time to time to reflect product, legal, or operational changes. When we do, we will update the effective date shown on this page. For privacy questions, support questions, or account deletion concerns, contact VDJV Sampler Pad support through the support channel shown in the app or website.`,
      },
    ],
  },
  terms: {
    documentKey: 'terms',
    status: 'published',
    title: 'Terms of Service',
    updatedAt: TODAY_LABEL,
    publishedAt: null,
    intro:
      'These Terms of Service govern your access to and use of VDJV Sampler Pad, including the website, account login flow, sampler app, store, backups, downloads, upgrade requests, and related support tools.',
    sections: [
      {
        title: 'Acceptance of Terms',
        body: `By accessing or using VDJV Sampler Pad, you agree to these Terms and to any policies that are incorporated into them, including the Privacy Policy. If you do not agree, do not use the service.

We may revise these Terms from time to time to reflect product, operational, or legal changes. Updated Terms become effective when posted unless a later effective date is stated. Continued use of the service after an update means you accept the revised Terms.`,
      },
      {
        title: 'Eligibility and Account Responsibilities',
        body: `You may use the service only if you are legally able to enter into these Terms and use the app in your location. You are responsible for providing accurate information when creating an account, submitting purchase or upgrade requests, or contacting support.

You are responsible for activity that occurs through your account and devices. Keep your sign-in method, email access, and device access secure. Notify support promptly if you believe your account has been accessed without permission or your purchase records have been used improperly.`,
      },
      {
        title: 'Limited License and Permitted Use',
        body: `Subject to these Terms, VDJV Sampler Pad grants you a limited, non-exclusive, revocable, non-transferable license to access and use the app and related services for your own lawful personal, creative, event, or internal professional use on supported devices.

This license allows you to use the service as provided, but it does not transfer ownership of the app, store content, software, branding, or platform rights. We reserve all rights not expressly granted to you.`,
      },
      {
        title: 'User Content, Imported Media, and Rights',
        body: `You are responsible for all audio, images, bank files, text, notes, and other materials you import, upload, export, store, or play through the app. You represent that you have the rights or permissions needed to use that content and that your use does not infringe the rights of others.

You retain ownership of your own content. However, if you upload content to VDJV Sampler Pad services for backup, recovery, support, or crash investigation, you grant us a limited permission to host, process, copy, transmit, and inspect that content only as necessary to operate those features, maintain the service, and resolve support issues.`,
      },
      {
        title: 'Store Purchases, Digital Delivery, and Entitlements',
        body: `The app may offer paid banks, bundled downloads, installer packages, account tiers, promotional pricing, or other digital access. Digital items may be delivered immediately, manually approved, queued for review, or tied to your account before access is granted.

Unless we expressly say otherwise, digital purchases and granted entitlements are licensed to the account that received them and are not transferable, refundable, or resellable except where required by applicable law. We may deny, reverse, or limit access where payment is fraudulent, unauthorized, reversed, or materially inconsistent with our review rules.`,
      },
      {
        title: 'Pricing, Promotions, and Upgrade Requests',
        body: `Prices, promos, voucher offers, tier rules, bundle contents, account limits, supported platforms, and upgrade requirements may change over time. We may set eligibility rules for discounts, installer access, promotional grants, or review-based approvals.

When a purchase or upgrade requires manual review, you must provide accurate proof and payment details. Submission of a request does not guarantee approval. We may reject or cancel a request that is incomplete, inconsistent, suspicious, duplicated, abusive, or otherwise outside the scope of the offer.`,
      },
      {
        title: 'Backups, Exports, and Your Data Responsibility',
        body: `VDJV Sampler Pad may include backup, restore, export, import, repair, and recovery features, but those features are provided as operational tools, not as a guarantee against data loss. You remain responsible for maintaining your own copies of important banks, audio files, and related project materials.

Device failures, browser cleanup, unsupported environments, interrupted uploads, corrupted media, account deletion, or unsupported file states may prevent successful recovery. We recommend that you maintain separate copies of content you cannot afford to lose.`,
      },
      {
        title: 'Acceptable Use Restrictions',
        body: `You may not use the service to violate law, infringe intellectual property rights, upload malicious code, interfere with platform security, scrape protected content, bypass access controls, misuse payment review flows, automate abusive requests, impersonate others, or disrupt the service for other users.

Except to the extent applicable law clearly permits it, you may not reverse engineer, decompile, disassemble, or attempt to extract protected parts of the service, cryptographic protections, download security systems, or private administrative tools. You also may not redistribute paid content unless we expressly authorize it.`,
      },
      {
        title: 'Third-Party Services and Platforms',
        body: `VDJV Sampler Pad may rely on or connect to third-party services such as Google sign-in, Supabase, file storage, hosting, manual payment channels, app stores, browsers, operating systems, OCR tools, or external links. Your use of those services may also be governed by their own terms and privacy policies.

We are not responsible for third-party outages, policy changes, network failures, payment-provider delays, or platform restrictions that affect your ability to access the service, restore data, install supported versions, or complete purchases.`,
      },
      {
        title: 'Suspension, Termination, and Account Deletion',
        body: `We may suspend, restrict, or terminate access to some or all of the service if we reasonably believe you have violated these Terms, used the service fraudulently, attempted unauthorized access, abused payment flows, harmed other users, or created risk for the platform.

You may stop using the service at any time and may delete your account using supported account controls. If your account is deleted or terminated, access to account-linked downloads, store entitlements, backups, or support history may be limited or end entirely, subject to any rights required by applicable law.`,
      },
      {
        title: 'Availability, Updates, and Feature Changes',
        body: `We may modify, add, pause, or discontinue features, products, platform support, account limits, pricing, or operational workflows at any time. We may also release patches, migrations, new versions, compatibility changes, or deprecations that require you to update software or use supported environments.

We do not guarantee that every feature will always be available, that every release will support every device, or that all content will remain downloadable forever. Temporary interruptions may occur due to maintenance, network issues, abuse prevention, provider outages, or technical problems.`,
      },
      {
        title: 'Disclaimers and Limitation of Liability',
        body: `To the maximum extent allowed by applicable law, VDJV Sampler Pad is provided on an "as is" and "as available" basis. We do not guarantee uninterrupted availability, perfect compatibility, permanent data retention, error-free operation, successful restoration, or the legality of third-party content supplied by users.

To the maximum extent allowed by law, we are not liable for indirect, incidental, special, consequential, exemplary, or punitive damages, or for lost profits, lost revenue, lost opportunity, lost goodwill, lost data, event disruption, media claims, or device issues arising out of or related to the service, even if we were advised such losses were possible.`,
      },
      {
        title: 'Contact and Changes to These Terms',
        body: `If you have questions about these Terms, account access, purchases, upgrade decisions, or support issues, contact VDJV Sampler Pad through the support channel shown in the app or website.

When we update these Terms, we will post the revised version here and update the effective date shown on the page. You should review the Terms periodically, especially before making purchases, submitting backups, or relying on account-linked downloads and entitlements.`,
      },
    ],
  },
};

const clampText = (value: unknown, fallback: string, maxLength: number): string => {
  const text = typeof value === 'string' ? value.trim() : '';
  return (text || fallback).slice(0, maxLength);
};

const normalizeSections = (value: unknown, fallback: LegalSection[]): LegalSection[] => {
  const raw = Array.isArray(value) ? value : [];
  const sections = raw
    .slice(0, 24)
    .map((section) => ({
      title: clampText((section as any)?.title, '', 120),
      body: clampText((section as any)?.body, '', 8000),
    }))
    .filter((section) => section.title && section.body);
  return sections.length ? sections : fallback;
};

export const normalizeLegalDocument = (
  documentKey: LegalDocumentKey,
  value: unknown,
  fallback: LegalDocument = DEFAULT_LEGAL_DOCUMENTS[documentKey],
): LegalDocument => {
  const input = (value || {}) as Partial<LegalDocument> & Record<string, unknown>;
  const status = input.status === 'draft' ? 'draft' : 'published';
  const updatedAt = clampText(input.updatedAt ?? input.updated_at, fallback.updatedAt, 80);
  const publishedAtRaw = input.publishedAt ?? input.published_at;
  const publishedAt = typeof publishedAtRaw === 'string' && publishedAtRaw.trim() ? publishedAtRaw.trim() : null;
  return {
    documentKey,
    status,
    title: clampText(input.title, fallback.title, 140),
    intro: clampText(input.intro, fallback.intro, 1500),
    sections: normalizeSections(input.sections, fallback.sections),
    updatedAt,
    publishedAt,
  };
};

export const normalizeAdminLegalDocuments = (value: unknown): AdminLegalDocumentState => {
  const input = (value || {}) as Partial<AdminLegalDocumentState>;
  return {
    privacy: {
      draft: normalizeLegalDocument('privacy', input.privacy?.draft, {
        ...DEFAULT_LEGAL_DOCUMENTS.privacy,
        status: 'draft',
      }),
      published: normalizeLegalDocument('privacy', input.privacy?.published, DEFAULT_LEGAL_DOCUMENTS.privacy),
    },
    terms: {
      draft: normalizeLegalDocument('terms', input.terms?.draft, {
        ...DEFAULT_LEGAL_DOCUMENTS.terms,
        status: 'draft',
      }),
      published: normalizeLegalDocument('terms', input.terms?.published, DEFAULT_LEGAL_DOCUMENTS.terms),
    },
  };
};
