import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';
import {
  getRealtimeSubscriberCount,
  publishAdminRequestsRefresh,
  publishRequestsRefresh,
  publishTimelineRefresh,
  subscribeRealtimeClient,
} from '../services/realtime-service';

function createResponseMock(options?: { write?: ReturnType<typeof vi.fn> }) {
  const handlers = new Map<string, () => void>();
  const res = {
    status: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    write: options?.write ?? vi.fn(),
    flush: vi.fn(),
    on: vi.fn((event: string, handler: () => void) => {
      handlers.set(event, handler);
      return res;
    }),
  } as unknown as Response;

  return {
    res,
    handlers,
  };
}

describe('realtime-service', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('publishes timeline events only to matching pharmacy subscribers', () => {
    const first = createResponseMock();
    const second = createResponseMock();

    subscribeRealtimeClient({
      res: first.res,
      pharmacyId: 1,
      isAdmin: false,
      topics: ['timeline'],
    });
    subscribeRealtimeClient({
      res: second.res,
      pharmacyId: 2,
      isAdmin: false,
      topics: ['timeline'],
    });

    publishTimelineRefresh({
      pharmacyId: 1,
      reason: 'notification_created',
    });

    expect(first.res.write).toHaveBeenCalledWith(expect.stringContaining('event: timeline.refresh'));
    expect(second.res.write).not.toHaveBeenCalledWith(expect.stringContaining('event: timeline.refresh'));

    first.handlers.get('close')?.();
    second.handlers.get('close')?.();
  });

  it('publishes request events to the request owner and admin request events only to admins', () => {
    const user = createResponseMock();
    const admin = createResponseMock();

    subscribeRealtimeClient({
      res: user.res,
      pharmacyId: 5,
      isAdmin: false,
      topics: ['requests'],
    });
    subscribeRealtimeClient({
      res: admin.res,
      pharmacyId: 99,
      isAdmin: true,
      topics: ['admin_requests'],
    });

    publishRequestsRefresh({
      pharmacyId: 5,
      requestId: 41,
      reason: 'request_updated',
    });
    publishAdminRequestsRefresh({
      requestId: 41,
      reason: 'request_updated',
    });

    expect(user.res.write).toHaveBeenCalledWith(expect.stringContaining('event: requests.refresh'));
    expect(admin.res.write).toHaveBeenCalledWith(expect.stringContaining('event: admin_requests.refresh'));

    user.handlers.get('close')?.();
    admin.handlers.get('close')?.();
  });

  it('cleans up subscribers when the response closes', () => {
    const stream = createResponseMock();
    subscribeRealtimeClient({
      res: stream.res,
      pharmacyId: 3,
      isAdmin: false,
      topics: ['timeline'],
    });

    expect(getRealtimeSubscriberCount()).toBeGreaterThan(0);
    stream.handlers.get('close')?.();

    expect(getRealtimeSubscriberCount()).toBe(0);
  });

  it('does not throw when a subscriber write fails during publish', () => {
    const brokenWrite = vi.fn()
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => undefined)
      .mockImplementation(() => {
        throw new Error('write after end');
      });
    const broken = createResponseMock({ write: brokenWrite });
    const healthy = createResponseMock();

    subscribeRealtimeClient({
      res: broken.res,
      pharmacyId: 1,
      isAdmin: false,
      topics: ['timeline'],
    });
    subscribeRealtimeClient({
      res: healthy.res,
      pharmacyId: 1,
      isAdmin: false,
      topics: ['timeline'],
    });

    expect(() => {
      publishTimelineRefresh({
        pharmacyId: 1,
        reason: 'notification_created',
      });
    }).not.toThrow();

    expect(getRealtimeSubscriberCount()).toBe(1);
    healthy.handlers.get('close')?.();
  });
});
