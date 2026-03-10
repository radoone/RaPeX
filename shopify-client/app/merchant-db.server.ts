import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { firestore } from "./firestore.server";

type SortOrder = "asc" | "desc";

type PrimitiveWhere =
  | string
  | number
  | boolean
  | null
  | {
      in?: unknown[];
      contains?: string;
    };

type WhereClause = Record<string, PrimitiveWhere | undefined>;
type SelectClause = Record<string, boolean>;

type FindManyOptions = {
  where?: WhereClause;
  orderBy?: Record<string, SortOrder>;
  skip?: number;
  take?: number;
  select?: SelectClause;
  distinct?: string[];
};

type CountOptions = {
  where?: WhereClause;
};

type CreateOptions<T> = {
  data: T;
};

type UpdateOptions<T> = {
  where: { id: string };
  data: Partial<T>;
};

type DeleteManyOptions = {
  where?: WhereClause;
};

type UpsertOptions<T> = {
  where: { shop: string };
  update: Partial<T>;
  create: T;
};

type FindUniqueOptions = {
  where: { shop: string };
};

type SafetyAlertRecord = {
  id: string;
  productId: string;
  productTitle: string;
  productHandle?: string;
  shop: string;
  checkResult: string;
  status: string;
  riskLevel: string;
  warningsCount: number;
  createdAt: Date;
  updatedAt: Date;
  dismissedAt?: Date | null;
  dismissedBy?: string | null;
  resolvedAt?: Date | null;
  resolutionType?: string | null;
  notes?: string | null;
};

type SafetyCheckRecord = {
  id: string;
  productId: string;
  productTitle: string;
  shop: string;
  isSafe: boolean;
  checkedAt: Date;
  createdAt: Date;
};

type WebhookErrorRecord = {
  id: string;
  shop: string;
  topic: string;
  error: string;
  payload: string;
  createdAt: Date;
};

type SafetySettingRecord = {
  id: string;
  shop: string;
  similarityThreshold: number;
  createdAt: Date;
  updatedAt: Date;
};

const COLLECTIONS = {
  safetyAlert: "merchant_alerts",
  safetyCheck: "merchant_checks",
  webhookError: "merchant_webhook_errors",
  safetySetting: "merchant_settings",
  merchantProduct: "merchant_products",
  merchantMonitorState: "merchant_monitor_state",
} as const;

function encodeShopKey(shop: string): string {
  return encodeURIComponent(shop);
}

function normalizeDate(value: unknown): Date | undefined {
  if (value instanceof Date) {
    return value;
  }

  if (value && typeof value === "object" && "toDate" in (value as any)) {
    const result = (value as Timestamp).toDate();
    return result;
  }

  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return undefined;
}

function sanitizeForFirestore(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (value instanceof Date || value instanceof Timestamp || value instanceof FieldValue) {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => sanitizeForFirestore(entry))
      .filter((entry) => entry !== undefined);
  }

  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      const sanitized = sanitizeForFirestore(nestedValue);
      if (sanitized !== undefined) {
        output[key] = sanitized;
      }
    }
    return output;
  }

  return value;
}

function applySelect<T extends Record<string, unknown>>(record: T, select?: SelectClause): any {
  if (!select) {
    return record;
  }

  const selected: Record<string, unknown> = {};
  for (const [key, enabled] of Object.entries(select)) {
    if (enabled) {
      selected[key] = record[key];
    }
  }
  return selected;
}

function matchesWhere(record: Record<string, unknown>, where?: WhereClause): boolean {
  if (!where) {
    return true;
  }

  for (const [field, condition] of Object.entries(where)) {
    if (condition === undefined) {
      continue;
    }

    const value = record[field];

    if (condition && typeof condition === "object" && !Array.isArray(condition)) {
      if (Array.isArray((condition as any).in)) {
        const allowed = (condition as any).in as unknown[];
        if (!allowed.includes(value)) {
          return false;
        }
        continue;
      }

      if (typeof (condition as any).contains === "string") {
        const source = String(value ?? "");
        if (!source.includes((condition as any).contains)) {
          return false;
        }
        continue;
      }
    }

    if (value !== condition) {
      return false;
    }
  }

  return true;
}

function sortRecords<T extends Record<string, unknown>>(records: T[], orderBy?: Record<string, SortOrder>): T[] {
  if (!orderBy) {
    return records;
  }

  const [field, direction] = Object.entries(orderBy)[0] || [];
  if (!field || !direction) {
    return records;
  }

  return [...records].sort((left, right) => {
    const leftDate = normalizeDate(left[field]);
    const rightDate = normalizeDate(right[field]);
    const leftValue = leftDate ? leftDate.getTime() : (left[field] as any);
    const rightValue = rightDate ? rightDate.getTime() : (right[field] as any);

    if (leftValue === rightValue) {
      return 0;
    }

    if (direction === "desc") {
      return leftValue > rightValue ? -1 : 1;
    }

    return leftValue > rightValue ? 1 : -1;
  });
}

function applyDistinct<T extends Record<string, unknown>>(records: T[], fields?: string[]): T[] {
  if (!fields || fields.length === 0) {
    return records;
  }

  const seen = new Set<string>();
  const distinctRecords: T[] = [];

  for (const record of records) {
    const key = fields.map((field) => String(record[field] ?? "")).join("::");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    distinctRecords.push(record);
  }

  return distinctRecords;
}

async function loadCollectionByShop(
  collectionName: string,
  where?: WhereClause,
): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
  const shop = typeof where?.shop === "string" ? where.shop : undefined;
  const query = shop
    ? firestore.collection(collectionName).where("shop", "==", shop)
    : firestore.collection(collectionName);
  const snapshot = await query.get();

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    data: doc.data() as Record<string, unknown>,
  }));
}

function convertSafetyAlert(id: string, data: Record<string, unknown>): SafetyAlertRecord {
  return {
    id,
    productId: String(data.productId || ""),
    productTitle: String(data.productTitle || ""),
    productHandle: data.productHandle ? String(data.productHandle) : undefined,
    shop: String(data.shop || ""),
    checkResult: String(data.checkResult || ""),
    status: String(data.status || "active"),
    riskLevel: String(data.riskLevel || "Unknown"),
    warningsCount: Number(data.warningsCount || 0),
    createdAt: normalizeDate(data.createdAt) || new Date(0),
    updatedAt: normalizeDate(data.updatedAt) || new Date(0),
    dismissedAt: normalizeDate(data.dismissedAt) || null,
    dismissedBy: data.dismissedBy ? String(data.dismissedBy) : null,
    resolvedAt: normalizeDate(data.resolvedAt) || null,
    resolutionType: data.resolutionType ? String(data.resolutionType) : null,
    notes: data.notes ? String(data.notes) : null,
  };
}

function convertSafetyCheck(id: string, data: Record<string, unknown>): SafetyCheckRecord {
  return {
    id,
    productId: String(data.productId || ""),
    productTitle: String(data.productTitle || ""),
    shop: String(data.shop || ""),
    isSafe: Boolean(data.isSafe),
    checkedAt: normalizeDate(data.checkedAt) || new Date(0),
    createdAt: normalizeDate(data.createdAt) || new Date(0),
  };
}

function convertWebhookError(id: string, data: Record<string, unknown>): WebhookErrorRecord {
  return {
    id,
    shop: String(data.shop || ""),
    topic: String(data.topic || ""),
    error: String(data.error || ""),
    payload: String(data.payload || ""),
    createdAt: normalizeDate(data.createdAt) || new Date(0),
  };
}

const safetyAlert = {
  async findMany(options: FindManyOptions = {}): Promise<any[]> {
    const loaded = await loadCollectionByShop(COLLECTIONS.safetyAlert, options.where);
    let records = loaded
      .map((entry) => convertSafetyAlert(entry.id, entry.data))
      .filter((record) => matchesWhere(record as unknown as Record<string, unknown>, options.where));

    records = sortRecords(records, options.orderBy);
    records = applyDistinct(records, options.distinct);

    const skip = options.skip || 0;
    const take = typeof options.take === "number" ? options.take : records.length;
    const sliced = records.slice(skip, skip + take);

    return sliced.map((record) => applySelect(record as unknown as Record<string, unknown>, options.select));
  },

  async findFirst(options: FindManyOptions = {}): Promise<any | null> {
    const rows = await safetyAlert.findMany({ ...options, take: 1 });
    return rows[0] ?? null;
  },

  async count(options: CountOptions = {}): Promise<number> {
    const rows = await safetyAlert.findMany({ where: options.where });
    return rows.length;
  },

  async create(options: CreateOptions<Omit<SafetyAlertRecord, "id" | "createdAt" | "updatedAt">>): Promise<SafetyAlertRecord> {
    const now = new Date();
    const payload = sanitizeForFirestore({
      ...options.data,
      createdAt: now,
      updatedAt: now,
    }) as Record<string, unknown>;
    const ref = await firestore.collection(COLLECTIONS.safetyAlert).add(payload);
    return convertSafetyAlert(ref.id, payload);
  },

  async update(options: UpdateOptions<SafetyAlertRecord>): Promise<SafetyAlertRecord> {
    const ref = firestore.collection(COLLECTIONS.safetyAlert).doc(options.where.id);
    const payload = sanitizeForFirestore({
      ...options.data,
      updatedAt: new Date(),
    }) as Record<string, unknown>;
    await ref.set(payload, { merge: true });
    const snapshot = await ref.get();
    return convertSafetyAlert(snapshot.id, (snapshot.data() || {}) as Record<string, unknown>);
  },

  async deleteMany(options: DeleteManyOptions = {}): Promise<{ count: number }> {
    const rows = await safetyAlert.findMany({ where: options.where });
    for (const row of rows) {
      await firestore.collection(COLLECTIONS.safetyAlert).doc(row.id).delete();
    }
    return { count: rows.length };
  },
};

const safetyCheck = {
  async findMany(options: FindManyOptions = {}): Promise<any[]> {
    const loaded = await loadCollectionByShop(COLLECTIONS.safetyCheck, options.where);
    let records = loaded
      .map((entry) => convertSafetyCheck(entry.id, entry.data))
      .filter((record) => matchesWhere(record as unknown as Record<string, unknown>, options.where));

    records = sortRecords(records, options.orderBy);
    records = applyDistinct(records, options.distinct);

    const skip = options.skip || 0;
    const take = typeof options.take === "number" ? options.take : records.length;
    const sliced = records.slice(skip, skip + take);
    return sliced.map((record) => applySelect(record as unknown as Record<string, unknown>, options.select));
  },

  async count(options: CountOptions = {}): Promise<number> {
    const rows = await safetyCheck.findMany({ where: options.where });
    return rows.length;
  },

  async create(options: CreateOptions<Omit<SafetyCheckRecord, "id" | "createdAt">>): Promise<SafetyCheckRecord> {
    const now = new Date();
    const payload = sanitizeForFirestore({
      ...options.data,
      createdAt: now,
    }) as Record<string, unknown>;
    const ref = await firestore.collection(COLLECTIONS.safetyCheck).add(payload);
    return convertSafetyCheck(ref.id, payload);
  },

  async deleteMany(options: DeleteManyOptions = {}): Promise<{ count: number }> {
    const rows = await safetyCheck.findMany({ where: options.where });
    for (const row of rows) {
      await firestore.collection(COLLECTIONS.safetyCheck).doc(row.id).delete();
    }
    return { count: rows.length };
  },
};

const webhookError = {
  async create(options: CreateOptions<Omit<WebhookErrorRecord, "id" | "createdAt">>): Promise<WebhookErrorRecord> {
    const payload = sanitizeForFirestore({
      ...options.data,
      createdAt: new Date(),
    }) as Record<string, unknown>;
    const ref = await firestore.collection(COLLECTIONS.webhookError).add(payload);
    return convertWebhookError(ref.id, payload);
  },

  async deleteMany(options: DeleteManyOptions = {}): Promise<{ count: number }> {
    const loaded = await loadCollectionByShop(COLLECTIONS.webhookError, options.where);
    const records = loaded
      .map((entry) => convertWebhookError(entry.id, entry.data))
      .filter((record) => matchesWhere(record as unknown as Record<string, unknown>, options.where));
    for (const record of records) {
      await firestore.collection(COLLECTIONS.webhookError).doc(record.id).delete();
    }
    return { count: records.length };
  },
};

const safetySetting = {
  async findUnique(options: FindUniqueOptions): Promise<SafetySettingRecord | null> {
    const ref = firestore.collection(COLLECTIONS.safetySetting).doc(encodeShopKey(options.where.shop));
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      return null;
    }
    const data = (snapshot.data() || {}) as Record<string, unknown>;
    return {
      id: snapshot.id,
      shop: String(data.shop || options.where.shop),
      similarityThreshold: Number(data.similarityThreshold || 0),
      createdAt: normalizeDate(data.createdAt) || new Date(0),
      updatedAt: normalizeDate(data.updatedAt) || new Date(0),
    };
  },

  async upsert(options: UpsertOptions<Omit<SafetySettingRecord, "id" | "createdAt" | "updatedAt">>): Promise<SafetySettingRecord> {
    const ref = firestore.collection(COLLECTIONS.safetySetting).doc(encodeShopKey(options.where.shop));
    const snapshot = await ref.get();
    const now = new Date();
    const base = snapshot.exists ? options.update : options.create;
    const payload = sanitizeForFirestore({
      ...base,
      shop: options.where.shop,
      updatedAt: now,
      createdAt: snapshot.exists ? (snapshot.data() as any)?.createdAt || now : now,
    }) as Record<string, unknown>;

    await ref.set(payload, { merge: true });
    const stored = await ref.get();
    const data = (stored.data() || {}) as Record<string, unknown>;
    return {
      id: stored.id,
      shop: String(data.shop || options.where.shop),
      similarityThreshold: Number(data.similarityThreshold || 0),
      createdAt: normalizeDate(data.createdAt) || now,
      updatedAt: normalizeDate(data.updatedAt) || now,
    };
  },

  async deleteMany(options: DeleteManyOptions = {}): Promise<{ count: number }> {
    const shop = typeof options.where?.shop === "string" ? options.where.shop : undefined;
    if (!shop) {
      return { count: 0 };
    }
    const ref = firestore.collection(COLLECTIONS.safetySetting).doc(encodeShopKey(shop));
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      return { count: 0 };
    }
    await ref.delete();
    return { count: 1 };
  },
};

export async function purgeMerchantShopData(shop: string): Promise<{
  alerts: number;
  checks: number;
  webhookErrors: number;
  settings: number;
  products: number;
  monitorState: number;
}> {
  const [alerts, checks, webhookErrors, settings] = await Promise.all([
    safetyAlert.deleteMany({ where: { shop } }),
    safetyCheck.deleteMany({ where: { shop } }),
    webhookError.deleteMany({ where: { shop } }),
    safetySetting.deleteMany({ where: { shop } }),
  ]);

  const productSnapshot = await firestore
    .collection(COLLECTIONS.merchantProduct)
    .where("shop", "==", shop)
    .get();
  for (const doc of productSnapshot.docs) {
    await doc.ref.delete();
  }

  const monitorRef = firestore.collection(COLLECTIONS.merchantMonitorState).doc(encodeShopKey(shop));
  const monitorSnapshot = await monitorRef.get();
  if (monitorSnapshot.exists) {
    await monitorRef.delete();
  }

  return {
    alerts: alerts.count,
    checks: checks.count,
    webhookErrors: webhookErrors.count,
    settings: settings.count,
    products: productSnapshot.size,
    monitorState: monitorSnapshot.exists ? 1 : 0,
  };
}

const merchantDb = {
  safetyAlert,
  safetyCheck,
  webhookError,
  safetySetting,
};

export default merchantDb;
