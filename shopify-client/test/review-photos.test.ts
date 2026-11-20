import { describe, expect, it, vi } from "vitest";
import { fetchReviewPhotos } from "../app/services/review-photos";

describe("local review photograph refresh", () => {
  it("sends an abortable same-origin request and returns usable distinct photos", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ productId: "1", images: ["https://example.com/a.jpg", "javascript:alert(1)", "https://example.com/a.jpg"] }));
    const signal = new AbortController().signal;
    expect(await fetchReviewPhotos("1", signal, request)).toEqual(["https://example.com/a.jpg"]);
    expect(request).toHaveBeenCalledWith("/api/product-images?productId=1", { signal });
  });
  it("reports HTTP and transport failures locally so the caller can retain cached photographs", async () => {
    await expect(fetchReviewPhotos("1", new AbortController().signal, vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: true }, { status: 503 })))).rejects.toThrow();
    await expect(fetchReviewPhotos("1", new AbortController().signal, vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Offline")))).rejects.toThrow("Offline");
  });
  it("rejects responses for another product and malformed success responses", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ productId: "2", images: ["https://example.com/a.jpg"] }));
    await expect(fetchReviewPhotos("1", new AbortController().signal, request)).rejects.toThrow();
    await expect(fetchReviewPhotos("1", new AbortController().signal, vi.fn<typeof fetch>().mockResolvedValue(Response.json({ productId: "1" })))).rejects.toThrow();
  });
});
