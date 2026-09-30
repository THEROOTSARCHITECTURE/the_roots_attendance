import { useEffect, useState } from 'react';

// Android/desktop Chrome fire beforeinstallprompt; iOS needs Share → Add to Home Screen
export default function InstallPrompt() {
  const [evt, setEvt] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);

  useEffect(() => {
    const h = (e) => { e.preventDefault(); setEvt(e); };
    window.addEventListener('beforeinstallprompt', h);
    return () => window.removeEventListener('beforeinstallprompt', h);
  }, []);

  if (standalone || dismissed || (!evt && !ios)) return null;

  return (
    <div className="mx-4 mt-4 flex items-center gap-3 rounded-xl bg-white p-3 text-sm shadow-sm">
      <span className="flex-1">
        {evt ? 'Install the app for one-tap attendance.' : 'Install: tap Share, then “Add to Home Screen”.'}
      </span>
      {evt && (
        <button
          onClick={async () => { evt.prompt(); await evt.userChoice; setEvt(null); }}
          className="rounded-lg bg-roots-700 px-3 py-1.5 font-medium text-white"
        >
          Install
        </button>
      )}
      <button onClick={() => setDismissed(true)} aria-label="Dismiss" className="px-1 text-gray-400">✕</button>
    </div>
  );
}
