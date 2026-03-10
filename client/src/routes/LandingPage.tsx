import * as React from 'react';
import { Link } from 'react-router-dom';
import { ScrollFrameAnimator, type ScrollFrameAnimatorHandle } from '@/components/landing/ScrollFrameAnimator';
import { DOWNLOAD_LINKS, PlatformKey, VersionKey } from '@/components/landing/download-config';
import { VersionSelector } from '@/components/landing/VersionSelector';
import { usePerformanceTier } from '@/hooks/usePerformanceTier';
import { edgeFunctionUrl } from '@/lib/edge-api';
import { Download, Monitor, Smartphone } from 'lucide-react';

const FRAME_COUNT = 97;
const REVEAL_THRESHOLD = 0.92;

const versionDescriptions: Record<VersionKey, { title: string; desc: string }> = {
  V1: {
    title: 'V1 – Standalone Version',
    desc: 'Pinakasimple na version ng VDJV. Hindi kailangan ng laptop o PC dahil diretso na itong gagana sa device mo. Best ito para sa mga gusto lang ng basic sampler pad para sa events gamit ang phone, tablet, o computer nang walang setup o remote connection. May unique features kumpara sa V2 at V3 pero mabilis at madaling gamitin.'
  },
  V2: {
    title: 'V2 – Laptop/PC Based Version',
    desc: 'Ito ang 2023 version na gumagamit ng laptop o PC bilang main system. Ang phone o tablet ay gagamitin bilang wireless touchscreen controller gamit ang remote app. Mas stable ito para sa events at mas flexible kumpara sa V1 dahil naka-run ang audio sa laptop. Recommended ito kung gusto mo ng mas professional setup pero hindi pa kailangan ang full features ng V3.'
  },
  V3: {
    title: 'V3 – Full Features Version',
    desc: 'Ito ang pinaka-complete at latest version ng VDJV. May kasama na itong installer, bagong features, effects, at lahat ng banks. Designed ito para sa professional events at mas advanced na paggamit. Laptop o PC pa rin ang main system habang ang phone o tablet ay gagamitin bilang wireless controller. Ito ang recommended version kung gusto mo ng full VDJV experience.'
  }
};

const platformDescriptions: Record<VersionKey, Record<PlatformKey, string>> = {
  V1: {
    android: 'VDJV App, no laptop needed',
    ios: 'Web App, no laptop needed',
    windows: 'Standalone software, no remote app',
    macos: 'Web app sa browser, no remote app',
  },
  V2: {
    android: 'VDJV Remote App V2 connect sa laptop/PC',
    ios: 'VirtualDJ Remote App',
    windows: 'VDJV V2 (up to V2.5)',
    macos: 'Message muna for compatibility',
  },
  V3: {
    android: 'VDJV Remote App V3 connect sa laptop/PC',
    ios: 'VirtualDJ Remote App',
    windows: 'VDJV V3 (2026 latest)',
    macos: 'Message muna for compatibility',
  },
};

const platformGroups: Array<{
  sideClass: string;
  title: string;
  items: Array<{ key: PlatformKey; label: string; Icon: React.ElementType }>;
}> = [
    {
      sideClass: 'is-left',
      title: 'Mobile',
      items: [
        { key: 'android', label: 'Android', Icon: Smartphone },
        { key: 'ios', label: 'iOS', Icon: Smartphone },
      ],
    },
    {
      sideClass: 'is-right',
      title: 'Desktop',
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

export default function LandingPage() {
  const animatorRef = React.useRef<ScrollFrameAnimatorHandle | null>(null);
  const sectionRef = React.useRef<HTMLElement | null>(null);
  const autoplayStartTimeoutRef = React.useRef<number | null>(null);
  const [version, setVersion] = React.useState<VersionKey>('V1');
  const [progress, setProgress] = React.useState(0);
  const [revealOverride, setRevealOverride] = React.useState(false);
  const { tier } = usePerformanceTier();
  const prefersReducedMotion = usePrefersReducedMotion();

  const compactRunway = prefersReducedMotion || tier === 'lowest';
  const autoplayEnabled = !prefersReducedMotion;
  const revealVisible = revealOverride || progress >= REVEAL_THRESHOLD;
  const activeLinks = DOWNLOAD_LINKS[version];

  const [paymentConfig, setPaymentConfig] = React.useState<{ messenger_url?: string } | null>(null);

  React.useEffect(() => {
    let active = true;
    fetch(edgeFunctionUrl('store-api', 'payment-config'))
      .then(async (res) => {
        const payload = await res.json().catch(() => ({}));
        const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
        if (!active || !res.ok) return;
        setPaymentConfig(data?.config || null);
      })
      .catch(() => { });
    return () => { active = false; };
  }, []);

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

    // Stop any existing manual tween and natively scroll cleanly.
    animatorRef.current?.stopAutoplay();
    sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });

    if (!autoplayEnabled) {
      setRevealOverride(true);
    }
  }, [autoplayEnabled, clearTimers]);

  return (
    <main className="lp-page">
      <header className="lp-header">
        <Link className="lp-brand" to="/home">
          <img src="/assets/logo.png" alt="VDJV Sampler Pad logo" className="lp-brand-logo" />
          <span className="lp-brand-copy">VDJV Sampler Pad App</span>
        </Link>
        <Link className="lp-open-app" to="/">
          Web Demo
        </Link>
      </header>

      <section className="lp-marketing-band">
        <p className="lp-kicker">VDJV Sampler Pad App</p>
        <h1>Premium Performance Sampler</h1>
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
          overlayVisible={revealVisible}
          activeVersion={version}
          tier={tier}
          topOverlay={
            <button type="button" className="lp-floating-download" onClick={handleDownloadClick} aria-label="Download VDJV Sampler Pad App">
              <Download size={22} className="lp-download-icon" />
              <span className="lp-floating-download-title">DOWNLOAD</span>
            </button>
          }
          overlay={
            <div className="lp-download-panel">
              <VersionSelector value={version} onChange={setVersion} />
              <div className="lp-platform-columns" aria-label="VDJV Sampler Pad App platform downloads">
                {platformGroups.map((group) => (
                  <div key={group.title} className={`lp-platform-group ${group.sideClass}`}>
                    <p className="lp-platform-title">{group.title}</p>
                    {group.items.map((item) => {
                      const Icon = item.Icon;

                      let overrideHref = activeLinks[item.key];
                      if ((version === 'V2' || version === 'V3') && item.key === 'ios') {
                        overrideHref = 'https://apps.apple.com/us/app/virtualdj-remote/id407160120';
                      } else if ((version === 'V2' || version === 'V3') && item.key === 'macos') {
                        overrideHref = paymentConfig?.messenger_url || '#';
                      }

                      return (
                        <a
                          key={item.key}
                          className="lp-platform-link"
                          href={overrideHref}
                          target="_blank"
                          rel="noreferrer"
                          title={platformDescriptions[version][item.key]}
                          aria-label={`${item.label} ${version}`}
                        >
                          <div className="lp-platform-info">
                            <Icon size={18} className="lp-platform-icon" />
                            <span>{item.label}</span>
                          </div>
                          <small>{platformDescriptions[version][item.key]}</small>
                        </a>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          }
        />
      </section>

      <section className="lp-version-details-section">
        <div className="lp-version-description-box" key={version}>
          <h4>{versionDescriptions[version].title}</h4>
          <p>{versionDescriptions[version].desc}</p>
        </div>
      </section>
    </main>
  );
}
