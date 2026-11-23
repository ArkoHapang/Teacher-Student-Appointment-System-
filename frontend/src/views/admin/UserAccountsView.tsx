/**
 * User Accounts View
 *
 * Implements administrative oversight of all system user accounts:
 * 1. View all users across roles (STUDENT, TEACHER, ADMIN).
 * 2. Search by name, email, or ID and filter by role and account status.
 * 3. Update user lifecycle status (ACTIVE, SUSPENDED, PENDING_APPROVAL).
 * 4. Record and reflect state modifications in real time.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { AdminUserRecord } from '../../types/admin';
import { adminService } from '../../services/adminService';
import { Button } from '../../components/Button/Button';
import { FormField, TextInput, Select } from '../../components/Form/Form';
import { Table } from '../../components/Table/Table';
import { Badge, UserStatusBadge } from '../../components/Badge/Badge';
import { Alert } from '../../components/Alert/Alert';
import { LoadingState, EmptyState, ErrorState } from '../../components/Feedback/Feedback';
import { PaginationState, TableColumn, UserStatus } from '../../types/designSystem';

export const UserAccountsView: React.FC = () => {
  const [users, setUsers] = useState<AdminUserRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [actionInProgressId, setActionInProgressId] = useState<number | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Pagination
  const [page, setPage] = useState(1);
  const limit = 10;

  const loadUsers = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await adminService.listUsers();
      setUsers(res.users);
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setErrorMessage(errorObj.message || 'Failed to load user accounts from server.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleUpdateStatus = async (user: AdminUserRecord, nextStatus: UserStatus) => {
    setActionInProgressId(user.id);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const res = await adminService.updateUserStatus(user.id, nextStatus);
      setSuccessMessage(res.message || `User #${user.id} status updated to ${nextStatus}.`);
      setUsers(prev =>
        prev.map(u => (u.id === user.id ? { ...u, status: nextStatus } : u))
      );
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setErrorMessage(errorObj.message || `Failed to update status for user #${user.id}.`);
    } finally {
      setActionInProgressId(null);
    }
  };

  // Filtered dataset
  const filteredUsers = useMemo(() => {
    return users.filter(user => {
      if (roleFilter && user.role_name !== roleFilter) {
        return false;
      }
      if (statusFilter && user.status !== statusFilter) {
        return false;
      }
      if (search.trim()) {
        const query = search.toLowerCase().trim();
        const fullName = `${user.first_name} ${user.last_name}`.toLowerCase();
        const matchesName = fullName.includes(query);
        const matchesEmail = user.email.toLowerCase().includes(query);
        const matchesId = `#${user.id}`.includes(query) || String(user.id) === query;
        return matchesName || matchesEmail || matchesId;
      }
      return true;
    });
  }, [users, search, roleFilter, statusFilter]);

  // Paginated records
  const paginatedUsers = useMemo(() => {
    const startIndex = (page - 1) * limit;
    return filteredUsers.slice(startIndex, startIndex + limit);
  }, [filteredUsers, page, limit]);

  const totalPages = Math.ceil(filteredUsers.length / limit) || 1;

  const paginationState: PaginationState = {
    page,
    limit,
    total: filteredUsers.length,
    totalPages
  };

  // Summary counts
  const summaryCounts = useMemo(() => {
    const total = users.length;
    let students = 0;
    let teachers = 0;
    let admins = 0;
    let active = 0;
    let suspended = 0;
    let pending = 0;

    users.forEach(u => {
      if (u.role_name === 'STUDENT') students++;
      else if (u.role_name === 'TEACHER') teachers++;
      else if (u.role_name === 'ADMIN') admins++;

      if (u.status === 'ACTIVE') active++;
      else if (u.status === 'SUSPENDED') suspended++;
      else if (u.status === 'PENDING_APPROVAL') pending++;
    });

    return { total, students, teachers, admins, active, suspended, pending };
  }, [users]);

  const columns: TableColumn<AdminUserRecord>[] = [
    {
      key: 'id',
      header: 'ID',
      width: '80px',
      render: row => <span className="code-identifier">#{row.id}</span>
    },
    {
      key: 'name',
      header: 'Name',
      render: row => (
        <div>
          <div style={{ fontWeight: 600, color: 'var(--color-text-main)' }}>
            {row.first_name} {row.last_name}
          </div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
            {row.email}
          </div>
        </div>
      )
    },
    {
      key: 'role_name',
      header: 'Role',
      width: '130px',
      render: row => {
        const variant =
          row.role_name === 'ADMIN'
            ? 'suspended'
            : row.role_name === 'TEACHER'
            ? 'info'
            : 'active';
        return <Badge variant={variant}>{row.role_name}</Badge>;
      }
    },
    {
      key: 'status',
      header: 'Account Status',
      width: '150px',
      render: row => <UserStatusBadge status={row.status} />
    },
    {
      key: 'created_at',
      header: 'Registered',
      width: '150px',
      render: row => (
        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
          {row.created_at ? new Date(row.created_at).toLocaleDateString() : 'N/A'}
        </span>
      )
    },
    {
      key: 'actions',
      header: 'Actions',
      width: '160px',
      align: 'right',
      render: row => {
        const isBusy = actionInProgressId === row.id;

        if (row.status === 'ACTIVE') {
          return (
            <Button
              variant="danger"
              size="sm"
              disabled={isBusy}
              onClick={() => handleUpdateStatus(row, 'SUSPENDED')}
              aria-label={`Suspend user ${row.first_name} ${row.last_name}`}
            >
              {isBusy ? 'Saving...' : 'Suspend'}
            </Button>
          );
        }

        return (
          <Button
            variant="secondary"
            size="sm"
            disabled={isBusy}
            onClick={() => handleUpdateStatus(row, 'ACTIVE')}
            aria-label={`Activate user ${row.first_name} ${row.last_name}`}
          >
            {isBusy ? 'Saving...' : 'Activate'}
          </Button>
        );
      }
    }
  ];

  return (
    <div>
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-header__title">User Accounts</h1>
          <p className="page-header__description">
            Maintain system users, view assigned roles, and manage active account credentials.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={loadUsers}
          disabled={isLoading}
        >
          Refresh Users
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

      {/* User Statistics Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
          gap: '12px',
          marginBottom: '24px'
        }}
      >
        <div className="surface-card" style={{ padding: '16px' }}>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Total Users</div>
          <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'bold' }}>{summaryCounts.total}</div>
        </div>
        <div className="surface-card" style={{ padding: '16px' }}>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Students</div>
          <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'bold' }}>{summaryCounts.students}</div>
        </div>
        <div className="surface-card" style={{ padding: '16px' }}>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Faculty</div>
          <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'bold' }}>{summaryCounts.teachers}</div>
        </div>
        <div className="surface-card" style={{ padding: '16px' }}>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Admins</div>
          <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'bold' }}>{summaryCounts.admins}</div>
        </div>
        <div className="surface-card" style={{ padding: '16px' }}>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-success-700)' }}>Active</div>
          <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'bold', color: 'var(--color-success-700)' }}>
            {summaryCounts.active}
          </div>
        </div>
        <div className="surface-card" style={{ padding: '16px' }}>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-danger-700)' }}>Suspended / Pending</div>
          <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'bold', color: 'var(--color-danger-700)' }}>
            {summaryCounts.suspended + summaryCounts.pending}
          </div>
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
          <FormField label="Search Users" htmlFor="search-users">
            <TextInput
              id="search-users"
              placeholder="Search by name, email, or #ID..."
              value={search}
              onChange={e => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </FormField>

          <FormField label="System Role" htmlFor="filter-user-role">
            <Select
              id="filter-user-role"
              value={roleFilter}
              onChange={e => {
                setRoleFilter(e.target.value);
                setPage(1);
              }}
              options={[
                { value: '', label: 'All Roles' },
                { value: 'STUDENT', label: 'Students' },
                { value: 'TEACHER', label: 'Faculty / Teachers' },
                { value: 'ADMIN', label: 'Administrators' }
              ]}
            />
          </FormField>

          <FormField label="Account Status" htmlFor="filter-user-status">
            <Select
              id="filter-user-status"
              value={statusFilter}
              onChange={e => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              options={[
                { value: '', label: 'All Statuses' },
                { value: 'ACTIVE', label: 'Active' },
                { value: 'SUSPENDED', label: 'Suspended' },
                { value: 'PENDING_APPROVAL', label: 'Pending Approval' }
              ]}
            />
          </FormField>

          <div>
            <Button
              variant="outline"
              size="md"
              onClick={() => {
                setSearch('');
                setRoleFilter('');
                setStatusFilter('');
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
        <LoadingState message="Loading user accounts..." />
      ) : errorMessage && users.length === 0 ? (
        <ErrorState
          title="Could Not Load Users"
          message={errorMessage}
          onRetry={loadUsers}
        />
      ) : users.length === 0 ? (
        <EmptyState
          title="No User Accounts Found"
          description="No user accounts are currently provisioned in the system."
        />
      ) : (
        <Table<AdminUserRecord>
          columns={columns}
          data={paginatedUsers}
          keyExtractor={row => row.id}
          caption="System Users List"
          emptyMessage="No user accounts match the selected filter criteria."
          pagination={paginationState}
          onPageChange={setPage}
        />
      )}
    </div>
  );
};
