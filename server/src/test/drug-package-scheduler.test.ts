import { describe, it, expect } from 'vitest';
import { triggerManualPackageAutoSync } from '../services/drug-package-scheduler';

const ORIGINAL_SOURCE_URL = process.env.DRUG_PACKAGE_SOURCE_URL;

describe('drug-package-scheduler triggerManualPackageAutoSync', () => {
  it('returns helpful message when source URL is missing', async () => {
    if (ORIGINAL_SOURCE_URL === undefined) {
      delete process.env.DRUG_PACKAGE_SOURCE_URL;
    } else {
      process.env.DRUG_PACKAGE_SOURCE_URL = ORIGINAL_SOURCE_URL;
    }

    delete process.env.DRUG_PACKAGE_SOURCE_URL;
    const result = await triggerManualPackageAutoSync();
    expect(result.triggered).toBe(false);
    expect(result.message).toContain('sourceUrl');
  });

  it('rejects invalid source URL', async () => {
    delete process.env.DRUG_PACKAGE_SOURCE_URL;
    const result = await triggerManualPackageAutoSync({ sourceUrl: 'http://localhost/packages.xml' });
    expect(result.triggered).toBe(false);
    expect(result.message).toContain('HTTPS');
  });
});
