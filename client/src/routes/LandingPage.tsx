import * as React from 'react';
import { Link } from 'react-router-dom';
import { ScrollFrameAnimator, type ScrollFrameAnimatorHandle } from '@/components/landing/ScrollFrameAnimator';
import {
  DEFAULT_LANDING_DOWNLOAD_CONFIG,
  normalizeLandingDownloadConfig,
  type LandingDownloadConfig,
  type PlatformKey,
  type VersionKey,
} from '@/components/landing/download-config';
import { VersionSelector } from '@/components/landing/VersionSelector';
import { usePerformanceTier } from '@/hooks/usePerformanceTier';
import { edgeFunctionUrl } from '@/lib/edge-api';
import { getBuyPagePath, getLandingPagePath } from '@/lib/runtime-routes';
import { Download, Monitor, Smartphone } from 'lucide-react';

const FRAME_COUNT = 97;
const REVEAL_THRESHOLD = 0.92;
const LANDING_CONFIG_CACHE_KEY = 'vdjv-landing-config-v1';

const platformGroups: Array<{
  sideClass: string;
  title: string;
  items: Array<{ key: PlatformKey; label: string; Icon: React.ElementType }>;
}> = [
  {
    sideClass: 'is-left',
    title: 'Mobile DOWNLOAD',
    items: [
      { key: 'android', label: 'Android', Icon: Smartphone },
      { key: 'ios', label: 'iOS', Icon: Smartphone },
    ],
  },
  {
    sideClass: 'is-right',
    title: 'Desktop DOWNLOAD',
    items: [
      { key: 'windows', label: 'Windows', Icon: Monitor },
      { key: 'macos', label: 'macOS', Icon: Monitor },
    ],
  },
];

const padFrameNumber = (index: number) => String(index + 1).padStart(4, '0');

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = React.useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  React.useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (event: MediaQueryListEvent) => setPrefersReducedMotion(event.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  return prefersReducedMotion;
}

function useConnectionHints() {
  const [state, setState] = React.useState(() => {
    const connection = typeof navigator !== 'undefined' ? (navigator as any).connection : null;
    const effectiveType = typeof connection?.effectiveType === 'string' ? connection.effectiveType : '';
    const saveData = connection?.saveData === true;
    const slowConnection = saveData || effectiveType === 'slow-2g' || effectiveType === '2g' || effectiveType === '3g';
    return { saveData, slowConnection };
  });

  React.useEffect(() => {
    const connection = typeof navigator !== 'undefined' ? (navigator as any).connection : null;
    if (!connection?.addEventListener) return;
    const onChange = () => {
      const effectiveType = typeof connection.effectiveType === 'string' ? connection.effectiveType : '';
      const saveData = connection.saveData === true;
      const slowConnection = saveData || effectiveType === 'slow-2g' || effectiveType === '2g' || effectiveType === '3g';
      setState({ saveData, slowConnection });
    };
    connection.addEventListener('change', onChange);
    return () => connection.removeEventListener('change', onChange);
  }, []);

  return state;
}

export default function LandingPage() {
  const animatorRef = React.useRef<ScrollFrameAnimatorHandle | null>(null);
  const sectionRef = React.useRef<HTMLElement | null>(null);
  const autoplayStartTimeoutRef = React.useRef<number | null>(null);
  const [version, setVersion] = React.useState<VersionKey>('V1');
  const [progress, setProgress] = React.useState(0);
  const [revealOverride, setRevealOverride] = React.useState(false);
  const [landingConfig, setLandingConfig] = React.useState<LandingDownloadConfig>(() => {
    if (typeof window === 'undefined') {
      return normalizeLandingDownloadConfig(DEFAULT_LANDING_DOWNLOAD_CONFIG);
    }
    try {
      const cached = window.localStorage.getItem(LANDING_CONFIG_CACHE_KEY);
      if (cached) return normalizeLandingDownloadConfig(JSON.parse(cached));
    } catch {}
    return normalizeLandingDownloadConfig(DEFAULT_LANDING_DOWNLOAD_CONFIG);
  });
  const [landingConfigLoaded, setLandingConfigLoaded] = React.useState(false);
  const [redirectFailed, setRedirectFailed] = React.useState(false);
  const { tier } = usePerformanceTier();
  const prefersReducedMotion = usePrefersReducedMotion();
  const { saveData, slowConnection } = useConnectionHints();

  const compactRunway = prefersReducedMotion || tier === 'lowest' || slowConnection;
  const autoplayEnabled = !prefersReducedMotion;
  const allowVersionTransitions = !prefersReducedMotion && tier !== 'lowest';
  const revealVisible = revealOverride || progress >= REVEAL_THRESHOLD;
  const landingPagePath = React.useMemo(() => getLandingPagePath(), []);
  const buyPagePath = React.useMemo(() => getBuyPagePath(), []);
  const activeLinks = landingConfig.downloadLinks[version];
  const activePlatformDescriptions = landingConfig.platformDescriptions[version];
  const activeVersionDescription = landingConfig.versionDescriptions[version];
  const redirectRequest = React.useMemo(() => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    const requestedVersion = String(params.get('goVersion') || '').trim().toUpperCase();
    const requestedPlatform = String(params.get('goPlatform') || '').trim().toLowerCase();
    const normalizedVersion = (['V1', 'V2', 'V3'] as VersionKey[]).includes(requestedVersion as VersionKey)
      ? (requestedVersion as VersionKey)
      : null;
    const normalizedPlatform = (['android', 'ios', 'windows', 'macos'] as PlatformKey[]).includes(requestedPlatform as PlatformKey)
      ? (requestedPlatform as PlatformKey)
      : null;
    return normalizedVersion && normalizedPlatform
      ? { version: normalizedVersion, platform: normalizedPlatform }
      : null;
  }, []);

  React.useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), slowConnection ? 1800 : 3200);

    fetch(edgeFunctionUrl('store-api', 'landing-config'), { signal: controller.signal })
      .then(async (res) => {
        const payload = await res.json().catch(() => ({}));
        const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
        if (!active || !res.ok) {
          if (active) setLandingConfigLoaded(true);
          return;
        }
        const normalized = normalizeLandingDownloadConfig(data?.config || DEFAULT_LANDING_DOWNLOAD_CONFIG);
        setLandingConfig(normalized);
        setLandingConfigLoaded(true);
        try {
          window.localStorage.setItem(LANDING_CONFIG_CACHE_KEY, JSON.stringify(normalized));
        } catch {}
      })
      .catch(() => {
        if (active) setLandingConfigLoaded(true);
      });
    return () => {
      active = false;
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [slowConnection]);

  React.useEffect(() => {
    if (!redirectRequest) return;
    if (!landingConfigLoaded) return;
    const targetUrl = String(landingConfig.downloadLinks?.[redirectRequest.version]?.[redirectRequest.platform] || '').trim();
    if (!targetUrl) {
      setRedirectFailed(true);
      return;
    }
    window.location.replace(targetUrl);
  }, [landingConfig, landingConfigLoaded, redirectRequest]);

  const clearTimers = React.useCallback(() => {
    if (autoplayStartTimeoutRef.current !== null) {
      window.clearTimeout(autoplayStartTimeoutRef.current);
      autoplayStartTimeoutRef.current = null;
    }
  }, []);

  const handleAutoplayComplete = React.useCallback(() => {
    clearTimers();
    setRevealOverride(true);
  }, [clearTimers]);

  React.useEffect(() => {
    return () => {
      clearTimers();
    };
  }, [clearTimers]);

  const handleDownloadClick = React.useCallback(() => {
    clearTimers();
    setRevealOverride(false);

    animatorRef.current?.primeMainSequence();
    animatorRef.current?.stopAutoplay();
    sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });

    if (!autoplayEnabled) {
      setRevealOverride(true);
      return;
    }

    autoplayStartTimeoutRef.current = window.setTimeout(() => {
      animatorRef.current?.startAutoplay();
    }, 180);
  }, [autoplayEnabled, clearTimers]);

  const handleDownloadIntent = React.useCallback(() => {
    animatorRef.current?.primeMainSequence();
  }, []);

  if (redirectRequest) {
    return (
      <main className="lp-page">
        <section className="lp-marketing-band">
          <p className="lp-kicker">VDJV Sampler Pad App</p>
          <h1>Opening download...</h1>
          <p className="lp-lead">
            {redirectFailed
              ? 'We could not resolve the latest installer link right now. Please try again in a moment.'
              : 'Please wait while we redirect you to the latest installer link.'}
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="lp-page">
      <header className="lp-header">
        <Link className="lp-brand" to={landingPagePath}>
          <img src="/assets/logo.png" alt="VDJV Sampler Pad logo" className="lp-brand-logo" />
          <span className="lp-brand-copy">VDJV Sampler Pad App</span>
        </Link>
        <Link
          to={buyPagePath}
          className="inline-flex items-center rounded-full border border-amber-300 bg-amber-400 px-4 py-2 text-xs font-semibold tracking-[0.2em] text-slate-950 shadow-[0_16px_36px_rgba(251,191,36,0.22)] transition hover:bg-amber-300"
        >
          BUY VDJV
        </Link>
      </header>

      <section className="lp-marketing-band">
        <p className="lp-kicker">VDJV Sampler Pad App</p>
        <h1>Turn Your Device Into a Pro Sampler</h1>
        <p className="lp-lead">Cross-platform build for Android, iOS, Windows, and macOS.</p>
      </section>

      <section ref={sectionRef} id="lp-download-section" className="lp-animation-section">
        <ScrollFrameAnimator
          ref={animatorRef}
          frameCount={FRAME_COUNT}
          framePathBuilder={(index) => `/frames/v3-v1/frame-${padFrameNumber(index)}.webp`}
          revealThreshold={REVEAL_THRESHOLD}
          onProgressChange={setProgress}
          onAutoplayComplete={handleAutoplayComplete}
          autoplayEnabled={autoplayEnabled}
          compactRunway={compactRunway}
          saveDataMode={saveData || slowConnection}
          overlayVisible={revealVisible}
          activeVersion={version}
          allowVersionTransitions={allowVersionTransitions}
          tier={tier}
          topOverlay={(
            <button
              type="button"
              className="lp-floating-download"
              onClick={handleDownloadClick}
              onPointerEnter={handleDownloadIntent}
              onFocus={handleDownloadIntent}
              onTouchStart={handleDownloadIntent}
              aria-label="Download VDJV Sampler Pad App"
            >
              <Download size={22} className="lp-download-icon" />
              <span className="lp-floating-download-title">DOWNLOAD</span>
            </button>
          )}
          overlay={(
            <div className="lp-download-panel">
              <VersionSelector value={version} onChange={setVersion} />
              <div className="lp-platform-columns" aria-label="VDJV Sampler Pad App platform downloads">
                {platformGroups.map((group) => (
                  <div key={group.title} className={`lp-platform-group ${group.sideClass}`}>
                    <p className="lp-platform-title">{group.title}</p>
                    {group.items.map((item) => {
                      const Icon = item.Icon;
                      return (
                        <a
                          key={item.key}
                          className="lp-platform-link"
                          href={activeLinks[item.key] || '#'}
                          target="_blank"
                          rel="noreferrer"
                          title={activePlatformDescriptions[item.key]}
                          aria-label={`${item.label} ${version}`}
                        >
                          <div className="lp-platform-info">
                            <Icon size={18} className="lp-platform-icon" />
                            <span>{item.label}</span>
                          </div>
                          <small>{activePlatformDescriptions[item.key]}</small>
                        </a>
                      );
                    })}
                  </div>
                ))}
              </div>
              <div className="mt-5">
                <Link
                  to={`${buyPagePath}?version=${version}`}
                  className="inline-flex w-full items-center justify-center rounded-full bg-amber-400 px-5 py-3 text-sm font-black tracking-[0.18em] text-slate-950 shadow-[0_18px_40px_rgba(251,191,36,0.28)] transition hover:translate-y-[-1px] hover:bg-amber-300"
                >
                  {version === 'V1' ? 'CREATE V1 ACCOUNT' : 'BUY VDJV LICENSE'}
                </Link>
              </div>
            </div>
          )}
        />
      </section>

      <section className="lp-version-details-section">
        <div className="lp-version-description-box" key={version}>
          <h4>{activeVersionDescription.title}</h4>
          <p>{activeVersionDescription.desc}</p>
        </div>
      </section>
    </main>
  );
}
