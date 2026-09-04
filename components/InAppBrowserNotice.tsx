import React, { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import {
  currentUserAgent, detectInAppBrowser, dismissInAppNotice, inAppNoticeDismissed,
} from '../services/inAppBrowser';

/**
 * "You are in an app's built-in browser, and a photograph can fail silently."
 *
 * A WARNING, NEVER A BLOCK. It is dismissible, it prevents nothing, and a
 * student who cannot leave the app — a borrowed phone, a menu with no "open in
 * browser" — must still be able to photograph every page and submit. See
 * `services/inAppBrowser.ts` for the evidence and for what the detector misses.
 *
 * WHY THE WORDING IS THIS BLUNT. "You may experience issues" would be useless
 * here. The failure mode is a photograph that vanishes without an error, which a
 * student reads as their own mistake — so the notice has to say that outright,
 * or it does not do the one job it exists for.
 *
 * WHERE IT APPEARS: the top of the page-photograph step, not the landing screen.
 * It should arrive when it becomes relevant and it must not be the first thing a
 * student sees.
 */
const InAppBrowserNotice: React.FC = () => {
  // Read once, at first render. The user agent cannot change under a live tab,
  // and re-deciding on every render would be a detector nobody can reason about.
  const [detected] = useState(() => detectInAppBrowser(currentUserAgent()).inApp);
  const [dismissed, setDismissed] = useState(inAppNoticeDismissed);

  if (!detected || dismissed) return null;

  const handleDismiss = () => {
    dismissInAppNotice();
    setDismissed(true);
  };

  return (
    <div
      className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3"
      role="status"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 text-sm text-amber-900">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div className="space-y-1">
            <p className="font-semibold">You are in an app&rsquo;s built-in browser.</p>
            <p>
              It has less memory than your phone&rsquo;s own browser, and a photograph can fail
              to load without saying so. Open this page in Chrome or Safari instead: tap the
              menu in the corner and choose &ldquo;Open in browser&rdquo;.
            </p>
            <p className="text-amber-800">
              You can carry on here if you would rather — nothing is blocked. Check that every
              page you photograph actually appears below.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          className="p-1 rounded hover:bg-amber-100 text-amber-800 flex-shrink-0"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

export default InAppBrowserNotice;
