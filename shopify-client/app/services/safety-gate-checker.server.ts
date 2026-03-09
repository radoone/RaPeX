import { shopifyProductToProductData, type ProductData } from "./safety-gate-checker.client";
import db from "../db.server";

// Firebase Functions API configuration
const FIREBASE_FUNCTIONS_BASE_URL = process.env.FIREBASE_FUNCTIONS_BASE_URL ||
  'https://europe-west1-rapex-99a2c.cloudfunctions.net';
const SAFETY_GATE_API_KEY = process.env.SAFETY_GATE_API_KEY || 'default-api-key';

export async function getSimilarityThresholdForShop(shop: string): Promise<number> {
  const envDefault = Number(process.env.SAFETY_GATE_SIMILARITY_THRESHOLD || '0');
  try {
    const setting = await db.safetySetting.findUnique({
      where: { shop },
    });
    if (setting && Number.isFinite(setting.similarityThreshold)) {
      return setting.similarityThreshold;
    }
  } catch (error) {
    console.error('Error fetching similarity threshold for shop', shop, error);
  }
  return Number.isFinite(envDefault) ? envDefault : 0;
}

function applySimilarityThreshold<T extends SafetyCheckResult>(result: T, threshold: number): T {
  const safeThreshold = Number.isFinite(threshold) && threshold > 0 ? threshold : 0;

  if (safeThreshold <= 0) {
    return result;
  }

  const filteredWarnings = result.warnings.filter((warning) => {
    const similarity = Number.isFinite(warning.similarity) ? warning.similarity : 0;
    return similarity >= safeThreshold;
  });

  return {
    ...result,
    warnings: filteredWarnings,
    isSafe: filteredWarnings.length === 0 ? true : result.isSafe,
  };
}

export interface SafetyCheckResult {
  isSafe: boolean;
  warnings: Array<{
    alertId: string;
    similarity: number;
    riskLevel: string;
    alertType: string;
    riskLegalProvision: string;
    reason: string;
    alertDetails: {
      meta: {
        recordid: string;
        alert_date: string;
        ingested_at: string;
      };
      fields: {
        product_category: string;
        product_description: string;
        risk_level: string;
        alert_level: string;
        alert_type: string;
        risk_legal_provision: string;
        notifying_country: string;
        product_brand?: string;
        product_model?: string;
        pictures?: string[];
      };
    };
  }>;
  recommendation: string;
  checkedAt: string;
  analysis: {
    mode: "text-only" | "with-image";
    productImagesProvided: number;
    productImagesUsed: number;
    alertImagesUsed: number;
    candidateAlertsConsidered: number;
  };
}

/**
 * Checks product safety against Safety Gate database using Firebase Functions API
 */
export async function checkProductSafety(productData: ProductData, similarityThreshold?: number): Promise<SafetyCheckResult> {
  try {
    const envDefault = Number(process.env.SAFETY_GATE_SIMILARITY_THRESHOLD || '0');
    const effectiveThreshold = Number.isFinite(similarityThreshold)
      ? similarityThreshold!
      : (Number.isFinite(envDefault) ? envDefault : 0);

    const response = await fetch(`${FIREBASE_FUNCTIONS_BASE_URL}/checkProductSafetyAPI`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': SAFETY_GATE_API_KEY,
      },
      body: JSON.stringify(productData),
    });

    if (!response.ok) {
      throw new Error(`Safety Gate API returned ${response.status}: ${response.statusText}`);
    }

    const rawResult = await response.json() as SafetyCheckResult;
    const result = applySimilarityThreshold(rawResult, effectiveThreshold);
    console.info("Safety Gate check completed", {
      product: productData.name,
      analysisMode: result.analysis?.mode,
      productImagesUsed: result.analysis?.productImagesUsed ?? 0,
      alertImagesUsed: result.analysis?.alertImagesUsed ?? 0,
      candidateAlertsConsidered: result.analysis?.candidateAlertsConsidered ?? 0,
    });
    return result;

  } catch (error) {
    console.error('Error checking product safety:', error);

    // Return safe result with error indication if the service is unavailable
    return {
      isSafe: true, // Default to safe if check fails to prevent blocking sales
      warnings: [],
      recommendation: `Unable to verify product safety against Safety Gate database. Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      checkedAt: new Date().toISOString(),
      analysis: {
        mode: "text-only",
        productImagesProvided: productData.imageUrls?.length || (productData.imageUrl ? 1 : 0),
        productImagesUsed: 0,
        alertImagesUsed: 0,
        candidateAlertsConsidered: 0,
      },
    };
  }
}

/**
 * Check multiple products at once
 */
export async function checkMultipleProducts(products: ProductData[], similarityThreshold?: number): Promise<Record<string, SafetyCheckResult>> {
  const results: Record<string, SafetyCheckResult> = {};

  // Check products in parallel (but limit concurrency to avoid overwhelming the API)
  const batchSize = 3;
  for (let i = 0; i < products.length; i += batchSize) {
    const batch = products.slice(i, i + batchSize);
    const batchPromises = batch.map(async (product) => {
      const result = await checkProductSafety(product, similarityThreshold);
      return { product, result };
    });

    const batchResults = await Promise.all(batchPromises);
    batchResults.forEach(({ product, result }) => {
      results[product.name] = result;
    });
  }

  return results;
}

/**
 * Bulk check all products in a Shopify store
 */
export async function bulkCheckProducts(admin: any, shop: string, db: any) {
  const results = {
    processed: 0,
    checked: 0,
    alertsCreated: 0,
    errors: 0,
    startTime: new Date(),
    endTime: null as Date | null,
  };

  try {
    const similarityThreshold = await getSimilarityThresholdForShop(shop);
    console.log(`🚀 Starting bulk product safety check for ${shop} (threshold ${similarityThreshold})`);

    let hasNextPage = true;
    let cursor: string | null = null;

    while (hasNextPage) {
      // GraphQL query to get products with pagination
      const productsQuery = `
        query getProducts($first: Int!, $after: String) {
          products(first: $first, after: $after) {
            edges {
              node {
                id
                title
                handle
                productType
                vendor
                tags
                description
                descriptionHtml
                featuredImage {
                  url
                  altText
                }
                images(first: 4) {
                  nodes {
                    url
                    altText
                  }
                }
                variants(first: 1) {
                  edges {
                    node {
                      id
                      title
                      selectedOptions {
                        name
                        value
                      }
                      image {
                        url
                        altText
                      }
                      price
                    }
                  }
                }
                updatedAt
                createdAt
              }
              cursor
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      `;

      const variables: { first: number; after: string | null } = {
        first: 50, // Process 50 products at a time
        after: cursor
      };

      const productsResponse: Response = await admin.graphql(productsQuery, { variables });
      const productsJson: any = await productsResponse.json();

      if (!productsJson.data?.products) {
        console.error('Failed to fetch products:', productsJson);
        throw new Error('Failed to fetch products from Shopify');
      }

      const { edges, pageInfo }: { edges: any[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } = productsJson.data.products;
      hasNextPage = pageInfo.hasNextPage;
      cursor = pageInfo.endCursor;

      // Process products in batches to avoid overwhelming the API and speed up processing
      const batchSize = 5;
      for (let i = 0; i < edges.length; i += batchSize) {
        const batch = edges.slice(i, i + batchSize);
        
        await Promise.all(batch.map(async (edge: any) => {
          const product = edge.node;
          results.processed++;

          try {
            // Convert Shopify product to Safety Gate format
            const productData = shopifyProductToProductData(product);

            // Check product safety
            const safetyResult = await checkProductSafety(productData, similarityThreshold);
            results.checked++;

            // Handle safety check results
            if (!safetyResult.isSafe && safetyResult.warnings.length > 0) {
              // Check if alert already exists
              const existingAlert = await db.safetyAlert.findFirst({
                where: {
                  productId: product.id,
                  shop: shop,
                  status: 'active',
                },
              });

              if (!existingAlert) {
                await db.safetyAlert.create({
                  data: {
                    productId: product.id,
                    productTitle: product.title,
                    productHandle: product.handle,
                    shop: shop,
                    checkResult: JSON.stringify(safetyResult),
                    status: 'active',
                    riskLevel: safetyResult.warnings[0]?.alertDetails?.fields?.alert_level ||
                               safetyResult.warnings[0]?.alertDetails?.fields?.risk_level ||
                               safetyResult.warnings[0]?.riskLevel ||
                               'Unknown',
                    warningsCount: safetyResult.warnings.length,
                  },
                });
                results.alertsCreated++;
                console.log(`🚨 Alert created for: ${product.title}`);
              }
            }

            // Always log the check
            await db.safetyCheck.create({
              data: {
                productId: product.id,
                productTitle: product.title,
                shop: shop,
                isSafe: safetyResult.isSafe,
                checkedAt: new Date(safetyResult.checkedAt),
              },
            });

          } catch (error) {
            console.error(`Error processing product ${product.title}:`, error);
            results.errors++;

            // Log error but continue processing
            await db.webhookError.create({
              data: {
                shop: shop,
                topic: 'bulk_check',
                error: error instanceof Error ? error.message : 'Unknown error',
                payload: JSON.stringify({ productId: product.id, productTitle: product.title }),
              },
            }).catch((dbError: any) => {
              console.error('Failed to log error to database:', dbError);
            });
          }
        }));

        // Small delay between batches to be respectful to the API
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    results.endTime = new Date();

    console.log(`✅ Bulk check completed for ${shop}:`, {
      processed: results.processed,
      checked: results.checked,
      alertsCreated: results.alertsCreated,
      errors: results.errors,
      duration: results.endTime.getTime() - results.startTime.getTime(),
    });

    return results;

  } catch (error) {
    console.error('Bulk check failed:', error);
    results.endTime = new Date();
    results.errors++;
    throw error;
  }
}

// Re-export the client-side function for server use
export { shopifyProductToProductData };
