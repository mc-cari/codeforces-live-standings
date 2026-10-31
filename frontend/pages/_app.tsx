import React, { useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { pageMode, track } from '@/src/shared/telemetry/telemetry';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/500.css';
import '../styles/globals.css';
import type { AppProps } from 'next/app';
import { Analytics } from '@vercel/analytics/react';

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();
  const recordedInitial = useRef(false);
  useEffect(() => {
    const record = (path: string) => {
      const mode = pageMode(path);
      if (mode) track({ kind: 'page_view', mode });
    };
    if (router.isReady && !recordedInitial.current) {
      recordedInitial.current = true;
      record(router.asPath);
    }
    router.events.on('routeChangeComplete', record);
    return () => router.events.off('routeChangeComplete', record);
  }, [router.isReady, router.asPath, router.events]);
  return (
    <>
      <Component key={router.asPath} {...pageProps} />
      <Analytics />
    </>
  );
}
