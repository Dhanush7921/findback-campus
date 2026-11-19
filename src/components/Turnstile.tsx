import { useEffect, useRef } from 'react';

declare global {
  interface Window { turnstile?: { render: (el: HTMLElement, o: Record<string, unknown>) => string; remove: (id: string) => void } }
}

/** Optional Cloudflare Turnstile bot check (enabled when the API exposes a site key). */
export function Turnstile({ siteKey, onToken }: { siteKey: string; onToken: (t: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let id: string | undefined;
    const render = () => { if (ref.current && window.turnstile) id = window.turnstile.render(ref.current, { sitekey: siteKey, callback: onToken, 'expired-callback': () => onToken(''), theme: 'light' }); };
    if (window.turnstile) render();
    else {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.onload = render;
      document.head.appendChild(s);
    }
    return () => { if (id && window.turnstile) window.turnstile.remove(id); };
  }, [siteKey, onToken]);
  return <div ref={ref} />;
}
