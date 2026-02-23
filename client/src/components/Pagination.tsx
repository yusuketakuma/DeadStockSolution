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
    <BSPagination className="justify-content-center">
      <BSPagination.First onClick={() => onPageChange(1)} disabled={currentPage === 1} />
      <BSPagination.Prev onClick={() => onPageChange(currentPage - 1)} disabled={currentPage === 1} />
      {start > 1 && <BSPagination.Ellipsis disabled />}
      {pages.map((page) => (
        <BSPagination.Item
          key={page}
          active={page === currentPage}
          onClick={() => onPageChange(page)}
        >
          {page}
        </BSPagination.Item>
      ))}
      {end < totalPages && <BSPagination.Ellipsis disabled />}
      <BSPagination.Next onClick={() => onPageChange(currentPage + 1)} disabled={currentPage === totalPages} />
      <BSPagination.Last onClick={() => onPageChange(totalPages)} disabled={currentPage === totalPages} />
    </BSPagination>
  );
}
