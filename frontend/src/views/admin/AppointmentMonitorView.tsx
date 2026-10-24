/**
 * Appointment Monitor View (GitHub Issues #38 & #39)
 *
 * Implements:
 * 1. Real-time aggregated metrics summary cards derived from database records.
 * 2. Multi-criteria filtering (status, department, search, date range, sorting).
 * 3. Paginated appointment records table.
 * 4. Integration with AppointmentManageModal for lifecycle management and conflict detection.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  AppointmentRecord,
  AppointmentSummary,
  Department
} from '../../types/admin';
import { adminService, ListAppointmentsParams } from '../../services/adminService';
import { Button } from '../../components/Button/Button';
import { FormField, TextInput, Select } from '../../components/Form/Form';
import { Table } from '../../components/Table/Table';
import { AppointmentStatusBadge } from '../../components/Badge/Badge';
import { Alert } from '../../components/Alert/Alert';
import { LoadingState, ErrorState } from '../../components/Feedback/Feedback';
import { AppointmentManageModal } from './AppointmentManageModal';
import { PaginationState, TableColumn } from '../../types/designSystem';

export const AppointmentMonitorView: React.FC = () => {
  // Data state
  const [appointments, setAppointments] = useState<AppointmentRecord[]>([]);
  const [summary, setSummary] = useState<AppointmentSummary | null>(null);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Filters state
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>('DESC');

  // Modal inspection state
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<number | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const departments: Department[] = adminService.getDepartments();

  // Load summary and appointments
  const loadData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const params: ListAppointmentsParams = {
        page,
        limit,
        search: search.trim() || undefined,
        status: statusFilter || undefined,
        departmentId: departmentFilter ? parseInt(departmentFilter, 10) : undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        sortBy,
        sortOrder
      };

      const [listRes, summaryRes] = await Promise.all([
        adminService.listAppointments(params),
        adminService.getAppointmentSummary()
      ]);

      setAppointments(listRes.appointments);
      setTotal(listRes.total);
      setTotalPages(listRes.totalPages || 1);
      setSummary(summaryRes);
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setErrorMessage(errorObj.message || 'Failed to load appointment records from server.');
    } finally {
      setIsLoading(false);
    }
  }, [page, limit, search, statusFilter, departmentFilter, startDate, endDate, sortBy, sortOrder]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleOpenAppointment = (id: number) => {
    setSelectedAppointmentId(id);
    setIsModalOpen(true);
  };

  // Table columns definition
  const columns: TableColumn<AppointmentRecord>[] = [
    {
      key: 'id',
      header: 'ID',
      width: '75px',
      render: row => <span className="code-identifier">#{row.id}</span>
    },
    {
      key: 'title',
      header: 'Consultation Subject',
      render: row => (
        <div>
          <div style={{ fontWeight: 600, color: 'var(--color-text-main)' }}>{row.title}</div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {row.purpose}
          </div>
        </div>
      )
    },
    {
      key: 'student',
      header: 'Student',
      render: row => (
        <div>
          <div style={{ fontWeight: 500 }}>
            {row.student.firstName} {row.student.lastName}
          </div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
            ID: {row.student.studentIdNumber} | {row.student.department.code}
          </div>
        </div>
      )
    },
    {
      key: 'teacher',
      header: 'Faculty Member',
      render: row => (
        <div>
          <div style={{ fontWeight: 500 }}>
            {row.teacher.firstName} {row.teacher.lastName}
          </div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
            {row.teacher.designation} ({row.teacher.department.code})
          </div>
        </div>
      )
    },
    {
      key: 'slot',
      header: 'Scheduled Slot',
      width: '180px',
      render: row => (
        <div style={{ fontSize: 'var(--font-size-xs)' }}>
          <div style={{ fontWeight: 500 }}>{row.slot.slotDate}</div>
          <div style={{ color: 'var(--color-primary-700)', fontWeight: 600 }}>
            {row.slot.startTime} - {row.slot.endTime}
          </div>
        </div>
      )
    },
    {
      key: 'status',
      header: 'Status',
      width: '130px',
      render: row => <AppointmentStatusBadge status={row.status} />
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      width: '130px',
      render: row => (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleOpenAppointment(row.id)}
            aria-label={`Manage appointment #${row.id}`}
          >
            Manage
          </Button>
        </div>
      )
    }
  ];

  const paginationState: PaginationState = {
    page,
    limit,
    total,
    totalPages
  };

  return (
    <div>
      {/* Page Title */}
      <div className="page-header">
        <div>
          <h1 className="page-header__title">Appointment Monitor</h1>
          <p className="page-header__description">
            System-wide consultation tracking, lifecycle state management, and conflict audit ledger.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={loadData}
          disabled={isLoading}
        >
          Refresh Feed
        </Button>
      </div>

      {/* Global Alerts */}
      {successMessage && (
        <div style={{ marginBottom: '16px' }}>
          <Alert variant="success" onDismiss={() => setSuccessMessage(null)}>
            {successMessage}
          </Alert>
        </div>
      )}

      {errorMessage && (
        <div style={{ marginBottom: '16px' }}>
          <Alert variant="error" onDismiss={() => setErrorMessage(null)}>
            {errorMessage}
          </Alert>
        </div>
      )}

      {/* Real-Time Metrics Summary Cards */}
      {summary && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
            gap: '12px',
            marginBottom: '24px'
          }}
        >
          <div className="surface-card" style={{ padding: '16px' }}>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Total Recorded</div>
            <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'bold' }}>{summary.total}</div>
          </div>
          <div className="surface-card" style={{ padding: '16px' }}>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-warning-700)' }}>Pending Requests</div>
            <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'bold', color: 'var(--color-warning-700)' }}>
              {summary.byStatus?.PENDING ?? 0}
            </div>
          </div>
          <div className="surface-card" style={{ padding: '16px' }}>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-success-700)' }}>Approved</div>
            <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'bold', color: 'var(--color-success-700)' }}>
              {summary.byStatus?.APPROVED ?? 0}
            </div>
          </div>
          <div className="surface-card" style={{ padding: '16px' }}>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-primary-700)' }}>Upcoming Consults</div>
            <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'bold', color: 'var(--color-primary-700)' }}>
              {summary.upcoming ?? 0}
            </div>
          </div>
          <div className="surface-card" style={{ padding: '16px' }}>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Scheduled Today</div>
            <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'bold' }}>{summary.today ?? 0}</div>
          </div>
          <div className="surface-card" style={{ padding: '16px' }}>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Completed</div>
            <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'bold' }}>
              {summary.byStatus?.COMPLETED ?? 0}
            </div>
          </div>
          <div className="surface-card" style={{ padding: '16px' }}>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-danger-700)' }}>Cancelled / Rejected</div>
            <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'bold', color: 'var(--color-danger-700)' }}>
              {(summary.byStatus?.CANCELLED ?? 0) + (summary.byStatus?.REJECTED ?? 0)}
            </div>
          </div>
        </div>
      )}

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
          <FormField label="Search Consultations" htmlFor="search-appts">
            <TextInput
              id="search-appts"
              placeholder="Search by #ID, student, teacher, or topic..."
              value={search}
              onChange={e => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </FormField>

          <FormField label="Lifecycle Status" htmlFor="filter-appt-status">
            <Select
              id="filter-appt-status"
              value={statusFilter}
              onChange={e => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              options={[
                { value: '', label: 'All Lifecycle Statuses' },
                { value: 'PENDING', label: 'Pending Approval' },
                { value: 'APPROVED', label: 'Approved & Scheduled' },
                { value: 'RESCHEDULE_PENDING', label: 'Reschedule Pending' },
                { value: 'COMPLETED', label: 'Completed' },
                { value: 'CANCELLED', label: 'Cancelled' },
                { value: 'REJECTED', label: 'Rejected' }
              ]}
            />
          </FormField>

          <FormField label="Academic Department" htmlFor="filter-appt-dept">
            <Select
              id="filter-appt-dept"
              value={departmentFilter}
              onChange={e => {
                setDepartmentFilter(e.target.value);
                setPage(1);
              }}
              options={[
                { value: '', label: 'All Departments' },
                ...departments.map(d => ({ value: String(d.id), label: `${d.name} (${d.code})` }))
              ]}
            />
          </FormField>

          <FormField label="Date Range: From" htmlFor="filter-start-date">
            <TextInput
              id="filter-start-date"
              type="date"
              value={startDate}
              onChange={e => {
                setStartDate(e.target.value);
                setPage(1);
              }}
            />
          </FormField>

          <FormField label="Date Range: To" htmlFor="filter-end-date">
            <TextInput
              id="filter-end-date"
              type="date"
              value={endDate}
              onChange={e => {
                setEndDate(e.target.value);
                setPage(1);
              }}
            />
          </FormField>

          <FormField label="Sort By" htmlFor="filter-appt-sort">
            <Select
              id="filter-appt-sort"
              value={`${sortBy}:${sortOrder}`}
              onChange={e => {
                const [sb, so] = e.target.value.split(':');
                setSortBy(sb);
                setSortOrder(so as 'ASC' | 'DESC');
                setPage(1);
              }}
              options={[
                { value: 'created_at:DESC', label: 'Recently Created' },
                { value: 'created_at:ASC', label: 'Oldest Created' },
                { value: 'date:ASC', label: 'Schedule Date (Earliest)' },
                { value: 'date:DESC', label: 'Schedule Date (Latest)' },
                { value: 'status:ASC', label: 'Status' }
              ]}
            />
          </FormField>
        </div>
      </div>

      {/* Main Table Display */}
      {isLoading ? (
        <LoadingState message="Querying real-time appointment records..." />
      ) : errorMessage && appointments.length === 0 ? (
        <ErrorState
          title="Appointments Feed Offline"
          message={errorMessage}
          onRetry={loadData}
        />
      ) : (
        <Table<AppointmentRecord>
          columns={columns}
          data={appointments}
          keyExtractor={a => a.id}
          isLoading={isLoading}
          emptyMessage="No consultations matched your search criteria."
          pagination={paginationState}
          onPageChange={newPage => setPage(newPage)}
        />
      )}

      {/* Detailed Management & Conflict Modal */}
      <AppointmentManageModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        appointmentId={selectedAppointmentId}
        onAppointmentUpdated={() => {
          loadData();
        }}
      />
    </div>
  );
};
