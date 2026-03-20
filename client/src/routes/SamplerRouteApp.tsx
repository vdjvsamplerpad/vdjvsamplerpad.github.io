import * as React from 'react';
import { SamplerPadApp } from '@/components/sampler/SamplerPadApp';
import { GlobalErrorHandler } from '@/components/ui/global-error-handler';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { IOSAudioHelper, useIOSAudioHelper } from '@/components/ui/ios-audio-helper';
import { AuthProvider } from '@/hooks/useAuth';

const MemoizedSamplerPadApp = React.memo(SamplerPadApp);
const MemoizedIOSAudioHelper = React.memo(IOSAudioHelper);

export default function SamplerRouteApp() {
  const { showHelper, hideHelper } = useIOSAudioHelper();

  return (
    <ErrorBoundary>
      <GlobalErrorHandler>
        <AuthProvider>
          <MemoizedSamplerPadApp />
          <MemoizedIOSAudioHelper isVisible={showHelper} onClose={hideHelper} />
        </AuthProvider>
      </GlobalErrorHandler>
    </ErrorBoundary>
  );
}
