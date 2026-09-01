/**
 * qrPayload.ts — the page-format QR payload and the layout_id hash.
 *
 * **Ported from `GradeBridge-Assignment-Maker/services/qrPayload.ts`.** Spec:
 * `GradeBridge_Page_Format_v1.md` 2.1 (grammar), 2.2 (hash). The generator and
 * this app must compute `layout_id` identically: this app recomputes it over the
 * map it loaded and refuses to crop when it disagrees with the QR on the paper.
 *
 * That hash is the only thing standing between a stale map and a page that
 * registers perfectly, crops the wrong rectangles, and raises no error anywhere.
 * A student printing this week's sheet and loading last week's zip is the exact
 * case it catches, and every downstream symptom of it is silent.
 *
 * `canonicalMapSerialization` and `computeLayoutId` are byte-identical in
 * behaviour to the Assignment Maker's. `fmt4` comes from `./pageFormat`, the
 * same import shape as there. Do not "improve" any of the three.
 *
 * Naming caution: `GB1` here is the page-format tag. It is unrelated to the
 * `gb1:` / `gb2:` submission-JSON encryption prefixes.
 */

import { fmt4 } from './pageFormat';

export const FORMAT_TAG = 'GB1';

/**
 * Homework uses a class-wide master template with no student-specific QR, so
 * field 3 is this fixed placeholder on every homework page. On the **exam**
 * track the same field carries an opaque per-submission id and is a grouping
 * key; on this track it is the constant `HWMSTR` and groups nothing. Nothing
 * student-specific ever enters the QR.
 */
export const MASTER_TOKEN = 'HWMSTR';

export const PAYLOAD_RE =
  /^GB1-[A-Z0-9]{1,12}-[A-Z0-9]{6,10}-[0-9]{1,3}-[0-9]{1,3}-[0-9A-F]{8}$/;

export interface QrFields {
  assignmentId: string;
  token: string;
  k: number;
  n: number;
  layoutId: string;
}

export const buildPayload = (f: QrFields): string =>
  `${FORMAT_TAG}-${f.assignmentId}-${f.token}-${f.k}-${f.n}-${f.layoutId}`;

/** Split on `-` into exactly six fields — safe because `-` is excluded from every field. */
export const parsePayload = (payload: string): QrFields | null => {
  if (!PAYLOAD_RE.test(payload)) return null;
  const [, assignmentId, token, k, n, layoutId] = payload.split('-');
  return { assignmentId, token, k: Number(k), n: Number(n), layoutId };
};

// ---- layout_id -----------------------------------------------------------

/** One row of the stored map, as the hash sees it. */
export interface HashableRegion {
  regionId: string;
  partId: string;
  pageK: number;
  x0: number; y0: number; x1: number; y1: number;
}

/**
 * Spec 2.2, verbatim: sort rows by region_id; for each row join region_id,
 * part_id, page_k and the four coordinates each formatted to exactly four
 * decimal places, with `|` separators; join rows with `\n`.
 */
export const canonicalMapSerialization = (rows: HashableRegion[]): string =>
  [...rows]
    .sort((a, b) => (a.regionId < b.regionId ? -1 : a.regionId > b.regionId ? 1 : 0))
    .map(r => [r.regionId, r.partId, String(r.pageK), fmt4(r.x0), fmt4(r.y0), fmt4(r.x1), fmt4(r.y1)].join('|'))
    .join('\n');

const sha256Hex = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
};

/** SHA-256 of the canonical serialization, first eight hex characters, uppercased. */
export const computeLayoutId = async (rows: HashableRegion[]): Promise<string> =>
  (await sha256Hex(canonicalMapSerialization(rows))).slice(0, 8).toUpperCase();
