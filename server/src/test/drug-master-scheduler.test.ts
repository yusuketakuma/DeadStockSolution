import { afterEach, describe, expect, it } from 'vitest';
import { triggerManualAutoSync, getConfiguredSourceMode } from '../services/drug-master-scheduler';

const ORIGINAL_SOURCE_URL = process.env.DRUG_MASTER_SOURCE_URL;
const ORIGINAL_SOURCE_MODE = process.env.DRUG_MASTER_SOURCE_MODE;

describe('drug-master-scheduler triggerManualAutoSync', () => {
  afterEach(() => {
    if (ORIGINAL_SOURCE_URL === undefined) {
      delete process.env.DRUG_MASTER_SOURCE_URL;
    } else {
      process.env.DRUG_MASTER_SOURCE_URL = ORIGINAL_SOURCE_URL;
    }
    if (ORIGINAL_SOURCE_MODE === undefined) {
      delete process.env.DRUG_MASTER_SOURCE_MODE;
    } else {
      process.env.DRUG_MASTER_SOURCE_MODE = ORIGINAL_SOURCE_MODE;
    }
  });

  it('returns blocked message when source URL is not configured in single mode', async () => {
    delete process.env.DRUG_MASTER_SOURCE_URL;

    const result = await triggerManualAutoSync({ sourceMode: 'single' });
    expect(result.triggered).toBe(false);
    expect(result.message).toContain('sourceUrl');
  });

  it('rejects invalid manual URL', async () => {
    delete process.env.DRUG_MASTER_SOURCE_URL;

    const result = await triggerManualAutoSync({ sourceUrl: 'http://localhost/file.csv', sourceMode: 'single' });
    expect(result.triggered).toBe(false);
    expect(result.message).toContain('HTTPS');
  });
});

describe('drug-master-scheduler getConfiguredSourceMode', () => {
  afterEach(() => {
    if (ORIGINAL_SOURCE_MODE === undefined) {
      delete process.env.DRUG_MASTER_SOURCE_MODE;
    } else {
      process.env.DRUG_MASTER_SOURCE_MODE = ORIGINAL_SOURCE_MODE;
    }
  });

  it('defaults to index mode', () => {
    delete process.env.DRUG_MASTER_SOURCE_MODE;
    expect(getConfiguredSourceMode()).toBe('index');
  });

  it('returns single when explicitly set', () => {
    process.env.DRUG_MASTER_SOURCE_MODE = 'single';
    expect(getConfiguredSourceMode()).toBe('single');
  });

  it('returns index for any non-single value', () => {
    process.env.DRUG_MASTER_SOURCE_MODE = 'other';
    expect(getConfiguredSourceMode()).toBe('index');
  });
});
