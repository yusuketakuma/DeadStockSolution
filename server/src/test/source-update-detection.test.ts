import { describe, expect, it } from 'vitest';
import { decideSourceUpdate } from '../services/source-update-detection';

describe('decideSourceUpdate', () => {
  it('falls back to content-hash when source headers are missing', () => {
    const decision = decideSourceUpdate(
      { etag: null, lastModified: null },
      { etag: null, lastModified: null },
    );
    expect(decision).toEqual({
      shouldDownload: true,
      compareByContentHash: true,
    });
  });

  it('detects no update when ETag is unchanged', () => {
    const decision = decideSourceUpdate(
      { etag: '"abc"', lastModified: null },
      { etag: '"abc"', lastModified: null },
    );
    expect(decision).toEqual({
      shouldDownload: false,
      compareByContentHash: false,
    });
  });

  it('detects update when ETag changed', () => {
    const decision = decideSourceUpdate(
      { etag: '"abc"', lastModified: null },
      { etag: '"def"', lastModified: null },
    );
    expect(decision).toEqual({
      shouldDownload: true,
      compareByContentHash: false,
    });
  });

  it('detects no update when Last-Modified is unchanged', () => {
    const decision = decideSourceUpdate(
      { etag: null, lastModified: 'Mon, 01 Jan 2026 00:00:00 GMT' },
      { etag: null, lastModified: 'Mon, 01 Jan 2026 00:00:00 GMT' },
    );
    expect(decision).toEqual({
      shouldDownload: false,
      compareByContentHash: false,
    });
  });

  it('downloads to establish baseline when header exists but previous state is empty', () => {
    const decision = decideSourceUpdate(
      null,
      { etag: '"abc"', lastModified: null },
    );
    expect(decision).toEqual({
      shouldDownload: true,
      compareByContentHash: false,
    });
  });

  it('downloads when ETag appears even if Last-Modified is unchanged', () => {
    const decision = decideSourceUpdate(
      { etag: null, lastModified: 'Mon, 01 Jan 2026 00:00:00 GMT' },
      { etag: '"abc"', lastModified: 'Mon, 01 Jan 2026 00:00:00 GMT' },
    );
    expect(decision).toEqual({
      shouldDownload: true,
      compareByContentHash: false,
    });
  });
});
