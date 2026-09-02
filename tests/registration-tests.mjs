// =====================================================
// Registration and crop suite — the handwritten submission path
// =====================================================
// Plain Node (>= 18), no test framework, same shape as run-tests.mjs.
//
//   node tests/registration-tests.mjs      (also runs as part of `npm test`)
//
// Three groups, matching the three points the work order asks for a report at:
//
//   step 2 — the map arrives and a stale one is caught
//   step 3 — QR decode and mark detection over the capture set
//   step 4 — the transform, and what the crops land on
//
// The capture set here is synthetic (see captureSet.mjs) and **it is not the
// section 8 evidence**. The geometry is true; only the degradation is drawn.
// What it cannot produce is what actually breaks registration in the field, and
// the gap is not small: this detector once scored 12 of 12 on these synthetics
// and 4 of 11 on real photographs.
//
// The thresholds are no longer untuned — every one of them is now set from the
// sixteen photographs in tests/captures/real/ and stale/, and `gate-tests.mjs`
// holds them there. This file's job is the parts a photograph cannot check on
// its own: the ZIP path, the stale-map refusal, the crop geometry, and the
// 180-degree case that the real set happens not to contain.
// =====================================================

import JSZip from 'jszip';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
import {
  ensureCaptures, listCaptures, readCapture, loadModule,
  fmt, hom, SYNTHETIC_DIR, REAL_DIR,
} from './captureSet.mjs';

globalThis.crypto ??= webcrypto;

let passed = 0, failed = 0;
const results = [];
const check = (name, fn) => {
  try { fn(); passed++; results.push(`  PASS  ${name}`); }
  catch (err) { failed++; results.push(`  FAIL  ${name}\n          ${err.message}`); }
};
const checkAsync = async (name, fn) => {
  try { await fn(); passed++; results.push(`  PASS  ${name}`); }
  catch (err) { failed++; results.push(`  FAIL  ${name}\n          ${err.message}`); }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const assertEqual = (actual, expected, msg) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n          expected: ${e}\n          actual:   ${a}`);
};

const lay = await loadModule('services/layoutMap.ts', 'layoutMap.mjs');
const qrp = await loadModule('services/qrPayload.ts', 'qrPayload2.mjs');
const qrd = await loadModule('services/qrDecode.ts', 'qrDecode.mjs');
const reg = await loadModule('services/registration.ts', 'registration.mjs');
const crop = await loadModule('services/cropRegions.ts', 'cropRegions.mjs');
const bundle = await loadModule('services/assignmentBundle.ts', 'assignmentBundle.mjs');
const ras = await loadModule('services/raster.ts', 'raster.mjs');
const mdet = await loadModule('services/markDetect.ts', 'markDetect.mjs');

console.log('\nStudent Submission — registration and crop\n');

const { map: fixture, manifest } = await ensureCaptures();

// =====================================================
// Step 2 — the map arrives, and a stale one is caught
// =====================================================
console.log('  step 2: the map and the hash check');

let parsed;
await checkAsync('layout_*.csv parses into the eleven declared columns', async () => {
  parsed = await lay.parseLayoutCsv(fixture.csv, fixture.csvName);
  assertEqual(parsed.rows.length, fixture.rows.length, 'wrong row count');
  assertEqual(parsed.assignmentId, fixture.assignmentId, 'assignment_id not read');
});

await checkAsync('the recomputed layout_id is the one the generator put in the QR', async () => {
  assertEqual(parsed.computedLayoutId, fixture.layoutId, 'recomputed layout_id disagrees with the fixture');
  assertEqual(parsed.declaredLayoutId, fixture.layoutId, 'the CSV column disagrees with the fixture');
  const onPage = qrp.parsePayload(fixture.payloadFor(1)).layoutId;
  assertEqual(parsed.computedLayoutId, onPage, 'the map and the page QR disagree');
});

await checkAsync('a stale map is caught: one coordinate moved changes the hash', async () => {
  const bumped = fixture.csv.replace('0.2147', '0.2148');
  assert(bumped !== fixture.csv, 'the fixture edit did not apply');
  const other = await lay.parseLayoutCsv(bumped, 'layout_stale.csv');
  assert(other.computedLayoutId !== parsed.computedLayoutId,
    'a moved rectangle did not move the layout_id — the stale-map check is inert');
});

await checkAsync('every field is read by column NAME, not by position', async () => {
  // Same data, columns in a different order and one extra column appended.
  const lines = fixture.csv.trim().split('\n');
  const header = lines[0].split(',');
  const order = [10, 0, 4, 2, 8, 1, 3, 9, 5, 6, 7];
  const reorder = (cells) => order.map(i => cells[i]);
  const splitKeepingQuotes = (line) => {
    const out = []; let f = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { q = !q; f += c; }
      else if (c === ',' && !q) { out.push(f); f = ''; }
      else f += c;
    }
    out.push(f); return out;
  };
  const shuffled = [
    [...reorder(header), 'future_column'].join(','),
    ...lines.slice(1).map(l => [...reorder(splitKeepingQuotes(l)), 'ignored'].join(',')),
  ].join('\n');
  const other = await lay.parseLayoutCsv(shuffled, 'layout_shuffled.csv');
  assertEqual(other.computedLayoutId, parsed.computedLayoutId,
    'reordering the columns changed the map — something is reading by position');
  assertEqual(other.rows.map(r => r.partId), parsed.rows.map(r => r.partId), 'part_id moved');
  assertEqual(other.rows.map(r => r.isDrawing), parsed.rows.map(r => r.isDrawing), 'is_drawing moved');
  assertEqual(other.rows.map(r => r.maxPoints), parsed.rows.map(r => r.maxPoints), 'max_points moved');
});

// =====================================================
// The rotation's padding must not enter a local statistic
// =====================================================
// `rotateGray` grows the canvas to hold the turned corners and has to put
// SOMETHING in the space it grew into. Whatever that is, it is not a
// photograph, and `adaptiveInk` used to average it in: near a frame edge the
// local-mean box is up to half padding, the mean rises, and blank paper is
// declared ink. On `ios2_05` that erased a real registration mark by bridging it
// into a component spanning the whole frame, which the area band then rejected.
//
// This is measured on a synthetic frame rather than a photograph, because the
// photographs that show it are real student work and are not in this
// repository. The geometry is chosen to match the real case rather than to be
// convenient: the mark sits 30 px from the source edge with a local-mean radius
// of 60, so the box is about a quarter padding — `ios2_05`'s SW mark is 46 px
// from the edge with a radius of 95, about a third.
const paddedFrame = () => {
  const W = 825, H = 1100, side = 24, inset = 30;
  const data = new Uint8Array(W * H).fill(150);          // paper
  const cx = inset, cy = H - inset;                       // a mark near a corner
  for (let y = cy - side / 2; y < cy + side / 2; y++) {
    for (let x = cx - side / 2; x < cx + side / 2; x++) data[y * W + x] = 30;
  }
  const src = { data, width: W, height: H };
  const up = ras.rotateGray(src, (2 * Math.PI) / 180);
  const [ux, uy] = up.fromSource(cx, cy);
  return { src, up, side, at: { x: ux, y: uy } };
};

check('rotateGray says which pixels it invented', () => {
  const { src, up } = paddedFrame();
  assert(up.valid instanceof Uint8Array, 'rotateGray returned no validity mask');
  assertEqual(up.valid.length, up.width * up.height, 'the mask is not one entry per pixel');

  let invented = 0, real = 0, wrong = 0;
  for (let y = 0; y < up.height; y++) {
    for (let x = 0; x < up.width; x++) {
      const [sx, sy] = up.toSource(x + 0.5, y + 0.5);
      const inSource = (sx | 0) >= 0 && (sy | 0) >= 0 && (sx | 0) < src.width && (sy | 0) < src.height;
      const claimed = up.valid[y * up.width + x] === 1;
      if (claimed !== inSource) wrong++;
      if (claimed) real++; else invented++;
    }
  }
  assertEqual(wrong, 0, `${wrong} pixels disagree with whether they came from the source`);
  // The canvas grew, so there must be some of each — a mask that is all ones
  // would silently restore the old behaviour and pass every other check here.
  assert(invented > 0, 'no pixel is marked invented, yet the canvas grew');
  assert(real > 0, 'no pixel is marked real');
});

check('the padding never becomes ink, and never bridges a mark to the frame', () => {
  const { up, side, at } = paddedFrame();
  const win = { x0: 0, y0: 0, x1: up.width, y1: up.height };

  const ink = ras.adaptiveInk(up, 0, 0, up.width, up.height,
    side * mdet.LOCAL_RADIUS_MARKS, mdet.INK_OFFSET);
  let paddingInk = 0;
  for (let i = 0; i < ink.length; i++) if (ink[i] && up.valid[i] !== 1) paddingInk++;
  assertEqual(paddingInk, 0, `${paddingInk} invented pixels were classified as ink`);

  const found = mdet.findMarksInWindow(up, win, side, { limit: 50 });
  const near = found
    .map(c => ({ ...c, d: Math.hypot(c.x - at.x, c.y - at.y) }))
    .sort((a, b) => a.d - b.d)[0];
  assert(near && near.d < side, `the mark near the frame edge was not found (${found.length} candidates)`);
  const ratio = near.area / (side * side);
  assert(ratio > 0.8 && ratio < 1.25,
    `the mark was found but at ${ratio.toFixed(2)}x its area — it is merged with something`);

  // The teeth. Hand the same bitmap over WITHOUT the mask, which is exactly the
  // old code path, and the mark must disappear. If this ever stops failing, the
  // check above has stopped testing anything.
  const unmasked = mdet.findMarksInWindow(
    { data: up.data, width: up.width, height: up.height }, win, side, { limit: 50 });
  const stillThere = unmasked.some(c => Math.hypot(c.x - at.x, c.y - at.y) < side);
  assert(!stillThere,
    'the mark survives even without the validity mask, so this fixture no longer ' +
    'reproduces the defect and proves nothing');
});

check('a box with no real pixel in it is declined, not guessed at', () => {
  // Every pixel invented: there is no local paper level, so nothing may be
  // called ink. The old code would have divided by the full box area and
  // thresholded against a fabricated mean.
  const W = 40, H = 40;
  const gray = {
    data: new Uint8Array(W * H).fill(200),
    width: W, height: H,
    valid: new Uint8Array(W * H),          // all zero — nothing is real
  };
  const ink = ras.adaptiveInk(gray, 0, 0, W, H, 5, 18);
  assertEqual(ink.reduce((a, b) => a + b, 0), 0, 'ink was found in a frame with no real pixels');
});

check('an invented pixel is never ink, whatever value it was given', () => {
  // `rotateGray` currently fills with 255, and white can never be `offset`
  // below a local mean of paper — so on that fill alone this rule never binds
  // and would look like dead code. It is not: it is what makes the fill value
  // irrelevant, which is the whole point. "The fill value is not the fix"
  // (WORKORDER_PADDING_MASK_2026-09-02) is only true if nothing downstream
  // depends on which lie was chosen, and this is where that is enforced.
  //
  // So the fixture picks the value that WOULD fool the threshold: invented
  // pixels are black. Under the rule they are still not ink.
  const W = 80, H = 80;
  const data = new Uint8Array(W * H).fill(180);
  const valid = new Uint8Array(W * H).fill(1);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < 20; x++) {          // a dark invented strip down one side
      data[y * W + x] = 0;
      valid[y * W + x] = 0;
    }
  }
  const ink = ras.adaptiveInk({ data, width: W, height: H, valid }, 0, 0, W, H, 8, 18);
  let inventedInk = 0;
  for (let i = 0; i < ink.length; i++) if (ink[i] && valid[i] !== 1) inventedInk++;
  assertEqual(inventedInk, 0, `${inventedInk} invented pixels were called ink`);

  // ...and the strip must not have dragged the real paper beside it into ink
  // either, which is the same leak in the other direction: a dark fill pulls a
  // local mean DOWN and erases real ink, where a white one pushes it up and
  // manufactures ink.
  let realInk = 0;
  for (let i = 0; i < ink.length; i++) if (ink[i]) realInk++;
  assertEqual(realInk, 0, `${realInk} pixels of blank paper were called ink beside a dark fill`);
});

check('a frame with no mask is unchanged, byte for byte', () => {
  // Everything straight off the camera has no mask and must take the original
  // path exactly. This is the guarantee that the sixteen calibration captures
  // cannot move for a reason invented here.
  const W = 120, H = 90;
  const data = new Uint8Array(W * H);
  for (let i = 0; i < data.length; i++) data[i] = (i * 37 + (i % 13) * 11) % 256;
  const bare = { data, width: W, height: H };
  const allValid = { data, width: W, height: H, valid: new Uint8Array(W * H).fill(1) };
  const a = ras.adaptiveInk(bare, 0, 0, W, H, 7, 18);
  const b = ras.adaptiveInk(allValid, 0, 0, W, H, 7, 18);
  assertEqual(a.length, b.length, 'different lengths');
  let diff = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
  assertEqual(diff, 0, `${diff} pixels differ between the masked and unmasked paths`);
});

check('validity composes — rotating twice cannot launder invented pixels', () => {
  const { up } = paddedFrame();
  const twice = ras.rotateGray(up, (3 * Math.PI) / 180);
  let laundered = 0;
  for (let y = 0; y < twice.height; y++) {
    for (let x = 0; x < twice.width; x++) {
      if (twice.valid[y * twice.width + x] !== 1) continue;
      const [sx, sy] = twice.toSource(x + 0.5, y + 0.5);
      const ix = sx | 0, iy = sy | 0;
      if (ix < 0 || iy < 0 || ix >= up.width || iy >= up.height) { laundered++; continue; }
      if (up.valid[iy * up.width + ix] !== 1) laundered++;
    }
  }
  assertEqual(laundered, 0, `${laundered} invented pixels were promoted to real by a second rotation`);
});

check('part_id, is_drawing and max_points come from the row, and region_id is never parsed', () => {
  const drawing = parsed.rows.filter(r => r.isDrawing).map(r => r.regionId);
  assertEqual(drawing, ['r003'], 'the drawing region was not read from is_drawing');
  assertEqual(parsed.rows.map(r => r.partId).includes('Problem 1(c)'), true, 'part_id lost');
  // region_id carries no page, no part and no points, so anything that parsed it
  // would have to invent them. Assert it stays opaque.
  assert(parsed.rows.every(r => /^r\d+$/.test(r.regionId)), 'the fixture region_id stopped being opaque');
});

await checkAsync('a comma inside part_id does not shift the columns after it', async () => {
  const csv = fixture.csv.replace('"Problem 1(a)"', '"Problem 1(a), first attempt"');
  const other = await lay.parseLayoutCsv(csv, 'layout_comma.csv');
  assertEqual(other.rows[0].partId, 'Problem 1(a), first attempt', 'quoted comma mis-split');
  assertEqual(other.rows[0].maxPoints, 10, 'max_points shifted by the comma');
});

await checkAsync('a map missing a column is refused, by name', async () => {
  const csv = fixture.csv.replace('is_drawing,', '');
  let threw = null;
  try { await lay.parseLayoutCsv(csv, 'layout_short.csv'); } catch (e) { threw = e; }
  assert(threw && /is_drawing/.test(threw.message), `expected a named refusal, got: ${threw && threw.message}`);
});

await checkAsync('the whole loop closes: a real zip in, a registered page and crops out', async () => {
  // The work order's own acceptance for step 4: a sheet, photographed, through
  // the app's real loading path, to crops cut against the same map. Everything
  // here is the shipped module, not a stand-in — the only thing missing from
  // "nothing short of that closes the loop" is the container end, which lives
  // in another repo and has not been run against this output.
  const zip = new JSZip();
  zip.file('assignment.pdf', new Uint8Array([0x25, 0x50, 0x44, 0x46]));  // ignored, and must be
  zip.file('assignment_spec.json', JSON.stringify({
    id: 'fixture', courseCode: 'ENG17', title: 'HW1',
    inputMode: 'handwritten', preamble: '', problems: [], createdAt: 0, updatedAt: 0,
  }));
  zip.file(fixture.csvName, fixture.csv);
  const bytes = await zip.generateAsync({ type: 'uint8array' });

  const loaded = await bundle.loadAssignmentBundle({
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  });
  assertEqual(loaded.kind, 'zip', 'the zip was not recognised');
  assert(loaded.layout !== null, 'the layout map was not found in the zip');
  assertEqual(loaded.layout.name, fixture.csvName, 'the wrong file was taken as the map');
  assert(!loaded.entries.some(e => e.name === 'assignment.pdf' && e.path !== 'assignment.pdf'),
    'the pdf entry was rewritten');

  const map = await lay.parseLayoutCsv(loaded.layout.text, loaded.layout.name);
  assertEqual(map.computedLayoutId, fixture.layoutId, 'the map from the zip hashes differently');

  const capture = readCapture(join(SYNTHETIC_DIR, '01-clean.jpg'));
  const result = reg.registerPage(capture);
  assert(result.usable, `the page did not register: ${result.status}`);
  assertEqual(result.qr.fields.layoutId, map.computedLayoutId,
    'the page QR and the map from the zip disagree');

  const rows = lay.rowsForPage(map, result.qr.fields.k);
  const cut = crop.cropRegions(capture, result.transform, rows);
  assertEqual(cut.length, rows.length, 'not every declared region was cut');
  assert(cut.every(c => !c.flags.includes(crop.CROP_FLAG_LOOKS_EMPTY)), 'a crop came out blank');
});

check('a bare assignment_spec.json still loads (electronic assignments keep working)', () => {
  assert(bundle.looksLikeZip(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0])), 'zip magic not recognised');
  assert(!bundle.looksLikeZip(new TextEncoder().encode('{"problems":[]}')), 'plain JSON read as a zip');
  assert(!bundle.looksLikeZip(new TextEncoder().encode('gb1:AAAA')), 'a gb1 spec read as a zip');
});

// =====================================================
// Step 3 — QR decode and mark detection over the capture set
// =====================================================
console.log('  step 3: QR decode and mark detection');

// The synthetic set only. The real photographs are measured in
// `gate-tests.mjs`, and they have to be measured THERE rather than here,
// because this file reads a capture straight off disk: a photograph off the
// phone is 4032 x 3024 and `imageIngest.ingestPage` stands it upright and steps
// it down to 2200 px before registration ever sees it. Reading the original
// measures an image the app never processes and flatters it — three times the
// pixels and none of the recompression — and it disagrees with the gate. It did
// disagree, visibly: this table reported `cap05` through `cap09` as `no_qr`
// while the gate decodes four of the five and passes three.
const captures = listCaptures().filter(c => c.synthetic);
const truthFor = (file) => manifest.captures.find(c => c.file === file);
const report = [];

for (const cap of captures) {
  const image = readCapture(cap.path);
  const qr = qrd.decodePageQr(image);
  const result = reg.registerPage(image);
  report.push({ ...cap, image, qr, result, truth: truthFor(cap.file) });
}

const synthetic = report;

const qrOk = synthetic.filter(r => r.qr).length;
const marks4 = synthetic.filter(r => r.result.marksFound === 4).length;
const usable = synthetic.filter(r => r.result.usable).length;

console.log('');
console.log('    capture                          QR   marks  status     residual');
for (const r of report) {
  const res = r.result.residualMm === null ? '   —  ' : `${r.result.residualMm.toFixed(3)} mm`;
  console.log(`    ${r.file.padEnd(32)} ${r.qr ? ' ok ' : 'FAIL'}  ${r.result.marksFound}/4   ` +
    `${r.result.status.padEnd(10)} ${res}`);
}
console.log('');
console.log(`    synthetic set: QR ${qrOk}/${synthetic.length}, ` +
  `4-of-4 marks ${marks4}/${synthetic.length}, usable ${usable}/${synthetic.length}`);
console.log(`    real photographs: measured in gate-tests.mjs, through the app's own ingest`);
console.log('');

check('the QR decodes on every synthetic capture', () => {
  const bad = synthetic.filter(r => !r.qr).map(r => r.file);
  assert(bad.length === 0, `no QR on: ${bad.join(', ')}`);
});

check('every decoded payload is the page-format grammar, with the fixture layout_id', () => {
  for (const r of synthetic) {
    const f = r.qr.fields;
    assertEqual(f.layoutId, fixture.layoutId, `${r.file}: wrong layout_id in the QR`);
    assertEqual(f.token, qrp.MASTER_TOKEN, `${r.file}: token is not the class-wide placeholder`);
    assertEqual(f.n, 3, `${r.file}: wrong N`);
    assertEqual(f.k, truthFor(r.file).pageK, `${r.file}: wrong k`);
  }
});

check('the 180-degree capture reorients rather than registering upside down', () => {
  const flipped = synthetic.find(r => /upside-down/.test(r.file));
  assert(flipped, 'the upside-down capture is missing from the set');
  assert(Math.abs(Math.abs(flipped.qr.theta) - Math.PI) < 0.1,
    `theta is ${flipped.qr.theta.toFixed(3)} rad, expected about pi`);
  assert(flipped.result.usable, `the upside-down page did not register: ${flipped.result.status}`);
});

check('all four marks are found on every synthetic capture', () => {
  const bad = synthetic.filter(r => r.result.marksFound < 4)
    .map(r => `${r.file} (${r.result.marksFound}/4)`);
  assert(bad.length === 0, `fewer than 4 marks on: ${bad.join(', ')}`);
});

check('the six-degree capture registers — the stage order is doing its job', () => {
  const r = synthetic.find(x => /rotate-6deg/.test(x.file));
  assert(r && r.result.usable, 'the 6-degree page did not register');
  assertEqual(r.result.marksFound, 4, 'the 6-degree page lost marks — reorient is not running first');
});

// =====================================================
// Step 4 — the transform, and what the crops land on
// =====================================================
console.log('  step 4: the transform and the crops');

/** Worst disagreement, in page millimetres, between the fitted map and the truth. */
const worstErrorMm = (fitted, truthMarks) => {
  let worst = 0;
  // Convert a pixel error to millimetres with the capture's own scale, measured
  // from the truth marks: NW to NE is a known 186.9 mm.
  const pxPerMm = Math.hypot(truthMarks[1][0] - truthMarks[0][0], truthMarks[1][1] - truthMarks[0][1])
    / (fmt.MARK_CENTRES_MM[1][0] - fmt.MARK_CENTRES_MM[0][0]);
  for (let i = 0; i < 4; i++) {
    const [mx, my] = fmt.MARK_CENTRES_MM[i];
    const p = hom.applyMatrix(fitted, { x: mx, y: my });
    worst = Math.max(worst, Math.hypot(p.x - truthMarks[i][0], p.y - truthMarks[i][1]) / pxPerMm);
  }
  return worst;
};

const accuracy = synthetic
  .filter(r => r.result.usable)
  .map(r => ({ file: r.file, mm: worstErrorMm(r.result.transform, r.truth.truthMarks) }));

console.log('');
for (const a of accuracy) console.log(`    ${a.file.padEnd(32)} worst corner error ${a.mm.toFixed(3)} mm`);
console.log('');

check('every registered page lands its corners inside the 1.0 mm residual budget', () => {
  const bad = accuracy.filter(a => a.mm > fmt.RESIDUAL_MAX_MM)
    .map(a => `${a.file} (${a.mm.toFixed(3)} mm)`);
  assert(bad.length === 0, `over the 1.0 mm budget: ${bad.join(', ')}`);
});

check('the crops carry the ink that was inside the declared rectangle', () => {
  for (const r of synthetic) {
    if (!r.result.usable) continue;
    const rows = lay.rowsForPage(parsed, r.qr.fields.k);
    assert(rows.length > 0, `${r.file}: the map declares nothing for page ${r.qr.fields.k}`);
    const crops = crop.cropRegions(r.image, r.result.transform, rows);
    for (const c of crops) {
      assert(c.image.width > 10 && c.image.height > 10,
        `${r.file}/${c.row.regionId}: crop is ${c.image.width}x${c.image.height}`);
      assert(!c.flags.includes(crop.CROP_FLAG_LOOKS_EMPTY),
        `${r.file}/${c.row.regionId}: a written region came out blank — the crop landed off the answer`);
    }
  }
});

check('a crop is never upsampled past the resolution the photograph actually has', () => {
  for (const r of synthetic) {
    if (!r.result.usable) continue;
    const rows = lay.rowsForPage(parsed, r.qr.fields.k);
    for (const c of crop.cropRegions(r.image, r.result.transform, rows)) {
      assert(c.pxPerMm <= fmt.PX_PER_MM + 0.001,
        `${r.file}/${c.row.regionId}: ${c.pxPerMm.toFixed(2)} px/mm is above the canonical 300 dpi`);
    }
  }
});

check('the 3 mm pad is not applied twice — the crop is the declared rectangle', () => {
  // Aspect ratio is the tell: re-padding by 3 mm on each side changes it, and by
  // more on the short axis. Compare the crop's shape to the rectangle's own.
  const r = synthetic.find(x => /01-clean/.test(x.file));
  const rows = lay.rowsForPage(parsed, r.qr.fields.k);
  for (const c of crop.cropRegions(r.image, r.result.transform, rows)) {
    const mm = fmt.fractionRectToMm({ x0: c.row.x0, y0: c.row.y0, x1: c.row.x1, y1: c.row.y1 });
    const declared = (mm.x1 - mm.x0) / (mm.y1 - mm.y0);
    const actual = c.image.width / c.image.height;
    assert(Math.abs(declared - actual) / declared < 0.01,
      `${c.row.regionId}: crop aspect ${actual.toFixed(3)} vs declared ${declared.toFixed(3)}`);
  }
});

check('a page whose QR names another layout is refused rather than cropped', () => {
  const r = synthetic.find(x => /01-clean/.test(x.file));
  const onPage = r.qr.fields.layoutId;
  const stale = { ...parsed, computedLayoutId: 'DEADBEEF' };
  assert(onPage !== stale.computedLayoutId, 'the fixture did not produce a mismatch');
  // registerAndCropPage owns this branch and needs a DOM; the condition it tests
  // is this one, asserted here so the rule cannot be quietly deleted from it.
  assert(onPage === parsed.computedLayoutId, 'the matching case stopped matching');
});

// =====================================================
// Step 7 — the submission package
// =====================================================
// The packaging lives in `services/submissionPackage.ts` now — it was inside
// the React component until milestone zero needed to build a submission without
// a browser — so these read that file rather than App.tsx.
//
// They stay source-level, and they exist because the bug they guard was silent
// for weeks: the ZIP builder never referenced the pages at all, so a handwritten
// student submitted a PDF of the blank question paper and a JSON in which every
// answer was null, while three comments in the tree asserted the pages shipped.
// The behavioural version now exists too — `milestone-zero.mjs` builds a real
// package from two photographs and opens it — but that one needs an assignment
// export and a capture set on disk, so these keep running in `npm test` alone.
console.log('  step 7: the submission package');

const appSrc = readFileSync(join(REPO, 'App.tsx'), 'utf8');
const pkgSrc = readFileSync(join(REPO, 'services', 'submissionPackage.ts'), 'utf8');
/** Source with comments removed, for checks that must not match prose. */
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');

const zipStart = pkgSrc.indexOf('const zip = new JSZip()');
const zipEnd = pkgSrc.indexOf('return { zip', zipStart);
const zipBlock = pkgSrc.slice(zipStart, zipEnd);

check('the ZIP builder writes the page images', () => {
  assert(zipStart !== -1 && zipEnd > zipStart,
    'the ZIP builder could not be located in services/submissionPackage.ts');
  assert(/for \(const page of sources\.pages\)/.test(zipBlock),
    'the ZIP builder does not iterate the pages — the pages do not ship');
  assert(/add\(page\.file,/.test(zipBlock), 'the ZIP builder does not write page.file');
});

check('the ZIP builder writes the crop images', () => {
  assert(/cropList\(sources\.crops\)/.test(zipBlock), 'the ZIP builder does not iterate the crops');
  assert(/add\(crop\.file,/.test(zipBlock), 'the ZIP builder does not write crop.file');
});

check('the ZIP always carries the JSON', () => {
  assert(zipBlock.includes('.json`, encoded.bytes)'), 'the ZIP builder does not write the JSON');
});

check('a handwritten submission carries no PDF', () => {
  // Andre, 2026-09-01, DECISION_PACKAGE_CONTENTS_2026-09-01.md. Nothing consumes
  // it, it was half the archive, and the one the app would have produced was the
  // blank question paper — which invites a reader to conclude the student
  // submitted nothing. The electronic path still writes one.
  const pdfWrite = zipBlock.indexOf('.pdf`, assets.pdfBytes)');
  assert(pdfWrite !== -1, 'the ZIP builder no longer writes a PDF at all — the electronic path needs one');
  const guard = zipBlock.lastIndexOf('if (!sources.isHandwritten)', pdfWrite);
  assert(guard !== -1, 'the PDF write is not behind an isHandwritten guard');

  // ...and the payload must not name a file the archive does not contain.
  assert(/delete submissionJson\.pdf_filename;/.test(pkgSrc),
    'pdf_filename is still emitted on the handwritten path, naming a file that is not there');
  const branch = pkgSrc.indexOf('if (s.isHandwritten) {');
  assert(pkgSrc.indexOf('delete submissionJson.pdf_filename;') > branch,
    'pdf_filename is deleted outside the handwritten branch — an electronic payload would lose it');
});

check('the submission JSON carries the layout_id and the page set with k and N', () => {
  assert(/submissionJson\.layout_id\s*=/.test(pkgSrc), 'no layout_id in the submission JSON');
  assert(/submissionJson\.pages\s*=/.test(pkgSrc), 'no page set in the submission JSON');
  const pages = pkgSrc.slice(pkgSrc.indexOf('submissionJson.pages'), pkgSrc.indexOf('submissionJson.crops'));
  for (const key of ['k:', 'n:', 'file:']) {
    assert(pages.includes(key), `the page set omits ${key}`);
  }
});

check('the page set says how the page registered, and on which corners', () => {
  // A page may register on three marks since 2026-09-02 (`captureGate.MARKS_MIN`),
  // and then the crops from it are cut through a transform that INFERRED one
  // corner rather than measuring it. Three fields carry that to the grader and
  // all three have to be there: the status, the count, and — the one added with
  // the change — which corners the fit actually used. `marks_found` alone says
  // a corner was missing; only `marks_detected` says which end of the sheet it
  // was, which is the first thing to look at when a crop is disputed.
  const pages = pkgSrc.slice(pkgSrc.indexOf('submissionJson.pages'), pkgSrc.indexOf('submissionJson.crops'));
  for (const key of ['registration:', 'marks_found:', 'marks_detected:', 'residual_mm:']) {
    assert(pages.includes(key), `the page set omits ${key}`);
  }
  // ...and it must be the real corner list, not a placeholder.
  assert(/marks_detected:\s*page\.registration\?\.marksDetected/.test(pages),
    'marks_detected is not read from the registration');
});

check('every crop carries its map row, its source, the review and the flags', () => {
  const from = pkgSrc.indexOf('crops[crop.regionId] = {');
  assert(from !== -1, 'the crop payload could not be located');
  const payload = pkgSrc.slice(from, pkgSrc.indexOf('\n      };', from));
  for (const key of [
    'region_id:', 'part_id:', 'page_k:', 'is_drawing:', 'max_points:',
    'crop_source:', 'student_review:', 'quality_flags:', 'file:',
  ]) {
    assert(payload.includes(key), `the crop payload omits ${key}`);
  }
});

check('nothing blocks submission on a flag or an unreviewed part', () => {
  // "A flagged part does not block submission. Do not put a detector between a
  // student and a deadline." Neither the packaging nor the handler may read
  // either field. Comments are stripped first — both files discuss the rule.
  const build = stripComments(pkgSrc.slice(pkgSrc.indexOf('export const buildSubmissionPackage')));
  assert(!/\bflagged\b/.test(build), 'the package builder reads the flag state');
  assert(!/not_reviewed/.test(build), 'the package builder reads the review state');

  const from = appSrc.indexOf('const handleDownloadForGradescope');
  const to = appSrc.indexOf('const acceptPrivacy', from);
  assert(from !== -1 && to > from, 'the download handler could not be located');
  const handler = stripComments(appSrc.slice(from, to));
  assert(!/\bflagged\b/.test(handler), 'the download handler reads the flag state');
  assert(!/not_reviewed/.test(handler), 'the download handler reads the review state');
});

check('the UI still calls the packaging service', () => {
  // The point of lifting it out was to make it testable, not to fork it. If the
  // component grows a copy of its own, everything above stops describing what
  // a student actually downloads.
  assert(/buildSubmissionPackage\(/.test(appSrc), 'App.tsx no longer calls buildSubmissionPackage');
  assert(!/new JSZip\(\)/.test(appSrc), 'App.tsx builds a ZIP of its own again');
  assert(/SUBMISSION_ZIP_OPTIONS/.test(appSrc), 'App.tsx no longer uses the shared archive options');
});

check('a bare spec still reaches the same submission path', () => {
  // An electronic assignment's payload must be what it always was, so every
  // handwritten field is set inside the isHandwritten branch and nowhere else.
  const declared = pkgSrc.indexOf('const submissionJson');
  const branch = pkgSrc.indexOf('if (s.isHandwritten) {', declared);
  assert(branch !== -1, 'the handwritten branch could not be located');

  const literalEnd = pkgSrc.indexOf('\n  };', declared);
  const literal = pkgSrc.slice(declared, literalEnd);
  for (const key of ['layout_id:', 'crops:', 'input_mode:', 'pages:']) {
    assert(!literal.includes(key),
      `${key} is in the base submission literal — an electronic submission would carry it`);
  }

  // ...and every assignment onto submissionJson happens after the branch opens.
  for (const m of pkgSrc.matchAll(/submissionJson\.(\w+)\s*=/g)) {
    assert(m.index > branch,
      `submissionJson.${m[1]} is set outside the handwritten branch`);
  }
});


// =====================================================
console.log(results.join('\n'));
console.log(`\n  ${passed} passed, ${failed} failed\n`);
console.log(`  Capture set: ${SYNTHETIC_DIR}`);
console.log('  SYNTHETIC — not the section 8 evidence. The thresholds are set from');
console.log('  the real photographs and held by gate-tests.mjs; this file checks the');
console.log(`  parts a photograph cannot. Real ones live in ${REAL_DIR}.\n`);
process.exit(failed > 0 ? 1 : 0);
