import * as React from 'react';
import { SamplerPadApp } from '@/components/sampler/SamplerPadApp';
import { GlobalErrorHandler } from '@/components/ui/global-error-handler';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { useIOSAudioHelper } from '@/components/ui/ios-audio-helper';
import { AuthProvider } from '@/hooks/useAuth';

export default function SamplerRouteApp() {
  const { IOSAudioHelper } = useIOSAudioHelper();

  return (
    <ErrorBoundary>
      <GlobalErrorHandler>
        <AuthProvider>
          <SamplerPadApp />
          <IOSAudioHelper />
        </AuthProvider>
      </GlobalErrorHandler>
    </ErrorBoundary>
  );
}
