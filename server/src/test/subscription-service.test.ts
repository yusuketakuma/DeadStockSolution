/**
 * Tests for subscription-service.ts
 *
 * Tests the subscription database operations with mocked drizzle-orm.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  upsertSubscription,
  getActiveSubscription,
  getPharmacySubscriptions,
  getSubscriptionByStripeId,
  updateSubscriptionStatus,
  deleteSubscription,
} from '../services/subscription-service';

// Hoisted mocks for proper hoisting
const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock the database module
vi.mock('../config/database', () => ({
  db: mocks.db,
}));

// Mock the schema
vi.mock('../db/schema', () => ({
  subscriptions: {
    id: 'id',
    pharmacyId: 'pharmacy_id',
    stripeSubscriptionId: 'stripe_subscription_id',
    stripeCustomerId: 'stripe_customer_id',
    planType: 'plan_type',
    status: 'status',
    currentPeriodStart: 'current_period_start',
    currentPeriodEnd: 'current_period_end',
    cancelAtPeriodEnd: 'cancel_at_period_end',
    canceledAt: 'canceled_at',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
}));

// Mock logger
vi.mock('../services/logger', () => ({
  logger: mocks.logger,
}));

// Helper to create select chain
function createSelectChain(rows: unknown[], endsWithOrderBy = false) {
  const limitMock = vi.fn().mockResolvedValue(rows);
  // orderBy can either be terminal (returns promise) or chain to limit
  const orderByMock = vi.fn().mockImplementation(() => {
    if (endsWithOrderBy) {
      return Promise.resolve(rows);
    }
    return { limit: limitMock };
  });
  const whereMock = vi.fn().mockReturnValue({ orderBy: orderByMock, limit: limitMock });
  const fromMock = vi.fn().mockReturnValue({ where: whereMock, orderBy: orderByMock });
  mocks.db.select.mockReturnValue({ from: fromMock });
  return { from: fromMock, where: whereMock, limit: limitMock, orderBy: orderByMock };
}

// Helper to create insert chain
function createInsertChain(returning: unknown[]) {
  const returningMock = vi.fn().mockResolvedValue(returning);
  const valuesMock = vi.fn().mockReturnValue({ returning: returningMock });
  mocks.db.insert.mockReturnValue({ values: valuesMock });
  return { values: valuesMock, returning: returningMock };
}

// Helper to create update chain
function createUpdateChain(returning: unknown[]) {
  const returningMock = vi.fn().mockResolvedValue(returning);
  const whereMock = vi.fn().mockReturnValue({ returning: returningMock });
  const setMock = vi.fn().mockReturnValue({ where: whereMock });
  mocks.db.update.mockReturnValue({ set: setMock });
  return { set: setMock, where: whereMock, returning: returningMock };
}

// Helper to create delete chain
function createDeleteChain() {
  const whereMock = vi.fn().mockResolvedValue(undefined);
  mocks.db.delete.mockReturnValue({ where: whereMock });
  return { where: whereMock };
}

describe('subscription-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('upsertSubscription', () => {
    it('should insert a new subscription when it does not exist', async () => {
      // First select returns empty (no existing subscription)
      createSelectChain([]);

      // Insert returns the new record
      const mockInserted = {
        id: 1,
        pharmacyId: 1,
        stripeSubscriptionId: 'sub_test123',
        stripeCustomerId: 'cus_test123',
        planType: 'standard',
        status: 'active',
        currentPeriodStart: '2024-01-01T00:00:00Z',
        currentPeriodEnd: '2024-02-01T00:00:00Z',
        cancelAtPeriodEnd: false,
        canceledAt: null,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };
      createInsertChain([mockInserted]);

      const result = await upsertSubscription({
        pharmacyId: 1,
        stripeSubscriptionId: 'sub_test123',
        stripeCustomerId: 'cus_test123',
        planType: 'standard',
        status: 'active',
        currentPeriodStart: '2024-01-01T00:00:00Z',
        currentPeriodEnd: '2024-02-01T00:00:00Z',
      });

      expect(result).toEqual(mockInserted);
      expect(mocks.logger.info).toHaveBeenCalledWith(
        'Subscription created in database',
        expect.objectContaining({
          subscriptionId: 1,
          stripeSubscriptionId: 'sub_test123',
          pharmacyId: 1,
          planType: 'standard',
        })
      );
    });

    it('should update an existing subscription', async () => {
      // First select returns existing subscription
      const existingSubscription = {
        id: 1,
        pharmacyId: 1,
        stripeSubscriptionId: 'sub_test123',
        stripeCustomerId: 'cus_test123',
        planType: 'standard',
        status: 'active',
        currentPeriodStart: '2024-01-01T00:00:00Z',
        currentPeriodEnd: '2024-02-01T00:00:00Z',
        cancelAtPeriodEnd: false,
        canceledAt: null,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };
      createSelectChain([existingSubscription]);

      // Update returns the updated record
      const mockUpdated = {
        ...existingSubscription,
        status: 'canceled',
        cancelAtPeriodEnd: true,
        canceledAt: '2024-01-15T00:00:00Z',
      };
      createUpdateChain([mockUpdated]);

      const result = await upsertSubscription({
        pharmacyId: 1,
        stripeSubscriptionId: 'sub_test123',
        stripeCustomerId: 'cus_test123',
        planType: 'standard',
        status: 'canceled',
        cancelAtPeriodEnd: true,
        canceledAt: '2024-01-15T00:00:00Z',
      });

      expect(result).toEqual(mockUpdated);
      expect(mocks.logger.info).toHaveBeenCalledWith(
        'Subscription updated in database',
        expect.objectContaining({
          subscriptionId: 1,
          stripeSubscriptionId: 'sub_test123',
          status: 'canceled',
        })
      );
    });

    it('should return null on database error during select', async () => {
      // Simulate database error
      mocks.db.select.mockImplementation(() => {
        throw new Error('Database connection failed');
      });

      const result = await upsertSubscription({
        pharmacyId: 1,
        stripeSubscriptionId: 'sub_test',
        stripeCustomerId: 'cus_test',
        planType: 'light',
        status: 'active',
      });

      expect(result).toBeNull();
      expect(mocks.logger.error).toHaveBeenCalledWith(
        'Failed to upsert subscription',
        expect.objectContaining({
          error: 'Database connection failed',
          stripeSubscriptionId: 'sub_test',
        })
      );
    });

    it('should use default values for optional parameters', async () => {
      createSelectChain([]);
      const mockInserted = {
        id: 1,
        pharmacyId: 1,
        stripeSubscriptionId: 'sub_test',
        stripeCustomerId: 'cus_test',
        planType: 'light',
        status: 'active',
        currentPeriodStart: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        canceledAt: null,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      };
      createInsertChain([mockInserted]);

      const result = await upsertSubscription({
        pharmacyId: 1,
        stripeSubscriptionId: 'sub_test',
        stripeCustomerId: 'cus_test',
        planType: 'light',
        status: 'active',
      });

      expect(result).toBeDefined();
    });
  });

  describe('getActiveSubscription', () => {
    it('should return active subscription for pharmacy', async () => {
      const mockSubscription = {
        id: 1,
        pharmacyId: 1,
        stripeSubscriptionId: 'sub_test',
        stripeCustomerId: 'cus_test',
        planType: 'standard',
        status: 'active',
        currentPeriodStart: '2024-01-01T00:00:00Z',
        currentPeriodEnd: '2024-02-01T00:00:00Z',
        cancelAtPeriodEnd: false,
        canceledAt: null,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };
      createSelectChain([mockSubscription]);

      const result = await getActiveSubscription(1);

      expect(result).toEqual(mockSubscription);
    });

    it('should return null when no active subscription exists', async () => {
      createSelectChain([]);

      const result = await getActiveSubscription(999);

      expect(result).toBeNull();
    });

    it('should return null on database error', async () => {
      mocks.db.select.mockImplementation(() => {
        throw new Error('Database error');
      });

      const result = await getActiveSubscription(1);

      expect(result).toBeNull();
      expect(mocks.logger.error).toHaveBeenCalledWith(
        'Failed to get active subscription',
        expect.objectContaining({
          error: 'Database error',
          pharmacyId: 1,
        })
      );
    });
  });

  describe('getPharmacySubscriptions', () => {
    it('should return all subscriptions for pharmacy', async () => {
      const mockSubscriptions = [
        {
          id: 1,
          pharmacyId: 1,
          stripeSubscriptionId: 'sub_1',
          status: 'active',
          createdAt: '2024-01-01T00:00:00Z',
        },
        {
          id: 2,
          pharmacyId: 1,
          stripeSubscriptionId: 'sub_2',
          status: 'canceled',
          createdAt: '2023-01-01T00:00:00Z',
        },
      ];
      // getPharmacySubscriptions ends with orderBy, not limit
      createSelectChain(mockSubscriptions, true);

      const result = await getPharmacySubscriptions(1);

      expect(result).toEqual(mockSubscriptions);
    });

    it('should return empty array when no subscriptions exist', async () => {
      // getPharmacySubscriptions ends with orderBy, not limit
      createSelectChain([], true);

      const result = await getPharmacySubscriptions(999);

      expect(result).toEqual([]);
    });

    it('should return empty array on database error', async () => {
      mocks.db.select.mockImplementation(() => {
        throw new Error('Database error');
      });

      const result = await getPharmacySubscriptions(1);

      expect(result).toEqual([]);
      expect(mocks.logger.error).toHaveBeenCalledWith(
        'Failed to get pharmacy subscriptions',
        expect.objectContaining({
          error: 'Database error',
          pharmacyId: 1,
        })
      );
    });
  });

  describe('getSubscriptionByStripeId', () => {
    it('should return subscription by Stripe ID', async () => {
      const mockSubscription = {
        id: 1,
        pharmacyId: 1,
        stripeSubscriptionId: 'sub_test',
        status: 'active',
      };
      createSelectChain([mockSubscription]);

      const result = await getSubscriptionByStripeId('sub_test');

      expect(result).toEqual(mockSubscription);
    });

    it('should return null when subscription not found', async () => {
      createSelectChain([]);

      const result = await getSubscriptionByStripeId('nonexistent');

      expect(result).toBeNull();
    });

    it('should return null on database error', async () => {
      mocks.db.select.mockImplementation(() => {
        throw new Error('Database error');
      });

      const result = await getSubscriptionByStripeId('sub_test');

      expect(result).toBeNull();
      expect(mocks.logger.error).toHaveBeenCalledWith(
        'Failed to get subscription by Stripe ID',
        expect.objectContaining({
          error: 'Database error',
          stripeSubscriptionId: 'sub_test',
        })
      );
    });
  });

  describe('updateSubscriptionStatus', () => {
    it('should update subscription status successfully', async () => {
      createUpdateChain([{ id: 1 }]);

      const result = await updateSubscriptionStatus('sub_test', 'canceled');

      expect(result).toBe(true);
      expect(mocks.logger.info).toHaveBeenCalledWith(
        'Subscription status updated',
        expect.objectContaining({
          stripeSubscriptionId: 'sub_test',
          status: 'canceled',
        })
      );
    });

    it('should update with cancelAtPeriodEnd and canceledAt', async () => {
      createUpdateChain([{ id: 1 }]);

      const result = await updateSubscriptionStatus(
        'sub_test',
        'active',
        true,
        '2024-01-15T00:00:00Z'
      );

      expect(result).toBe(true);
      expect(mocks.logger.info).toHaveBeenCalledWith(
        'Subscription status updated',
        expect.objectContaining({
          stripeSubscriptionId: 'sub_test',
          status: 'active',
          cancelAtPeriodEnd: true,
        })
      );
    });

    it('should return false on database error', async () => {
      mocks.db.update.mockImplementation(() => {
        throw new Error('Database error');
      });

      const result = await updateSubscriptionStatus('sub_test', 'canceled');

      expect(result).toBe(false);
      expect(mocks.logger.error).toHaveBeenCalledWith(
        'Failed to update subscription status',
        expect.objectContaining({
          error: 'Database error',
          stripeSubscriptionId: 'sub_test',
          status: 'canceled',
        })
      );
    });
  });

  describe('deleteSubscription', () => {
    it('should delete subscription successfully', async () => {
      createDeleteChain();

      const result = await deleteSubscription('sub_test');

      expect(result).toBe(true);
      expect(mocks.logger.info).toHaveBeenCalledWith(
        'Subscription deleted from database',
        expect.objectContaining({
          stripeSubscriptionId: 'sub_test',
        })
      );
    });

    it('should return false on database error', async () => {
      mocks.db.delete.mockImplementation(() => {
        throw new Error('Database error');
      });

      const result = await deleteSubscription('sub_test');

      expect(result).toBe(false);
      expect(mocks.logger.error).toHaveBeenCalledWith(
        'Failed to delete subscription',
        expect.objectContaining({
          error: 'Database error',
          stripeSubscriptionId: 'sub_test',
        })
      );
    });
  });
});
