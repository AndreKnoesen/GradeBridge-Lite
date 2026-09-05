// =====================================================
// Is the student inside an app's built-in browser?
// =====================================================
// On 2026-09-04 the first end-to-end run by a person was done inside the Gmail
// app's in-app browser, because she opened the assignment link from an email on
// her phone. She did not choose that browser and did not know she was in one.
//
// The run completed — sixteen pages, seventeen crops, all registered — but two
// photographs hit an Android "low memory" popup and **silently failed to load**.
// The same sixteen pages, on the same phone, at the same 9% free storage, in
// Chrome, produced no popup at all. So the constraint is the WebView, not the
// app and not the phone: an Android WebView runs on a smaller memory budget
// than the browser it looks like.
//
// That is the default path, not an edge case. A student taps a link in Canvas,
// in Gmail, or in a messaging app and lands in a WebView without ever choosing
// a browser — and the student most likely to hit it is the one who does not
// read instructions, which is exactly the student a written note will not reach.
//
// WHAT THIS IS: a heuristic over the user agent string. There is no API for it,
// every method is a guess, and the population changes without notice.
//
// WHICH WAY TO BE WRONG. A false positive is a student told to switch browsers
// when they did not need to — mildly annoying. A false negative is a student
// losing a photograph with no explanation, and misreading it as their own
// mistake. **So these rules are deliberately loose, and where a call is close it
// is made in favour of showing the notice.**
//
// WHAT THIS DOES NOT USE, deliberately:
//
//   * `navigator.standalone` — an iOS home-screen PWA, which is not this, and
//     an undefined property on every other platform.
//   * the presence of `window.chrome` — absent in plenty of real browsers and
//     present in some WebViews.
//   * feature-detecting a storage API — an API can be missing or throw for
//     private browsing, for a storage permission, or for a quota, none of which
//     is the question being asked, and all of which fail silently.
//
// Each of those breaks for a reason unrelated to the question, and breaks
// without saying so. The user agent is a guess, but it is a guess about the
// right thing.
//
// NOTHING HERE REACHES THE SUBMISSION. The result is not recorded, not stored
// beyond the tab, and no field is added to the payload. Whether a student saw
// the notice is not the grader's business.

/** What `detectInAppBrowser` answers. `rule` exists for the tests and the note. */
export interface InAppBrowserDetection {
  /** True when the user agent matches a known in-app browser signature. */
  inApp: boolean;
  /**
   * Which rule matched, or `null`. Never shown to a student — the notice says
   * "an app's built-in browser" rather than naming an app, because naming the
   * wrong app is a worse error than naming none.
   */
  rule: string | null;
}

interface Rule {
  name: string;
  test: (ua: string) => boolean;
}

/**
 * Ordered, and the order is only for which name a match reports; any one match
 * is enough. Comments name what each token is and, where it matters, what the
 * token does NOT cover.
 */
const RULES: Rule[] = [
  {
    // The single highest-value signal. Chromium stamps `; wv` into the platform
    // section of every Android WebView user agent — `(Linux; Android 14; …; wv)`
    // — and Chrome for Android never carries it. Gmail, Canvas, Facebook,
    // Instagram and most Android apps embed a WebView, so this one rule covers
    // the 2026-09-04 failure and most of its neighbours.
    //
    // It does not cover Android Custom Tabs: those ARE Chrome, with Chrome's own
    // memory budget, and are correctly not flagged.
    name: 'android-webview',
    test: (ua) => /;\s*wv[);]/i.test(ua),
  },
  {
    // Facebook's own tokens, on both platforms. FBAN/FBAV are the app name and
    // version; FB_IAB is literally "Facebook in-app browser"; FB4A and FBIOS are
    // the Android and iOS clients. Listed separately from the WebView rule
    // because the iOS ones are the only signal there.
    name: 'facebook',
    test: (ua) => /\bFBAN\/|\bFBAV\/|FB_IAB|\bFB4A\b|\bFBIOS\b/i.test(ua),
  },
  {
    // Instagram appends `Instagram 300.0.0.0.0` to an otherwise ordinary UA.
    name: 'instagram',
    test: (ua) => /\bInstagram\b/i.test(ua),
  },
  {
    // WeChat, on both platforms. `MicroMessenger` is the app; `wxwork` is the
    // WeCom/Work variant, which is a different app with the same engine.
    name: 'wechat',
    test: (ua) => /MicroMessenger|wxwork/i.test(ua),
  },
  {
    // Line, both platforms: ` Line/12.0.0` on iOS, `Line/12.0.0` inside the
    // platform section on Android. Word-bounded so it cannot match "Airline" or
    // a "Line" in a device model.
    name: 'line',
    test: (ua) => /\bLine\/[\d.]/i.test(ua),
  },
  {
    // Google's iOS apps. `GSA/` is the Google app (Search); Gmail for iOS is
    // NOT covered by this and is discussed in the iOS note below.
    name: 'google-ios-app',
    test: (ua) => /\bGSA\/[\d.]/i.test(ua),
  },
  {
    // Canvas Student — the app a student most often opens an assignment link
    // from. `candroid` is the Android client, `iCanvas` the iOS one; both
    // append their token to the WebView UA.
    name: 'canvas-student',
    test: (ua) => /\bcandroid\b|\biCanvas\b/i.test(ua),
  },
  {
    // The rest of the messaging and social apps a link arrives in. Each token is
    // the app's own, appended to an otherwise ordinary UA. `musical_ly` and
    // `BytedanceWebview` are TikTok; `Messenger` is Facebook's standalone app.
    name: 'messaging-app',
    test: (ua) => /\bWhatsApp\b|\bMessenger\b|\bSnapchat\b|\bTwitter\b|\bLinkedInApp\b|\bPinterest\b|musical_ly|BytedanceWebview|\bSlack\b|\bDiscord\b|\bTelegram\b|\bKAKAOTALK\b/i.test(ua),
  },
  {
    // ---- iOS, where this is genuinely hard ----
    //
    // An iOS in-app browser is a WKWebView and it renders with the same engine
    // as Safari, because Apple allows no other. There is no `; wv` and there is
    // no required token. **The only structural signal is a missing one:** a real
    // iOS browser ends its user agent with a `Safari/` token, and a plain
    // WKWebView with the default user agent does not. So: an iOS device, running
    // WebKit, with a `Mobile/` build token, and no `Safari/` at the end.
    //
    // The third-party iOS browsers are excluded explicitly rather than relied on
    // to carry `Safari/` — they all do today, and an explicit exclusion is
    // cheaper than finding out that one stopped.
    //
    // **WHAT THIS KNOWINGLY MISSES, and it is not a small set.** An app that
    // presents a link in `SFSafariViewController`, or a WKWebView whose host app
    // sets `applicationNameForUserAgent` to append `Safari/`, is byte-for-byte
    // indistinguishable from Safari itself. Gmail for iOS is in that set. There
    // is no heuristic for it, and this file does not pretend otherwise —
    // `tests/in-app-browser-tests.mjs` carries such a string and asserts it is
    // NOT detected, so the gap is written down rather than assumed away.
    //
    // The consolation, and the reason this is tolerable: iOS is not where the
    // measured failure was. `SFSafariViewController` is a real Safari process
    // with Safari's memory budget; the case being missed is largely the case
    // that does not need the warning.
    name: 'ios-webview',
    test: (ua) => {
      const isIosDevice = /\((?:iPhone|iPad|iPod)[^)]*\)/i.test(ua);
      if (!isIosDevice) return false;
      if (!/AppleWebKit\//i.test(ua)) return false;
      if (!/\bMobile\/\w/i.test(ua)) return false;
      // A real third-party iOS browser names itself.
      if (/\bCriOS\/|\bFxiOS\/|\bEdgiOS\/|\bOPiOS\/|\bOPT\/|\bYaBrowser\/|\bDuckDuckGo\//i.test(ua)) return false;
      return !/\bSafari\/[\d.]/i.test(ua);
    },
  },
];

/**
 * Classify a user agent string. Pure — pass the string in, so this is testable
 * against a table and so nothing here touches a global.
 *
 * An empty string returns `false`. That is the one place the bias is reversed,
 * and on purpose: no user agent means no browser, which in practice means a
 * test runner or a server render, and showing a browser warning to a process
 * that has no student in front of it helps nobody.
 */
export const detectInAppBrowser = (userAgent: string): InAppBrowserDetection => {
  const ua = (userAgent ?? '').trim();
  if (ua === '') return { inApp: false, rule: null };
  for (const rule of RULES) {
    if (rule.test(ua)) return { inApp: true, rule: rule.name };
  }
  return { inApp: false, rule: null };
};

/** The live user agent, or `''` where there is no browser to ask. */
export const currentUserAgent = (): string =>
  typeof navigator === 'undefined' ? '' : navigator.userAgent || '';

// ---------------------------------------------------------------------------
// The notice's memory, which lasts exactly one tab session
// ---------------------------------------------------------------------------
// `sessionStorage`, not `localStorage`, and the difference is the whole point:
// a student who dismissed this in September should see it again in October,
// because by then they may be on a different device, in a different app, or
// have forgotten. A dismissal is a statement about this sitting, not a setting.

/** The key. Session-scoped; deliberately not in `constants.ts` beside the persistent ones. */
export const INAPP_NOTICE_DISMISSED_KEY = 'gradebridge_inapp_notice_dismissed';

/**
 * Has the student dismissed the notice in this tab?
 *
 * A storage that throws — private browsing, a blocked cookie policy, a WebView
 * with storage disabled — answers `false`, so the notice shows. Erring toward
 * showing it costs one tap; erring the other way is a student who never sees it
 * because their browser is exactly the restricted kind this warns about.
 */
export const inAppNoticeDismissed = (): boolean => {
  try {
    return window.sessionStorage.getItem(INAPP_NOTICE_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
};

/** Remember the dismissal for this tab session. Never throws. */
export const dismissInAppNotice = (): void => {
  try {
    window.sessionStorage.setItem(INAPP_NOTICE_DISMISSED_KEY, '1');
  } catch {
    // Nothing to do and nothing to tell the student: the notice is advisory,
    // and the component hides it for the life of this render either way.
  }
};
