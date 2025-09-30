import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { checkProductSafety, shopifyProductToProductData } from "../services/safety-gate-checker.server";

/**
 * Webhook handler for product updates
 * Re-checks products against Safety Gate database when they are modified
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, topic, shop } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    const product = payload as any;

    // Convert Shopify product to format needed for Safety Gate checking
    const productData = shopifyProductToProductData(product);

    console.log(`Re-checking updated product: ${productData.name}`);

    // Check product against Safety Gate database
    const safetyResult = await checkProductSafety(productData);

    // Look for existing alerts for this product
    const existingAlert = await db.safetyAlert.findFirst({
      where: {
        productId: product.id.toString(),
        shop: shop,
        status: 'active',
      },
    });

    if (!safetyResult.isSafe && safetyResult.warnings.length > 0) {
      if (existingAlert) {
        // Update existing alert with new check result
        await db.safetyAlert.update({
          where: { id: existingAlert.id },
          data: {
            checkResult: JSON.stringify(safetyResult),
            riskLevel: safetyResult.warnings[0]?.riskLevel || 'unknown',
            warningsCount: safetyResult.warnings.length,
            updatedAt: new Date(),
          },
        });

        console.log(`🔄 Updated existing alert for: ${product.title}`);
      } else {
        // Create new alert
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

        console.log(`🚨 New alert created for updated product: ${product.title}`);
      }
    } else {
      // Product is now safe
      if (existingAlert) {
        // Mark existing alert as resolved
        await db.safetyAlert.update({
          where: { id: existingAlert.id },
          data: {
            status: 'resolved',
            resolvedAt: new Date(),
            notes: 'Product update resolved safety concerns',
          },
        });

        console.log(`✅ Alert resolved for updated product: ${product.title}`);
      }

      // Log successful check
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
    console.error(`Error processing product update webhook:`, error);

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
