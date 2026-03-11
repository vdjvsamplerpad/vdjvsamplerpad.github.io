import * as React from 'react';
import { BrowserRouter, HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { usePerformanceTier } from '@/hooks/usePerformanceTier';
import {
  WEB_SAMPLER_APP_PATH,
  getLandingPagePath,
  getSamplerAppPath,
  isPackagedAppRuntime,
} from '@/lib/runtime-routes';

const SamplerRouteApp = React.lazy(() => import('@/routes/SamplerRouteApp'));
const LandingPage = __VDJV_INCLUDE_LANDING__ ? React.lazy(() => import('@/routes/LandingPage')) : null;

function AppFallback() {
  return (
    <div className="lp-app-fallback">
      <div className="lp-loader-chip">Loading VDJV</div>
    </div>
  );
}

function RouteContainer() {
  const Router = window.location.protocol === 'file:' ? HashRouter : BrowserRouter;
  const packagedRuntime = isPackagedAppRuntime();
  const includeLanding = __VDJV_INCLUDE_LANDING__ && Boolean(LandingPage);
  const landingPath = getLandingPagePath();
  const samplerPath = getSamplerAppPath();
  const fallbackPath = packagedRuntime || !includeLanding ? samplerPath : landingPath;

  return (
    <Router>
      <Routes>
        {packagedRuntime ? (
          <>
            <Route path={samplerPath} element={<SamplerRouteApp />} />
            {includeLanding && LandingPage ? <Route path={landingPath} element={<LandingPage />} /> : null}
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
