/**
 * Stripe Service
 * 
 * Handles Stripe operations for DeadStockSolution subscriptions.
 * 
 * Plans:
 * - Light: ¥4,980/month
 * - Standard: ¥9,800/month
 * - Enterprise: ¥19,800/month
 */

import StripeCtor from 'stripe';
import type { Stripe } from 'stripe/cjs/stripe.core';
import { logger } from './logger';

// Plan types
export type PlanType = 'light' | 'standard' | 'enterprise';

export interface PlanConfig {
  name: string;
  price: number;
  priceIdEnvKey: string;
  priceIdLiveEnvKey: string;
}

// Plan configurations
export const PLANS: Record<PlanType, PlanConfig> = {
  light: {
    name: 'ライトプラン',
    price: 4980,
    priceIdEnvKey: 'STRIPE_PRICE_ID_LIGHT',
    priceIdLiveEnvKey: 'STRIPE_PRICE_ID_LIGHT_LIVE',
  },
  standard: {
    name: 'スタンダードプラン',
    price: 9800,
    priceIdEnvKey: 'STRIPE_PRICE_ID_STANDARD',
    priceIdLiveEnvKey: 'STRIPE_PRICE_ID_STANDARD_LIVE',
  },
  enterprise: {
    name: 'エンタープライズプラン',
    price: 19800,
    priceIdEnvKey: 'STRIPE_PRICE_ID_ENTERPRISE',
    priceIdLiveEnvKey: 'STRIPE_PRICE_ID_ENTERPRISE_LIVE',
  },
};

// Check if Stripe is configured
export function isStripeConfigured(): boolean {
  return !!(process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY_LIVE);
}

// Get Stripe instance
function getStripe(): Stripe | null {
  const isLive = process.env.STRIPE_LIVE_MODE === 'true';
  const secretKey = isLive
    ? process.env.STRIPE_SECRET_KEY_LIVE
    : process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    logger.warn('Stripe secret key not configured');
    return null;
  }

  return new StripeCtor(secretKey, {
    apiVersion: '2026-03-25.dahlia',
  });
}

// Get Price ID for a plan
export function getPriceId(plan: PlanType): string | null {
  const isLive = process.env.STRIPE_LIVE_MODE === 'true';
  const planConfig = PLANS[plan];

  if (!planConfig) {
    logger.error('Invalid plan type', { plan });
    return null;
  }

  const envKey = isLive ? planConfig.priceIdLiveEnvKey : planConfig.priceIdEnvKey;
  const priceId = process.env[envKey];

  if (!priceId) {
    logger.warn('Price ID not configured for plan', { plan, envKey });
    return null;
  }

  return priceId;
}

// Create Checkout Session
export interface CreateCheckoutSessionParams {
  plan: PlanType;
  customerId?: string;
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, string>;
}

export interface CreateCheckoutSessionResult {
  success: boolean;
  sessionId?: string;
  url?: string;
  error?: string;
}

export async function createCheckoutSession(
  params: CreateCheckoutSessionParams
): Promise<CreateCheckoutSessionResult> {
  const stripe = getStripe();

  if (!stripe) {
    return {
      success: false,
      error: 'Stripe is not configured',
    };
  }

  const priceId = getPriceId(params.plan);

  if (!priceId) {
    return {
      success: false,
      error: `Price ID not configured for plan: ${params.plan}`,
    };
  }

  try {
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      metadata: params.metadata,
    };

    if (params.customerId) {
      sessionParams.customer = params.customerId;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    logger.info('Checkout session created', {
      sessionId: session.id,
      plan: params.plan,
      customerId: params.customerId,
    });

    return {
      success: true,
      sessionId: session.id,
      url: session.url ?? undefined,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Failed to create checkout session', {
      error: errorMessage,
      plan: params.plan,
    });

    return {
      success: false,
      error: errorMessage,
    };
  }
}

// Get subscription by ID
export async function getSubscription(subscriptionId: string): Promise<Stripe.Subscription | null> {
  const stripe = getStripe();

  if (!stripe) {
    return null;
  }

  try {
    return await stripe.subscriptions.retrieve(subscriptionId);
  } catch (error) {
    logger.error('Failed to retrieve subscription', {
      error: error instanceof Error ? error.message : String(error),
      subscriptionId,
    });
    return null;
  }
}

// Cancel subscription
export interface CancelSubscriptionResult {
  success: boolean;
  subscription?: Stripe.Subscription;
  error?: string;
}

export async function cancelSubscription(
  subscriptionId: string,
  immediately: boolean = false
): Promise<CancelSubscriptionResult> {
  const stripe = getStripe();

  if (!stripe) {
    return {
      success: false,
      error: 'Stripe is not configured',
    };
  }

  try {
    let subscription: Stripe.Subscription;

    if (immediately) {
      subscription = await stripe.subscriptions.cancel(subscriptionId);
    } else {
      subscription = await stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: true,
      });
    }

    logger.info('Subscription cancelled', {
      subscriptionId,
      immediately,
      status: subscription.status,
    });

    return {
      success: true,
      subscription,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Failed to cancel subscription', {
      error: errorMessage,
      subscriptionId,
    });

    return {
      success: false,
      error: errorMessage,
    };
  }
}

// Verify webhook signature
export interface VerifyWebhookResult {
  success: boolean;
  event?: Stripe.Event;
  error?: string;
}

export function verifyWebhookSignature(
  payload: string | Buffer,
  signature: string
): VerifyWebhookResult {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    return {
      success: false,
      error: 'Stripe webhook secret not configured',
    };
  }

  const stripe = getStripe();

  if (!stripe) {
    return {
      success: false,
      error: 'Stripe is not configured',
    };
  }

  try {
    const event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);

    return {
      success: true,
      event,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Webhook signature verification failed', {
      error: errorMessage,
    });

    return {
      success: false,
      error: errorMessage,
    };
  }
}

// Get customer by ID
export async function getCustomer(customerId: string): Promise<Stripe.Customer | null> {
  const stripe = getStripe();

  if (!stripe) {
    return null;
  }

  try {
    return (await stripe.customers.retrieve(customerId)) as Stripe.Customer;
  } catch (error) {
    logger.error('Failed to retrieve customer', {
      error: error instanceof Error ? error.message : String(error),
      customerId,
    });
    return null;
  }
}

// Create customer
export interface CreateCustomerParams {
  email: string;
  name?: string;
  metadata?: Record<string, string>;
}

export async function createCustomer(
  params: CreateCustomerParams
): Promise<Stripe.Customer | null> {
  const stripe = getStripe();

  if (!stripe) {
    return null;
  }

  try {
    const customer = await stripe.customers.create({
      email: params.email,
      name: params.name,
      metadata: params.metadata,
    });

    logger.info('Customer created', {
      customerId: customer.id,
      email: params.email,
    });

    return customer;
  } catch (error) {
    logger.error('Failed to create customer', {
      error: error instanceof Error ? error.message : String(error),
      email: params.email,
    });
    return null;
  }
}
