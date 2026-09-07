// =====================================================
// The QR decoder is self-contained, and the vendored binary is the real one
// =====================================================
// The CONSUME contract is self-contained: nothing is fetched at runtime, from
// anywhere, including the app's own origin. `zxing-wasm` fights that by default
// twice over — its published `locateFile` points at `fastly.jsdelivr.net`, and
// left alone a bundler emits `zxing_reader.wasm` as a separate asset that the
// emscripten glue fetches on first use.
//
// **Both defaults are silent when they win.** A `locateFile` that slipped back
// to the CDN would still decode on every developer machine and every test run;
// it would fail only for the student on the train, which is the one case the
// rule exists for. So this file asserts the property by BUILDING the app and
// looking at what came out, not by reading the source that was supposed to
// prevent it.
// =====================================================

import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModule, ensureCaptures, readCapture, SYNTHETIC_DIR } from './captureSet.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `\n          ${detail}`}`);
  if (!ok) failures++;
};

console.log('\nThe QR decoder: self-contained, and the binary is the pinned one\n');

// =====================================================
// 1. The vendored base64 is the installed binary, byte for byte
// =====================================================
// `vendor/zxingReaderWasm.ts` is generated and committed, so it can drift from
// what `npm install` puts on disk — a bumped dependency with a stale vendored
// binary would run the OLD decoder while `package.json` claimed the new one,
// and every measurement in the completion notes would be about a file nobody
// could find. The generator records the version and hash; this compares them.
const pkgPath = join(REPO, 'node_modules', 'zxing-wasm', 'package.json');
const wasmPath = join(REPO, 'node_modules', 'zxing-wasm', 'dist', 'reader', 'zxing_reader.wasm');

if (!existsSync(wasmPath)) {
  console.log('  SKIP: zxing-wasm is not installed — run npm install.\n');
  process.exit(0);
}

const installed = readFileSync(wasmPath);
const installedSha = createHash('sha256').update(installed).digest('hex');
const installedVersion = JSON.parse(readFileSync(pkgPath, 'utf8')).version;

const vendored = await loadModule('vendor/zxingReaderWasm.ts', 'qd_vendor.mjs');
check('the vendored binary names the installed version',
  vendored.ZXING_READER_WASM_VERSION === installedVersion,
  `vendored ${vendored.ZXING_READER_WASM_VERSION}, installed ${installedVersion}`);
check('the vendored binary names the installed hash',
  vendored.ZXING_READER_WASM_SHA256 === installedSha,
  `vendored ${vendored.ZXING_READER_WASM_SHA256}\n          installed ${installedSha}`);

const decoded = Buffer.from(vendored.ZXING_READER_WASM_BASE64, 'base64');
check('the base64 decodes to the installed binary, byte for byte',
  decoded.length === installed.length && Buffer.compare(decoded, installed) === 0,
  `${decoded.length} bytes vs ${installed.length}`);
check('...and it is a WebAssembly module, not something that merely decodes',
  decoded.subarray(0, 4).toString('hex') === '0061736d',
  decoded.subarray(0, 4).toString('hex'));

// The `@internal` coupling in services/zxingReader.ts is only safe against an
// exact version. A caret would let `npm install` move the binding underneath it.
const appPkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
check('package.json pins zxing-wasm exactly, with no range',
  /^\d+\.\d+\.\d+$/.test(appPkg.dependencies['zxing-wasm'] ?? ''),
  String(appPkg.dependencies['zxing-wasm']));

// =====================================================
// 2. The built bundle carries the binary rather than a way of getting it
// =====================================================
// A real build, into a temp directory, then read back.
console.log('\n  the built bundle');
const outDir = mkdtempSync(join(tmpdir(), 'gb-qr-bundle-'));
await build({
  entryPoints: [join(REPO, 'services', 'qrDecode.ts')],
  outfile: join(outDir, 'bundle.js'),
  format: 'esm', target: 'es2022', bundle: true, minify: false,
  absWorkingDir: REPO, logLevel: 'silent',
});
const bundled = readFileSync(join(outDir, 'bundle.js'), 'utf8');

check('the binary is IN the bundle, not beside it',
  bundled.length > 1_400_000, `${bundled.length.toLocaleString()} bytes`);

// **A grep for CDN hostnames is NOT the check here, and it would fail.**
// `zxing-wasm`'s own module-level default `locateFile` builds a
// `fastly.jsdelivr.net` URL, and that string is in the bundle whether or not
// anything ever calls it — the app overrides the whole overrides object, so the
// default is dead code that a bundler cannot see is dead. The property that
// matters is behavioural and is asserted in section 3 by taking `fetch` away.
// This only holds the one source-level fact a grep can prove: the app's single
// call site hands over the bytes.
const readerSource = readFileSync(join(REPO, 'services', 'zxingReader.ts'), 'utf8');
const calls = readerSource.match(/prepareZXingModule\s*\(\s*\{[\s\S]*?\n\s*\}\)/g) ?? [];
check('the one prepareZXingModule call supplies wasmBinary',
  calls.length === 1 && /wasmBinary/.test(calls[0]),
  `${calls.length} call(s) found`);

// The whole app, as Vite writes it. Skipped rather than assumed when `dist/` is
// not there: this suite must not require a build to run, but when a build
// exists it is the strongest evidence available.
const distDir = join(REPO, 'dist');
if (!existsSync(distDir)) {
  console.log('  SKIP  dist/ is not built — run `npm run build` for the whole-app check');
} else {
  const walk = (d) => readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
  const distFiles = walk(distDir);
  check('dist/ emits no .wasm asset at all',
    !distFiles.some(p => extname(p) === '.wasm'),
    distFiles.filter(p => extname(p) === '.wasm').join(', '));
}

// =====================================================
// 3. It decodes with the network taken away
// =====================================================
// **This is the check the contract actually asks for**, and it is why the CDN
// grep above was dropped rather than weakened. Every way this process could
// reach the network — or reach a URL at all, including a same-origin one and a
// `data:` one — is replaced with something that throws and records. The decoder
// is then built and made to read a real symbol. If any of it were reaching for
// a `.wasm`, this section cannot pass.
console.log('\n  it actually decodes, with every fetch path sabotaged');

const reached = [];
const trap = (label) => (...args) => {
  reached.push(`${label}(${String(args[0]).slice(0, 60)})`);
  throw new Error(`network reached: ${label}`);
};
globalThis.fetch = trap('fetch');
globalThis.XMLHttpRequest = function () { throw new Error('network reached: XMLHttpRequest'); };
WebAssembly.instantiateStreaming = trap('WebAssembly.instantiateStreaming');
WebAssembly.compileStreaming = trap('WebAssembly.compileStreaming');

const qrDecode = await loadModule('services/qrDecode.ts', 'qd_decode.mjs');

check('the decoder refuses to guess before it is built',
  (() => {
    try {
      qrDecode.decodePageQrCandidates({ data: new Uint8ClampedArray(4 * 100 * 100), width: 100, height: 100 });
      return false;
    } catch (err) {
      return /initQrReader/.test(String(err.message));
    }
  })(),
  'decoding before initQrReader() must throw, not quietly report no symbol');

await qrDecode.initQrReader();
check('initQrReader builds it', qrDecode.qrReaderReady());

const { map } = await ensureCaptures();
const clean = readCapture(join(SYNTHETIC_DIR, '01-clean.jpg'));
const readings = qrDecode.decodePageQrCandidates(clean);
check('a clean synthetic page decodes to its own payload',
  readings.length === 1 && readings[0].payload === map.payloadFor(1),
  `${readings.length} symbol(s): ${readings.map(r => r.payload).join(', ')}`);

// The flipped sheet, because the symbol is the only self-orienting element on
// the page and the whole pipeline order depends on it.
const flipped = readCapture(join(SYNTHETIC_DIR, '04-upside-down.jpg'));
const flippedRead = qrDecode.decodePageQrCandidates(flipped);
check('an upside-down page decodes and reports theta near pi',
  flippedRead.length === 1 && Math.abs(Math.abs(flippedRead[0].theta) - Math.PI) < 0.15,
  flippedRead.length ? `theta ${flippedRead[0].theta.toFixed(3)}` : 'nothing decoded');

check('...and nothing tried to fetch anything to do it', reached.length === 0,
  reached.join('\n          '));

if (failures > 0) {
  console.error(`\n  ${failures} check(s) failed\n`);
  process.exit(1);
}
console.log('\n  all checks passed\n');
