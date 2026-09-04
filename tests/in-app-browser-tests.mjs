// =====================================================
// In-app browser detection
// =====================================================
// Plain Node (>= 18), no test framework, same shape as the other suites.
//
//   node tests/in-app-browser-tests.mjs        (also runs as part of `npm test`)
//
// WHY THIS EXISTS: a detector nobody has seen fire is a comment. The thing being
// guarded is a heuristic over a string, so the only way to know it works is to
// run it over the strings — including the ones it must NOT fire on, which is
// where a loose regex does its damage.
//
// WHERE THE STRINGS CAME FROM, honestly. **None of them was captured from the
// 2026-09-04 run** — that session's user agent was not recorded, which is part
// of why this file exists. Each string below is the published shape of its
// family, with a representative version number; the detector keys on one token
// per family and the version digits are decoration. Each entry says which token
// it is pinning, so a string that is stale in its version numbers still tests
// the thing it was added to test.
//
// THE DOCUMENTED MISS is the last row of the in-app table: an iOS in-app browser
// that is byte-for-byte a Safari user agent, asserted NOT detected. It is here
// so the gap is written down and fails loudly if anyone ever claims to have
// closed it without evidence.
import { build } from 'esbuild';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

// ---------- tiny assertion harness (mirrors the other suites) ----------
let passed = 0, failed = 0;
const results = [];

const check = (name, fn) => {
  try {
    fn();
    passed++;
    results.push(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    results.push(`  FAIL  ${name}\n          ${err.message}`);
  }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

/**
 * Source with its comments removed, for the checks below that ask what the code
 * DOES rather than what it says. Both files explain at length why they use
 * `sessionStorage` and not `localStorage`, and a scan that cannot tell the
 * explanation from the call fails on its own documentation — which is the sort
 * of check that gets deleted rather than fixed.
 *
 * Crude on purpose: block and line comments only, no string-literal awareness.
 * That is sound for these two files, which contain no `//` inside a string, and
 * this is the only place it is used.
 */
const codeOnly = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const outDir = mkdtempSync(join(tmpdir(), 'gb-inapp-test-'));

// ---------- build the detector ----------
const detectorFile = join(outDir, 'inAppBrowser.mjs');
await build({
  entryPoints: [join(REPO, 'services/inAppBrowser.ts')],
  outfile: detectorFile,
  format: 'esm',
  target: 'es2022',
  bundle: false,
  logLevel: 'silent',
});
const {
  detectInAppBrowser, currentUserAgent,
  inAppNoticeDismissed, dismissInAppNotice, INAPP_NOTICE_DISMISSED_KEY,
} = await import(pathToFileURL(detectorFile).href);

// ---------- build the notice component, with a server renderer ----------
// Bundled through esbuild's stdin so nothing has to be written into the repo
// tree. `resolveDir` is the repo root, so the component's own imports and
// react-dom/server both resolve out of the real node_modules.
const harnessFile = join(outDir, 'notice-harness.mjs');
await build({
  stdin: {
    contents: `
      import * as React from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      import InAppBrowserNotice from './components/InAppBrowserNotice';
      export const render = () => renderToStaticMarkup(React.createElement(InAppBrowserNotice));
    `,
    resolveDir: REPO,
    loader: 'tsx',
    sourcefile: 'notice-harness.tsx',
  },
  outfile: harnessFile,
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  bundle: true,
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  // react-dom's server build reaches for node's `util` through a bare require,
  // which an ESM bundle has no way to honour. This is esbuild's documented
  // shim for exactly that: give the bundle a real `require`.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'silent',
});
const { render } = await import(pathToFileURL(harnessFile).href);

// =====================================================
// 1. The user agent table
// =====================================================
// `token` names the substring the detector is actually keying on. `rule` is the
// rule expected to claim the match — asserted as well as the boolean, because a
// string matching by accident under someone else's rule is a passing test that
// proves nothing.

/** Must be detected. */
const IN_APP = [
  {
    label: 'Android WebView (generic — the Gmail/Canvas/most-apps case)',
    token: '; wv)',
    source: 'the platform section Chromium stamps into every Android WebView UA; documented by the Android WebView team.',
    rule: 'android-webview',
    ua: 'Mozilla/5.0 (Linux; Android 14; SM-S911B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.144 Mobile Safari/537.36',
  },
  {
    label: 'Android WebView, older device shape',
    token: '; wv)',
    source: 'same token, an older Android release — kept separately because the surrounding fields differ and a regex anchored too tightly would pass the row above and fail this one.',
    rule: 'android-webview',
    ua: 'Mozilla/5.0 (Linux; Android 10; K; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.0.0 Mobile Safari/537.36',
  },
  {
    label: 'Facebook in-app browser, Android',
    token: 'FBAN / FBAV / FB_IAB',
    source: "Facebook's published in-app browser UA shape; FB_IAB is literally their in-app-browser marker.",
    rule: 'android-webview',   // the `; wv` token wins first; the FB rule is the iOS backstop
    ua: 'Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A.230805.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/116.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/430.0.0.34.113;]',
  },
  {
    label: 'Facebook in-app browser, iOS',
    token: 'FBAN/FBIOS',
    source: 'same published shape on iOS, where there is no `; wv` and this token is the only signal.',
    rule: 'facebook',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21B74 [FBAN/FBIOS;FBDV/iPhone14,2;FBMD/iPhone;FBSN/iOS;FBSV/17.1;FBID/phone;FBLC/en_US;FBOP/5]',
  },
  {
    label: 'Instagram in-app browser, iOS',
    token: 'Instagram',
    source: "Instagram appends its app name and version to an otherwise ordinary UA.",
    rule: 'instagram',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 302.0.0.23.109 (iPhone14,2; iOS 16_6; en_US; en; scale=3.00; 1170x2532; 519528798)',
  },
  {
    label: 'WeChat, iOS',
    token: 'MicroMessenger',
    source: "WeChat's engine token, the same on both platforms.",
    rule: 'wechat',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.42(0x18002a2f) NetType/WIFI Language/en',
  },
  {
    label: 'Line, iOS',
    token: 'Line/',
    source: "Line appends ` Line/<version>`; word-bounded in the detector so a device model containing 'line' cannot match.",
    rule: 'line',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Line/13.14.0',
  },
  {
    label: 'Google app (Search) in-app browser, iOS',
    token: 'GSA/',
    source: "Google's iOS apps identify as GSA. This is the Google app; **Gmail for iOS is not covered** — see the documented miss below.",
    rule: 'google-ios-app',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/291.0.567591927 Mobile/15E148 Safari/604.1',
  },
  {
    label: 'Canvas Student, iOS',
    token: 'iCanvas',
    source: "Instructure's iOS client token. Included because Canvas is where a student most often taps an assignment link.",
    rule: 'canvas-student',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21B74 iCanvas/7.3.0',
  },
  {
    label: 'Bare iOS WKWebView (no app token, no Safari token)',
    token: 'iOS + Mobile/ and NO Safari/',
    source: 'the default WKWebView UA: an app that sets no `applicationNameForUserAgent` drops the trailing Safari token that every real iOS browser carries. This is the structural iOS signal and the only one there is.',
    rule: 'ios-webview',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21B74',
  },
];

/** Must NOT be detected. Ordinary browsers a student legitimately uses. */
const ORDINARY = [
  {
    label: 'Chrome for Android — the browser the retest ran in, with no popup',
    token: 'no `; wv`',
    source: "Chrome's own mobile UA. This is the string that must never match, because it is the browser the notice is telling students to switch TO.",
    ua: 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36',
  },
  {
    label: 'Safari, iPhone',
    token: 'Safari/604.1 present',
    source: "Apple's mobile Safari UA.",
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
  },
  {
    label: 'Safari, iPad',
    token: 'Safari/604.1 present',
    source: 'iPadOS Safari; included because the iOS rule keys on the device token and an iPad must be treated like an iPhone, not missed.',
    ua: 'Mozilla/5.0 (iPad; CPU OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
  },
  {
    label: 'Chrome for iOS',
    token: 'CriOS',
    source: "Google's iOS browser. A real browser wrapped in a WKWebView by Apple's rules — it must not be flagged, and it is excluded by name as well as by its Safari token.",
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1',
  },
  {
    label: 'Firefox for iOS',
    token: 'FxiOS',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/121.0 Mobile/15E148 Safari/605.1.15',
    source: "Mozilla's iOS browser, same reasoning as Chrome for iOS.",
  },
  {
    label: 'Edge for iOS',
    token: 'EdgiOS',
    source: "Microsoft's iOS browser, same reasoning.",
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 EdgiOS/120.0.2210.86 Mobile/15E148 Safari/605.1.15',
  },
  {
    label: 'Firefox for Android',
    token: 'Gecko/Firefox, no wv',
    source: "Mozilla's Android browser — a different engine entirely, and a reminder that the `; wv` rule must not be written as 'anything WebKit on Android'.",
    ua: 'Mozilla/5.0 (Android 14; Mobile; rv:121.0) Gecko/121.0 Firefox/121.0',
  },
  {
    label: 'Chrome, desktop Windows',
    token: 'desktop UA',
    source: 'the ordinary desktop case; a student on a laptop must never see this notice.',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  },
  {
    label: 'Safari, macOS',
    token: 'desktop UA',
    source: 'the other ordinary desktop case.',
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  },
];

/**
 * THE DOCUMENTED MISS. Asserted NOT detected — this test passes because the
 * detector fails here, and that is deliberate.
 *
 * An iOS app that opens a link in `SFSafariViewController`, or a WKWebView whose
 * host sets `applicationNameForUserAgent` to append the Safari token, produces a
 * user agent identical to Safari's. Gmail for iOS is in that set. There is no
 * heuristic that separates them and this row says so, rather than leaving the
 * gap to be discovered by a student.
 *
 * Tolerable because iOS is not where the measured failure was: an
 * `SFSafariViewController` is a real Safari process with Safari's memory budget,
 * so the case being missed is largely the case that does not need the warning.
 * If iOS photograph losses are ever reported, this row is the first place to
 * look, and closing it will need a signal that is not the user agent.
 */
const DOCUMENTED_MISS = {
  label: 'iOS in-app browser presenting as Safari (e.g. SFSafariViewController)',
  token: 'none — indistinguishable from the Safari row above',
  source: 'byte-for-byte the iPhone Safari UA. Kept as its own row so the gap is a test, not a hope.',
  ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
};

for (const row of IN_APP) {
  check(`detected: ${row.label}`, () => {
    const got = detectInAppBrowser(row.ua);
    assert(got.inApp === true, `expected in-app (token ${row.token}), got inApp=false`);
    assert(got.rule === row.rule, `matched by rule "${got.rule}", expected "${row.rule}"`);
  });
}

for (const row of ORDINARY) {
  check(`not detected: ${row.label}`, () => {
    const got = detectInAppBrowser(row.ua);
    assert(got.inApp === false, `expected ordinary browser, matched rule "${got.rule}"`);
  });
}

check(`documented miss stays missed: ${DOCUMENTED_MISS.label}`, () => {
  const got = detectInAppBrowser(DOCUMENTED_MISS.ua);
  assert(
    got.inApp === false,
    'this string is byte-for-byte a Safari UA. If it now matches, the detector is also ' +
    'flagging every iPhone Safari user — check the Safari row above before celebrating.'
  );
});

check('the documented miss really is byte-identical to the Safari row', () => {
  const safari = ORDINARY.find((r) => r.label === 'Safari, iPhone');
  assert(
    safari.ua === DOCUMENTED_MISS.ua,
    'the miss is only a miss while the two strings are the same; they have drifted apart, ' +
    'which means the row no longer documents what it claims to'
  );
});

check('an empty user agent is not flagged', () => {
  assert(detectInAppBrowser('').inApp === false, 'empty UA matched');
  assert(detectInAppBrowser('   ').inApp === false, 'whitespace UA matched');
});

check('currentUserAgent survives a missing navigator', () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  try {
    Object.defineProperty(globalThis, 'navigator', { value: undefined, configurable: true });
    assert(currentUserAgent() === '', 'expected empty string with no navigator');
  } finally {
    if (saved) Object.defineProperty(globalThis, 'navigator', saved);
    else delete globalThis.navigator;
  }
});

// =====================================================
// 2. Dismissal: this session only, and never a block
// =====================================================
const withStorage = (store, fn) => {
  const savedWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  try {
    Object.defineProperty(globalThis, 'window', { value: { sessionStorage: store }, configurable: true });
    return fn();
  } finally {
    if (savedWindow) Object.defineProperty(globalThis, 'window', savedWindow);
    else delete globalThis.window;
  }
};

const fakeStore = () => {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
  };
};

check('dismissal is remembered within the session', () => {
  const store = fakeStore();
  withStorage(store, () => {
    assert(inAppNoticeDismissed() === false, 'dismissed before anything was dismissed');
    dismissInAppNotice();
    assert(inAppNoticeDismissed() === true, 'dismissal not remembered');
  });
});

check('a new session starts undismissed — nothing persists past the tab', () => {
  const first = fakeStore();
  withStorage(first, () => dismissInAppNotice());
  assert(first.map.size === 1, 'the dismissal was not written where it was supposed to be');
  // A second session is a second sessionStorage. Nothing carries over: a student
  // who dismissed this in September must see it again in October.
  withStorage(fakeStore(), () => {
    assert(inAppNoticeDismissed() === false, 'the dismissal survived into a new session');
  });
});

check('dismissal is session-scoped by construction, not by convention', () => {
  // The property under test is that `localStorage` is never touched: a window
  // that offers only sessionStorage must still work.
  const store = fakeStore();
  withStorage(store, () => {
    dismissInAppNotice();
    assert(inAppNoticeDismissed() === true, 'dismissal needs something other than sessionStorage');
  });
  const src = codeOnly(readFileSync(join(REPO, 'services/inAppBrowser.ts'), 'utf8'));
  assert(!/localStorage/.test(src), 'inAppBrowser.ts reads or writes localStorage');
});

check('a storage that throws shows the notice rather than swallowing it', () => {
  const hostile = {
    getItem: () => { throw new Error('SecurityError'); },
    setItem: () => { throw new Error('SecurityError'); },
  };
  withStorage(hostile, () => {
    assert(inAppNoticeDismissed() === false, 'a throwing read must answer "not dismissed"');
    dismissInAppNotice();   // must not throw
  });
});

// =====================================================
// 3. The notice itself
// =====================================================
const renderWith = (ua, store) => {
  const savedNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const savedWin = Object.getOwnPropertyDescriptor(globalThis, 'window');
  try {
    Object.defineProperty(globalThis, 'navigator', { value: { userAgent: ua }, configurable: true });
    Object.defineProperty(globalThis, 'window', { value: { sessionStorage: store ?? fakeStore() }, configurable: true });
    return render();
  } finally {
    if (savedNav) Object.defineProperty(globalThis, 'navigator', savedNav); else delete globalThis.navigator;
    if (savedWin) Object.defineProperty(globalThis, 'window', savedWin); else delete globalThis.window;
  }
};

const WEBVIEW_UA = IN_APP[0].ua;
const CHROME_UA = ORDINARY[0].ua;

check('the notice renders in an Android WebView', () => {
  const html = renderWith(WEBVIEW_UA);
  assert(html.length > 0, 'nothing rendered');
  assert(/built-in browser/.test(html), 'the notice does not say where the student is');
});

check('it says a photograph can fail silently, not that issues may occur', () => {
  const html = renderWith(WEBVIEW_UA);
  assert(/less memory/.test(html), 'the reason is missing');
  assert(/fail\s*to load without saying so/.test(html), 'the silent-failure sentence is missing');
  assert(/Chrome or Safari/.test(html), 'the notice does not say what to do instead');
  assert(!/may experience issues/i.test(html), '"may experience issues" is not this warning');
});

check('it offers a way out of the notice', () => {
  const html = renderWith(WEBVIEW_UA);
  assert(/aria-label="Dismiss"/.test(html), 'no dismiss control');
});

check('it renders nothing at all in ordinary Chrome', () => {
  assert(renderWith(CHROME_UA) === '', `expected empty markup, got: ${renderWith(CHROME_UA).slice(0, 120)}`);
});

check('it renders nothing once dismissed in this session', () => {
  const store = fakeStore();
  withStorage(store, () => dismissInAppNotice());
  assert(renderWith(WEBVIEW_UA, store) === '', 'the notice came back after being dismissed');
});

check('it blocks nothing: no overlay, no modal, no disabled control', () => {
  const html = renderWith(WEBVIEW_UA);
  assert(!/\bfixed\b|\bdisabled\b|role="dialog"|aria-modal/.test(html),
    'the notice renders as something that can stand between a student and the page');
});

// =====================================================
// 4. Nothing about the submission changes
// =====================================================
// The payload must be byte-identical whether or not the notice was shown, and
// the way to be sure of that is that no code on the submission path can see the
// detector at all. Checked by reachability rather than by comparing two
// payloads: a payload comparison passes for as long as nobody has added the
// field yet, and says nothing about the next person who does.
check('the detector is unreachable from anything that builds the submission', () => {
  const PAYLOAD_PATH = [
    'App.tsx',
    'cryptoService.ts',
    'services/submissionPackage.ts',
    'services/pageCrops.ts',
    'services/cropRegions.ts',
    'pageStore.ts',
    'imageIngest.ts',
  ];
  for (const rel of PAYLOAD_PATH) {
    const src = readFileSync(join(REPO, rel), 'utf8');
    assert(!/inAppBrowser|detectInAppBrowser/.test(src),
      `${rel} references the in-app browser detector — the submission must not know`);
  }
});

check('the detection result is never written anywhere that outlives the tab', () => {
  const src = codeOnly(readFileSync(join(REPO, 'services/inAppBrowser.ts'), 'utf8'));
  const notice = codeOnly(readFileSync(join(REPO, 'components/InAppBrowserNotice.tsx'), 'utf8'));
  // Only the dismissal is stored, and only as the literal '1'. The rule name,
  // the user agent and the boolean go nowhere.
  assert(!/localStorage|indexedDB|IDB|fetch\(|navigator\.sendBeacon/.test(src + notice),
    'the detector or the notice persists or transmits something');
  const writes = [...src.matchAll(/setItem\(([^)]*)\)/g)].map((m) => m[1]);
  assert(writes.length === 1, `expected exactly one storage write, found ${writes.length}`);
  assert(writes[0].includes(`INAPP_NOTICE_DISMISSED_KEY`) && writes[0].includes(`'1'`),
    `the one write is not the dismissal flag: ${writes[0]}`);
});

check('the notice sits in the photograph step, not on the landing screen', () => {
  const uploader = readFileSync(join(REPO, 'components/PageUploader.tsx'), 'utf8');
  const app = readFileSync(join(REPO, 'App.tsx'), 'utf8');
  assert(/InAppBrowserNotice/.test(uploader), 'PageUploader does not render the notice');
  assert(!/InAppBrowserNotice/.test(app), 'the notice is mounted outside the photograph step');
});

// ---------- report ----------
rmSync(outDir, { recursive: true, force: true });
console.log('\nIn-app browser detection');
console.log(`  ${IN_APP.length} in-app strings, ${ORDINARY.length} ordinary browsers, 1 documented miss\n`);
console.log(results.join('\n'));
console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
