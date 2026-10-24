/**
 * Teacher Management View (GitHub Issue #37)
 * Implements administrative teacher operations:
 * - Paginated list retrieval, search, department/status/verification filters, sorting
 * - Detailed teacher profile inspection with metrics and course assignments
 * - New teacher creation modal with validation and duplicate handling
 * - Profile and permitted account field updates
 * - Status activation / suspension confirmation workflows
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  TeacherRecord,
  Department,
  CreateTeacherPayload,
  UpdateTeacherPayload
} from '../../types/admin';
import { adminService, ListTeachersParams } from '../../services/adminService';
import { Button } from '../../components/Button/Button';
import { FormField, TextInput, Select, Textarea } from '../../components/Form/Form';
import { Table } from '../../components/Table/Table';
import { Badge, UserStatusBadge } from '../../components/Badge/Badge';
import { Dialog } from '../../components/Dialog/Dialog';
import { Alert } from '../../components/Alert/Alert';
import { LoadingState, ErrorState } from '../../components/Feedback/Feedback';
import {
  PlusIcon,
  CheckIcon
} from '../../components/Icons/Icons';
import { PaginationState, TableColumn } from '../../types/designSystem';

export const TeacherManagementView: React.FC = () => {
  // Data state
  const [teachers, setTeachers] = useState<TeacherRecord[]>([]);
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
  const [verifiedFilter, setVerifiedFilter] = useState('');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>('DESC');

  // Dialogs
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isStatusDialogOpen, setIsStatusDialogOpen] = useState(false);
  const [selectedTeacher, setSelectedTeacher] = useState<TeacherRecord | null>(null);
  const [teacherDetailsLoading, setTeacherDetailsLoading] = useState(false);
  const [detailedTeacher, setDetailedTeacher] = useState<TeacherRecord | null>(null);

  // Form states
  const [createForm, setCreateForm] = useState<CreateTeacherPayload>({
    email: '',
    firstName: '',
    lastName: '',
    departmentId: 1,
    designation: 'Assistant Professor',
    officeRoom: 'Room 301',
    bio: '',
    isVerified: 1,
    status: 'ACTIVE'
  });
  const [editForm, setEditForm] = useState<UpdateTeacherPayload>({});
  const [statusAction, setStatusAction] = useState<{ targetStatus: string; reason: string }>({
    targetStatus: 'SUSPENDED',
    reason: ''
  });
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const departments: Department[] = adminService.getDepartments();

  // Load teachers from backend API
  const loadTeachers = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const params: ListTeachersParams = {
        page,
        limit,
        search: search.trim() || undefined,
        status: statusFilter || undefined,
        departmentId: departmentFilter ? parseInt(departmentFilter, 10) : undefined,
        isVerified: verifiedFilter !== '' ? verifiedFilter === '1' : undefined,
        sortBy,
        sortOrder
      };

      const res = await adminService.listTeachers(params);
      setTeachers(res.teachers);
      setTotal(res.total);
      setTotalPages(res.totalPages || 1);
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setErrorMessage(errorObj.message || 'Failed to load faculty records from the server.');
    } finally {
      setIsLoading(false);
    }
  }, [page, limit, search, statusFilter, departmentFilter, verifiedFilter, sortBy, sortOrder]);

  useEffect(() => {
    loadTeachers();
  }, [loadTeachers]);

  // Open Edit / View Details
  const handleOpenDetails = async (teacher: TeacherRecord) => {
    setSelectedTeacher(teacher);
    setDetailedTeacher(null);
    setIsEditOpen(true);
    setTeacherDetailsLoading(true);
    setDialogError(null);

    setEditForm({
      firstName: teacher.firstName,
      lastName: teacher.lastName,
      email: teacher.email,
      departmentId: teacher.department.id,
      designation: teacher.designation,
      officeRoom: teacher.officeRoom,
      bio: teacher.bio || '',
      isVerified: teacher.isVerified ? 1 : 0
    });

    try {
      const fullRecord = await adminService.getTeacher(teacher.id);
      setDetailedTeacher(fullRecord);
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setDialogError(`Could not load full teacher details: ${errorObj.message || 'Unknown error'}`);
    } finally {
      setTeacherDetailsLoading(false);
    }
  };

  // Handle Create Teacher
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setDialogError(null);

    if (!createForm.firstName.trim() || !createForm.lastName.trim() || !createForm.email.trim()) {
      setDialogError('First name, last name, and valid email address are required.');
      return;
    }

    setFormSubmitting(true);
    try {
      await adminService.createTeacher(createForm);
      setSuccessMessage(`Faculty record for ${createForm.firstName} ${createForm.lastName} created successfully.`);
      setIsCreateOpen(false);
      setCreateForm({
        email: '',
        firstName: '',
        lastName: '',
        departmentId: 1,
        designation: 'Assistant Professor',
        officeRoom: 'Room 301',
        bio: '',
        isVerified: 1,
        status: 'ACTIVE'
      });
      loadTeachers();
    } catch (err: unknown) {
      const errorObj = err as { message?: string; code?: string };
      setDialogError(errorObj.message || 'Failed to create teacher record.');
    } finally {
      setFormSubmitting(false);
    }
  };

  // Handle Edit Teacher
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTeacher) return;
    setDialogError(null);
    setFormSubmitting(true);

    try {
      await adminService.updateTeacher(selectedTeacher.id, editForm);
      setSuccessMessage(`Updated profile for ${editForm.firstName || selectedTeacher.firstName} ${editForm.lastName || selectedTeacher.lastName}.`);
      setIsEditOpen(false);
      loadTeachers();
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setDialogError(errorObj.message || 'Failed to update teacher profile.');
    } finally {
      setFormSubmitting(false);
    }
  };

  // Open Status Confirmation Dialog
  const handleOpenStatusDialog = (teacher: TeacherRecord, newStatus: string) => {
    setSelectedTeacher(teacher);
    setStatusAction({ targetStatus: newStatus, reason: '' });
    setDialogError(null);
    setIsStatusDialogOpen(true);
  };

  // Confirm Status Change
  const handleConfirmStatusChange = async () => {
    if (!selectedTeacher) return;
    setFormSubmitting(true);
    setDialogError(null);

    try {
      await adminService.updateTeacherStatus(selectedTeacher.id, {
        status: statusAction.targetStatus,
        reason: statusAction.reason.trim() || undefined
      });
      setSuccessMessage(`Status for ${selectedTeacher.firstName} ${selectedTeacher.lastName} updated to ${statusAction.targetStatus}.`);
      setIsStatusDialogOpen(false);
      loadTeachers();
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setDialogError(errorObj.message || 'Failed to update teacher status.');
    } finally {
      setFormSubmitting(false);
    }
  };

  // Table Columns Definition
  const columns: TableColumn<TeacherRecord>[] = [
    {
      key: 'id',
      header: 'ID',
      width: '70px',
      render: row => <span className="code-identifier">#{row.id}</span>
    },
    {
      key: 'name',
      header: 'Faculty Member',
      render: row => (
        <div>
          <div style={{ fontWeight: 600, color: 'var(--color-text-main)' }}>
            {row.firstName} {row.lastName}
          </div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
            {row.email} | Office: {row.officeRoom}
          </div>
        </div>
      )
    },
    {
      key: 'department',
      header: 'Department & Title',
      render: row => (
        <div>
          <div style={{ fontWeight: 500 }}>{row.designation}</div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
            {row.department.name} ({row.department.code})
          </div>
        </div>
      )
    },
    {
      key: 'status',
      header: 'Status',
      width: '120px',
      render: row => <UserStatusBadge status={row.status} />
    },
    {
      key: 'verification',
      header: 'Verification',
      width: '110px',
      render: row =>
        row.isVerified ? (
          <Badge variant="approved">Verified</Badge>
        ) : (
          <Badge variant="pending">Unverified</Badge>
        )
    },
    {
      key: 'metrics',
      header: 'Activity Metrics',
      render: row => (
        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-body)' }}>
          <span>{row.metrics?.appointmentsCount ?? 0} total consults</span>
          {row.metrics && row.metrics.upcomingAppointmentsCount > 0 && (
            <span style={{ color: 'var(--color-primary-700)', fontWeight: 600, marginLeft: '6px' }}>
              ({row.metrics.upcomingAppointmentsCount} upcoming)
            </span>
          )}
        </div>
      )
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      width: '180px',
      render: row => (
        <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleOpenDetails(row)}
            aria-label={`View or edit details for ${row.firstName} ${row.lastName}`}
          >
            Details
          </Button>
          {row.status === 'ACTIVE' ? (
            <Button
              variant="danger"
              size="sm"
              onClick={() => handleOpenStatusDialog(row, 'SUSPENDED')}
              aria-label={`Suspend ${row.firstName} ${row.lastName}`}
            >
              Suspend
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleOpenStatusDialog(row, 'ACTIVE')}
              aria-label={`Activate ${row.firstName} ${row.lastName}`}
            >
              Activate
            </Button>
          )}
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
      {/* Page Title & Action Bar */}
      <div className="page-header">
        <div>
          <h1 className="page-header__title">Faculty Management</h1>
          <p className="page-header__description">
            Maintain teacher accounts, verify department credentials, and manage operational availability.
          </p>
        </div>
        <Button
          variant="primary"
          size="md"
          leadingIcon={<PlusIcon size={18} />}
          onClick={() => {
            setDialogError(null);
            setIsCreateOpen(true);
          }}
        >
          Add Faculty Member
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

      {/* Search & Filter Bar */}
      <div className="surface-card" style={{ marginBottom: '20px', padding: '16px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', alignItems: 'flex-end' }}>
          <FormField label="Search Teachers" htmlFor="search-teachers">
            <TextInput
              id="search-teachers"
              placeholder="Search by name, email, office, or code..."
              value={search}
              onChange={e => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </FormField>

          <FormField label="Account Status" htmlFor="filter-status">
            <Select
              id="filter-status"
              value={statusFilter}
              onChange={e => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              options={[
                { value: '', label: 'All Statuses' },
                { value: 'ACTIVE', label: 'Active' },
                { value: 'PENDING_APPROVAL', label: 'Pending Approval' },
                { value: 'SUSPENDED', label: 'Suspended' }
              ]}
            />
          </FormField>

          <FormField label="Department" htmlFor="filter-department">
            <Select
              id="filter-department"
              value={departmentFilter}
              onChange={e => {
                setDepartmentFilter(e.target.value);
                setPage(1);
              }}
              options={[
                { value: '', label: 'All Academic Departments' },
                ...departments.map(d => ({ value: String(d.id), label: `${d.name} (${d.code})` }))
              ]}
            />
          </FormField>

          <FormField label="Verification" htmlFor="filter-verification">
            <Select
              id="filter-verification"
              value={verifiedFilter}
              onChange={e => {
                setVerifiedFilter(e.target.value);
                setPage(1);
              }}
              options={[
                { value: '', label: 'All Faculty' },
                { value: '1', label: 'Verified Only' },
                { value: '0', label: 'Unverified Only' }
              ]}
            />
          </FormField>

          <FormField label="Sort Order" htmlFor="filter-sort">
            <Select
              id="filter-sort"
              value={`${sortBy}:${sortOrder}`}
              onChange={e => {
                const [sb, so] = e.target.value.split(':');
                setSortBy(sb);
                setSortOrder(so as 'ASC' | 'DESC');
                setPage(1);
              }}
              options={[
                { value: 'created_at:DESC', label: 'Newest First' },
                { value: 'created_at:ASC', label: 'Oldest First' },
                { value: 'name:ASC', label: 'Name (A-Z)' },
                { value: 'name:DESC', label: 'Name (Z-A)' },
                { value: 'department:ASC', label: 'Department' }
              ]}
            />
          </FormField>
        </div>
      </div>

      {/* Main Table Display */}
      {isLoading ? (
        <LoadingState message="Loading university faculty records..." />
      ) : errorMessage && teachers.length === 0 ? (
        <ErrorState
          title="Faculty Records Unavailable"
          message={errorMessage}
          onRetry={loadTeachers}
        />
      ) : (
        <Table<TeacherRecord>
          columns={columns}
          data={teachers}
          keyExtractor={t => t.id}
          isLoading={isLoading}
          emptyMessage="No faculty records matched the selected filters."
          pagination={paginationState}
          onPageChange={newPage => setPage(newPage)}
        />
      )}

      {/* -------------------------------------------------------------
       * Modal: Create Faculty Record
       * ----------------------------------------------------------- */}
      <Dialog
        isOpen={isCreateOpen}
        onClose={() => {
          if (!formSubmitting) setIsCreateOpen(false);
        }}
        title="Add New Faculty Member"
        size="md"
        footer={
          <>
            <Button
              variant="secondary"
              size="md"
              disabled={formSubmitting}
              onClick={() => setIsCreateOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="md"
              isLoading={formSubmitting}
              onClick={handleCreateSubmit}
              leadingIcon={<CheckIcon size={16} />}
            >
              Create Faculty Record
            </Button>
          </>
        }
      >
        <form onSubmit={handleCreateSubmit}>
          {dialogError && (
            <div style={{ marginBottom: '16px' }}>
              <Alert variant="error">{dialogError}</Alert>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <FormField label="First Name" htmlFor="create-fn" required>
              <TextInput
                id="create-fn"
                value={createForm.firstName}
                onChange={e => setCreateForm({ ...createForm, firstName: e.target.value })}
                required
              />
            </FormField>
            <FormField label="Last Name" htmlFor="create-ln" required>
              <TextInput
                id="create-ln"
                value={createForm.lastName}
                onChange={e => setCreateForm({ ...createForm, lastName: e.target.value })}
                required
              />
            </FormField>
          </div>

          <FormField label="Academic Email Address" htmlFor="create-email" required helperText="Must be unique across all system users.">
            <TextInput
              id="create-email"
              type="email"
              value={createForm.email}
              onChange={e => setCreateForm({ ...createForm, email: e.target.value })}
              required
            />
          </FormField>

          <FormField label="Academic Department" htmlFor="create-dept" required>
            <Select
              id="create-dept"
              value={createForm.departmentId}
              onChange={e => setCreateForm({ ...createForm, departmentId: parseInt(e.target.value, 10) })}
              options={departments.map(d => ({ value: d.id, label: `${d.name} (${d.code})` }))}
            />
          </FormField>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <FormField label="Academic Designation" htmlFor="create-desig" required>
              <TextInput
                id="create-desig"
                value={createForm.designation}
                onChange={e => setCreateForm({ ...createForm, designation: e.target.value })}
                required
              />
            </FormField>
            <FormField label="Office Room Location" htmlFor="create-office" required>
              <TextInput
                id="create-office"
                value={createForm.officeRoom}
                onChange={e => setCreateForm({ ...createForm, officeRoom: e.target.value })}
                required
              />
            </FormField>
          </div>

          <FormField label="Biography & Research Areas" htmlFor="create-bio">
            <Textarea
              id="create-bio"
              value={createForm.bio}
              onChange={e => setCreateForm({ ...createForm, bio: e.target.value })}
              rows={3}
              placeholder="e.g. Specializes in distributed systems and software engineering."
            />
          </FormField>
        </form>
      </Dialog>

      {/* -------------------------------------------------------------
       * Modal: Faculty Details & Edit Permitted Fields
       * ----------------------------------------------------------- */}
      <Dialog
        isOpen={isEditOpen}
        onClose={() => {
          if (!formSubmitting) setIsEditOpen(false);
        }}
        title={`Faculty Profile #${selectedTeacher?.id}: ${selectedTeacher?.firstName} ${selectedTeacher?.lastName}`}
        size="lg"
        footer={
          <>
            <Button
              variant="secondary"
              size="md"
              disabled={formSubmitting}
              onClick={() => setIsEditOpen(false)}
            >
              Close
            </Button>
            <Button
              variant="primary"
              size="md"
              isLoading={formSubmitting}
              onClick={handleEditSubmit}
            >
              Save Profile Changes
            </Button>
          </>
        }
      >
        {teacherDetailsLoading ? (
          <LoadingState message="Fetching complete teacher details & metrics..." />
        ) : (
          <form onSubmit={handleEditSubmit}>
            {dialogError && (
              <div style={{ marginBottom: '16px' }}>
                <Alert variant="error">{dialogError}</Alert>
              </div>
            )}

            {/* Metrics Snapshot */}
            {detailedTeacher?.stats && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 1fr)',
                  gap: '12px',
                  marginBottom: '20px',
                  backgroundColor: 'var(--color-bg-surface-subtle)',
                  padding: '12px',
                  borderRadius: 'var(--radius-md)'
                }}
              >
                <div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Total Consultations</div>
                  <div style={{ fontSize: 'var(--font-size-xl)', fontWeight: 'bold' }}>{detailedTeacher.stats.totalAppointments}</div>
                </div>
                <div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Upcoming Consultations</div>
                  <div style={{ fontSize: 'var(--font-size-xl)', fontWeight: 'bold', color: 'var(--color-primary-700)' }}>
                    {detailedTeacher.stats.upcomingAppointments}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Completed</div>
                  <div style={{ fontSize: 'var(--font-size-xl)', fontWeight: 'bold', color: 'var(--color-success-700)' }}>
                    {detailedTeacher.stats.completedAppointments}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Available Open Slots</div>
                  <div style={{ fontSize: 'var(--font-size-xl)', fontWeight: 'bold' }}>{detailedTeacher.stats.activeOpenSlots}</div>
                </div>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <FormField label="First Name" htmlFor="edit-fn" required>
                <TextInput
                  id="edit-fn"
                  value={editForm.firstName || ''}
                  onChange={e => setEditForm({ ...editForm, firstName: e.target.value })}
                />
              </FormField>
              <FormField label="Last Name" htmlFor="edit-ln" required>
                <TextInput
                  id="edit-ln"
                  value={editForm.lastName || ''}
                  onChange={e => setEditForm({ ...editForm, lastName: e.target.value })}
                />
              </FormField>
            </div>

            <FormField label="Email Address" htmlFor="edit-email" required>
              <TextInput
                id="edit-email"
                type="email"
                value={editForm.email || ''}
                onChange={e => setEditForm({ ...editForm, email: e.target.value })}
              />
            </FormField>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <FormField label="Academic Department" htmlFor="edit-dept" required>
                <Select
                  id="edit-dept"
                  value={editForm.departmentId}
                  onChange={e => setEditForm({ ...editForm, departmentId: parseInt(e.target.value, 10) })}
                  options={departments.map(d => ({ value: d.id, label: `${d.name} (${d.code})` }))}
                />
              </FormField>
              <FormField label="Verification Status" htmlFor="edit-verif">
                <Select
                  id="edit-verif"
                  value={String(editForm.isVerified ?? 1)}
                  onChange={e => setEditForm({ ...editForm, isVerified: parseInt(e.target.value, 10) })}
                  options={[
                    { value: '1', label: 'Verified Faculty Member' },
                    { value: '0', label: 'Unverified' }
                  ]}
                />
              </FormField>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <FormField label="Designation" htmlFor="edit-desig" required>
                <TextInput
                  id="edit-desig"
                  value={editForm.designation || ''}
                  onChange={e => setEditForm({ ...editForm, designation: e.target.value })}
                />
              </FormField>
              <FormField label="Office Room" htmlFor="edit-office" required>
                <TextInput
                  id="edit-office"
                  value={editForm.officeRoom || ''}
                  onChange={e => setEditForm({ ...editForm, officeRoom: e.target.value })}
                />
              </FormField>
            </div>

            <FormField label="Biography" htmlFor="edit-bio">
              <Textarea
                id="edit-bio"
                value={editForm.bio || ''}
                onChange={e => setEditForm({ ...editForm, bio: e.target.value })}
                rows={3}
              />
            </FormField>

            {/* Assigned Courses Section */}
            {detailedTeacher?.courses && detailedTeacher.courses.length > 0 && (
              <div style={{ marginTop: '16px' }}>
                <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', marginBottom: '8px' }}>
                  Assigned Teaching Courses
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {detailedTeacher.courses.map(c => (
                    <span key={c.id} className="code-identifier">
                      {c.courseCode} - {c.courseTitle}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </form>
        )}
      </Dialog>

      {/* -------------------------------------------------------------
       * Modal: Confirmation for Status Change
       * ----------------------------------------------------------- */}
      <Dialog
        isOpen={isStatusDialogOpen}
        onClose={() => {
          if (!formSubmitting) setIsStatusDialogOpen(false);
        }}
        title={`Confirm Faculty Status Change: ${statusAction.targetStatus}`}
        size="sm"
        footer={
          <>
            <Button
              variant="secondary"
              size="md"
              disabled={formSubmitting}
              onClick={() => setIsStatusDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant={statusAction.targetStatus === 'SUSPENDED' ? 'danger' : 'primary'}
              size="md"
              isLoading={formSubmitting}
              onClick={handleConfirmStatusChange}
            >
              Confirm Status Change
            </Button>
          </>
        }
      >
        <div>
          {dialogError && (
            <div style={{ marginBottom: '16px' }}>
              <Alert variant="error">{dialogError}</Alert>
            </div>
          )}

          <p style={{ marginBottom: '16px', color: 'var(--color-text-body)' }}>
            Are you sure you want to change the status of{' '}
            <strong>{selectedTeacher?.firstName} {selectedTeacher?.lastName}</strong> to{' '}
            <Badge variant={statusAction.targetStatus === 'ACTIVE' ? 'approved' : 'rejected'}>
              {statusAction.targetStatus}
            </Badge>
            ?
          </p>

          {statusAction.targetStatus === 'SUSPENDED' && (
            <div style={{ marginBottom: '16px' }}>
              <Alert variant="warning" title="Impact on Scheduled Consultations">
                Suspending this teacher deactivates their open slots and flags upcoming appointments.
                Students with pending requests will need to be notified.
              </Alert>
            </div>
          )}

          <FormField label="Administrative Reason / Notes" htmlFor="status-reason" helperText="Recorded in the permanent audit ledger.">
            <TextInput
              id="status-reason"
              placeholder="e.g. Sabbatical leave approved by Dean"
              value={statusAction.reason}
              onChange={e => setStatusAction({ ...statusAction, reason: e.target.value })}
            />
          </FormField>
        </div>
      </Dialog>
    </div>
  );
};
