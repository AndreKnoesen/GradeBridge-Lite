// =====================================================
// The capture set — milestone zero, section 8, as far as code can take it
// =====================================================
// The work order asks for a printed sheet photographed a dozen ways before any
// threshold in the detector is trusted. Nobody here can hold a phone, so this
// renders the sheet from the SAME canonical constants the generator prints from
// (services/pageFormat.ts, Appendix A of the page format spec) and then degrades
// it in code: perspective, rotation including the 180 degree case, a lighting
// gradient, a shadow across a corner, defocus, JPEG loss, a dark desk, and one
// capture with all of it at once.
//
// **This is not the section 8 evidence and every threshold in the detector is
// untuned against a phone photograph.** The geometry is true — it comes from the
// same numbers the printer uses — and only the degradation is synthetic. What a
// synthetic set cannot produce is the thing that actually breaks registration in
// the field: paper curl, a specular highlight off a ballpoint line, motion blur
// with a directional streak, and the particular way a phone's ISP sharpens.
//
// Real photographs drop into tests/captures/real/ as .jpg or .png and the suite
// picks them up with no code change. They carry no ground truth, so they are
// scored on whether the page registers at all.
// =====================================================

import { build } from 'esbuild';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import QRCode from 'qrcode';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
export const CAPTURE_DIR = join(HERE, 'captures');
export const SYNTHETIC_DIR = join(CAPTURE_DIR, 'synthetic');
export const REAL_DIR = join(CAPTURE_DIR, 'real');

// ---------- load the app's own modules, so the fixture and the code under
// ---------- test cannot drift apart on geometry
const outDir = mkdtempSync(join(tmpdir(), 'gb-student-capture-'));
export const loadModule = async (relPath, outName) => {
  const entry = join(REPO, relPath);
  const outfile = join(outDir, outName);
  await build({
    entryPoints: [entry], outfile, format: 'esm', target: 'es2022',
    bundle: true, absWorkingDir: dirname(entry), logLevel: 'silent',
  });
  return import(pathToFileURL(outfile).href);
};

export const fmt = await loadModule('services/pageFormat.ts', 'pageFormat.mjs');
export const hom = await loadModule('services/homography.ts', 'homography.mjs');
export const qrp = await loadModule('services/qrPayload.ts', 'qrPayload.mjs');

const PX_PER_MM_300 = 300 / 25.4;
const SHEET_W = Math.round(fmt.PAGE_W_MM * PX_PER_MM_300);
const SHEET_H = Math.round(fmt.PAGE_H_MM * PX_PER_MM_300);

// ---------- the synthetic assignment ----------
// Three pages, mixed region sizes, one drawing region. Every rectangle sits
// inside the spec 4.4 safe area (x 12.0 to 203.9, y 25.0 to 262.0) and clear of
// the QR keep-out, because a fixture that violates the format proves nothing.
const REGION_SPECS = [
  { regionId: 'r001', partId: 'Problem 1(a)', pageK: 1, mm: [12.0, 60.0, 203.9, 120.0], isDrawing: false, maxPoints: 10 },
  { regionId: 'r002', partId: 'Problem 1(b)', pageK: 1, mm: [12.0, 128.0, 203.9, 200.0], isDrawing: false, maxPoints: 15 },
  { regionId: 'r003', partId: 'Problem 1(c)', pageK: 1, mm: [12.0, 208.0, 203.9, 258.0], isDrawing: true, maxPoints: 8 },
  { regionId: 'r004', partId: 'Problem 2(a)', pageK: 2, mm: [12.0, 45.0, 203.9, 150.0], isDrawing: false, maxPoints: 20 },
  { regionId: 'r005', partId: 'Problem 2(b)', pageK: 2, mm: [12.0, 158.0, 203.9, 258.0], isDrawing: false, maxPoints: 20 },
  { regionId: 'r006', partId: 'Problem 3', pageK: 3, mm: [12.0, 45.0, 203.9, 258.0], isDrawing: false, maxPoints: 27 },
];

const ASSIGNMENT_ID = 'ENG17HW1';
export const PAGE_COUNT = 3;

const toFraction = (mm) => ({
  x0: fmt.round4(mm[0] / fmt.PAGE_W_MM),
  y0: fmt.round4(mm[1] / fmt.PAGE_H_MM),
  x1: fmt.round4(mm[2] / fmt.PAGE_W_MM),
  y1: fmt.round4(mm[3] / fmt.PAGE_H_MM),
});

/** The map, its layout_id, and the CSV text — all self-consistent by construction. */
export const buildFixtureMap = async () => {
  const rows = REGION_SPECS.map(s => ({ ...s, fr: toFraction(s.mm) }));
  const layoutId = await qrp.computeLayoutId(rows.map(r => ({
    regionId: r.regionId, partId: r.partId, pageK: r.pageK,
    x0: r.fr.x0, y0: r.fr.y0, x1: r.fr.x1, y1: r.fr.y1,
  })));
  const header = 'assignment_id,layout_id,region_id,part_id,page_k,x0,y0,x1,y1,is_drawing,max_points';
  const body = rows.map(r => [
    ASSIGNMENT_ID, layoutId, r.regionId, '"' + r.partId + '"', r.pageK,
    fmt.fmt4(r.fr.x0), fmt.fmt4(r.fr.y0), fmt.fmt4(r.fr.x1), fmt.fmt4(r.fr.y1),
    r.isDrawing ? 'true' : 'false', r.maxPoints,
  ].join(','));
  return {
    rows, layoutId, assignmentId: ASSIGNMENT_ID,
    csv: [header, ...body].join('\n') + '\n',
    csvName: 'layout_' + layoutId + '.csv',
    payloadFor: (k) => qrp.buildPayload({
      assignmentId: ASSIGNMENT_ID, token: qrp.MASTER_TOKEN, k, n: PAGE_COUNT, layoutId,
    }),
  };
};

// ---------- rasteriser ----------
const blank = (w, h, value = 255) => ({
  data: new Uint8ClampedArray(w * h * 4).fill(value), width: w, height: h,
});

const setPx = (img, x, y, v) => {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const i = (y * img.width + x) * 4;
  img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
  img.data[i + 3] = 255;
};

const fillRectMm = (img, x0, y0, x1, y1, v) => {
  const px0 = Math.round(x0 * PX_PER_MM_300), px1 = Math.round(x1 * PX_PER_MM_300);
  const py0 = Math.round(y0 * PX_PER_MM_300), py1 = Math.round(y1 * PX_PER_MM_300);
  for (let y = py0; y < py1; y++) for (let x = px0; x < px1; x++) setPx(img, x, y, v);
};

const strokeRectMm = (img, x0, y0, x1, y1, widthMm, v) => {
  fillRectMm(img, x0, y0, x1, y0 + widthMm, v);
  fillRectMm(img, x0, y1 - widthMm, x1, y1, v);
  fillRectMm(img, x0, y0, x0 + widthMm, y1, v);
  fillRectMm(img, x1 - widthMm, y0, x1, y1, v);
};

/** Deterministic PRNG, so the same fixture renders identically on every machine. */
const rng = (seed) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

/** Pen strokes: enough real ink for the crop's "looks empty" check to be exercised. */
const scribbleMm = (img, x0, y0, x1, y1, seed) => {
  const next = rng(seed);
  const lines = Math.max(1, Math.floor((y1 - y0) / 9));
  for (let l = 0; l < lines; l++) {
    const baseY = y0 + 6 + l * 9;
    if (baseY > y1 - 3) break;
    let x = x0 + 4;
    const end = x0 + 8 + next() * (x1 - x0 - 20);
    while (x < end) {
      const dy = Math.sin(x * 1.7 + l) * 1.1 + (next() - 0.5) * 0.6;
      const px = Math.round(x * PX_PER_MM_300);
      const py = Math.round((baseY + dy) * PX_PER_MM_300);
      for (let t = -2; t <= 2; t++) for (let s = -1; s <= 1; s++) setPx(img, px + s, py + t, 25);
      x += 0.35;
    }
  }
};

const drawQr = (img, payload) => {
  const qr = QRCode.create(payload, { version: 4, errorCorrectionLevel: 'H' });
  const n = qr.modules.size;
  const sizeMm = fmt.QR_RECT_MM.x1 - fmt.QR_RECT_MM.x0;
  const modMm = sizeMm / n;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.modules.data[r * n + c]) continue;
      fillRectMm(img,
        fmt.QR_RECT_MM.x0 + c * modMm, fmt.QR_RECT_MM.y0 + r * modMm,
        fmt.QR_RECT_MM.x0 + (c + 1) * modMm, fmt.QR_RECT_MM.y0 + (r + 1) * modMm, 0);
    }
  }
};

/** One page of the fixture sheet, at the canonical 300 dpi. */
export const renderSheet = (map, k) => {
  const img = blank(SHEET_W, SHEET_H);

  // Registration marks — the four 5 mm squares, from MARK_CENTRES_MM itself.
  for (const [cx, cy] of fmt.MARK_CENTRES_MM) {
    fillRectMm(img,
      cx - fmt.MARK_SIZE_MM / 2, cy - fmt.MARK_SIZE_MM / 2,
      cx + fmt.MARK_SIZE_MM / 2, cy + fmt.MARK_SIZE_MM / 2, 0);
  }

  drawQr(img, map.payloadFor(k));

  // The one header text line, as bars. Its content is irrelevant to registration
  // and this fixture must not put a name on a page.
  for (let i = 0; i < 9; i++) fillRectMm(img, 20 + i * 6, 11.5, 24.5 + i * 6, 13.5, 90);

  for (const r of map.rows.filter(r => r.pageK === k)) {
    const [x0, y0, x1, y1] = r.mm;
    strokeRectMm(img, x0, y0, x1, y1, 0.353, 0);           // the 1 pt answer box
    if (!r.isDrawing) {
      for (let y = y0 + 9; y < y1 - 2; y += 9) {            // dashed writing rules
        for (let x = x0 + 2; x < x1 - 2; x += 2.2) fillRectMm(img, x, y, x + 1.3, y + 0.18, 190);
      }
      scribbleMm(img, x0, y0, x1, y1 - 6, 7 + k * 31 + Math.round(x0));
    } else {
      scribbleMm(img, x0 + 20, y0 + 10, x1 - 20, y1 - 10, 991 + k);
    }
  }
  return img;
};

// ---------- degradations ----------
const sampleBilinear = (src, x, y, outside) => {
  if (x < 0 || y < 0 || x > src.width - 1 || y > src.height - 1) return outside;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, src.width - 1), y1 = Math.min(y0 + 1, src.height - 1);
  const fx = x - x0, fy = y - y0;
  const at = (xx, yy) => src.data[(yy * src.width + xx) * 4];
  return (at(x0, y0) * (1 - fx) + at(x1, y0) * fx) * (1 - fy)
       + (at(x0, y1) * (1 - fx) + at(x1, y1) * fx) * fy;
};

const boxBlur = (img, radius) => {
  if (radius < 1) return img;
  const w = img.width, h = img.height;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let d = -radius; d <= radius; d++) {
        const xx = x + d;
        if (xx < 0 || xx >= w) continue;
        s += img.data[(y * w + xx) * 4]; n++;
      }
      tmp[y * w + x] = s / n;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let d = -radius; d <= radius; d++) {
        const yy = y + d;
        if (yy < 0 || yy >= h) continue;
        s += tmp[yy * w + x]; n++;
      }
      out[y * w + x] = s / n;
    }
  }
  for (let p = 0; p < w * h; p++) {
    const v = out[p];
    img.data[p * 4] = img.data[p * 4 + 1] = img.data[p * 4 + 2] = v;
  }
  return img;
};

/**
 * One capture: the sheet placed into a phone-sized frame by a homography, with
 * whatever else the recipe asks for. Returns the image plus the ground-truth
 * mark positions in capture pixels, which is what the suite measures against.
 */
export const makeCapture = (sheet, recipe) => {
  const W = recipe.frameW ?? 1700, H = recipe.frameH ?? 2200;
  const corners = recipe.corners(W, H);
  const mmCorners = [
    { x: 0, y: 0 }, { x: fmt.PAGE_W_MM, y: 0 },
    { x: 0, y: fmt.PAGE_H_MM }, { x: fmt.PAGE_W_MM, y: fmt.PAGE_H_MM },
  ];
  const mmToCapture = hom.homographyFromQuad(mmCorners, corners);
  const captureToMm = hom.homographyFromQuad(corners, mmCorners);
  if (!mmToCapture || !captureToMm) throw new Error(recipe.name + ': degenerate corner set');

  const out = blank(W, H, 255);
  const desk = recipe.desk ?? 255;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const mm = hom.applyMatrix(captureToMm, { x: x + 0.5, y: y + 0.5 });
      const v = sampleBilinear(sheet, mm.x * PX_PER_MM_300, mm.y * PX_PER_MM_300, desk);
      const i = (y * W + x) * 4;
      out.data[i] = out.data[i + 1] = out.data[i + 2] = v;
      out.data[i + 3] = 255;
    }
  }

  if (recipe.gradient) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const f = recipe.gradient(x / W, y / H);
        const i = (y * W + x) * 4;
        const v = Math.max(0, Math.min(255, out.data[i] * f));
        out.data[i] = out.data[i + 1] = out.data[i + 2] = v;
      }
    }
  }
  if (recipe.blur) boxBlur(out, recipe.blur);

  let bytes = null;
  if (recipe.jpegQuality) {
    bytes = jpeg.encode({ data: Buffer.from(out.data.buffer.slice(0)), width: W, height: H },
      recipe.jpegQuality).data;
    const back = jpeg.decode(bytes, { useTArray: true });
    out.data.set(back.data);
  }

  const truthMarks = fmt.MARK_CENTRES_MM.map(([mx, my]) =>
    hom.applyMatrix(mmToCapture, { x: mx, y: my }));

  return { image: out, bytes, mmToCapture, truthMarks, width: W, height: H };
};

const rotatedCorners = (deg, inset = 0.06) => (W, H) => {
  const t = (deg * Math.PI) / 180, cos = Math.cos(t), sin = Math.sin(t);
  const cx = W / 2, cy = H / 2;
  const halfW = (W * (1 - 2 * inset)) / 2, halfH = (H * (1 - 2 * inset)) / 2;
  return [[-halfW, -halfH], [halfW, -halfH], [-halfW, halfH], [halfW, halfH]]
    .map(([x, y]) => ({ x: cx + x * cos - y * sin, y: cy + x * sin + y * cos }));
};

/**
 * A real perspective, not a shear: the far edge of the sheet is shorter than the
 * near one and the two side edges converge, which is the trapezoid a phone
 * produces when it is not held parallel to the desk. `narrow` is how much the
 * top edge shrinks, `lift` how far the top edge rides up as it recedes, and
 * `roll` the small rotation that always comes with a hand-held shot.
 */
const perspectiveCorners = (narrow, lift, roll = 0, inset = 0.06) => (W, H) => {
  const x0 = W * inset, x1 = W * (1 - inset), y0 = H * inset, y1 = H * (1 - inset);
  const shrink = ((x1 - x0) * narrow) / 2;
  const pts = [
    { x: x0 + shrink, y: y0 + H * lift },
    { x: x1 - shrink, y: y0 + H * lift },
    { x: x0, y: y1 },
    { x: x1, y: y1 },
  ];
  if (!roll) return pts;
  const t = (roll * Math.PI) / 180, cos = Math.cos(t), sin = Math.sin(t);
  const cx = W / 2, cy = H / 2;
  return pts.map(p => ({
    x: cx + (p.x - cx) * cos - (p.y - cy) * sin,
    y: cy + (p.x - cx) * sin + (p.y - cy) * cos,
  }));
};

export const RECIPES = [
  { name: '01-clean', corners: rotatedCorners(0), jpegQuality: 92 },
  { name: '02-rotate-2deg', corners: rotatedCorners(2), jpegQuality: 88 },
  { name: '03-rotate-6deg', corners: rotatedCorners(6, 0.10), jpegQuality: 88 },
  { name: '04-upside-down', corners: rotatedCorners(180), jpegQuality: 88 },
  { name: '05-perspective-mild', corners: perspectiveCorners(0.06, 0.02, 1.0), jpegQuality: 88 },
  { name: '06-perspective-strong', corners: perspectiveCorners(0.20, 0.055, -3.0, 0.05), jpegQuality: 85 },
  {
    name: '07-lighting-gradient', corners: rotatedCorners(1), jpegQuality: 88,
    gradient: (u, v) => 1.02 - 0.42 * u - 0.18 * v,
  },
  {
    name: '08-shadow-across-corner', corners: rotatedCorners(-1.5), jpegQuality: 88,
    gradient: (u, v) => (u + v < 0.65 ? 0.52 + 0.55 * (u + v) : 1.0),
  },
  { name: '09-defocus', corners: rotatedCorners(1), blur: 3, jpegQuality: 88 },
  { name: '10-jpeg-low', corners: rotatedCorners(-2), jpegQuality: 32 },
  { name: '11-dark-desk-small-in-frame', corners: rotatedCorners(4, 0.19), desk: 58, jpegQuality: 85 },
  {
    name: '12-in-a-hurry', corners: perspectiveCorners(0.15, 0.04, 5.0, 0.10), blur: 2, jpegQuality: 40,
    gradient: (u, v) => 1.0 - 0.3 * v - 0.12 * u,
  },
];

// ---------- writing and reading the folder ----------
export const writeCaptures = async () => {
  const map = await buildFixtureMap();
  mkdirSync(SYNTHETIC_DIR, { recursive: true });
  mkdirSync(REAL_DIR, { recursive: true });

  const sheets = {};
  for (let k = 1; k <= PAGE_COUNT; k++) sheets[k] = renderSheet(map, k);

  const manifest = { layoutId: map.layoutId, assignmentId: map.assignmentId, captures: [] };
  for (const recipe of RECIPES) {
    // The page cycles so the crop check is not one page repeated twelve times.
    const k = (manifest.captures.length % PAGE_COUNT) + 1;
    const cap = makeCapture(sheets[k], recipe);
    const name = recipe.name + '.jpg';
    const bytes = cap.bytes ?? jpeg.encode(
      { data: Buffer.from(cap.image.data.buffer.slice(0)), width: cap.width, height: cap.height }, 90).data;
    writeFileSync(join(SYNTHETIC_DIR, name), bytes);
    manifest.captures.push({
      file: name, pageK: k, width: cap.width, height: cap.height,
      truthMarks: cap.truthMarks.map(p => [p.x, p.y]),
    });
  }
  writeFileSync(join(SYNTHETIC_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  writeFileSync(join(CAPTURE_DIR, 'layout_fixture.csv'), map.csv);
  return { map, manifest };
};

export const ensureCaptures = async () => {
  const manifestPath = join(SYNTHETIC_DIR, 'manifest.json');
  const map = await buildFixtureMap();
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    // A stale fixture is worse than none: it would test yesterday's geometry.
    if (manifest.layoutId === map.layoutId && manifest.captures.length === RECIPES.length) {
      return { map, manifest };
    }
  }
  return writeCaptures();
};

/** Decodes a capture file to the { data, width, height } the app's services take. */
export const readCapture = (path) => {
  const buf = readFileSync(path);
  if (extname(path).toLowerCase() === '.png') {
    const png = PNG.sync.read(buf);
    return { data: new Uint8ClampedArray(png.data), width: png.width, height: png.height };
  }
  const img = jpeg.decode(buf, { useTArray: true });
  return { data: new Uint8ClampedArray(img.data), width: img.width, height: img.height };
};

/** Every image in captures/, synthetic and real alike. Real ones carry no truth. */
export const listCaptures = () => {
  const out = [];
  for (const dir of [SYNTHETIC_DIR, REAL_DIR]) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).sort()) {
      if (!/\.(jpe?g|png)$/i.test(name)) continue;
      out.push({ file: name, path: join(dir, name), synthetic: dir === SYNTHETIC_DIR });
    }
  }
  return out;
};
