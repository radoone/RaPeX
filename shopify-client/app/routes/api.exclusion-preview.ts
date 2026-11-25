import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getCachedCatalogProducts } from "../services/catalog-products-cache.server";
import { exclusionPreview } from "../services/exclusion-preview";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const vendors = url.searchParams.get("vendors") || "";
  const types = url.searchParams.get("types") || "";
  const catalog = await getCachedCatalogProducts(session.shop, admin);
  const excluded = exclusionPreview(
    catalog.map((product) => ({
      id: product.id,
      title: product.title,
      vendor: product.vendor || "",
      productType: product.productType || "",
    })),
    vendors,
    types,
  );
  return Response.json({
    total: catalog.length,
    excludedCount: excluded.length,
    sample: excluded.slice(0, 10).map(({ id, title }) => ({ id, title })),
  });
};
