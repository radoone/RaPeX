import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../merchant-db.server";
import {
  checkProductSafety,
  getSimilarityThresholdForShop,
  shopifyProductToProductData,
  upsertMerchantProductForMonitoring,
} from "../services/safety-gate-checker.server";
import { handleAutoDraftAndNotifications } from "../services/safety-gate-notifications.server";

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
    const similarityThreshold = await getSimilarityThresholdForShop(shop);

    await upsertMerchantProductForMonitoring({
      shop,
      productId: product.id.toString(),
      productTitle: product.title,
      productHandle: product.handle || undefined,
      product: productData,
      sourceUpdatedAt: product.updated_at || product.updatedAt || undefined,
    });

    console.log(`Checking product safety for: ${productData.name}`);

    // Check product against Safety Gate database
    const safetyResult = await checkProductSafety(productData, similarityThreshold, {
      shop,
      productId: product.id.toString(),
      sourceUpdatedAt: product.updated_at || product.updatedAt || undefined,
    });

    await db.safetyCheck.create({
      data: {
        productId: product.id.toString(),
        productTitle: product.title,
        shop: shop,
        isSafe: safetyResult.isSafe,
        checkedAt: new Date(safetyResult.checkedAt),
      },
    });

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
      // Risk level is stored in alertDetails.fields.alert_level from Safety Gate API
      const firstWarning = safetyResult.warnings[0];
      const riskLevel = firstWarning?.alertDetails?.fields?.alert_level ||
                        firstWarning?.alertDetails?.fields?.risk_level ||
                        firstWarning?.riskLevel ||
                        'unknown';
      
      await db.safetyAlert.create({
        data: {
          productId: product.id.toString(),
          productTitle: product.title,
          productHandle: product.handle,
          shop: shop,
          checkResult: JSON.stringify(safetyResult),
          status: 'active',
          riskLevel,
          warningsCount: safetyResult.warnings.length,
        },
      });

      // Log webhook automatic quarantine/unsafe event
      await db.activityLog.create({
        data: {
          shop,
          type: "automatic",
          action: "quarantine",
          details: `Webhook detected unsafe product "${product.title}" (${safetyResult.warnings.length} matches).`
        }
      });

      // Run auto-draft and notification flow asynchronously
      handleAutoDraftAndNotifications(shop, product.id.toString(), safetyResult).catch(err => {
        console.error("Failed executing webhook notifications:", err);
      });

      console.log(`🚨 Alert created for unsafe product: ${product.title}`);

    } else {
      console.log(`✅ Product is safe: ${productData.name}`);

      // Log webhook check success
      await db.activityLog.create({
        data: {
          shop,
          type: "automatic",
          action: "check",
          details: `Webhook successfully verified product "${product.title}" as safe.`
        }
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
