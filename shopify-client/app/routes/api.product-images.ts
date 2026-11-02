import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { loadAllProductImages } from "../services/product-images.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, cors } = await authenticate.admin(request);
  const input = new URL(request.url).searchParams.get("productId") || "";
  const numericId = input.replace(/^gid:\/\/shopify\/Product\//, "");
  if (!/^\d{1,30}$/.test(numericId)) return cors(Response.json({ error: true }, { status: 400 }));
  try {
    const images = await loadAllProductImages(admin, `gid://shopify/Product/${numericId}`);
    return cors(Response.json({ productId: numericId, images: images || [], error: images === null },
      { status: images === null ? 404 : 200, headers: { "Cache-Control": "private, no-store" } }));
  } catch {
    return cors(Response.json({ productId: numericId, error: true },
      { status: 503, headers: { "Cache-Control": "private, no-store" } }));
  }
};
