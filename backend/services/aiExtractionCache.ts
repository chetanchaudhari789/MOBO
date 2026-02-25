/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * AI EXTRACTION CACHE SERVICE
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Purpose: Prevent repeated Gemini API calls for the same order proof image
 * 
 * Problem Solved:
 * ───────────────────────────────────────────────────────────────────────────────
 * Previously when a buyer uploaded order screenshot, the system would call
 * Gemini AI API:
 * 1. When buyer first submits order
 * 2. When mediator opens order for verification
 * 3. When admin views order
 * 4. When reanalyze is clicked by mediator
 * 5. When brand views order details
 * 
 * This caused:
 * - $$$$ Cost explosion (Gemini charged per API call)
 * - Slow UX (2-5s wait every time)
 * - Quota exhaustion on high traffic
 * 
 * Solution:
 * ───────────────────────────────────────────────────────────────────────────────
 * Extract ONCE when image is first uploaded → store result in database → 
 * serve cached result for all subsequent views
 * 
 * Cache Storage:
 * ───────────────────────────────────────────────────────────────────────────────
 * - Order.orderAiExtraction (JSONB) - cached extraction for order screenshot
 * - Order.paymentAiExtraction - cached payment proof extraction
 * - Order.reviewAiExtraction - cached review proof extraction  
 * - Order.ratingAiExtraction - cached rating proof extraction
 * - Order.returnWindowAiExtraction - cached return window proof extraction
 * 
 * Each includes:
 * - Full extraction result (fields, confidence, etc.)
 * - Extraction timestamp
 * - AI model used
 * - All verification details
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { prisma } from '../database/prisma.js';
import { extractOrderDetailsWithAi, verifyProofWithAi, verifyRatingScreenshotWithAi } from './aiService.js';
import type { Env } from '../config/env.js';
import { aiLog } from '../config/logger.js';

type ProofType = 'order' | 'payment' | 'review' | 'rating' | 'returnWindow';

/**
 * Get cached AI extraction for a proof type, or extract if not cached.
 *
 * NOTE: All AI service functions use the signature `(env, payload)`.
 */
export async function getOrExtractProof(params: {
  orderId: string; // mongoId
  proofType: ProofType;
  imageBase64: string;
  expectedOrderId?: string;
  expectedAmount?: number;
  expectedBuyerName?: string;
  expectedProductName?: string;
  expectedReviewerName?: string;
  env: Env;
  forceReExtract?: boolean; // Admin override to force re-extraction
}): Promise<any> {
  const {
    orderId,
    proofType,
    imageBase64,
    expectedOrderId,
    expectedAmount,
    expectedBuyerName,
    expectedProductName,
    expectedReviewerName,
    env,
    forceReExtract = false,
  } = params;

  // Field mapping
  const cacheField = `${proofType}AiExtraction` as any;
  const timestampField = `${proofType}ExtractedAt` as any;

  // Check cache first (unless forced)
  if (!forceReExtract) {
    const order = await prisma().order.findFirst({
      where: { mongoId: orderId },
      select: {
        [cacheField]: true,
        [timestampField]: true,
      },
    });

    if (order && (order as any)[cacheField]) {
      const cached = (order as any)[cacheField];
      const extractedAt = (order as any)[timestampField];
      
      aiLog.info(`AI extraction cache HIT for order ${orderId} proof ${proofType}`, {
        extractedAt,
        ageMinutes: extractedAt ? Math.round((Date.now() - new Date(extractedAt).getTime()) / 60000) : null,
      });

      return {
        ...cached,
        cached: true,
        extractedAt,
      };
    }

    aiLog.info(`AI extraction cache MISS for order ${orderId} proof ${proofType} - calling Gemini`);
  } else {
    aiLog.info(`AI extraction FORCED for order ${orderId} proof ${proofType} - bypassing cache`);
  }

  // Cache miss or forced — extract from AI
  let extraction: any;
  const startTime = Date.now();

  try {
    switch (proofType) {
      case 'order':
      case 'payment':
        if (!expectedOrderId || expectedAmount === undefined) {
          throw new Error('Order/payment proof requires expectedOrderId and expectedAmount');
        }
        extraction = await verifyProofWithAi(env, {
          imageBase64,
          expectedOrderId,
          expectedAmount,
        });
        break;

      case 'review':
        // Review verification typically uses similar logic to purchase
        if (!expectedOrderId) {
          throw new Error('Review proof requires expectedOrderId');
        }
        // For review, we just extract and validate presence of review text
        extraction = await extractOrderDetailsWithAi(env, { imageBase64 });
        break;

      case 'rating':
        if (!expectedBuyerName || !expectedProductName) {
          throw new Error('Rating proof requires expectedBuyerName and expectedProductName');
        }
        extraction = await verifyRatingScreenshotWithAi(env, {
          imageBase64,
          expectedBuyerName,
          expectedProductName,
          expectedReviewerName,
        });
        break;

      case 'returnWindow':
        // Return window extraction
        extraction = await extractOrderDetailsWithAi(env, { imageBase64 });
        break;

      default:
        throw new Error(`Unknown proof type: ${proofType}`);
    }

    const duration = Date.now() - startTime;

    // Store in cache
    await prisma().order.update({
      where: { mongoId: orderId },
      data: {
        [cacheField]: extraction as any,
        [timestampField]: new Date(),
      },
    });

    aiLog.info(`AI extraction completed and cached for order ${orderId} proof ${proofType}`, {
      duration,
      confidence: extraction?.confidence,
      verified: extraction?.verified,
    });

    return {
      ...extraction,
      cached: false,
      extractedAt: new Date().toISOString(),
    };
  } catch (error) {
    aiLog.error(`AI extraction failed for order ${orderId} proof ${proofType}`, { error });
    throw error;
  }
}

/**
 * Clear cache for a specific proof (used when user uploads new screenshot)
 */
export async function clearProofCache(orderId: string, proofType: ProofType): Promise<void> {
  const cacheField = `${proofType}AiExtraction` as any;
  const timestampField = `${proofType}ExtractedAt` as any;

  await prisma().order.update({
    where: { mongoId: orderId },
    data: {
      [cacheField]: null,
      [timestampField]: null,
    },
  });

  aiLog.info(`AI extraction cache cleared for order ${orderId} proof ${proofType}`);
}

/**
 * Get extraction status for all proofs of an order (used by UI to show progress)
 */
export async function getExtractionStatus(orderId: string): Promise<{
  order: { extracted: boolean; at: Date | null };
  payment: { extracted: boolean; at: Date | null };
  review: { extracted: boolean; at: Date | null };
  rating: { extracted: boolean; at: Date | null };
  returnWindow: { extracted: boolean; at: Date | null };
}> {
  const order = await prisma().order.findFirst({
    where: { mongoId: orderId },
    select: {
      orderAiExtraction: true,
      orderExtractedAt: true,
      paymentAiExtraction: true,
      paymentExtractedAt: true,
      reviewAiExtraction: true,
      reviewExtractedAt: true,
      ratingAiExtraction: true,
      ratingExtractedAt: true,
      returnWindowAiExtraction: true,
      returnWindowExtractedAt: true,
    },
  });

  if (!order) {
    throw new Error(`Order ${orderId} not found`);
  }

  return {
    order: {
      extracted: !!order.orderAiExtraction,
      at: order.orderExtractedAt,
    },
    payment: {
      extracted: !!order.paymentAiExtraction,
      at: order.paymentExtractedAt,
    },
    review: {
      extracted: !!order.reviewAiExtraction,
      at: order.reviewExtractedAt,
    },
    rating: {
      extracted: !!order.ratingAiExtraction,
      at: order.ratingExtractedAt,
    },
    returnWindow: {
      extracted: !!order.returnWindowAiExtraction,
      at: order.returnWindowExtractedAt,
    },
  };
}

/**
 * Estimate cost savings from caching (for analytics)
 */
export async function getCostSavings(days: number = 30): Promise<{
  totalExtractions: number;
  cacheHits: number;
  cacheMisses: number;
  cacheHitRate: number;
  estimatedSavingsUSD: number;
}> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  // This is a simplified estimate
  // In production, track cache hits/misses with proper counters
  const orders = await prisma().order.count({
    where: {
      createdAt: { gte: cutoff },
    },
  });

  // Estimated: avg 3 proof types per order, avg 5 views per proof
  const avgProofsPerOrder = 3;
  const avgViewsPerProof = 5;
  const totalExtractions = orders * avgProofsPerOrder;
  const totalViews = orders * avgProofsPerOrder * avgViewsPerProof;
  const cacheHits = totalViews - totalExtractions;
  const cacheMisses = totalExtractions;

  // Gemini API cost ~ $0.001 per image analysis (conservative estimate)
  const costPerExtraction = 0.001;
  const estimatedSavingsUSD = cacheHits * costPerExtraction;

  return {
    totalExtractions,
    cacheHits,
    cacheMisses,
    cacheHitRate: totalViews > 0 ? (cacheHits / totalViews) * 100 : 0,
    estimatedSavingsUSD,
  };
}

/**
 * Batch pre-warm cache for orders (useful after backfill or for high-priority orders)
 */
export async function preWarmCache(params: {
  orderIds: string[];
  proofTypes: ProofType[];
  env: Env;
}): Promise<{ success: number; failed: number; skipped: number }> {
  const { orderIds, proofTypes, env } = params;
  
  let success = 0;
  let failed = 0;
  let skipped = 0;

  for (const orderId of orderIds) {
    for (const proofType of proofTypes) {
      try {
        const order = await prisma().order.findFirst({
          where: { mongoId: orderId },
          select: {
            [`screenshot${proofType.charAt(0).toUpperCase() + proofType.slice(1)}`]: true,
          } as any,
        });

        const screenshot = (order as any)?.[`screenshot${proofType.charAt(0).toUpperCase() + proofType.slice(1)}`];
        if (!screenshot) {
          skipped++;
          continue;
        }

        // Check if already cached
        const cacheField = `${proofType}AiExtraction` as any;
        const existing = await prisma().order.findFirst({
          where: { mongoId: orderId },
          select: { [cacheField]: true },
        });

        if ((existing as any)?.[cacheField]) {
          skipped++;
          continue;
        }

        // Extract and cache
        // Note: This is a simplified version - in production, fetch proper expected values
        await getOrExtractProof({
          orderId,
          proofType,
          imageBase64: screenshot,
          expectedOrderId: orderId,
          expectedAmount: 0, // TODO: fetch from order
          env,
        });

        success++;
      } catch (error) {
        failed++;
        aiLog.error(`Pre-warm cache failed for order ${orderId} proof ${proofType}`, { error });
      }
    }
  }

  return { success, failed, skipped };
}
