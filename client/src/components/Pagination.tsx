import { Pagination as BSPagination } from 'react-bootstrap';

interface Props {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export default function Pagination({ currentPage, totalPages, onPageChange }: Props) {
  if (totalPages <= 1) return null;

  const pages: number[] = [];
  const start = Math.max(1, currentPage - 2);
  const end = Math.min(totalPages, currentPage + 2);

  for (let i = start; i <= end; i++) {
    pages.push(i);
  }

  return (
    <BSPagination className="justify-content-center" aria-label="ページネーション">
      <BSPagination.First aria-label="最初のページへ" onClick={() => onPageChange(1)} disabled={currentPage === 1} />
      <BSPagination.Prev aria-label="前のページへ" onClick={() => onPageChange(currentPage - 1)} disabled={currentPage === 1} />
      {start > 1 && <BSPagination.Ellipsis disabled />}
      {pages.map((page) => (
        <BSPagination.Item
          key={page}
          active={page === currentPage}
          aria-current={page === currentPage ? 'page' : undefined}
          aria-label={page === currentPage ? `現在のページ ${page}` : `ページ ${page}`}
          onClick={() => onPageChange(page)}
        >
          {page}
        </BSPagination.Item>
      ))}
      {end < totalPages && <BSPagination.Ellipsis disabled />}
      <BSPagination.Next aria-label="次のページへ" onClick={() => onPageChange(currentPage + 1)} disabled={currentPage === totalPages} />
      <BSPagination.Last aria-label="最後のページへ" onClick={() => onPageChange(totalPages)} disabled={currentPage === totalPages} />
    </BSPagination>
  );
}
