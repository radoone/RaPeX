import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { getApps, initializeApp } from "firebase-admin/app";
import { FieldPath, getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import * as logger from "firebase-functions/logger";
import { FIRESTORE_COLLECTIONS } from "./safety-gate-config.js";

export const DEFAULT_VECTOR_SNAPSHOT_BUCKET = "rapex-99a2c-vector-snapshots";
export const VECTOR_SNAPSHOT_META_DOC = "vector_snapshot";
export const TEXT_VECTOR_DIMS = 1536;
export const IMAGE_VECTOR_DIMS = 1408;
// Format 1 remains readable; policy 2 certifies journal-complete publication.
export const VECTOR_SNAPSHOT_COVERAGE_POLICY = 2;
export const MAX_EXACT_HYDRATION_ROWS = 256;
const MAX_PATCH_JOURNAL_CHANGES = 10000;
export const MAX_DELTA_OVERLAY_CHANGES = 250;
export const MANIFEST_REFRESH_MS = 5 * 60 * 1000;

const SNAPSHOT_MAGIC = "SGVS";
const SNAPSHOT_FORMAT_VERSION = 1;
const SNAPSHOT_HEADER_BYTES = 32;
const PAGINATION_LIMIT = 1000;
const GET_ALL_CHUNK = 100;
const IN_QUERY_CHUNK = 30;

export interface SnapshotRecord {
  docId: string;
  vector: number[];
  alertId?: string;
  imageUrl?: string;
}

export interface DecodedVectorSnapshot {
  count: number;
  dims: number;
  flags: 0 | 1;
  scales: Float32Array;
  vectors: Int8Array;
  docIds: string[];
  alertIds?: string[];
  imageUrls?: string[];
}

export interface VectorSnapshotManifest {
  version: 1;
  coveragePolicyVersion: 2;
  snapshotId: string;
  builtAt: string;
  coveredThrough: string;
  bucket: string;
  textObject: string;
  textCount: number;
  textDims: number;
  textSha256: string;
  textBytes: number;
  imageObject: string;
  imageCount: number;
  imageDims: number;
  imageSha256: string;
  imageBytes: number;
}

export interface DeltaOverlayEntry {
  docId: string;
  alertId: string;
  imageUrl?: string;
  unitVector: Float32Array | Float64Array;
}

export interface DeltaOverlay {
  supersededDocIds?: ReadonlySet<string>;
  supersededAlertIds?: ReadonlySet<string>;
  entries?: readonly DeltaOverlayEntry[];
}

export interface SnapshotSearchHit {
  id: string;
  data: Record<string, unknown>;
  distance: number;
}

type ChannelName = "text" | "image";

interface ChannelCacheState {
  snapshotId: string;
  sha256: string;
  decoded: DecodedVectorSnapshot;
}

interface OverlayCacheState {
  snapshotId: string;
  coveredThrough: string;
  refreshedAtMs: number;
  readThrough: Timestamp;
  stale: boolean;
  supersededAlertIds: Set<string>;
  textEntries: DeltaOverlayEntry[];
  imageEntries: DeltaOverlayEntry[] | null;
}

let cachedManifest: { manifest: VectorSnapshotManifest | null; fetchedAtMs: number } | null = null;
let cachedTextSnapshot: ChannelCacheState | null = null;
let cachedImageSnapshot: ChannelCacheState | null = null;
let pendingManifestLoad: Promise<VectorSnapshotManifest | null> | null = null;
let pendingTextLoad: Promise<DecodedVectorSnapshot | null> | null = null;
let pendingImageLoad: Promise<DecodedVectorSnapshot | null> | null = null;
let pendingOverlayLoad: Promise<OverlayCacheState | null> | null = null;

export function isVectorSnapshotEnabled(): boolean {
  return process.env.SAFETY_GATE_DISABLE_VECTOR_SNAPSHOT !== "1";
}

export function getVectorSnapshotBucketName(explicit?: string): string {
  return (
    explicit?.trim() ||
    process.env.SAFETY_GATE_VECTOR_SNAPSHOT_BUCKET?.trim() ||
    DEFAULT_VECTOR_SNAPSHOT_BUCKET
  );
}

export function resetVectorSnapshotCacheForTests(): void {
  cachedManifest = null;
  cachedTextSnapshot = null;
  cachedImageSnapshot = null;
  pendingManifestLoad = null;
  pendingTextLoad = null;
  pendingImageLoad = null;
  pendingOverlayLoad = null;
}

function compareUtf8Ids(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

export function extractVectorArray(value: unknown): number[] | undefined {
  if (Array.isArray(value)) {
    return value as number[];
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const maybeVector = value as { toArray?: () => number[]; _values?: number[] };
  if (typeof maybeVector.toArray === "function") {
    return maybeVector.toArray();
  }
  if (Array.isArray(maybeVector._values)) {
    return maybeVector._values;
  }
  return undefined;
}

function normalizeUnitVectorF64(vector: readonly number[], dims: number): Float64Array | null {
  if (!Array.isArray(vector) || vector.length !== dims) {
    return null;
  }
  let normSq = 0;
  for (let i = 0; i < dims; i++) {
    const v = vector[i];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      return null;
    }
    normSq += v * v;
  }
  const norm = Math.sqrt(normSq);
  if (!Number.isFinite(norm) || normSq < 2 ** -1022) {
    return null;
  }
  const out = new Float64Array(dims);
  for (let i = 0; i < dims; i++) {
    out[i] = vector[i] / norm;
  }
  return out;
}

function quantizeUnitVector(
  vector: readonly number[],
  dims: number,
): { scale: number; quantized: Int8Array } | null {
  if (!Array.isArray(vector) || vector.length !== dims) {
    return null;
  }
  let normSq = 0;
  for (let i = 0; i < dims; i++) {
    const v = vector[i];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      return null;
    }
    normSq += v * v;
  }
  const norm = Math.sqrt(normSq);
  if (!Number.isFinite(norm) || normSq < 2 ** -1022) {
    return null;
  }

  let maxAbs = 0;
  const unit = new Float64Array(dims);
  for (let i = 0; i < dims; i++) {
    const u = vector[i] / norm;
    unit[i] = u;
    const abs = Math.abs(u);
    if (abs > maxAbs) {
      maxAbs = abs;
    }
  }
  if (!Number.isFinite(maxAbs) || maxAbs === 0) {
    return null;
  }

  const scale = Math.fround(maxAbs / 127);
  if (!Number.isFinite(scale) || scale === 0) {
    return null;
  }

  const quantized = new Int8Array(dims);
  for (let i = 0; i < dims; i++) {
    let q = Math.round(unit[i] / scale);
    if (q > 127) q = 127;
    else if (q < -127) q = -127;
    quantized[i] = q;
  }

  return { scale, quantized };
}

interface SerializedRow {
  docId: string;
  alertId?: string;
  imageUrl?: string;
  scale: number;
  quantized: Int8Array;
}

function serializeSnapshotRows(rows: SerializedRow[], dims: number, flags: 0 | 1): Buffer {
  rows.sort((a, b) => compareUtf8Ids(a.docId, b.docId));

  const count = rows.length;
  const metaPayload =
    flags === 1
      ? rows.map((row) => [row.docId, row.alertId || "", row.imageUrl || ""])
      : rows.map((row) => row.docId);
  const metaBuf = Buffer.from(JSON.stringify(metaPayload), "utf8");

  const scalesOffset = SNAPSHOT_HEADER_BYTES;
  const vectorsOffset = scalesOffset + count * 4;
  const metaOffset = vectorsOffset + count * dims;
  const totalBytes = metaOffset + metaBuf.byteLength;

  const buf = Buffer.allocUnsafe(totalBytes);
  buf.fill(0, 0, SNAPSHOT_HEADER_BYTES);
  buf.write(SNAPSHOT_MAGIC, 0, "ascii");
  buf.writeUInt32LE(SNAPSHOT_FORMAT_VERSION, 4);
  buf.writeUInt32LE(count, 8);
  buf.writeUInt32LE(dims, 12);
  buf.writeUInt32LE(flags, 16);
  buf.writeUInt32LE(metaBuf.byteLength, 20);

  for (let i = 0; i < count; i++) {
    const row = rows[i];
    buf.writeFloatLE(row.scale, scalesOffset + i * 4);
    const src = new Uint8Array(
      row.quantized.buffer,
      row.quantized.byteOffset,
      row.quantized.byteLength,
    );
    buf.set(src, vectorsOffset + i * dims);
  }
  metaBuf.copy(buf, metaOffset);

  return buf;
}

export function encodeVectorSnapshot(
  records: readonly SnapshotRecord[],
  dims: number,
  flags: 0 | 1,
): Buffer {
  const deduped = new Map<string, SnapshotRecord>();
  for (const record of records) {
    if (typeof record.docId === "string" && record.docId.length > 0) {
      deduped.set(record.docId, record);
    }
  }

  const rows: SerializedRow[] = [];
  for (const record of deduped.values()) {
    const quantized = quantizeUnitVector(record.vector, dims);
    if (!quantized) {
      continue;
    }
    rows.push({
      docId: record.docId,
      alertId: record.alertId,
      imageUrl: record.imageUrl,
      scale: quantized.scale,
      quantized: quantized.quantized,
    });
  }

  return serializeSnapshotRows(rows, dims, flags);
}

export function decodeVectorSnapshot(
  buf: Buffer,
  expectedDims: number,
  expectedFlags: 0 | 1,
): DecodedVectorSnapshot {
  if (!Buffer.isBuffer(buf) || buf.byteLength < SNAPSHOT_HEADER_BYTES) {
    throw new Error("Vector snapshot buffer is too small");
  }
  if (buf.toString("ascii", 0, 4) !== SNAPSHOT_MAGIC) {
    throw new Error("Invalid vector snapshot magic header");
  }

  const version = buf.readUInt32LE(4);
  const count = buf.readUInt32LE(8);
  const dims = buf.readUInt32LE(12);
  const flags = buf.readUInt32LE(16);
  const metaLen = buf.readUInt32LE(20);

  if (version !== SNAPSHOT_FORMAT_VERSION) {
    throw new Error(`Unsupported vector snapshot version: ${version}`);
  }
  if (dims !== expectedDims) {
    throw new Error(`Unexpected snapshot dimensions ${dims} (expected ${expectedDims})`);
  }
  if (flags !== expectedFlags) {
    throw new Error(`Unexpected snapshot flags ${flags} (expected ${expectedFlags})`);
  }

  const scalesBytes = count * 4;
  const vectorsBytes = count * dims;
  const expectedTotal = SNAPSHOT_HEADER_BYTES + scalesBytes + vectorsBytes + metaLen;
  if (!Number.isSafeInteger(expectedTotal) || expectedTotal !== buf.byteLength) {
    throw new Error(
      `Snapshot byte length mismatch: got ${buf.byteLength}, expected ${expectedTotal}`,
    );
  }

  let source = buf;
  if ((buf.byteOffset + SNAPSHOT_HEADER_BYTES) % 4 !== 0) {
    // Allocate a standalone ArrayBuffer (byteOffset === 0) to guarantee 4-byte Float32 alignment.
    const aligned = new Uint8Array(buf.byteLength);
    aligned.set(buf);
    source = Buffer.from(aligned.buffer);
  }

  const scales = new Float32Array(source.buffer, source.byteOffset + SNAPSHOT_HEADER_BYTES, count);
  const vectors = new Int8Array(
    source.buffer,
    source.byteOffset + SNAPSHOT_HEADER_BYTES + scalesBytes,
    count * dims,
  );

  const metaOffset = SNAPSHOT_HEADER_BYTES + scalesBytes + vectorsBytes;
  const parsedMeta = JSON.parse(source.toString("utf8", metaOffset, metaOffset + metaLen));
  if (!Array.isArray(parsedMeta) || parsedMeta.length !== count) {
    throw new Error("Snapshot metadata array length does not match count");
  }

  if (flags === 1) {
    const docIds = new Array<string>(count);
    const alertIds = new Array<string>(count);
    const imageUrls = new Array<string>(count);
    for (let i = 0; i < count; i++) {
      const entry = parsedMeta[i];
      if (!Array.isArray(entry) || entry.length < 3) {
        throw new Error(`Malformed image snapshot metadata at index ${i}`);
      }
      docIds[i] = String(entry[0]);
      alertIds[i] = String(entry[1]);
      imageUrls[i] = String(entry[2]);
    }
    return { count, dims, flags: 1, scales, vectors, docIds, alertIds, imageUrls };
  }

  const docIds = new Array<string>(count);
  for (let i = 0; i < count; i++) {
    const entry = parsedMeta[i];
    if (typeof entry !== "string") {
      throw new Error(`Malformed text snapshot metadata at index ${i}`);
    }
    docIds[i] = entry;
  }
  return { count, dims, flags: 0, scales, vectors, docIds };
}

export function patchDecodedSnapshot(
  base: DecodedVectorSnapshot,
  upserts: readonly SnapshotRecord[],
  deleteDocIds: ReadonlySet<string>,
  supersededAlertIds: ReadonlySet<string> = new Set(),
): Buffer {
  const upsertRows = new Map<string, SerializedRow>();
  for (const record of upserts) {
    if (typeof record.docId !== "string" || record.docId.length === 0) {
      continue;
    }
    const quantized = quantizeUnitVector(record.vector, base.dims);
    if (!quantized) {
      continue;
    }
    upsertRows.set(record.docId, {
      docId: record.docId,
      alertId: record.alertId,
      imageUrl: record.imageUrl,
      scale: quantized.scale,
      quantized: quantized.quantized,
    });
  }

  const rows: SerializedRow[] = [];
  for (let i = 0; i < base.count; i++) {
    const docId = base.docIds[i];
    if (deleteDocIds.has(docId) || upsertRows.has(docId) || supersededAlertIds.has(base.alertIds?.[i] || docId)) {
      continue;
    }
    rows.push({
      docId,
      alertId: base.alertIds?.[i],
      imageUrl: base.imageUrls?.[i],
      scale: base.scales[i],
      quantized: base.vectors.subarray(i * base.dims, (i + 1) * base.dims),
    });
  }

  for (const row of upsertRows.values()) {
    if (!deleteDocIds.has(row.docId)) {
      rows.push(row);
    }
  }

  return serializeSnapshotRows(rows, base.dims, base.flags);
}

export function exactCosineDistance(a: readonly number[], b: readonly number[]): number | null {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) {
    return null;
  }
  let dot = 0;
  let normASq = 0;
  let normBSq = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      typeof x !== "number" ||
      typeof y !== "number" ||
      !Number.isFinite(x) ||
      !Number.isFinite(y)
    ) {
      return null;
    }
    dot += x * y;
    normASq += x * x;
    normBSq += y * y;
  }
  if (normASq === 0 || normBSq === 0) {
    return null;
  }
  const cosine = dot / (Math.sqrt(normASq) * Math.sqrt(normBSq));
  const distance = 1 - cosine;
  return Number.isFinite(distance) ? distance : null;
}

export interface SnapshotScanHit {
  docId: string;
  approxDistance: number;
  alertId?: string;
  imageUrl?: string;
  lowerBound: number;
}

/**
 * Return every row whose certified distance lower bound can pass the cutoff.
 * The legacy oversample argument is deliberately not a truncation budget.
 * For format 1, each normalized coordinate was rounded to a nearest integer
 * multiple of scale. Its absolute error is <= scale/2 (including clamped extrema;
 * Float32 scale rounding cannot move an extremum by half a quantization step).
 * Thus |dot(q,v)-dot(q,v_quant)| <= scale/2 * ||q||_1.
 * Float64 normalization and dot accumulation use a conservative gamma(n) margin.
 */
export function scanSnapshotTopK(
  snapshot: DecodedVectorSnapshot,
  queryVector: readonly number[],
  maxDistance: number,
  _oversampleLimit: number,
  overlay?: DeltaOverlay,
): SnapshotScanHit[] | null {
  const qUnit = normalizeUnitVectorF64(queryVector, snapshot.dims);
  if (!qUnit || !Number.isFinite(maxDistance)) return null;
  const dims = snapshot.dims;
  const arithmeticError = 64 * Number.EPSILON * dims;
  let queryL1 = 0;
  for (const value of qUnit) queryL1 += Math.abs(value);
  const hits = new Map<string, SnapshotScanHit>();
  for (let i = 0; i < snapshot.count; i++) {
    const docId = snapshot.docIds[i];
    const alertId = snapshot.alertIds?.[i];
    if (overlay?.supersededDocIds?.has(docId) || overlay?.supersededAlertIds?.has(alertId || docId)) continue;
    const scale = snapshot.scales[i];
    // Values outside the original unit-vector encoder's contract are uncertain.
    if (!Number.isFinite(scale) || scale <= 0 || scale > (1 + 2 ** -23) / 127) return null;
    const off = i * dims;
    let dot = 0;
    for (let j = 0; j < dims; j++) dot += snapshot.vectors[off + j] * qUnit[j];
    const approxDistance = 1 - dot * scale;
    const lowerBound = approxDistance - (scale / 2 * queryL1 + arithmeticError);
    if (lowerBound <= maxDistance) hits.set(docId, {
      docId, approxDistance, lowerBound,
      ...(alertId !== undefined ? { alertId } : {}),
      ...(snapshot.imageUrls?.[i] !== undefined ? { imageUrl: snapshot.imageUrls[i] } : {}),
    });
  }
  for (const entry of overlay?.entries || []) {
    if (entry.unitVector.length !== dims) return null;
    let dot = 0;
    for (let j = 0; j < dims; j++) {
      if (!Number.isFinite(entry.unitVector[j])) return null;
      dot += entry.unitVector[j] * qUnit[j];
    }
    const approxDistance = 1 - dot;
    // Support callers supplying the historical Float32 overlay representation.
    const rounding = entry.unitVector.BYTES_PER_ELEMENT === 4 ? Math.sqrt(dims) * 2 ** -24 : 0;
    const lowerBound = approxDistance - rounding - arithmeticError;
    if (lowerBound <= maxDistance) hits.set(entry.docId, { docId: entry.docId, alertId: entry.alertId, ...(entry.imageUrl !== undefined ? { imageUrl: entry.imageUrl } : {}), approxDistance, lowerBound });
  }
  return [...hits.values()].sort((a, b) => a.lowerBound - b.lowerBound || compareUtf8Ids(a.docId, b.docId));
}

export interface SnapshotSearchMetrics {
  elapsedMs: number;
  scanElapsedMs: number;
  scannedRows: number;
  candidateRows: number;
  exactDocumentReads: number;
  manifestReads: number;
  journalQueries: number;
  journalDocuments: number;
  overlayDocumentReads: number;
  overlayImageDocuments: number;
  gcsDownloads: number;
  gcsBytes: number;
  usedSnapshot: boolean;
  fallbackReason?: string;
}
export interface SnapshotSearchOptions {
  /** Physical I/O initiated by this call; excludes shared/cached work and billing estimates. */
  onMetrics?: (metrics: SnapshotSearchMetrics) => void;
}

function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function ensureDefaultFirebaseApp(): void {
  if (typeof getApps === "function" && typeof initializeApp === "function" && getApps().length === 0) {
    initializeApp({
      projectId: process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || "rapex-99a2c",
    });
  }
}

function isLocalProcess(): boolean {
  return !process.env.K_SERVICE && !process.env.FUNCTION_TARGET;
}

function getLocalCacheDir(): string {
  return (
    process.env.SAFETY_GATE_VECTOR_CACHE_DIR?.trim() ||
    join(homedir(), ".cache", "zerorecall-vectors")
  );
}

function parseManifestData(data: Record<string, unknown> | undefined): VectorSnapshotManifest | null {
  if (!data || data.version !== 1 || data.coveragePolicyVersion !== VECTOR_SNAPSHOT_COVERAGE_POLICY) return null;
  if (
    typeof data.snapshotId !== "string" ||
    typeof data.builtAt !== "string" ||
    typeof data.coveredThrough !== "string" ||
    typeof data.bucket !== "string" ||
    typeof data.textObject !== "string" ||
    typeof data.textCount !== "number" ||
    typeof data.textDims !== "number" ||
    typeof data.textSha256 !== "string" ||
    typeof data.textBytes !== "number" ||
    typeof data.imageObject !== "string" ||
    typeof data.imageCount !== "number" ||
    typeof data.imageDims !== "number" ||
    typeof data.imageSha256 !== "string" ||
    typeof data.imageBytes !== "number"
  ) {
    return null;
  }
  if (!Number.isFinite(Date.parse(data.coveredThrough))) {
    return null;
  }
  return data as unknown as VectorSnapshotManifest;
}

async function loadManifest(db: Firestore, metrics?: SnapshotSearchMetrics): Promise<VectorSnapshotManifest | null> {
  const now = Date.now();
  if (cachedManifest && now - cachedManifest.fetchedAtMs < MANIFEST_REFRESH_MS) {
    return cachedManifest.manifest;
  }
  if (pendingManifestLoad) {
    return pendingManifestLoad;
  }

  pendingManifestLoad = (async () => {
    try {
      if (metrics) metrics.manifestReads++;
      const snap = await db
        .collection(FIRESTORE_COLLECTIONS.meta)
        .doc(VECTOR_SNAPSHOT_META_DOC)
        .get();
      const parsed = snap.exists ? parseManifestData(snap.data() as Record<string, unknown> | undefined) : null;
      cachedManifest = { manifest: parsed, fetchedAtMs: Date.now() };
      return parsed;
    } finally {
      pendingManifestLoad = null;
    }
  })();

  return pendingManifestLoad;
}

async function downloadSnapshotBuffer(
  bucketName: string,
  objectPath: string,
  snapshotId: string,
  channel: ChannelName,
  expectedSha256: string,
  metrics?: SnapshotSearchMetrics,
): Promise<Buffer> {
  const localEnabled = isLocalProcess();
  const safeId = snapshotId.replace(/[^a-zA-Z0-9._-]/g, "_");
  const cacheDir = localEnabled ? getLocalCacheDir() : "";
  const localPath = localEnabled ? join(cacheDir, `${safeId}-${channel}.sgvs`) : "";

  if (localEnabled) {
    try {
      const diskBuf = await readFile(localPath);
      if (sha256Hex(diskBuf) === expectedSha256) {
        return diskBuf;
      }
    } catch {
      // Cache miss or unreadable; download from GCS below.
    }
  }

  if (metrics) metrics.gcsDownloads++;
  const [gcsBuf] = await getStorage().bucket(bucketName).file(objectPath).download();
  if (metrics) metrics.gcsBytes += gcsBuf.byteLength;
  const actualSha = sha256Hex(gcsBuf);
  if (actualSha !== expectedSha256) {
    throw new Error(
      `Snapshot checksum mismatch for ${objectPath}: expected ${expectedSha256}, got ${actualSha}`,
    );
  }

  if (localEnabled) {
    try {
      await mkdir(cacheDir, { recursive: true });
      const tmpPath = `${localPath}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tmpPath, gcsBuf);
      await rename(tmpPath, localPath);
    } catch (cacheErr) {
      logger.warn("Unable to write local vector snapshot cache", {
        localPath,
        error: cacheErr instanceof Error ? cacheErr.message : String(cacheErr),
      });
    }
  }

  return gcsBuf;
}

async function loadChannelSnapshot(
  manifest: VectorSnapshotManifest,
  channel: ChannelName,
  metrics?: SnapshotSearchMetrics,
): Promise<DecodedVectorSnapshot | null> {
  const isText = channel === "text";
  const current = isText ? cachedTextSnapshot : cachedImageSnapshot;
  const expectedSha = isText ? manifest.textSha256 : manifest.imageSha256;
  const objectPath = isText ? manifest.textObject : manifest.imageObject;
  const expectedDims = isText ? TEXT_VECTOR_DIMS : IMAGE_VECTOR_DIMS;
  const expectedFlags: 0 | 1 = isText ? 0 : 1;

  if (
    current &&
    current.snapshotId === manifest.snapshotId &&
    current.sha256 === expectedSha
  ) {
    return current.decoded;
  }

  const existingPending = isText ? pendingTextLoad : pendingImageLoad;
  if (existingPending) {
    await existingPending;
    // A different generation may have begun loading before this manifest was
    // refreshed. Re-check its identity instead of joining the wrong snapshot.
    return loadChannelSnapshot(manifest, channel, metrics);
  }

  const loaderPromise = (async () => {
    try {
      const buf = await downloadSnapshotBuffer(
        manifest.bucket,
        objectPath,
        manifest.snapshotId,
        channel,
        expectedSha,
        metrics,
      );
      const decoded = decodeVectorSnapshot(buf, expectedDims, expectedFlags);
      const entry: ChannelCacheState = {
        snapshotId: manifest.snapshotId,
        sha256: expectedSha,
        decoded,
      };
      if (isText) {
        cachedTextSnapshot = entry;
      } else {
        cachedImageSnapshot = entry;
      }
      return decoded;
    } finally {
      if (isText) {
        pendingTextLoad = null;
      } else {
        pendingImageLoad = null;
      }
    }
  })();

  if (isText) {
    pendingTextLoad = loaderPromise;
  } else {
    pendingImageLoad = loaderPromise;
  }

  return loaderPromise;
}

async function loadDeltaOverlay(
  db: Firestore,
  manifest: VectorSnapshotManifest,
  needImages: boolean,
  metrics?: SnapshotSearchMetrics,
): Promise<OverlayCacheState | null> {
  if (pendingOverlayLoad) {
    const joined = await pendingOverlayLoad;
    if (joined && joined.snapshotId === manifest.snapshotId && joined.coveredThrough === manifest.coveredThrough && (!needImages || joined.imageEntries !== null)) return joined;
  }

  pendingOverlayLoad = (async () => {
    try {
      const cutoff = Timestamp.fromDate(new Date(manifest.coveredThrough));
      if (metrics) metrics.journalQueries++;
      const changeSnap = await db
        .collection("rapex_changes")
        .where("changedAt", ">", cutoff)
        .orderBy("changedAt", "asc")
        .limit(MAX_DELTA_OVERLAY_CHANGES + 1)
        .get();

      if (metrics) metrics.journalDocuments += changeSnap.size;
      if (changeSnap.size > MAX_DELTA_OVERLAY_CHANGES) {
        const staleState: OverlayCacheState = {
          snapshotId: manifest.snapshotId,
          coveredThrough: manifest.coveredThrough,
          refreshedAtMs: Date.now(),
          readThrough: changeSnap.readTime,
          stale: true,
          supersededAlertIds: new Set<string>(),
          textEntries: [],
          imageEntries: needImages ? [] : null,
        };
        return staleState;
      }

      const alertIds = new Set<string>();
      for (const doc of changeSnap.docs) {
        const alertId = doc.get("alertId");
        if (typeof alertId !== "string" || !alertId.trim()) throw new Error("Invalid snapshot journal alert ID");
        alertIds.add(alertId.trim());
      }

      const textEntries: DeltaOverlayEntry[] = [];
      let imageEntries: DeltaOverlayEntry[] | null = needImages ? [] : null;
      const distinctIds = [...alertIds];

      if (distinctIds.length > 0) {
        for (let i = 0; i < distinctIds.length; i += GET_ALL_CHUNK) {
          const refs = distinctIds
            .slice(i, i + GET_ALL_CHUNK)
            .map((id) => db.collection(FIRESTORE_COLLECTIONS.alerts).doc(id));
          if (metrics) metrics.overlayDocumentReads += refs.length;
          const alertDocs = await db.getAll(...refs, { fieldMask: ["vector_text"] });
          for (const doc of alertDocs) {
            if (!doc.exists) continue;
            const vec = extractVectorArray(doc.get("vector_text"));
            const unitVector = vec ? normalizeUnitVectorF64(vec, TEXT_VECTOR_DIMS) : null;
            if (unitVector) {
              textEntries.push({
                docId: doc.id,
                alertId: doc.id,
                unitVector,
              });
            }
          }
        }

        if (needImages) {
          imageEntries = [];
          for (let i = 0; i < distinctIds.length; i += IN_QUERY_CHUNK) {
            const chunk = distinctIds.slice(i, i + IN_QUERY_CHUNK);
            const imgSnap = await db
              .collection(FIRESTORE_COLLECTIONS.alertImages)
              .where("alertId", "in", chunk)
              .select("alertId", "imageUrl", "vector_image")
              .get();
            if (metrics) metrics.overlayImageDocuments += imgSnap.size;
            for (const doc of imgSnap.docs) {
              const alertId = doc.get("alertId");
              const imageUrl = doc.get("imageUrl");
              const vec = extractVectorArray(doc.get("vector_image"));
              const unitVector = vec ? normalizeUnitVectorF64(vec, IMAGE_VECTOR_DIMS) : null;
              if (typeof alertId === "string" && alertId && unitVector) {
                imageEntries.push({
                  docId: doc.id,
                  alertId,
                  imageUrl: typeof imageUrl === "string" ? imageUrl : "",
                  unitVector,
                });
              }
            }
          }
        }
      }

      const state: OverlayCacheState = {
        snapshotId: manifest.snapshotId,
        coveredThrough: manifest.coveredThrough,
        refreshedAtMs: Date.now(),
        readThrough: changeSnap.readTime,
        stale: false,
        supersededAlertIds: alertIds,
        textEntries,
        imageEntries,
      };
      return state;
    } finally {
      pendingOverlayLoad = null;
    }
  })();

  return pendingOverlayLoad;
}

export async function searchSafetyGateSnapshot(
  channel: ChannelName,
  queryVector: number[],
  limit: number,
  maxDistance: number,
  options?: SnapshotSearchOptions,
): Promise<SnapshotSearchHit[] | null> {
  const started = performance.now();
  const metrics: SnapshotSearchMetrics = {
    elapsedMs: 0, scanElapsedMs: 0, scannedRows: 0, candidateRows: 0,
    exactDocumentReads: 0, manifestReads: 0, journalQueries: 0, journalDocuments: 0,
    overlayDocumentReads: 0, overlayImageDocuments: 0, gcsDownloads: 0, gcsBytes: 0, usedSnapshot: false,
  };
  const fallback = (reason: string) => { metrics.fallbackReason = reason; return null; };
  try {
    if (!isVectorSnapshotEnabled()) return fallback("disabled");
    if (!Number.isInteger(limit) || limit < 1 || !Number.isFinite(maxDistance)) return fallback("invalid_query");
    if (typeof ensureDefaultFirebaseApp === "function") ensureDefaultFirebaseApp();
    const db = getFirestore();
    const manifest = await loadManifest(db, metrics);
    if (!manifest) return fallback("missing_or_legacy_manifest");
    const [snapshot, overlay] = await Promise.all([
      loadChannelSnapshot(manifest, channel, metrics),
      loadDeltaOverlay(db, manifest, channel === "image", metrics),
    ]);
    if (!snapshot || !overlay || overlay.stale || !overlay.readThrough) return fallback("unavailable_or_stale_overlay");
    const entries = channel === "text" ? overlay.textEntries : overlay.imageEntries ?? [];
    metrics.scannedRows = snapshot.count + entries.length;
    const scanStarted = performance.now();
    const candidates = scanSnapshotTopK(snapshot, queryVector, maxDistance, 0, {
      supersededAlertIds: overlay.supersededAlertIds, entries,
    });
    metrics.scanElapsedMs = performance.now() - scanStarted;
    if (candidates === null) return fallback("uncertain_quantization");
    metrics.candidateRows = candidates.length;
    const collectionName = channel === "text" ? FIRESTORE_COLLECTIONS.alerts : FIRESTORE_COLLECTIONS.alertImages;
    const vectorField = channel === "text" ? "vector_text" : "vector_image";
    const exactHits: SnapshotSearchHit[] = [];
    const compare = (a: SnapshotSearchHit, b: SnapshotSearchHit) => a.distance - b.distance || compareUtf8Ids(a.id, b.id);
    let offset = 0;
    while (offset < candidates.length) {
      // Strictly greater only: an exact-distance tie may change UTF-8 ID ordering.
      const threshold = exactHits.length >= limit ? Math.min(maxDistance, exactHits[limit - 1].distance) : maxDistance;
      if (candidates[offset].lowerBound > threshold) break;
      if (metrics.exactDocumentReads >= MAX_EXACT_HYDRATION_ROWS) return fallback("exact_hydration_budget");
      const maxBatchSize = Math.min(
        Math.max(limit, 24),
        GET_ALL_CHUNK,
        MAX_EXACT_HYDRATION_ROWS - metrics.exactDocumentReads,
      );
      let batchEnd = offset;
      while (
        batchEnd < candidates.length &&
        batchEnd - offset < maxBatchSize &&
        candidates[batchEnd].lowerBound <= threshold
      ) {
        batchEnd++;
      }
      if (batchEnd === offset) break;
      const batch = candidates.slice(offset, batchEnd);
      offset += batch.length;
      metrics.exactDocumentReads += batch.length;
      const docs = await db.getAll(...batch.map(hit => db.collection(collectionName).doc(hit.docId)));
      for (const doc of docs) {
        if (!doc.exists) continue;
        const data = doc.data() as Record<string, unknown> | undefined;
        const storedVector = data && extractVectorArray(data[vectorField]);
        if (!data || !storedVector) continue;
        const distance = exactCosineDistance(queryVector, storedVector);
        if (distance !== null && distance <= maxDistance) exactHits.push({ id: doc.id, data, distance });
      }
      exactHits.sort(compare);
      if (exactHits.length > limit) exactHits.length = limit;
    }
    // If source facts changed while scanning/hydrating, use authoritative KNN.
    // This also protects the no-hit path; it must never return a cached negative.
    metrics.journalQueries++;
    const intervening = await db.collection("rapex_changes").where("changedAt", ">", overlay.readThrough).limit(1).get();
    metrics.journalDocuments += intervening.size;
    if (!intervening.empty) return fallback("source_changed_during_search");
    metrics.usedSnapshot = true;
    return exactHits;
  } catch (error) {
    logger.warn("Vector snapshot retrieval failed; falling back to Firestore KNN", {
      channel, error: error instanceof Error ? error.message : String(error),
    });
    return fallback("error");
  } finally {
    metrics.elapsedMs = performance.now() - started;
    try { options?.onMetrics?.(metrics); } catch { /* Diagnostics must not affect a safety result. */ }
  }
}

async function buildAndUploadTextChannel(
  db: Firestore,
  bucketName: string,
  snapshotId: string,
): Promise<{ objectPath: string; count: number; sha256: string; bytes: number }> {
  const rows: SerializedRow[] = [];
  const query = db
    .collection(FIRESTORE_COLLECTIONS.alerts)
    .select("vector_text")
    .orderBy(FieldPath.documentId())
    .limit(PAGINATION_LIMIT);

  let page = await query.get();
  while (!page.empty) {
    for (const doc of page.docs) {
      const vec = extractVectorArray(doc.get("vector_text"));
      if (vec && vec.length === TEXT_VECTOR_DIMS) {
        const quantized = quantizeUnitVector(vec, TEXT_VECTOR_DIMS);
        if (!quantized) throw new Error(`Cannot safely snapshot text vector ${doc.id}`);
        rows.push({
          docId: doc.id,
          scale: quantized.scale,
          quantized: quantized.quantized,
        });
      }
    }
    if (page.size < PAGINATION_LIMIT) {
      break;
    }
    const last = page.docs[page.docs.length - 1];
    page = await query.startAfter(last).get();
  }

  const buf = serializeSnapshotRows(rows, TEXT_VECTOR_DIMS, 0);
  const count = buf.readUInt32LE(8);
  const sha256 = sha256Hex(buf);
  const bytes = buf.byteLength;
  const objectPath = `snapshots/${snapshotId}/text.sgvs`;

  rows.length = 0;

  await getStorage()
    .bucket(bucketName)
    .file(objectPath)
    .save(buf, {
      resumable: buf.byteLength > 5 * 1024 * 1024,
      contentType: "application/octet-stream",
      metadata: { cacheControl: "public, max-age=31536000, immutable" },
    });

  return { objectPath, count, sha256, bytes };
}

async function buildAndUploadImageChannel(
  db: Firestore,
  bucketName: string,
  snapshotId: string,
): Promise<{ objectPath: string; count: number; sha256: string; bytes: number }> {
  const rows: SerializedRow[] = [];
  const query = db
    .collection(FIRESTORE_COLLECTIONS.alertImages)
    .select("alertId", "imageUrl", "vector_image")
    .orderBy(FieldPath.documentId())
    .limit(PAGINATION_LIMIT);

  let page = await query.get();
  while (!page.empty) {
    for (const doc of page.docs) {
      const vec = extractVectorArray(doc.get("vector_image"));
      const alertId = doc.get("alertId");
      const imageUrl = doc.get("imageUrl");
      if (vec && vec.length === IMAGE_VECTOR_DIMS && typeof alertId === "string" && alertId) {
        const quantized = quantizeUnitVector(vec, IMAGE_VECTOR_DIMS);
        if (!quantized) throw new Error(`Cannot safely snapshot image vector ${doc.id}`);
        rows.push({
          docId: doc.id,
          alertId,
          imageUrl: typeof imageUrl === "string" ? imageUrl : "",
          scale: quantized.scale,
          quantized: quantized.quantized,
        });
      }
    }
    if (page.size < PAGINATION_LIMIT) {
      break;
    }
    const last = page.docs[page.docs.length - 1];
    page = await query.startAfter(last).get();
  }

  const buf = serializeSnapshotRows(rows, IMAGE_VECTOR_DIMS, 1);
  const count = buf.readUInt32LE(8);
  const sha256 = sha256Hex(buf);
  const bytes = buf.byteLength;
  const objectPath = `snapshots/${snapshotId}/image.sgvs`;

  rows.length = 0;

  await getStorage()
    .bucket(bucketName)
    .file(objectPath)
    .save(buf, {
      resumable: buf.byteLength > 5 * 1024 * 1024,
      contentType: "application/octet-stream",
      metadata: { cacheControl: "public, max-age=31536000, immutable" },
    });

  return { objectPath, count, sha256, bytes };
}

async function publishManifest(
  db: Firestore,
  manifest: VectorSnapshotManifest,
  expectedUpdateTime: Timestamp | null,
): Promise<void> {
  // Each immutable manifest is retained for rollback. Firestore is the sole
  // authoritative pointer; a shared GCS manifest.json would race other writers.
  await getStorage().bucket(manifest.bucket).file(`snapshots/${manifest.snapshotId}/manifest.json`).save(JSON.stringify(manifest, null, 2), {
    resumable: false, contentType: "application/json", metadata: { cacheControl: "private, max-age=31536000, immutable" },
  });
  const ref = db.collection(FIRESTORE_COLLECTIONS.meta).doc(VECTOR_SNAPSHOT_META_DOC);
  await db.runTransaction(async transaction => {
    const current = await transaction.get(ref);
    const unchanged = expectedUpdateTime === null ? !current.exists : Boolean(current.updateTime?.isEqual(expectedUpdateTime));
    if (!unchanged) throw new Error("Vector snapshot manifest changed during build; retry from the current manifest");
    transaction.set(ref, manifest);
  });
  resetVectorSnapshotCacheForTests();
}

export async function buildFullVectorSnapshot(options?: {
  bucketName?: string;
}): Promise<VectorSnapshotManifest> {
  if (typeof ensureDefaultFirebaseApp === "function") ensureDefaultFirebaseApp();
  const db = getFirestore();
  const bucketName = getVectorSnapshotBucketName(options?.bucketName);

  const priorManifest = await db.collection(FIRESTORE_COLLECTIONS.meta).doc(VECTOR_SNAPSHOT_META_DOC).get();
  // Capture authoritative server readTime BEFORE streaming vectors so any
  // concurrent update during the build stays in the delta overlay window.
  const anchorSnap = await db
    .collection(FIRESTORE_COLLECTIONS.meta)
    .doc(FIRESTORE_COLLECTIONS.loaderStateDoc)
    .get();
  const coveredThrough = anchorSnap.readTime.toDate().toISOString();
  const builtAt = new Date().toISOString();
  const snapshotId = `${builtAt.replace(/[:.]/g, "-")}-${randomUUID()}`;

  const textMeta = await buildAndUploadTextChannel(db, bucketName, snapshotId);
  const imageMeta = await buildAndUploadImageChannel(db, bucketName, snapshotId);

  const manifest: VectorSnapshotManifest = {
    version: 1,
    coveragePolicyVersion: VECTOR_SNAPSHOT_COVERAGE_POLICY,
    snapshotId,
    builtAt,
    coveredThrough,
    bucket: bucketName,
    textObject: textMeta.objectPath,
    textCount: textMeta.count,
    textDims: TEXT_VECTOR_DIMS,
    textSha256: textMeta.sha256,
    textBytes: textMeta.bytes,
    imageObject: imageMeta.objectPath,
    imageCount: imageMeta.count,
    imageDims: IMAGE_VECTOR_DIMS,
    imageSha256: imageMeta.sha256,
    imageBytes: imageMeta.bytes,
  };

  await publishManifest(db, manifest, priorManifest.updateTime || null);
  return manifest;
}

async function patchAndUploadSingleChannel(
  bucketName: string,
  oldObjectPath: string,
  newObjectPath: string,
  dims: number,
  flags: 0 | 1,
  upserts: readonly SnapshotRecord[],
  deleteDocIds: ReadonlySet<string>,
  supersededAlertIds: ReadonlySet<string>,
  expectedSha256: string,
): Promise<{ objectPath: string; count: number; sha256: string; bytes: number }> {
  const patchedBuf = await (async () => {
    const [baseBuf] = await getStorage().bucket(bucketName).file(oldObjectPath).download();
    if (sha256Hex(baseBuf) !== expectedSha256) throw new Error("Cannot patch a snapshot with a mismatched checksum");
    const decoded = decodeVectorSnapshot(baseBuf, dims, flags);
    return patchDecodedSnapshot(decoded, upserts, deleteDocIds, supersededAlertIds);
  })();
  const count = patchedBuf.readUInt32LE(8);
  const sha256 = sha256Hex(patchedBuf);
  const bytes = patchedBuf.byteLength;

  await getStorage()
    .bucket(bucketName)
    .file(newObjectPath)
    .save(patchedBuf, {
      resumable: patchedBuf.byteLength > 5 * 1024 * 1024,
      contentType: "application/octet-stream",
      metadata: { cacheControl: "public, max-age=31536000, immutable" },
    });

  return { objectPath: newObjectPath, count, sha256, bytes };
}

export async function patchVectorSnapshotIncremental(
  delta: {
    textUpserts: SnapshotRecord[];
    imageUpserts: SnapshotRecord[];
    deletedImageDocIds: string[];
    coveredThrough: Date;
  },
  options?: { bucketName?: string },
): Promise<VectorSnapshotManifest | null> {
  if (typeof ensureDefaultFirebaseApp === "function") ensureDefaultFirebaseApp();
  const db = getFirestore();
  const manifestSnap = await db
    .collection(FIRESTORE_COLLECTIONS.meta)
    .doc(VECTOR_SNAPSHOT_META_DOC)
    .get();
  if (!manifestSnap.exists) {
    logger.warn("Skipping incremental vector snapshot patch: no manifest found");
    return null;
  }

  const current = parseManifestData(manifestSnap.data() as Record<string, unknown> | undefined);
  if (!current) {
    logger.warn("Skipping incremental vector snapshot patch: manifest is invalid");
    return null;
  }

  // Replay the complete journal interval, not just successful embeddings from
  // this loader invocation. A previous failed patch must never become invisible.
  const through = Timestamp.fromDate(manifestSnap.readTime.toDate());
  if (through.toMillis() < Date.parse(current.coveredThrough)) {
    return current;
  }
  const changedIds = new Set(delta.textUpserts.map(row => row.docId));
  for (const row of delta.imageUpserts) if (row.alertId) changedIds.add(row.alertId);
  const changesQuery = db.collection("rapex_changes")
    .where("changedAt", ">", Timestamp.fromDate(new Date(current.coveredThrough)))
    .where("changedAt", "<=", through).orderBy("changedAt").limit(PAGINATION_LIMIT);
  let changes = await changesQuery.get();
  let replayed = 0;
  while (!changes.empty) {
    replayed += changes.size;
    if (replayed > MAX_PATCH_JOURNAL_CHANGES) throw new Error("Snapshot journal replay exceeds patch budget; a full vector snapshot is required");
    for (const doc of changes.docs) {
      const id = doc.get("alertId");
      if (typeof id !== "string" || !id.trim()) throw new Error("Invalid snapshot journal alert ID");
      changedIds.add(id.trim());
    }
    if (changes.size < PAGINATION_LIMIT) break;
    changes = await changesQuery.startAfter(changes.docs[changes.docs.length - 1]).get();
  }
  if (changedIds.size === 0 && delta.deletedImageDocIds.length === 0) {
    return current;
  }
  const textUpserts: SnapshotRecord[] = [];
  const imageUpserts: SnapshotRecord[] = [];
  const ids = [...changedIds];
  for (let i = 0; i < ids.length; i += GET_ALL_CHUNK) {
    const refs = ids.slice(i, i + GET_ALL_CHUNK).map(id => db.collection(FIRESTORE_COLLECTIONS.alerts).doc(id));
    const docs = await db.getAll(...refs, { fieldMask: ["vector_text"] });
    for (const doc of docs) {
      if (!doc.exists) continue;
      const vector = extractVectorArray(doc.get("vector_text"));
      if (!vector || !quantizeUnitVector(vector, TEXT_VECTOR_DIMS)) throw new Error("Changed source lacks a valid text vector; snapshot checkpoint retained");
      textUpserts.push({ docId: doc.id, vector });
    }
  }
  for (let i = 0; i < ids.length; i += IN_QUERY_CHUNK) {
    const docs = await db.collection(FIRESTORE_COLLECTIONS.alertImages).where("alertId", "in", ids.slice(i, i + IN_QUERY_CHUNK)).select("alertId", "imageUrl", "vector_image").get();
    for (const doc of docs.docs) {
      const vector = extractVectorArray(doc.get("vector_image"));
      const alertId = doc.get("alertId");
      if (!vector || !quantizeUnitVector(vector, IMAGE_VECTOR_DIMS) || typeof alertId !== "string") throw new Error("Changed source lacks a valid image vector; snapshot checkpoint retained");
      imageUpserts.push({ docId: doc.id, alertId, imageUrl: String(doc.get("imageUrl") || ""), vector });
    }
  }
  const bucketName = getVectorSnapshotBucketName(options?.bucketName || current.bucket);
  const builtAt = new Date().toISOString();
  const snapshotId = `${builtAt.replace(/[:.]/g, "-")}-${randomUUID()}`;
  const textMeta = changedIds.size ? await patchAndUploadSingleChannel(bucketName, current.textObject, `snapshots/${snapshotId}/text.sgvs`, TEXT_VECTOR_DIMS, 0, textUpserts, new Set(), changedIds, current.textSha256) : { objectPath: current.textObject, count: current.textCount, sha256: current.textSha256, bytes: current.textBytes };
  const imageMeta = changedIds.size || delta.deletedImageDocIds.length ? await patchAndUploadSingleChannel(bucketName, current.imageObject, `snapshots/${snapshotId}/image.sgvs`, IMAGE_VECTOR_DIMS, 1, imageUpserts, new Set(delta.deletedImageDocIds), changedIds, current.imageSha256) : { objectPath: current.imageObject, count: current.imageCount, sha256: current.imageSha256, bytes: current.imageBytes };
  const updatedManifest: VectorSnapshotManifest = {
    version: 1, coveragePolicyVersion: VECTOR_SNAPSHOT_COVERAGE_POLICY,
    snapshotId, builtAt, coveredThrough: through.toDate().toISOString(), bucket: bucketName,
    textObject: textMeta.objectPath, textCount: textMeta.count, textDims: TEXT_VECTOR_DIMS, textSha256: textMeta.sha256, textBytes: textMeta.bytes,
    imageObject: imageMeta.objectPath, imageCount: imageMeta.count, imageDims: IMAGE_VECTOR_DIMS, imageSha256: imageMeta.sha256, imageBytes: imageMeta.bytes,
  };
  await publishManifest(db, updatedManifest, manifestSnap.updateTime || null);
  return updatedManifest;
}
