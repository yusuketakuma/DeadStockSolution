import { afterEach, describe, expect, it } from 'vitest';
import { triggerManualAutoSync } from '../services/drug-master-scheduler';

const ORIGINAL_SOURCE_URL = process.env.DRUG_MASTER_SOURCE_URL;

describe('drug-master-scheduler triggerManualAutoSync', () => {
  afterEach(() => {
    if (ORIGINAL_SOURCE_URL === undefined) {
      delete process.env.DRUG_MASTER_SOURCE_URL;
    } else {
      process.env.DRUG_MASTER_SOURCE_URL = ORIGINAL_SOURCE_URL;
    }
  });

  it('returns blocked message when source URL is not configured', async () => {
    delete process.env.DRUG_MASTER_SOURCE_URL;

    const result = await triggerManualAutoSync();
    expect(result.triggered).toBe(false);
    expect(result.message).toContain('sourceUrl');
  });

  it('rejects invalid manual URL', async () => {
    delete process.env.DRUG_MASTER_SOURCE_URL;

    const result = await triggerManualAutoSync({ sourceUrl: 'http://localhost/file.csv' });
    expect(result.triggered).toBe(false);
    expect(result.message).toContain('sourceUrl');
  });
});
