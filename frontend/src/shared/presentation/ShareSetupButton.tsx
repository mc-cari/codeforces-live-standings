import { useEffect, useRef, useState } from 'react';

type Props = { href?: string; getUrl?: () => string; disabled?: boolean };

export default function ShareSetupButton({ href, getUrl, disabled }: Props) {
  const [feedback, setFeedback] = useState<{ href?: string; message: string; fallbackUrl: string }>();
  const setupVersion = useRef(0);
  const hrefRef = useRef(href);
  useEffect(() => {
    hrefRef.current = href;
    setupVersion.current += 1;
    return () => {
      setupVersion.current += 1;
      hrefRef.current = undefined;
    };
  }, [href]);
  const copyLink = async () => {
    setupVersion.current += 1;
    const version = setupVersion.current;
    const url = getUrl?.() || new URL(href || window.location.href, window.location.origin).href;
    try {
      await navigator.clipboard.writeText(url);
      if (version !== setupVersion.current || hrefRef.current !== href) return;
      setFeedback({ href, fallbackUrl: '', message: 'Link copied.' });
    } catch {
      if (version !== setupVersion.current || hrefRef.current !== href) return;
      setFeedback({ href, fallbackUrl: url, message: 'Copy the link below.' });
    }
  };
  const visibleFeedback = feedback?.href === href ? feedback : undefined;
  return <div className="flex min-w-0 flex-wrap items-center gap-2">
    <button
      className="min-h-11 rounded-sm border border-[#25364d] bg-[#13243a] px-3 py-2 text-sm font-semibold text-white hover:bg-[#1b304a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#65adff] disabled:cursor-not-allowed disabled:opacity-50"
      disabled={disabled}
      onClick={copyLink}
      type="button"
    >Share setup</button>
    <span className="text-sm text-[#9fc8ff]" role="status" aria-live="polite">{visibleFeedback?.message}</span>
    {visibleFeedback?.fallbackUrl && <input aria-label="Share link" className="broadcast-input min-w-0 px-2 text-sm" onFocus={(event) => event.target.select()} readOnly value={visibleFeedback.fallbackUrl} />}
  </div>;
}
