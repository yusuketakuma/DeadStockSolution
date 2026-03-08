/**
 * Subscription Service
 *
 * Manages subscription data in the database.
 */

import { and, eq, desc } from 'drizzle-orm';
import { db } from '../config/database';
import { subscriptions, type SubscriptionPlan, type SubscriptionStatus } from '../db/schema';
import { logger } from './logger';

export interface SubscriptionRecord {
  id: number;
  pharmacyId: number;
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  planType: SubscriptionPlan;
  status: SubscriptionStatus;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface UpsertSubscriptionParams {
  pharmacyId: number;
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  planType: SubscriptionPlan;
  status: SubscriptionStatus;
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
  canceledAt?: string | null;
}

/**
 * Upsert a subscription record.
 * Updates if stripeSubscriptionId exists, inserts otherwise.
 */
export async function upsertSubscription(params: UpsertSubscriptionParams): Promise<SubscriptionRecord | null> {
  try {
    const now = new Date().toISOString();

    // Check if subscription exists
    const existing = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.stripeSubscriptionId, params.stripeSubscriptionId))
      .limit(1);

    if (existing.length > 0) {
      // Update existing
      const [updated] = await db
        .update(subscriptions)
        .set({
          status: params.status,
          currentPeriodStart: params.currentPeriodStart ?? null,
          currentPeriodEnd: params.currentPeriodEnd ?? null,
          cancelAtPeriodEnd: params.cancelAtPeriodEnd ?? false,
          canceledAt: params.canceledAt ?? null,
          updatedAt: now,
        })
        .where(eq(subscriptions.stripeSubscriptionId, params.stripeSubscriptionId))
        .returning();

      logger.info('Subscription updated in database', {
        subscriptionId: updated.id,
        stripeSubscriptionId: params.stripeSubscriptionId,
        status: params.status,
      });

      return updated as SubscriptionRecord;
    } else {
      // Insert new
      const [inserted] = await db
        .insert(subscriptions)
        .values({
          pharmacyId: params.pharmacyId,
          stripeSubscriptionId: params.stripeSubscriptionId,
          stripeCustomerId: params.stripeCustomerId,
          planType: params.planType,
          status: params.status,
          currentPeriodStart: params.currentPeriodStart ?? null,
          currentPeriodEnd: params.currentPeriodEnd ?? null,
          cancelAtPeriodEnd: params.cancelAtPeriodEnd ?? false,
          canceledAt: params.canceledAt ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      logger.info('Subscription created in database', {
        subscriptionId: inserted.id,
        stripeSubscriptionId: params.stripeSubscriptionId,
        pharmacyId: params.pharmacyId,
        planType: params.planType,
      });

      return inserted as SubscriptionRecord;
    }
  } catch (error) {
    logger.error('Failed to upsert subscription', {
      error: error instanceof Error ? error.message : String(error),
      stripeSubscriptionId: params.stripeSubscriptionId,
    });
    return null;
  }
}

/**
 * Get active subscription for a pharmacy.
 */
export async function getActiveSubscription(pharmacyId: number): Promise<SubscriptionRecord | null> {
  try {
    const [subscription] = await db
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.pharmacyId, pharmacyId),
          eq(subscriptions.status, 'active')
        )
      )
      .orderBy(desc(subscriptions.createdAt))
      .limit(1);

    return (subscription as SubscriptionRecord) ?? null;
  } catch (error) {
    logger.error('Failed to get active subscription', {
      error: error instanceof Error ? error.message : String(error),
      pharmacyId,
    });
    return null;
  }
}

/**
 * Get all subscriptions for a pharmacy.
 */
export async function getPharmacySubscriptions(pharmacyId: number): Promise<SubscriptionRecord[]> {
  try {
    const results = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.pharmacyId, pharmacyId))
      .orderBy(desc(subscriptions.createdAt));

    return results as SubscriptionRecord[];
  } catch (error) {
    logger.error('Failed to get pharmacy subscriptions', {
      error: error instanceof Error ? error.message : String(error),
      pharmacyId,
    });
    return [];
  }
}

/**
 * Get subscription by Stripe subscription ID.
 */
export async function getSubscriptionByStripeId(stripeSubscriptionId: string): Promise<SubscriptionRecord | null> {
  try {
    const [subscription] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.stripeSubscriptionId, stripeSubscriptionId))
      .limit(1);

    return (subscription as SubscriptionRecord) ?? null;
  } catch (error) {
    logger.error('Failed to get subscription by Stripe ID', {
      error: error instanceof Error ? error.message : String(error),
      stripeSubscriptionId,
    });
    return null;
  }
}

/**
 * Update subscription status.
 */
export async function updateSubscriptionStatus(
  stripeSubscriptionId: string,
  status: SubscriptionStatus,
  cancelAtPeriodEnd?: boolean,
  canceledAt?: string | null
): Promise<boolean> {
  try {
    const now = new Date().toISOString();

    await db
      .update(subscriptions)
      .set({
        status,
        cancelAtPeriodEnd: cancelAtPeriodEnd ?? false,
        canceledAt: canceledAt ?? null,
        updatedAt: now,
      })
      .where(eq(subscriptions.stripeSubscriptionId, stripeSubscriptionId));

    logger.info('Subscription status updated', {
      stripeSubscriptionId,
      status,
      cancelAtPeriodEnd,
    });

    return true;
  } catch (error) {
    logger.error('Failed to update subscription status', {
      error: error instanceof Error ? error.message : String(error),
      stripeSubscriptionId,
      status,
    });
    return false;
  }
}

/**
 * Delete subscription record.
 */
export async function deleteSubscription(stripeSubscriptionId: string): Promise<boolean> {
  try {
    await db
      .delete(subscriptions)
      .where(eq(subscriptions.stripeSubscriptionId, stripeSubscriptionId));

    logger.info('Subscription deleted from database', {
      stripeSubscriptionId,
    });

    return true;
  } catch (error) {
    logger.error('Failed to delete subscription', {
      error: error instanceof Error ? error.message : String(error),
      stripeSubscriptionId,
    });
    return false;
  }
}
