import * as React from 'react';
import { BrowserRouter, HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { usePerformanceTier } from '@/hooks/usePerformanceTier';
import { captureProductEvent } from '@/lib/productAnalytics';
import {
  WEB_INSTALLER_REDIRECT_PATH,
  WEB_LEGACY_BUY_PATH,
  WEB_PRIVACY_PATH,
  WEB_SAMPLER_APP_PATH,
  WEB_TERMS_PATH,
  getBuyPagePath,
  getLandingPagePath,
  getPrivacyPagePath,
  getSamplerAppPath,
  getTermsPagePath,
  isPackagedAppRuntime,
} from '@/lib/runtime-routes';

const SamplerRouteApp = React.lazy(() => import('@/routes/SamplerRouteApp'));
const LandingPage = __VDJV_INCLUDE_LANDING__ ? React.lazy(() => import('@/routes/LandingPage')) : null;
const BuyPage = __VDJV_INCLUDE_LANDING__ ? React.lazy(() => import('@/routes/BuyPage')) : null;
const InstallerDownloadRedirectPage = __VDJV_INCLUDE_LANDING__ ? React.lazy(() => import('@/routes/InstallerDownloadRedirectPage')) : null;
const PrivacyPage = React.lazy(() => import('@/routes/PrivacyPage'));
const TermsPage = React.lazy(() => import('@/routes/TermsPage'));

function AppFallback() {
  return (
    <div className="lp-app-fallback">
      <div className="lp-loader-chip">Loading VDJV</div>
    </div>
  );
}

function AnalyticsRouteTracker() {
  const location = useLocation();

  React.useEffect(() => {
    captureProductEvent('screen_view', {
      path: location.pathname,
      search: location.search || '',
      hash: location.hash || '',
      screen_name:
        location.pathname === WEB_SAMPLER_APP_PATH || location.pathname.startsWith(`${WEB_SAMPLER_APP_PATH}/`)
          ? 'sampler'
          : location.pathname === getLandingPagePath()
            ? 'landing'
            : location.pathname === getBuyPagePath()
              ? 'pricing'
              : location.pathname === `${getBuyPagePath()}/checkout`
                ? 'pricing_checkout'
              : location.pathname === WEB_INSTALLER_REDIRECT_PATH
                ? 'installer_redirect'
                : 'other',
    });
  }, [location.hash, location.pathname, location.search]);

  return null;
}

function RouteContainer() {
  const Router = window.location.protocol === 'file:' ? HashRouter : BrowserRouter;
  const routerFuture = {
    v7_startTransition: true,
    v7_relativeSplatPath: true,
  };
  const packagedRuntime = isPackagedAppRuntime();
  const includeLanding = __VDJV_INCLUDE_LANDING__ && Boolean(LandingPage);
  const landingPath = getLandingPagePath();
  const buyPath = getBuyPagePath();
  const privacyPath = getPrivacyPagePath();
  const samplerPath = getSamplerAppPath();
  const termsPath = getTermsPagePath();
  const fallbackPath = packagedRuntime || !includeLanding ? samplerPath : landingPath;

  return (
    <Router future={routerFuture}>
      <AnalyticsRouteTracker />
      <Routes>
        {packagedRuntime ? (
          <>
            <Route path={samplerPath} element={<SamplerRouteApp />} />
            {includeLanding && LandingPage ? <Route path={landingPath} element={<LandingPage />} /> : null}
            {includeLanding && BuyPage ? <Route path={buyPath} element={<BuyPage />} /> : null}
            {includeLanding && BuyPage ? <Route path={`${buyPath}/checkout`} element={<BuyPage />} /> : null}
            {includeLanding && BuyPage ? <Route path={WEB_LEGACY_BUY_PATH} element={<Navigate to={buyPath} replace />} /> : null}
            <Route path={privacyPath} element={<PrivacyPage />} />
            <Route path={termsPath} element={<TermsPage />} />
            {includeLanding && InstallerDownloadRedirectPage ? <Route path={WEB_INSTALLER_REDIRECT_PATH} element={<InstallerDownloadRedirectPage />} /> : null}
            <Route path={WEB_SAMPLER_APP_PATH} element={<SamplerRouteApp />} />
            <Route path={`${WEB_SAMPLER_APP_PATH}/*`} element={<SamplerRouteApp />} />
          </>
        ) : (
          <>
            {includeLanding && LandingPage ? (
              <Route path={landingPath} element={<LandingPage />} />
            ) : (
              <Route path={landingPath} element={<Navigate to={samplerPath} replace />} />
            )}
            {includeLanding && BuyPage ? (
              <Route path={buyPath} element={<BuyPage />} />
            ) : null}
            {includeLanding && BuyPage ? (
              <Route path={`${buyPath}/checkout`} element={<BuyPage />} />
            ) : null}
            {includeLanding && BuyPage ? (
              <Route path={WEB_LEGACY_BUY_PATH} element={<Navigate to={buyPath} replace />} />
            ) : null}
            <Route path={WEB_PRIVACY_PATH} element={<PrivacyPage />} />
            <Route path={WEB_TERMS_PATH} element={<TermsPage />} />
            {includeLanding && InstallerDownloadRedirectPage ? (
              <Route path={WEB_INSTALLER_REDIRECT_PATH} element={<InstallerDownloadRedirectPage />} />
            ) : null}
            <Route path={samplerPath} element={<SamplerRouteApp />} />
            <Route path={`${samplerPath}/*`} element={<SamplerRouteApp />} />
          </>
        )}
        <Route path="*" element={<Navigate to={fallbackPath} replace />} />
      </Routes>
    </Router>
  );
}

function App() {
  const { tier } = usePerformanceTier();

  React.useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('perf-high', 'perf-medium', 'perf-low', 'perf-lowest');
    root.classList.add(`perf-${tier}`);
  }, [tier]);

  return (
    <React.Suspense fallback={<AppFallback />}>
      <RouteContainer />
    </React.Suspense>
  );
}

export default App;
