import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useUploadPreview } from '../../hooks/useUploadPreview';
import { api } from '../../api/client';

vi.mock('../../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/client')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      upload: vi.fn(),
    },
  };
});

const mockApi = vi.mocked(api);

describe('useUploadPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers an external abort listener that forwards abort to the internal controller', async () => {
    mockApi.upload.mockImplementation((_path, _body, options) => {
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
      });
    });

    const { result } = renderHook(() => useUploadPreview());
    const externalController = new AbortController();
    const addSpy = vi.spyOn(externalController.signal, 'addEventListener');

    let previewResult: Promise<unknown>;
    await act(async () => {
      previewResult = result.current.handlePreview(
        new File(['a,b'], 'preview.csv', { type: 'text/csv' }),
        externalController.signal,
      );
    });

    // The hook registers an abort listener on the external signal to forward
    // cancellation to the internal AbortController (fire-and-forget style).
    expect(addSpy).toHaveBeenCalledWith('abort', expect.any(Function));

    externalController.abort();

    await act(async () => {
      await previewResult!;
    });

    // After abort, preview returns null
    expect(result.current.preview).toBeNull();
  });
});
