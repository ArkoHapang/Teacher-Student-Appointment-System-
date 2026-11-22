/**
 * Audit Logs View
 *
 * Implements administrative immutable audit trail inspection:
 * 1. View all recorded system events, status changes, and administrative actions.
 * 2. Filter by action type, entity type (USER, TEACHER_PROFILE, APPOINTMENT), and keyword search.
 * 3. Inspect actor identities, affected entities, and metadata change details.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { AuditLogRecord } from '../../types/admin';
import { adminService } from '../../services/adminService';
import { Button } from '../../components/Button/Button';
import { FormField, TextInput, Select } from '../../components/Form/Form';
import { Table } from '../../components/Table/Table';
import { Badge } from '../../components/Badge/Badge';
import { Alert } from '../../components/Alert/Alert';
import { LoadingState, ErrorState } from '../../components/Feedback/Feedback';
import { PaginationState, TableColumn } from '../../types/designSystem';

export const AuditLogsView: React.FC = () => {
  const [logs, setLogs] = useState<AuditLogRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [entityFilter, setEntityFilter] = useState('');

  // Pagination
  const [page, setPage] = useState(1);
  const limit = 15;

  const loadLogs = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await adminService.getAuditLogs();
      setLogs(res.logs);
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setErrorMessage(errorObj.message || 'Failed to load audit logs from server.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  // Unique actions list for filter dropdown
  const uniqueActions = useMemo(() => {
    const set = new Set<string>();
    logs.forEach(l => {
      if (l.action) set.add(l.action);
    });
    return Array.from(set).sort();
  }, [logs]);

  // Filtered dataset
  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      if (actionFilter && log.action !== actionFilter) {
        return false;
      }
      if (entityFilter && log.entity_type !== entityFilter) {
        return false;
      }
      if (search.trim()) {
        const query = search.toLowerCase().trim();
        const actorName = `${log.first_name} ${log.last_name}`.toLowerCase();
        const matchesActor = actorName.includes(query) || log.actor_email?.toLowerCase().includes(query);
        const matchesAction = log.action?.toLowerCase().includes(query);
        const matchesEntity = `${log.entity_type} #${log.entity_id}`.toLowerCase().includes(query);
        const matchesDetails = log.details?.toLowerCase().includes(query);
        const matchesIp = log.ip_address?.toLowerCase().includes(query);
        return matchesActor || matchesAction || matchesEntity || matchesDetails || matchesIp;
      }
      return true;
    });
  }, [logs, search, actionFilter, entityFilter]);

  // Paginated records
  const paginatedLogs = useMemo(() => {
    const startIndex = (page - 1) * limit;
    return filteredLogs.slice(startIndex, startIndex + limit);
  }, [filteredLogs, page, limit]);

  const totalPages = Math.ceil(filteredLogs.length / limit) || 1;

  const paginationState: PaginationState = {
    page,
    limit,
    total: filteredLogs.length,
    totalPages
  };

  // Metrics
  const metrics = useMemo(() => {
    let teacherActions = 0;
    let appointmentActions = 0;
    let userActions = 0;

    logs.forEach(l => {
      if (l.entity_type === 'TEACHER_PROFILE') teacherActions++;
      else if (l.entity_type === 'APPOINTMENT') appointmentActions++;
      else if (l.entity_type === 'USER') userActions++;
    });

    return {
      total: logs.length,
      teacherActions,
      appointmentActions,
      userActions
    };
  }, [logs]);

  const renderDetails = (detailsStr: string) => {
    if (!detailsStr) return <span style={{ color: 'var(--color-text-muted)' }}>-</span>;
    try {
      const parsed = JSON.parse(detailsStr);
      const entries = Object.entries(parsed);
      if (entries.length === 0) return <span>-</span>;
      return (
        <div style={{ fontSize: 'var(--font-size-xs)', fontFamily: 'monospace' }}>
          {entries.map(([k, v]) => (
            <div key={k} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '280px' }}>
              <strong>{k}:</strong> {typeof v === 'object' ? JSON.stringify(v) : String(v)}
            </div>
          ))}
        </div>
      );
    } catch {
      return (
        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
          {detailsStr}
        </span>
      );
    }
  };

  const columns: TableColumn<AuditLogRecord>[] = [
    {
      key: 'id',
      header: 'ID',
      width: '75px',
      render: row => <span className="code-identifier">#{row.id}</span>
    },
    {
      key: 'created_at',
      header: 'Timestamp',
      width: '160px',
      render: row => (
        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
          {row.created_at ? new Date(row.created_at).toLocaleString() : 'N/A'}
        </div>
      )
    },
    {
      key: 'actor',
      header: 'Actor',
      width: '180px',
      render: row => (
        <div>
          <div style={{ fontWeight: 600, color: 'var(--color-text-main)' }}>
            {row.first_name} {row.last_name}
          </div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
            {row.actor_email}
          </div>
        </div>
      )
    },
    {
      key: 'action',
      header: 'Action',
      width: '180px',
      render: row => <Badge variant="info">{row.action}</Badge>
    },
    {
      key: 'entity',
      header: 'Target Entity',
      width: '150px',
      render: row => (
        <div>
          <span style={{ fontWeight: 500, fontSize: 'var(--font-size-xs)' }}>
            {row.entity_type}
          </span>
          <div className="code-identifier" style={{ fontSize: 'var(--font-size-xs)' }}>
            #{row.entity_id}
          </div>
        </div>
      )
    },
    {
      key: 'details',
      header: 'Event Details',
      render: row => renderDetails(row.details)
    },
    {
      key: 'ip_address',
      header: 'IP Address',
      width: '110px',
      render: row => (
        <span style={{ fontSize: 'var(--font-size-xs)', fontFamily: 'monospace', color: 'var(--color-text-muted)' }}>
          {row.ip_address || '-'}
        </span>
      )
    }
  ];

  return (
    <div>
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-header__title">Audit Logs</h1>
          <p className="page-header__description">
            Immutable administrative audit trail recording security events, user moderation, and status transitions.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={loadLogs}
          disabled={isLoading}
        >
          Refresh Logs
        </Button>
      </div>

      {/* Global Alerts */}
      {errorMessage && (
        <div style={{ marginBottom: '16px' }}>
          <Alert variant="error" onDismiss={() => setErrorMessage(null)}>
            {errorMessage}
          </Alert>
        </div>
      )}

      {/* Audit Metrics Summary */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: '12px',
          marginBottom: '24px'
        }}
      >
        <div className="surface-card" style={{ padding: '16px' }}>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Total Records</div>
          <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'bold' }}>{metrics.total}</div>
        </div>
        <div className="surface-card" style={{ padding: '16px' }}>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Faculty Actions</div>
          <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'bold' }}>{metrics.teacherActions}</div>
        </div>
        <div className="surface-card" style={{ padding: '16px' }}>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Consultation Actions</div>
          <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'bold' }}>{metrics.appointmentActions}</div>
        </div>
        <div className="surface-card" style={{ padding: '16px' }}>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>User Actions</div>
          <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'bold' }}>{metrics.userActions}</div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="surface-card" style={{ marginBottom: '20px', padding: '16px' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '12px',
            alignItems: 'flex-end'
          }}
        >
          <FormField label="Search Log Ledger" htmlFor="search-logs">
            <TextInput
              id="search-logs"
              placeholder="Search by actor, action, details, IP..."
              value={search}
              onChange={e => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </FormField>

          <FormField label="Action Type" htmlFor="filter-action">
            <Select
              id="filter-action"
              value={actionFilter}
              onChange={e => {
                setActionFilter(e.target.value);
                setPage(1);
              }}
              options={[
                { value: '', label: 'All Recorded Actions' },
                ...uniqueActions.map(act => ({ value: act, label: act }))
              ]}
            />
          </FormField>

          <FormField label="Target Entity" htmlFor="filter-entity">
            <Select
              id="filter-entity"
              value={entityFilter}
              onChange={e => {
                setEntityFilter(e.target.value);
                setPage(1);
              }}
              options={[
                { value: '', label: 'All Entity Types' },
                { value: 'TEACHER_PROFILE', label: 'Faculty Profile (TEACHER_PROFILE)' },
                { value: 'APPOINTMENT', label: 'Appointment Consultation (APPOINTMENT)' },
                { value: 'USER', label: 'User Account (USER)' }
              ]}
            />
          </FormField>

          <div>
            <Button
              variant="outline"
              size="md"
              onClick={() => {
                setSearch('');
                setActionFilter('');
                setEntityFilter('');
                setPage(1);
              }}
              style={{ width: '100%' }}
            >
              Reset Filters
            </Button>
          </div>
        </div>
      </div>

      {/* Table Content */}
      {isLoading ? (
        <LoadingState message="Loading immutable audit trail..." />
      ) : errorMessage && logs.length === 0 ? (
        <ErrorState
          title="Could Not Load Audit Logs"
          message={errorMessage}
          onRetry={loadLogs}
        />
      ) : (
        <Table<AuditLogRecord>
          columns={columns}
          data={paginatedLogs}
          keyExtractor={row => row.id}
          caption="Audit Log Ledger"
          emptyMessage="No audit log entries match the selected filter criteria."
          pagination={paginationState}
          onPageChange={setPage}
        />
      )}
    </div>
  );
};
