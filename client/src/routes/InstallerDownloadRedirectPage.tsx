import * as React from 'react';
import { Link, useParams } from 'react-router-dom';

import {
  DEFAULT_LANDING_DOWNLOAD_CONFIG,
  normalizeLandingDownloadConfig,
  type PlatformKey,
  type VersionKey,
} from '@/components/landing/download-config';
import { edgeFunctionUrl } from '@/lib/edge-api';
import { getBuyPagePath, getLandingPagePath } from '@/lib/runtime-routes';

const PLATFORM_KEYS: PlatformKey[] = ['android', 'ios', 'windows', 'macos'];
const VERSION_KEYS: VersionKey[] = ['V1', 'V2', 'V3'];

const normalizeVersion = (value: string | undefined): VersionKey | null => {
  const normalized = String(value || '').trim().toUpperCase();
  return VERSION_KEYS.includes(normalized as VersionKey) ? (normalized as VersionKey) : null;
};

const normalizePlatform = (value: string | undefined): PlatformKey | null => {
  const normalized = String(value || '').trim().toLowerCase();
  return PLATFORM_KEYS.includes(normalized as PlatformKey) ? (normalized as PlatformKey) : null;
};

export default function InstallerDownloadRedirectPage() {
  const params = useParams();
  const version = normalizeVersion(params.version);
  const platform = normalizePlatform(params.platform);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    if (!version || !platform) {
      setError('Invalid download link.');
      return;
    }

    let cancelled = false;

    const redirectToTarget = async () => {
      try {
        const response = await fetch(edgeFunctionUrl('store-api', 'buy-config'));
        const payload = await response.json().catch(() => ({}));
        const data = payload?.data ?? payload;
        const config = normalizeLandingDownloadConfig(data?.config || DEFAULT_LANDING_DOWNLOAD_CONFIG);
        const targetUrl = String(config.downloadLinks?.[version]?.[platform] || '').trim();
        if (!targetUrl) throw new Error('Download link is not configured.');
        if (!cancelled) window.location.replace(targetUrl);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unable to open the download link.');
        }
      }
    };

    void redirectToTarget();
    return () => {
      cancelled = true;
    };
  }, [platform, version]);

  const buyPath = version && version !== 'V1' ? `${getBuyPagePath()}?version=${version}` : getBuyPagePath();

  return (
    <div className="min-h-screen bg-slate-950 px-6 py-10 text-slate-50">
      <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center rounded-[28px] border border-slate-800 bg-slate-900/80 px-6 py-10 text-center shadow-[0_30px_120px_rgba(15,23,42,0.45)]">
        <div className="text-sm font-semibold uppercase tracking-[0.24em] text-emerald-300">VDJV Redirect</div>
        <h1 className="mt-3 text-3xl font-black tracking-tight">Opening download...</h1>
        <p className="mt-3 text-sm leading-6 text-slate-300">
          {error || 'Please wait while we open the latest installer link for your selected version and platform.'}
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link
            to={buyPath}
            className="inline-flex items-center justify-center rounded-xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-400"
          >
            Go to Buy Page
          </Link>
          <Link
            to={getLandingPagePath()}
            className="inline-flex items-center justify-center rounded-xl border border-slate-700 px-5 py-3 text-sm font-semibold text-slate-200 transition hover:border-slate-500 hover:text-white"
          >
            Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}
