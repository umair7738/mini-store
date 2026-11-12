"use client";

export default function Pagination({ page, total, pageSize, onPageChange }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return <nav className="admin-pagination" aria-label="Pagination">
    <span>Page {page} of {pages}</span>
    <button type="button" className="button small secondary" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>Previous</button>
    <button type="button" className="button small secondary" disabled={page >= pages} onClick={() => onPageChange(page + 1)}>Next</button>
  </nav>;
}
