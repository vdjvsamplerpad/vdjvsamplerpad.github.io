import * as React from 'react';
import { Link } from 'react-router-dom';
import { Clock3, FileText, ListTree, ShieldCheck } from 'lucide-react';
import type { LegalDocument } from '@/lib/legal-content';
import { getPrivacyPagePath, getTermsPagePath } from '@/lib/runtime-routes';

interface LegalPageLayoutProps {
  document: LegalDocument;
}

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const formatLegalDate = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(parsed);
};

export function LegalPageLayout({ document }: LegalPageLayoutProps) {
  const privacyPath = React.useMemo(() => getPrivacyPagePath(), []);
  const termsPath = React.useMemo(() => getTermsPagePath(), []);
  const updatedAt = React.useMemo(
    () => formatLegalDate(document.publishedAt || document.updatedAt),
    [document.publishedAt, document.updatedAt],
  );
  const sections = React.useMemo(
    () =>
      document.sections.map((section, index) => ({
        ...section,
        id: `${slugify(section.title) || 'section'}-${index + 1}`,
        number: String(index + 1).padStart(2, '0'),
      })),
    [document.sections],
  );

  const navLinkClass = (active: boolean) =>
    `inline-flex items-center rounded-full px-3 py-2 text-xs font-semibold transition ${
      active
        ? 'bg-slate-950 text-white'
        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'
    }`;

  return (
    <main className="lp-page min-h-screen text-slate-950">
      <header className="lp-header">
        <div className="lp-brand">
          <img src="/assets/logo.png" alt="VDJV Sampler Pad logo" className="lp-brand-logo" />
          <span className="lp-brand-copy">VDJV Sampler Pad App</span>
        </div>
        <nav className="flex flex-wrap items-center justify-end gap-2">
          <Link className={navLinkClass(document.documentKey === 'privacy')} to={privacyPath}>
            Privacy
          </Link>
          <Link className={navLinkClass(document.documentKey === 'terms')} to={termsPath}>
            Terms
          </Link>
        </nav>
      </header>

      <section className="mx-auto max-w-5xl px-5 pb-8 pt-5 sm:pt-8">
        <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-[linear-gradient(140deg,rgba(255,251,235,0.95),rgba(255,255,255,1)_42%,rgba(248,250,252,1))] shadow-[0_28px_80px_rgba(15,23,42,0.08)]">
          <div className="space-y-5 px-6 py-8 lg:px-8 lg:py-10">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-800">
              <ShieldCheck className="h-3.5 w-3.5" />
              Legal
            </div>
            <div className="space-y-3">
              <h1 className="max-w-3xl text-4xl font-black leading-tight text-slate-950 sm:text-5xl">
                {document.title}
              </h1>
              <p className="vdjv-selectable max-w-3xl text-base leading-7 text-slate-600">
                {document.intro}
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/85 px-3 py-2 text-sm text-slate-700">
                <Clock3 className="h-4 w-4 text-slate-500" />
                Last updated {updatedAt}
              </div>
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/85 px-3 py-2 text-sm text-slate-700">
                <FileText className="h-4 w-4 text-slate-500" />
                {sections.length} sections
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-16">
        <div className="grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)] xl:gap-12">
          <aside className="hidden lg:block lg:sticky lg:top-6 lg:self-start">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                <ListTree className="h-3.5 w-3.5" />
                Contents
              </div>
              <nav className="mt-4 flex flex-col gap-1.5">
                {sections.map((section) => (
                  <a
                    key={section.id}
                    href={`#${section.id}`}
                    className="group rounded-xl px-3 py-2 text-sm transition hover:bg-slate-100"
                  >
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400 group-hover:text-slate-500">
                      {section.number}
                    </div>
                    <div className="mt-1 leading-5 text-slate-600 group-hover:text-slate-950">
                      {section.title}
                    </div>
                  </a>
                ))}
              </nav>
            </div>
          </aside>

          <article className="vdjv-selectable rounded-[24px] border border-slate-200 bg-white px-6 py-6 shadow-sm sm:px-8 sm:py-8">
            <div className="space-y-10">
              {sections.map((section) => (
                <section
                  key={section.id}
                  id={section.id}
                  className="scroll-mt-24 border-t border-slate-200 pt-8 first:border-t-0 first:pt-0"
                >
                  <div className="grid gap-4 sm:grid-cols-[72px_minmax(0,1fr)] sm:gap-6">
                    <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
                      {section.number}
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold leading-tight text-slate-950 sm:text-[1.7rem]">
                        {section.title}
                      </h2>
                      <div className="mt-4 space-y-4 text-[15px] leading-7 text-slate-700 sm:text-base">
                        {section.body
                          .split(/\n{2,}/)
                          .map((paragraph) => paragraph.trim())
                          .filter(Boolean)
                          .map((paragraph, index) => (
                            <p key={`${section.id}-${index}`}>{paragraph}</p>
                          ))}
                      </div>
                    </div>
                  </div>
                </section>
              ))}
            </div>
          </article>
        </div>
      </section>
    </main>
  );
}
