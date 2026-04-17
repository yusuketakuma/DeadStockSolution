/**
 * Stripe Webhook Route
 *
 * Handles Stripe webhook events.
 * This route must be registered BEFORE CSRF protection.
 */

import { Router, Request, Response } from 'express';
import { verifyWebhookSignature, getSubscription, getCustomer, PLANS, type PlanType } from '../services/stripe-service';
import { upsertSubscription, updateSubscriptionStatus, deleteSubscription } from '../services/subscription-service';
import { db } from '../config/database';
import { pharmacies } from '../db/schema';
import { eq } from 'drizzle-orm';
import { logger } from '../services/logger';
import type { Stripe } from 'stripe/cjs/stripe.core';

const router = Router();

// Webhook endpoint - must be excluded from CSRF protection
router.post('/webhook', async (req: Request, res: Response): Promise<void> => {
  const signature = req.headers['stripe-signature'];

  if (!signature || typeof signature !== 'string') {
    logger.warn('Stripe webhook missing signature');
    res.status(400).json({ error: 'Missing stripe-signature header' });
    return;
  }

  // rawBody is required for valid Stripe signature verification.
  // JSON.stringify of a parsed body may differ from the original payload bytes.
  const rawBody = (req as Request & { rawBody?: string }).rawBody;
  if (!rawBody && process.env.NODE_ENV === 'production') {
    logger.error('Stripe webhook missing rawBody — route may not be registered in isRawBodyRoute()');
    res.status(500).json({ error: 'Webhook configuration error' });
    return;
  }
  const payload = rawBody ?? JSON.stringify(req.body);

  // Verify signature
  const verifyResult = verifyWebhookSignature(payload, signature);

  if (!verifyResult.success || !verifyResult.event) {
    logger.warn('Stripe webhook signature verification failed', {
      error: verifyResult.error,
    });
    res.status(400).json({ error: 'Invalid signature' });
    return;
  }

  const event = verifyResult.event;

  logger.info('Stripe webhook received', {
    type: event.type,
    id: event.id,
  });

  try {
    // Handle different event types
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutSessionCompleted(session);
        break;
      }

      case 'customer.subscription.created': {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionCreated(subscription);
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionUpdated(subscription);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionDeleted(subscription);
        break;
      }

      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        await handleInvoicePaid(invoice);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        await handleInvoicePaymentFailed(invoice);
        break;
      }

      default:
        logger.info('Unhandled Stripe webhook event type', {
          type: event.type,
        });
    }

    res.json({ received: true });
  } catch (error) {
    logger.error('Error processing Stripe webhook', {
      error: error instanceof Error ? error.message : String(error),
      eventType: event.type,
      eventId: event.id,
    });
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Event handlers
async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session): Promise<void> {
  logger.info('Checkout session completed', {
    sessionId: session.id,
    customerId: session.customer,
    subscriptionId: session.subscription,
    metadata: session.metadata,
  });

  // Get pharmacy ID from metadata or lookup by customer email
  let pharmacyId: number | null = null;

  if (session.metadata?.pharmacyId) {
    pharmacyId = parseInt(session.metadata.pharmacyId, 10);
  } else if (session.customer_email) {
    // Lookup pharmacy by email
    const [pharmacy] = await db
      .select({ id: pharmacies.id })
      .from(pharmacies)
      .where(eq(pharmacies.email, session.customer_email))
      .limit(1);
    pharmacyId = pharmacy?.id ?? null;
  }

  if (!pharmacyId) {
    logger.error('Could not determine pharmacy ID for checkout session', {
      sessionId: session.id,
      customerEmail: session.customer_email,
      metadata: session.metadata,
    });
    return;
  }

  // Get subscription details from Stripe
  if (!session.subscription || typeof session.subscription !== 'string') {
    logger.error('No subscription ID in checkout session', {
      sessionId: session.id,
    });
    return;
  }

  const subscription = await getSubscription(session.subscription);
  if (!subscription) {
    logger.error('Could not retrieve subscription from Stripe', {
      subscriptionId: session.subscription,
    });
    return;
  }

  // Determine plan type from price ID
  const planType = determinePlanType(subscription);
  if (!planType) {
    logger.error('Could not determine plan type from subscription', {
      subscriptionId: subscription.id,
    });
    return;
  }

  // Get period timestamps safely (Stripe types may vary by API version)
  const subAny = subscription as unknown as Record<string, unknown>;
  const currentPeriodStart = subAny.current_period_start as number | undefined;
  const currentPeriodEnd = subAny.current_period_end as number | undefined;
  const cancelAtPeriodEnd = subAny.cancel_at_period_end as boolean | undefined;

  // Save to database
  await upsertSubscription({
    pharmacyId,
    stripeSubscriptionId: subscription.id,
    stripeCustomerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id ?? '',
    planType,
    status: subscription.status as SubscriptionStatus,
    currentPeriodStart: currentPeriodStart ? new Date(currentPeriodStart * 1000).toISOString() : null,
    currentPeriodEnd: currentPeriodEnd ? new Date(currentPeriodEnd * 1000).toISOString() : null,
    cancelAtPeriodEnd: cancelAtPeriodEnd ?? false,
  });
}

type SubscriptionStatus = 'active' | 'past_due' | 'canceled' | 'incomplete' | 'incomplete_expired' | 'trialing' | 'unpaid' | 'paused';

function determinePlanType(subscription: Stripe.Subscription): PlanType | null {
  const priceId = subscription.items.data[0]?.price?.id;
  if (!priceId) return null;

  // Check each plan's price ID
  for (const [planType, config] of Object.entries(PLANS)) {
    const testPriceId = process.env[config.priceIdEnvKey];
    const livePriceId = process.env[config.priceIdLiveEnvKey];
    if (priceId === testPriceId || priceId === livePriceId) {
      return planType as PlanType;
    }
  }

  return null;
}

async function handleSubscriptionCreated(subscription: Stripe.Subscription): Promise<void> {
  logger.info('Subscription created', {
    subscriptionId: subscription.id,
    customerId: subscription.customer,
    status: subscription.status,
  });

  // Note: The subscription is already created in handleCheckoutSessionCompleted
  // This handler is for any additional processing if needed
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
  logger.info('Subscription updated', {
    subscriptionId: subscription.id,
    customerId: subscription.customer,
    status: subscription.status,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
  });

  await updateSubscriptionStatus(
    subscription.id,
    subscription.status as SubscriptionStatus,
    subscription.cancel_at_period_end,
    subscription.canceled_at ? new Date(subscription.canceled_at * 1000).toISOString() : null
  );
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  logger.info('Subscription deleted', {
    subscriptionId: subscription.id,
    customerId: subscription.customer,
  });

  // Mark as canceled instead of deleting the record
  await updateSubscriptionStatus(
    subscription.id,
    'canceled',
    true,
    new Date().toISOString()
  );
}

async function handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  // Safely extract subscription ID (Stripe types may vary)
  const subscriptionId = (invoice as unknown as Record<string, unknown>).subscription as string | undefined;

  logger.info('Invoice paid', {
    invoiceId: invoice.id,
    customerId: invoice.customer,
    subscriptionId,
    amountPaid: invoice.amount_paid,
  });

  // If subscription exists, update status to active
  if (subscriptionId && typeof subscriptionId === 'string') {
    await updateSubscriptionStatus(subscriptionId, 'active');
  }
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  // Safely extract subscription ID (Stripe types may vary)
  const subscriptionId = (invoice as unknown as Record<string, unknown>).subscription as string | undefined;

  logger.warn('Invoice payment failed', {
    invoiceId: invoice.id,
    customerId: invoice.customer,
    subscriptionId,
    attemptCount: invoice.attempt_count,
  });

  // If subscription exists, update status to past_due
  if (subscriptionId && typeof subscriptionId === 'string') {
    await updateSubscriptionStatus(subscriptionId, 'past_due');
  }
}

export default router;
