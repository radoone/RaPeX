import type { NormalizedAlert } from "./safety-gate-checker.types.js";

export type MonitoringImage = { imageUrl: string; mediaUrl: string; vector: number[] };
export type StoredMonitoringImage = { imageUrl: string; embeddingSourceUrl?: string; vector?: number[] };

/** Shared image documents are the sole vector source; only current pictures are eligible. */
export function selectMonitoringImages(pictures: string[], stored: StoredMonitoringImage[]): MonitoringImage[] {
  const available = new Map(stored.map(image => [image.imageUrl, image]));
  return [...new Set(pictures)].flatMap(imageUrl => {
    const image = available.get(imageUrl);
    const vector = image?.vector;
    if (!vector?.length) return [];
    if (vector.length !== 1408 || vector.some(value => !Number.isFinite(value))) throw new Error("Invalid Safety Gate image vector");
    const officialThumbnail = imageUrl.replace("/notification/image/", "/notification/thumbnail/");
    const mediaUrl = image?.embeddingSourceUrl === officialThumbnail ? officialThumbnail : imageUrl;
    return [{ imageUrl, mediaUrl, vector }];
  });
}

/** Clone transient analysis evidence; never mutate the stored official alert. */
export function prioritizeMonitoringImages(alert: NormalizedAlert, matched: string[]): NormalizedAlert {
  if (!matched.length) return alert;
  const pictures = [...new Set([...matched, ...(alert.fields.pictures || [])])];
  return { ...alert, fields: { ...alert.fields, pictures, product_image: pictures[0], product_other_images: pictures.slice(1).join(",") } };
}
