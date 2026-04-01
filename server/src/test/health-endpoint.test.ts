import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// db mock must be hoisted so it is set up before app.ts is imported
const mocks = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  dbSelect: vi.fn(),
}));

vi.mock('../config/database', () => ({
  db: { execute: mocks.dbExecute, select: mocks.dbSelect },
}));

vi.mock('../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

let app: (typeof import('../app'))['default'];

const ORIGINAL_OPENCLAW_CONNECTOR_MODE = process.env.OPENCLAW_CONNECTOR_MODE;
const ORIGINAL_OPENCLAW_CLI_PATH = process.env.OPENCLAW_CLI_PATH;
const ORIGINAL_OPENCLAW_AGENT_ID = process.env.OPENCLAW_AGENT_ID;
const ORIGINAL_OPENCLAW_WEBHOOK_SECRET = process.env.OPENCLAW_WEBHOOK_SECRET;

function mockRetryQueueRows(rows: Array<{ status: string }>) {
  let callCount = 0;
  mocks.dbSelect.mockImplementation(() => {
    callCount += 1;
    if (callCount === 1) {
      // getOpenClawRetryQueueMetrics query 1: status snapshot (select().from())
      return { from: vi.fn().mockResolvedValue(rows) };
    }
    if (callCount === 2) {
      // getOpenClawRetryQueueMetrics query 2: failed count (select().from().where())
      const failedCount = rows.filter(r => r.status === 'failed').length;
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: failedCount }]),
        }),
      };
    }
    if (callCount === 3) {
      // getOpenClawRetryQueueMetrics query 3: oldest pending (select().from().where().orderBy().limit())
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      };
    }
    // Call 4+: handoff KPI (select().from().where().groupBy())
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          groupBy: vi.fn().mockResolvedValue([]),
        }),
      }),
    };
  });
}

async function loadApp() {
  vi.resetModules();
  ({ default: app } = await import('../app'));
}

describe('/api/health', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    mockRetryQueueRows([]);
    await loadApp();
  });

  describe('DB 正常時', () => {
    it('HTTP 200 で ok ステータスを返す', async () => {
      mocks.dbExecute.mockResolvedValue([]);

      const res = await request(app).get('/api/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });

    it('レスポンスに uptime, timestamp, version, db フィールドが含まれる', async () => {
      mocks.dbExecute.mockResolvedValue([]);

      const res = await request(app).get('/api/health');

      expect(res.status).toBe(200);
      expect(typeof res.body.uptime).toBe('number');
      expect(typeof res.body.timestamp).toBe('string');
      expect(typeof res.body.version).toBe('string');
      expect(res.body.db).toMatchObject({ status: 'ok' });
      expect(typeof res.body.db.responseTime).toBe('number');
    });

    it('timestamp が ISO 8601 形式である', async () => {
      mocks.dbExecute.mockResolvedValue([]);

      const res = await request(app).get('/api/health');

      expect(() => new Date(res.body.timestamp as string)).not.toThrow();
      expect(new Date(res.body.timestamp as string).toISOString()).toBe(res.body.timestamp);
    });
  });

  describe('DB 失敗時', () => {
    it('HTTP 503 で degraded ステータスを返す', async () => {
      mocks.dbExecute.mockRejectedValue(new Error('connection refused'));

      const res = await request(app).get('/api/health');

      expect(res.status).toBe(503);
      expect(res.body.status).toBe('degraded');
    });

    it('db.status が error になる', async () => {
      mocks.dbExecute.mockRejectedValue(new Error('timeout'));

      const res = await request(app).get('/api/health');

      expect(res.body.db.status).toBe('error');
      expect(typeof res.body.db.responseTime).toBe('number');
    });
  });
});

describe('/api/health/ready', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    mockRetryQueueRows([]);
    await loadApp();
  });

  describe('DB 正常時', () => {
    it('HTTP 200 で { ready: true } を返す', async () => {
      mocks.dbExecute.mockResolvedValue([]);

      const res = await request(app).get('/api/health/ready');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ready: true });
    });
  });

  describe('DB 失敗時', () => {
    it('HTTP 503 で { ready: false } を返す', async () => {
      mocks.dbExecute.mockRejectedValue(new Error('db unavailable'));

      const res = await request(app).get('/api/health/ready');

      expect(res.status).toBe(503);
      expect(res.body).toEqual({ ready: false });
    });
  });
});

describe('/api/health/openclaw', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    mockRetryQueueRows([]);
    delete process.env.OPENCLAW_CONNECTOR_MODE;
    delete process.env.OPENCLAW_CLI_PATH;
    delete process.env.OPENCLAW_AGENT_ID;
    delete process.env.OPENCLAW_WEBHOOK_SECRET;
    await loadApp();
  });

  afterEach(() => {
    if (typeof ORIGINAL_OPENCLAW_CONNECTOR_MODE === 'string') process.env.OPENCLAW_CONNECTOR_MODE = ORIGINAL_OPENCLAW_CONNECTOR_MODE;
    else delete process.env.OPENCLAW_CONNECTOR_MODE;
    if (typeof ORIGINAL_OPENCLAW_CLI_PATH === 'string') process.env.OPENCLAW_CLI_PATH = ORIGINAL_OPENCLAW_CLI_PATH;
    else delete process.env.OPENCLAW_CLI_PATH;
    if (typeof ORIGINAL_OPENCLAW_AGENT_ID === 'string') process.env.OPENCLAW_AGENT_ID = ORIGINAL_OPENCLAW_AGENT_ID;
    else delete process.env.OPENCLAW_AGENT_ID;
    if (typeof ORIGINAL_OPENCLAW_WEBHOOK_SECRET === 'string') process.env.OPENCLAW_WEBHOOK_SECRET = ORIGINAL_OPENCLAW_WEBHOOK_SECRET;
    else delete process.env.OPENCLAW_WEBHOOK_SECRET;
  });

  it('returns 200 with degraded snapshot when OpenClaw connector/webhook are not configured', async () => {
    const res = await request(app).get('/api/health/openclaw');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('degraded');
    expect(res.body.connector.configured).toBe(false);
    expect(res.body.webhook.configured).toBe(false);
  });

  it('returns 200 when OpenClaw is configured and retry queue is healthy', async () => {
    process.env.OPENCLAW_CONNECTOR_MODE = 'gateway_cli';
    process.env.OPENCLAW_CLI_PATH = '/usr/local/bin/openclaw';
    process.env.OPENCLAW_AGENT_ID = 'agent-1';
    process.env.OPENCLAW_WEBHOOK_SECRET = 'secret';
    mockRetryQueueRows([{ status: 'pending' }, { status: 'completed' }]);

    const res = await request(app).get('/api/health/openclaw');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.retryQueue.pending).toBe(1);
    expect(res.body.retryQueue.completed).toBe(1);
  });

  it('returns 200 even when historical failed retries exist', async () => {
    process.env.OPENCLAW_CONNECTOR_MODE = 'gateway_cli';
    process.env.OPENCLAW_CLI_PATH = '/usr/local/bin/openclaw';
    process.env.OPENCLAW_AGENT_ID = 'agent-1';
    process.env.OPENCLAW_WEBHOOK_SECRET = 'secret';
    mockRetryQueueRows([{ status: 'failed' }, { status: 'completed' }]);

    const res = await request(app).get('/api/health/openclaw');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.retryQueue.failed).toBe(1);
  });

  it('returns 503 when health snapshot creation fails unexpectedly', async () => {
    mocks.dbSelect.mockImplementation(() => ({
      from: vi.fn().mockImplementation(() => {
        throw new Error('openclaw health db failed');
      }),
    }));

    const res = await request(app).get('/api/health/openclaw');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.error).toBe('openclaw health check failed');
  });
});
