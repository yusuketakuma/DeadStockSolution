import { api } from './client';

export type SubscriptionPlanType = 'light' | 'standard' | 'enterprise';
export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete' | 'incomplete_expired' | 'unpaid';

export interface SubscriptionPlan {
  id: SubscriptionPlanType;
  name: string;
  price: number;
  priceFormatted: string;
}

export interface SubscriptionRecord {
  id: number;
  planType: SubscriptionPlanType;
  status: SubscriptionStatus;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  createdAt: string | null;
}

export interface SubscriptionPlansResponse {
  plans: SubscriptionPlan[];
  stripeConfigured: boolean;
}

export interface SubscriptionOverview {
  subscriptions: SubscriptionRecord[];
  activeSubscription: SubscriptionRecord | null;
}

export interface CheckoutSessionResponse {
  sessionId: string;
  url: string;
}

export interface CancelSubscriptionResponse {
  success: boolean;
  message: string;
  canceledAt: string | null;
  cancelAtPeriodEnd: boolean;
}

export const SUBSCRIPTION_PLAN_NAME: Record<SubscriptionPlanType, string> = {
  light: 'ライトプラン',
  standard: 'スタンダードプラン',
  enterprise: 'エンタープライズプラン',
};

export function getSubscriptionPlanName(planType: SubscriptionPlanType): string {
  return SUBSCRIPTION_PLAN_NAME[planType] ?? planType;
}

export async function listSubscriptionPlans(signal?: AbortSignal): Promise<SubscriptionPlansResponse> {
  return api.get<SubscriptionPlansResponse>('/subscriptions/plans', { signal });
}

export async function getSubscriptionOverview(signal?: AbortSignal): Promise<SubscriptionOverview> {
  return api.get<SubscriptionOverview>('/subscriptions', { signal });
}

export async function createSubscriptionCheckoutSession(
  plan: SubscriptionPlanType,
  successUrl?: string,
  cancelUrl?: string,
): Promise<CheckoutSessionResponse> {
  return api.post<CheckoutSessionResponse>('/subscriptions/checkout', {
    plan,
    successUrl,
    cancelUrl,
  });
}

export async function cancelCurrentSubscription(immediately: boolean): Promise<CancelSubscriptionResponse> {
  return api.post<CancelSubscriptionResponse>('/subscriptions/cancel', { immediately });
}
