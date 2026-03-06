/**
 * Stripe Webhook Route
 * 
 * Handles Stripe webhook events.
 * This route must be registered BEFORE CSRF protection.
 */

import { Router, Request, Response } from 'express';
import { verifyWebhookSignature, getSubscription, getCustomer } from '../services/stripe-service';
import { logger } from '../services/logger';
import Stripe from 'stripe';

const router = Router();

// Webhook endpoint - must be excluded from CSRF protection
router.post('/webhook', async (req: Request, res: Response): Promise<void> => {
  const signature = req.headers['stripe-signature'];

  if (!signature || typeof signature !== 'string') {
    logger.warn('Stripe webhook missing signature');
    res.status(400).json({ error: 'Missing stripe-signature header' });
    return;
  }

  // Get raw body
  const payload = (req as Request & { rawBody?: string }).rawBody ?? JSON.stringify(req.body);

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

  // TODO: Update user's subscription status in database
  // This is where you would:
  // 1. Get the user ID from session.metadata or customer
  // 2. Update their subscription status in the database
  // 3. Grant access to the appropriate features
}

async function handleSubscriptionCreated(subscription: Stripe.Subscription): Promise<void> {
  logger.info('Subscription created', {
    subscriptionId: subscription.id,
    customerId: subscription.customer,
    status: subscription.status,
  });

  // TODO: Update database with new subscription info
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
  logger.info('Subscription updated', {
    subscriptionId: subscription.id,
    customerId: subscription.customer,
    status: subscription.status,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
  });

  // TODO: Update database with subscription changes
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  logger.info('Subscription deleted', {
    subscriptionId: subscription.id,
    customerId: subscription.customer,
  });

  // TODO: Revoke access in database
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

  // TODO: Update payment records in database
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

  // TODO: Notify user of failed payment
}

export default router;
