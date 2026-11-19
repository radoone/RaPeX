import { checkCoversCurrentProductVersion, sameProductVersion } from "./catalog-coverage";

type Check = {
  productId?: string | null;
  sourceUpdatedAt?: string | null;
  checkedAt?: Date | string | null;
  isSafe?: boolean;
};
export function productCheckState(checks: Check[], updatedAt?: string | null) {
  const latest =
    [...checks].sort(
      (a, b) =>
        new Date(b.checkedAt || 0).getTime() -
        new Date(a.checkedAt || 0).getTime(),
    )[0] || null;
  const current =
    checks.find((check) =>
      checkCoversCurrentProductVersion(check, updatedAt),
    ) || null;
  return {
    latest,
    current,
    state: current ? "current" : latest ? "changed" : "unchecked",
  } as const;
}
export function catalogCheckStates(
  products: Array<{ id: string; updatedAt?: string | null }>,
  checks: Check[],
) {
  const byProduct = new Map<string, Check[]>();
  for (const check of checks) {
    const id = check.productId?.replace("gid://shopify/Product/", "");
    if (id) byProduct.set(id, [...(byProduct.get(id) || []), check]);
  }
  return Object.fromEntries(
    products.map((product) => {
      const id = product.id.replace("gid://shopify/Product/", "");
      return [
        id,
        productCheckState(byProduct.get(id) || [], product.updatedAt),
      ];
    }),
  );
}

export type PendingCatalogJob = {
  productId?: string;
  sourceUpdatedAt?: string;
  status?: string;
  attemptCount?: number;
  queuedAt?: number;
  startedAt?: number;
  createdAt?: number;
  updatedAt?: number;
};

export const productCheckRetryWindow = 24 * 60 * 60_000;

/** A queued check covers only the same Shopify version and current installation. */
export function pendingAutomaticProductIds(
  products: Array<{ id: string; updatedAt?: string | null }>,
  jobs: PendingCatalogJob[],
  observedAt: number,
  installationStartedAt: number,
): string[] {
  const versions = new Map(products.map(product => [
    product.id.replace("gid://shopify/Product/", ""),
    product.updatedAt,
  ]));
  const currentJobs = jobs.filter(job => {
    const started = job.createdAt ?? job.queuedAt ?? job.startedAt;
    if (!job.productId || started === undefined || started < installationStartedAt ||
      !sameProductVersion(job.sourceUpdatedAt, versions.get(job.productId))) return false;
    const age = observedAt - started;
    if (age < 0 || age >= productCheckRetryWindow) return false;

    if (job.status === "queued") return true;
    if (job.status === "retrying") return (job.attemptCount ?? 8) < 8;
    return job.status === "processing" &&
      observedAt - (job.updatedAt ?? started) < 33 * 60_000;
  });
  return [...new Set(currentJobs.flatMap(job => job.productId ? [job.productId] : []))];
}
