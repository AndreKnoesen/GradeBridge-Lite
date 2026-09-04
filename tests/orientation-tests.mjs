// =====================================================
// imageIngest orientation test suite
// =====================================================
// Plain Node (>=18) — no test framework, same shape as run-tests.mjs.
//
//   node tests/orientation-tests.mjs      (also runs as part of `npm test`)
//
// Why this exists: a colleague's 2026-08-13 Android device test reported pages coming in
// sideways. That test rotated the *paper*, which EXIF cannot describe, so it
// could not tell us whether the EXIF path itself works. This suite answers
// that question directly, with synthetic JPEGs carrying real orientation tags
// (flags 3, 6 and 8) — the case the 2a report flagged as a possible silent
// failure was orientation 3, which has no dimension cross-check and rests
// entirely on the decoder probe.
//
// Node has no canvas, so the pixel path is not exercised here. What is tested
// is everything that decides *how many degrees we owe the image*:
//
//   readJpegInfo        — does the EXIF flag and the raw SOF size come out?
//   pendingOrientation  — given a decoder that does / does not apply the flag,
//                         do we end up rotating exactly once?
//   applyOrientation    — does the matrix map the raw corners upright?
// =====================================================

import { build } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

// ---------- tiny assertion harness (mirrors run-tests.mjs) ----------
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
const assertEqual = (actual, expected, msg) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n          expected: ${e}\n          actual:   ${a}`);
};

// ---------- build imageIngest.ts ----------
// heic2any is a browser UMD bundle that touches window at load; the ingest
// path under test never calls it, so it is aliased to a stub.
const outDir = mkdtempSync(join(tmpdir(), 'gb-orient-test-'));
const stub = join(outDir, 'heic2any-stub.mjs');
writeFileSync(stub, 'export default async () => { throw new Error("heic2any stub"); };\n');
const outFile = join(outDir, 'imageIngest.mjs');
await build({
  entryPoints: [join(REPO, 'imageIngest.ts')],
  outfile: outFile,
  format: 'esm',
  target: 'es2022',
  bundle: true,
  alias: { heic2any: stub },
  logLevel: 'silent',
});

// The decoder probe is measured once per module instance and cached, so a
// second decoder behaviour needs a second instance — hence the cache-busting
// query, which Node treats as a distinct module URL.
const loadModule = (tag) => import(`${pathToFileURL(outFile).href}?probe=${tag}`);

// ---------- synthetic JPEGs ----------
// Enough of a JPEG for readJpegInfo's segment walk: SOI, an APP1/Exif block
// carrying one IFD0 entry (0x0112 orientation), a SOF0 frame header with the
// raw dimensions, then EOI. Not decodable as an image, and does not need to be.
const jpegWithOrientation = (
  orientation, width, height, { littleEndian = false, withExif = true, fillBytes = 0 } = {}
) => {
  const bytes = [0xff, 0xd8];                                  // SOI

  if (withExif) {
    const tiff = [];
    const u16 = (v) => (littleEndian ? [v & 0xff, (v >> 8) & 0xff] : [(v >> 8) & 0xff, v & 0xff]);
    const u32 = (v) => (littleEndian
      ? [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]
      : [(v >> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]);

    tiff.push(...(littleEndian ? [0x49, 0x49] : [0x4d, 0x4d])); // endian marker
    tiff.push(...u16(0x002a));                                  // 42
    tiff.push(...u32(8));                                       // IFD0 offset
    tiff.push(...u16(1));                                       // one entry
    tiff.push(...u16(0x0112));                                  // tag: orientation
    tiff.push(...u16(3));                                       // type: SHORT
    tiff.push(...u32(1));                                       // count
    tiff.push(...u16(orientation), 0, 0);                       // value, padded to 4 bytes
    tiff.push(...u32(0));                                       // next IFD: none

    const app1Body = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff]; // "Exif\0\0" + TIFF
    const app1Len = app1Body.length + 2;
    bytes.push(0xff, 0xe1, (app1Len >> 8) & 0xff, app1Len & 0xff, ...app1Body);
  }

  // SOF0 payload: precision, height, width, component count (6 bytes),
  // preceded by its own 2-byte length.
  const sof = [8, height >> 8, height & 0xff, width >> 8, width & 0xff, 1];
  for (let i = 0; i < fillBytes; i++) bytes.push(0xff);          // legal fill padding
  bytes.push(0xff, 0xc0, 0x00, sof.length + 2, ...sof);
  bytes.push(0xff, 0xd9);                                       // EOI

  return new Uint8Array(bytes).buffer;
};

const base64ToArrayBuffer = (b64) => {
  const buf = Buffer.from(b64, 'base64');
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
};

// ---------- fake canvas context ----------
// Accumulates the 2D affine matrix so a transform can be checked by mapping
// the raw image corners through it.
const fakeCtx = () => {
  const m = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  return {
    matrix: m,
    transform(a, b, c, d, e, f) {
      const n = {
        a: m.a * a + m.c * b,
        b: m.b * a + m.d * b,
        c: m.a * c + m.c * d,
        d: m.b * c + m.d * d,
        e: m.a * e + m.c * f + m.e,
        f: m.b * e + m.d * f + m.f,
      };
      Object.assign(m, n);
    },
    map(x, y) {
      return [
        Math.round(m.a * x + m.c * y + m.e),
        Math.round(m.b * x + m.d * y + m.f),
      ];
    },
  };
};

console.log('\nimageIngest — EXIF orientation suite\n');

// =====================================================
// 1. readJpegInfo: the flag and the raw dimensions come out
// =====================================================
{
  const { readJpegInfo, ORIENTATION_PROBE_JPEG } = await loadModule('read');

  for (const flag of [1, 2, 3, 4, 5, 6, 7, 8]) {
    check(`readJpegInfo reads EXIF orientation ${flag} (big-endian TIFF)`, () => {
      const info = readJpegInfo(jpegWithOrientation(flag, 4000, 3000));
      assert(info !== null, 'returned null for a JPEG');
      assertEqual([info.orientation, info.width, info.height], [flag, 4000, 3000],
        'orientation or raw dimensions wrong');
    });
  }

  check('readJpegInfo reads a little-endian (Intel) TIFF header', () => {
    const info = readJpegInfo(jpegWithOrientation(6, 3024, 4032, { littleEndian: true }));
    assertEqual([info.orientation, info.width, info.height], [6, 3024, 4032], 'little-endian parse wrong');
  });

  check('readJpegInfo defaults to orientation 1 when there is no EXIF block', () => {
    const info = readJpegInfo(jpegWithOrientation(0, 1600, 1200, { withExif: false }));
    assertEqual([info.orientation, info.width, info.height], [1, 1600, 1200], 'no-EXIF default wrong');
  });

  // Fill bytes before a marker are legal and common. Mis-reading the first
  // 0xFF of the run as the marker made the walk overshoot the file and report
  // 0x0 dimensions — which disables the orientation cross-check without ever
  // failing loudly.
  check('readJpegInfo skips 0xFF fill bytes before the frame header', () => {
    const info = readJpegInfo(jpegWithOrientation(6, 4032, 3024, { fillBytes: 3 }));
    assertEqual([info.orientation, info.width, info.height], [6, 4032, 3024],
      'fill padding hid the SOF dimensions');
  });

  check('readJpegInfo returns null for something that is not a JPEG', () =>
    assert(readJpegInfo(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer) === null,
      'a PNG signature was accepted as a JPEG'));

  // The probe is the only thing standing behind flags 2/3/4. If it ever stops
  // carrying orientation 6, every engine measures as "applies the flag" and a
  // 180° page is stored upside down with no other check to catch it.
  //
  // Only the flag is asserted. The probe is a hand-minified 315-byte blob
  // whose quantisation-table lengths run over its frame header, so a walk that
  // trusts segment lengths — ours — cannot reach its SOF. That does not matter
  // for its job: the probe is measured by *decoding* it, and the browser
  // engines that decode it are lenient about the overrun. Real camera JPEGs
  // declare honest lengths, which is what the synthetic cases above cover.
  check('the built-in decoder probe still carries EXIF orientation 6', () => {
    const info = readJpegInfo(base64ToArrayBuffer(ORIENTATION_PROBE_JPEG));
    assert(info !== null, 'probe did not parse as a JPEG');
    assertEqual(info.orientation, 6, 'probe is no longer an orientation-6 image');
  });
}

// =====================================================
// 2. pendingOrientation: rotate exactly once, either way
// =====================================================
// Two decoder behaviours, two module instances. `applies` mimics a modern
// engine (createImageBitmap honours EXIF); `ignores` mimics an older one.
const decodedFor = (info, applies) => {
  const swap = applies && info.orientation >= 5;
  return {
    source: null,
    width: swap ? info.height : info.width,
    height: swap ? info.width : info.height,
    path: 'bitmap',
    release: () => {},
  };
};

for (const applies of [true, false]) {
  const label = applies ? 'decoder applies EXIF' : 'decoder ignores EXIF';
  const mod = await loadModule(applies ? 'applies' : 'ignores');

  // The probe decodes through createImageBitmap; stand in for it so the
  // measurement resolves to the behaviour under test.
  globalThis.createImageBitmap = async () => (applies
    ? { width: 8, height: 16, close() {} }     // probe rotated 16x8 -> 8x16
    : { width: 16, height: 8, close() {} });

  for (const flag of [1, 3, 6, 8]) {
    const raw = flag >= 5 ? { width: 4032, height: 3024 } : { width: 3024, height: 4032 };
    const info = { orientation: flag, ...raw };
    const decoded = decodedFor(info, applies);
    const pending = await mod.pendingOrientation(info, decoded);

    check(`${label}: orientation ${flag} leaves ${applies || flag === 1 ? 'nothing' : `flag ${flag}`} to apply`, () => {
      const expected = flag === 1 ? 1 : (applies ? 1 : flag);
      assertEqual(pending, expected,
        `pendingOrientation returned ${pending}; applying it on top of the decoder would ` +
        (pending === 1 ? 'leave the page unrotated' : 'rotate the page twice'));
    });
  }

  // A file with the flag but no readable SOF (an EXIF thumbnail pushed the
  // frame header past the 256 KB header slice) still has to resolve, via the
  // probe rather than the dimension cross-check.
  {
    const info = { orientation: 6, width: 0, height: 0 };
    const pending = await mod.pendingOrientation(info, decodedFor(info, applies));
    check(`${label}: rotating flag with no raw dimensions still resolves`, () =>
      assertEqual(pending, applies ? 1 : 6, 'fallback path disagrees with the probe'));
  }

  {
    const pending = await mod.pendingOrientation(
      null, decodedFor({ orientation: 1, width: 10, height: 10 }, applies));
    check(`${label}: a null header (non-JPEG source) is left alone`, () =>
      assertEqual(pending, 1, 'a non-JPEG was given an orientation transform'));
  }
}

// The dimension cross-check has to win over the probe: if the decoder handed
// back a swapped frame, the rotation is already done whatever the probe said.
{
  const mod = await loadModule('crosscheck');
  globalThis.createImageBitmap = async () => ({ width: 16, height: 8, close() {} }); // probe says "ignores"
  const info = { orientation: 6, width: 4032, height: 3024 };
  const alreadyRotated = { source: null, width: 3024, height: 4032, path: 'bitmap', release: () => {} };
  const pending = await mod.pendingOrientation(info, alreadyRotated);
  check('dimension cross-check overrides the probe when the decoder already rotated', () =>
    assertEqual(pending, 1, 'would have rotated an already-upright page a second time'));
}

// =====================================================
// 3. applyOrientation: the matrices land the corners upright
// =====================================================
{
  const { applyOrientation } = await loadModule('matrix');
  const W = 40, H = 20;   // raw frame: landscape, so a rotation is visible

  // Where each raw corner must end up in the upright frame, per EXIF flag.
  // Upright frame is W x H for flags 1-4 and H x W for 5-8.
  const expectations = {
    1: { topLeft: [0, 0],  bottomRight: [W, H] },
    2: { topLeft: [W, 0],  bottomRight: [0, H] },   // mirrored horizontally
    3: { topLeft: [W, H],  bottomRight: [0, 0] },   // 180 degrees
    4: { topLeft: [0, H],  bottomRight: [W, 0] },   // mirrored vertically
    5: { topLeft: [0, 0],  bottomRight: [H, W] },   // transpose
    6: { topLeft: [H, 0],  bottomRight: [0, W] },   // 90 clockwise
    7: { topLeft: [H, W],  bottomRight: [0, 0] },   // transverse
    8: { topLeft: [0, W],  bottomRight: [H, 0] },   // 90 counter-clockwise
  };

  for (const [flag, want] of Object.entries(expectations)) {
    check(`applyOrientation(${flag}) maps the raw corners into the upright frame`, () => {
      const ctx = fakeCtx();
      applyOrientation(ctx, Number(flag), W, H);
      assertEqual(ctx.map(0, 0), want.topLeft, 'raw top-left landed in the wrong place');
      assertEqual(ctx.map(W, H), want.bottomRight, 'raw bottom-right landed in the wrong place');
    });
  }

  // Orientation 3 is the one the 2a report flagged: it is a pure 180 degree
  // turn, so no dimension check can catch it being applied twice or not at all.
  check('orientation 3 is a true 180 degree turn (all four corners)', () => {
    const ctx = fakeCtx();
    applyOrientation(ctx, 3, W, H);
    assertEqual(ctx.map(0, 0), [W, H], 'top-left');
    assertEqual(ctx.map(W, 0), [0, H], 'top-right');
    assertEqual(ctx.map(0, H), [W, 0], 'bottom-left');
    assertEqual(ctx.map(W, H), [0, 0], 'bottom-right');
  });

  // rotatePageBlob reuses flag 6 as "a quarter turn clockwise". Same matrix,
  // stated as its own expectation so a change to the table is caught here.
  check('the manual rotate reuses flag 6 and turns the page clockwise', () => {
    const ctx = fakeCtx();
    applyOrientation(ctx, 6, W, H);
    assertEqual(ctx.map(0, 0), [H, 0], 'raw top-left must become the upright top-right');
    assertEqual(ctx.map(0, H), [0, 0], 'raw bottom-left must become the upright top-left');
  });

  check('applyOrientation(1) is the identity', () => {
    const ctx = fakeCtx();
    applyOrientation(ctx, 1, W, H);
    assertEqual([ctx.map(0, 0), ctx.map(W, H)], [[0, 0], [W, H]], 'flag 1 moved the image');
  });
}

// ---------- report ----------
console.log(results.join('\n'));
console.log(`\n${passed} passed, ${failed} failed\n`);
rmSync(outDir, { recursive: true, force: true });
process.exit(failed > 0 ? 1 : 0);
