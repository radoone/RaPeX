import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { checkProductSafety, shopifyProductToProductData } from "../services/safety-gate-checker.server";

/**
 * Webhook handler for product creation
 * Automatically checks new products against Safety Gate database
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, topic, shop } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    const product = payload as any;

    // Convert Shopify product to format needed for Safety Gate checking
    const productData = shopifyProductToProductData(product);

    console.log(`Checking product safety for: ${productData.name}`);

    // Check product against Safety Gate database
    const safetyResult = await checkProductSafety(productData);

    // If product is not safe, create alert record
    if (!safetyResult.isSafe && safetyResult.warnings.length > 0) {
      console.log(`⚠️ UNSAFE PRODUCT DETECTED: ${productData.name}`, {
        warningsCount: safetyResult.warnings.length,
        highestRisk: Math.max(...safetyResult.warnings.map(w =>
          w.riskLevel === 'serious' ? 4 :
          w.riskLevel === 'high' ? 3 :
          w.riskLevel === 'medium' ? 2 : 1
        ))
      });

      // Store safety alert in database
      await db.safetyAlert.create({
        data: {
          productId: product.id.toString(),
          productTitle: product.title,
          productHandle: product.handle,
          shop: shop,
          checkResult: JSON.stringify(safetyResult),
          status: 'active',
          riskLevel: safetyResult.warnings[0]?.riskLevel || 'unknown',
          warningsCount: safetyResult.warnings.length,
        },
      });

      // TODO: Send notification to admin (email, Slack, etc.)
      console.log(`🚨 Alert created for unsafe product: ${product.title}`);

    } else {
      console.log(`✅ Product is safe: ${productData.name}`);

      // Store successful check record for reporting
      await db.safetyCheck.create({
        data: {
          productId: product.id.toString(),
          productTitle: product.title,
          shop: shop,
          isSafe: true,
          checkedAt: new Date(safetyResult.checkedAt),
        },
      });
    }

  } catch (error) {
    console.error(`Error processing product creation webhook:`, error);

    // Log the error but don't fail the webhook - Shopify might retry
    await db.webhookError.create({
      data: {
        shop: shop,
        topic: topic,
        error: error instanceof Error ? error.message : 'Unknown error',
        payload: JSON.stringify(payload),
      },
    }).catch(dbError => {
      console.error('Failed to log webhook error to database:', dbError);
    });
  }

  return new Response(null, { status: 200 });
};
