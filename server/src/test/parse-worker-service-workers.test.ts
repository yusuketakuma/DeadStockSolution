import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  Worker: vi.fn(),
  existsSync: vi.fn(),
  parseExcelBuffer: vi.fn(),
}));

vi.mock('worker_threads', () => ({ Worker: mocks.Worker }));
vi.mock('fs', () => ({ existsSync: mocks.existsSync }));
vi.mock('../services/upload-service', () => ({ parseExcelBuffer: mocks.parseExcelBuffer }));

import { parseInWorker } from '../services/parse-worker-service';

describe('parseInWorker on Cloudflare Workers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.parseExcelBuffer.mockResolvedValue([['薬品名', '数量'], ['ロキソニン', 10]]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses inline without resolving worker files or starting a thread', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Cloudflare-Workers' });

    const result = await parseInWorker(Buffer.from('xlsx'), { format: 'xlsx' });

    expect(result.rows).toEqual([['薬品名', '数量'], ['ロキソニン', 10]]);
    expect(mocks.existsSync).not.toHaveBeenCalled();
    expect(mocks.Worker).not.toHaveBeenCalled();
  });

  it('parses CSV inline on Workers', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Cloudflare-Workers' });

    const result = await parseInWorker(Buffer.from('a,b\n1,2'), { format: 'csv' });

    expect(result.rows).toEqual([['a', 'b'], ['1', '2']]);
    expect(mocks.Worker).not.toHaveBeenCalled();
  });

  it('still looks for the worker file on Node.js', async () => {
    mocks.existsSync.mockReturnValue(false);

    await parseInWorker(Buffer.from('xlsx'), { format: 'xlsx' });

    expect(mocks.existsSync).toHaveBeenCalled();
    expect(mocks.parseExcelBuffer).toHaveBeenCalledTimes(1);
  });
});
