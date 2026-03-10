import * as React from 'react';
import { BrowserRouter, HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { usePerformanceTier } from '@/hooks/usePerformanceTier';

const SamplerRouteApp = React.lazy(() => import('@/routes/SamplerRouteApp'));
const LandingPage = React.lazy(() => import('@/routes/LandingPage'));

function AppFallback() {
  return (
    <div className="lp-app-fallback">
      <div className="lp-loader-chip">Loading VDJV</div>
    </div>
  );
}

function RouteContainer() {
  const Router = window.location.protocol === 'file:' ? HashRouter : BrowserRouter;

  return (
    <Router>
      <Routes>
        <Route path="/" element={<SamplerRouteApp />} />
        <Route path="/home" element={<LandingPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
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
