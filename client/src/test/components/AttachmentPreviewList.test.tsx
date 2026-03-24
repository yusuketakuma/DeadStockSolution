import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import AttachmentPreviewList from '../../components/ui/AttachmentPreviewList';

describe('AttachmentPreviewList', () => {
  it('previews text attachments in a modal while keeping the download link', async () => {
    const fetchMock = vi.fn(async () => new Response('preview body', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AttachmentPreviewList
        attachments={[
          {
            id: 1,
            fileName: 'note.txt',
            mimeType: 'text/plain',
            fileSize: 2048,
          },
        ]}
        getDownloadUrl={(attachmentId) => `/api/files/${attachmentId}`}
      />,
    );

    expect(screen.getByRole('link', { name: 'ダウンロード' })).toHaveAttribute('href', '/api/files/1');

    await userEvent.click(screen.getByRole('button', { name: 'プレビュー' }));

    await waitFor(() => {
      expect(screen.getByText('preview body')).toBeInTheDocument();
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/files/1', { credentials: 'include' });
  });
});
