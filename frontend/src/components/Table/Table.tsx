import React from 'react';
import { TableColumn, PaginationState } from '../../types/designSystem';
import { Button } from '../Button/Button';
import { ChevronLeftIcon, ChevronRightIcon } from '../Icons/Icons';
import './Table.css';

export interface TableProps<T> {
  columns: TableColumn<T>[];
  data: T[];
  keyExtractor: (row: T, index: number) => string | number;
  caption?: string;
  isLoading?: boolean;
  emptyMessage?: string;
  pagination?: PaginationState;
  onPageChange?: (page: number) => void;
  className?: string;
}

export function Table<T>({
  columns,
  data,
  keyExtractor,
  caption,
  isLoading = false,
  emptyMessage = 'No records found.',
  pagination,
  onPageChange,
  className = ''
}: TableProps<T>): React.ReactElement {
  return (
    <div className={`ui-table-container ${className}`}>
      <div className="ui-table-wrapper">
        <table className="ui-table">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr>
              {columns.map(col => (
                <th
                  key={col.key}
                  style={{ width: col.width }}
                  className={`ui-table__cell--${col.align || 'left'}`}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={columns.length} className="ui-table-state-cell">
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                    <span className="ui-button__spinner" aria-hidden="true" />
                    <span>Loading data...</span>
                  </div>
                </td>
              </tr>
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="ui-table-state-cell">
                  <span style={{ color: 'var(--color-text-muted)' }}>{emptyMessage}</span>
                </td>
              </tr>
            ) : (
              data.map((row, idx) => (
                <tr key={keyExtractor(row, idx)}>
                  {columns.map(col => (
                    <td
                      key={col.key}
                      className={`ui-table__cell--${col.align || 'left'}`}
                    >
                      {col.render ? col.render(row, idx) : (row as Record<string, unknown>)[col.key] as React.ReactNode}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pagination && onPageChange && (
        <div className="ui-table-pagination">
          <div className="ui-table-pagination__info">
            <span>
              Showing {data.length > 0 ? (pagination.page - 1) * pagination.limit + 1 : 0} to{' '}
              {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} records
            </span>
          </div>
          <div className="ui-table-pagination__actions">
            <span>
              Page {pagination.page} of {pagination.totalPages || 1}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={pagination.page <= 1 || isLoading}
              onClick={() => onPageChange(pagination.page - 1)}
              aria-label="Previous page"
              leadingIcon={<ChevronLeftIcon size={16} />}
            >
              Prev
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={pagination.page >= pagination.totalPages || isLoading}
              onClick={() => onPageChange(pagination.page + 1)}
              aria-label="Next page"
              trailingIcon={<ChevronRightIcon size={16} />}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
