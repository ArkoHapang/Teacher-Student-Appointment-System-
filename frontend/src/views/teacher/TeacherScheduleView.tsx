/**
 * Faculty / Teacher Confirmed Schedule & Consultation History View
 * Implements:
 * 1. View confirmed upcoming consultations (APPROVED).
 * 2. View historical consultations (COMPLETED, CANCELLED, REJECTED).
 * 3. Mark consultation as COMPLETED upon meeting with the student.
 * 4. Cancel consultations with an explanatory reason where allowed.
 * 5. Reschedule consultations to alternative open office hour slots.
 * 6. Audit chronological status transitions.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { teacherService } from '../../services/teacherService';
import { TeacherAppointmentItem, TeacherSlotItem } from '../../types/teacher';
import { AppointmentHistoryRecord } from '../../types/admin';
import { Button } from '../../components/Button/Button';
import { FormField, TextInput, Select } from '../../components/Form/Form';
import { Table } from '../../components/Table/Table';
import { AppointmentStatusBadge } from '../../components/Badge/Badge';
import { Dialog } from '../../components/Dialog/Dialog';
import { Alert } from '../../components/Alert/Alert';
import { LoadingState, EmptyState, ErrorState } from '../../components/Feedback/Feedback';
import {
  CheckIcon
} from '../../components/Icons/Icons';
import { TableColumn } from '../../types/designSystem';

interface TeacherScheduleViewProps {
  teacherId: number;
  onNavigateToAvailability?: () => void;
}

export const TeacherScheduleView: React.FC<TeacherScheduleViewProps> = ({
  teacherId,
  onNavigateToAvailability
}) => {
  const [appointments, setAppointments] = useState<TeacherAppointmentItem[]>([]);
  const [filter, setFilter] = useState<'UPCOMING' | 'COMPLETED' | 'ALL' | 'CANCELLED'>('UPCOMING');
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Modal inspection state
  const [selectedAppointment, setSelectedAppointment] = useState<TeacherAppointmentItem | null>(null);
  const [history, setHistory] = useState<AppointmentHistoryRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Action states: 'complete' | 'cancel' | 'reschedule' | null
  const [activeAction, setActiveAction] = useState<'complete' | 'cancel' | 'reschedule' | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [rescheduleSlotId, setRescheduleSlotId] = useState<number | null>(null);
  const [rescheduleReason, setRescheduleReason] = useState('');
  const [availableSlots, setAvailableSlots] = useState<TeacherSlotItem[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadSchedule = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await teacherService.getAppointments();
      setAppointments(res.appointments);
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setErrorMessage(errorObj.message || 'Failed to retrieve your consultation schedule.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSchedule();
  }, [loadSchedule]);

  const filteredAppointments = appointments.filter(a => {
    if (filter === 'UPCOMING') return a.status === 'APPROVED';
    if (filter === 'COMPLETED') return a.status === 'COMPLETED';
    if (filter === 'CANCELLED') return a.status === 'CANCELLED' || a.status === 'REJECTED';
    return true; // ALL
  });

  const handleOpenDetails = async (appt: TeacherAppointmentItem) => {
    setSelectedAppointment(appt);
    setActiveAction(null);
    setActionError(null);
    setHistory([]);
    setHistoryLoading(true);

    try {
      const hist = await teacherService.getAppointmentHistory(appt.id);
      setHistory(hist);
    } catch {
      // History optional or handled
    } finally {
      setHistoryLoading(false);
    }
  };

  // Complete action
  const handleConfirmComplete = async () => {
    if (!selectedAppointment) return;
    setActionSubmitting(true);
    setActionError(null);

    try {
      await teacherService.completeAppointment(selectedAppointment.id);
      setSuccessMessage(`Consultation #${selectedAppointment.id} with ${selectedAppointment.studentFirstName} ${selectedAppointment.studentLastName} marked as completed.`);
      setSelectedAppointment(null);
      loadSchedule();
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setActionError(errorObj.message || 'Failed to mark consultation completed.');
    } finally {
      setActionSubmitting(false);
    }
  };

  // Cancel action
  const handleConfirmCancel = async () => {
    if (!selectedAppointment) return;
    if (cancelReason.trim().length < 3) {
      setActionError('Please provide an explanatory reason for cancellation (minimum 3 characters).');
      return;
    }

    setActionSubmitting(true);
    setActionError(null);

    try {
      await teacherService.cancelAppointment(selectedAppointment.id, cancelReason.trim());
      setSuccessMessage(`Consultation #${selectedAppointment.id} has been cancelled and the slot released.`);
      setSelectedAppointment(null);
      loadSchedule();
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setActionError(errorObj.message || 'Failed to cancel consultation.');
    } finally {
      setActionSubmitting(false);
    }
  };

  // Open Reschedule Prompt
  const handleOpenReschedule = async () => {
    if (!selectedAppointment) return;
    setActiveAction('reschedule');
    setRescheduleReason('');
    setRescheduleSlotId(null);
    setActionError(null);
    setSlotsLoading(true);

    try {
      // Get unbooked future slots for this teacher
      const slots = await teacherService.getSlots(teacherId);
      const unbookedSlots = slots.filter(s => !s.isBooked && s.isActive && s.id !== selectedAppointment.slotId);
      setAvailableSlots(unbookedSlots);
      if (unbookedSlots.length > 0) {
        setRescheduleSlotId(unbookedSlots[0].id);
      }
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setActionError(errorObj.message || 'Failed to retrieve available slots.');
    } finally {
      setSlotsLoading(false);
    }
  };

  // Confirm Reschedule
  const handleConfirmReschedule = async () => {
    if (!selectedAppointment || !rescheduleSlotId) {
      setActionError('Please select a target availability slot.');
      return;
    }
    if (rescheduleReason.trim().length < 3) {
      setActionError('Please provide an academic reason for rescheduling (minimum 3 characters).');
      return;
    }

    setActionSubmitting(true);
    setActionError(null);

    try {
      await teacherService.rescheduleAppointment(selectedAppointment.id, rescheduleSlotId, rescheduleReason.trim());
      setSuccessMessage(`Consultation #${selectedAppointment.id} has been successfully rescheduled.`);
      setSelectedAppointment(null);
      loadSchedule();
    } catch (err: unknown) {
      const errorObj = err as { message?: string; code?: string; status?: number };
      if (errorObj.status === 409 || errorObj.code === 'SLOT_UNAVAILABLE') {
        setActionError('The proposed slot has already been reserved or conflicts with another consultation.');
      } else {
        setActionError(errorObj.message || 'Failed to reschedule consultation.');
      }
    } finally {
      setActionSubmitting(false);
    }
  };

  const columns: TableColumn<TeacherAppointmentItem>[] = [
    {
      key: 'id',
      header: 'ID',
      width: '75px',
      render: row => <span className="code-identifier">#{row.id}</span>
    },
    {
      key: 'student',
      header: 'Student',
      render: row => (
        <div>
          <div style={{ fontWeight: 600, color: 'var(--color-text-main)' }}>
            {row.studentFirstName} {row.studentLastName}
          </div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
            ID: <span className="code-identifier">{row.studentIdNumber}</span> &bull; {row.studentEmail}
          </div>
        </div>
      )
    },
    {
      key: 'title',
      header: 'Consultation Subject',
      render: row => (
        <div>
          <div style={{ fontWeight: 500 }}>{row.title}</div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {row.purpose}
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
          <div style={{ fontWeight: 600 }}>{row.slotDate}</div>
          <div style={{ color: 'var(--color-primary-700)', fontWeight: 500 }}>
            {row.startTime.slice(0, 5)} - {row.endTime.slice(0, 5)}
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
      width: '120px',
      render: row => (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleOpenDetails(row)}
            aria-label={`View details and history for consultation #${row.id}`}
          >
            Details
          </Button>
        </div>
      )
    }
  ];

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-header__title">Faculty Consultation Schedule</h1>
          <p className="page-header__description">
            View confirmed appointments, manage upcoming consultations, and audit past consultation records.
          </p>
        </div>
      </div>

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

      {/* Filter Bar */}
      <div className="surface-card" style={{ marginBottom: '20px', padding: '16px' }}>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ maxWidth: '260px', width: '100%' }}>
            <FormField label="Filter Consultations" htmlFor="teacher-schedule-filter">
              <Select
                id="teacher-schedule-filter"
                value={filter}
                onChange={e => setFilter(e.target.value as any)}
                options={[
                  { value: 'UPCOMING', label: 'Upcoming Confirmed (APPROVED)' },
                  { value: 'COMPLETED', label: 'Completed Consultations' },
                  { value: 'CANCELLED', label: 'Cancelled / Rejected' },
                  { value: 'ALL', label: `All Consultations (${appointments.length})` }
                ]}
              />
            </FormField>
          </div>
          <Button variant="secondary" size="sm" onClick={loadSchedule} disabled={isLoading}>
            Refresh Schedule
          </Button>
        </div>
      </div>

      {/* Table Display */}
      {isLoading ? (
        <LoadingState message="Fetching your consultation schedule..." />
      ) : errorMessage && appointments.length === 0 ? (
        <ErrorState
          title="Schedule Unavailable"
          message={errorMessage}
          onRetry={loadSchedule}
        />
      ) : filteredAppointments.length === 0 ? (
        <EmptyState
          title={filter === 'UPCOMING' ? 'No Upcoming Consultations' : 'No Consultations Found'}
          description={
            filter === 'UPCOMING'
              ? 'You do not have any confirmed student consultations scheduled at this time.'
              : 'No appointments match the selected status filter.'
          }
          actionLabel={onNavigateToAvailability ? 'Manage Office Hours' : undefined}
          onAction={onNavigateToAvailability}
        />
      ) : (
        <Table<TeacherAppointmentItem>
          columns={columns}
          data={filteredAppointments}
          keyExtractor={a => a.id}
          isLoading={isLoading}
          emptyMessage="No consultations match the selected filter."
        />
      )}

      {/* -------------------------------------------------------------
       * Modal: Detailed Inspection, Status History & Actions
       * ----------------------------------------------------------- */}
      <Dialog
        isOpen={Boolean(selectedAppointment)}
        onClose={() => {
          if (!actionSubmitting) setSelectedAppointment(null);
        }}
        title={`Consultation #${selectedAppointment?.id ?? ''}: ${selectedAppointment?.title ?? 'Consultation'}`}
        size="md"
        footer={
          <Button variant="secondary" size="md" onClick={() => setSelectedAppointment(null)}>
            Close
          </Button>
        }
      >
        {selectedAppointment && (
          <div>
            {actionError && (
              <div style={{ marginBottom: '16px' }}>
                <Alert variant="error">{actionError}</Alert>
              </div>
            )}

            {/* Student Card */}
            <div
              style={{
                backgroundColor: 'var(--color-bg-surface-subtle)',
                padding: '16px',
                borderRadius: 'var(--radius-md)',
                marginBottom: '16px',
                border: '1px solid var(--color-border-subtle)',
                fontSize: 'var(--font-size-xs)'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                <div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Student Details</div>
                  <div style={{ fontWeight: 600, fontSize: 'var(--font-size-base)', color: 'var(--color-text-main)' }}>
                    {selectedAppointment.studentFirstName} {selectedAppointment.studentLastName}
                  </div>
                  <div style={{ color: 'var(--color-text-muted)' }}>
                    Student ID: {selectedAppointment.studentIdNumber} &bull; {selectedAppointment.studentEmail}
                  </div>
                </div>
                <AppointmentStatusBadge status={selectedAppointment.status} />
              </div>

              <div style={{ borderTop: '1px solid var(--color-border-subtle)', paddingTop: '8px', marginTop: '8px' }}>
                <div><strong>Scheduled Slot:</strong> {selectedAppointment.slotDate} ({selectedAppointment.startTime.slice(0, 5)} - {selectedAppointment.endTime.slice(0, 5)})</div>
                <div><strong>Your Office Room:</strong> {selectedAppointment.officeRoom}</div>
              </div>

              {selectedAppointment.cancellationReason && (
                <div style={{ marginTop: '8px', padding: '8px', backgroundColor: 'var(--color-danger-50)', color: 'var(--color-danger-700)', borderRadius: 'var(--radius-xs)' }}>
                  <strong>Cancellation/Rejection Reason:</strong> {selectedAppointment.cancellationReason}
                </div>
              )}
            </div>

            {/* Consultation Purpose */}
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>
                Student Questions & Purpose
              </div>
              <div style={{ fontSize: 'var(--font-size-sm)', backgroundColor: 'var(--color-bg-app)', padding: '10px 12px', borderRadius: 'var(--radius-sm)', whiteSpace: 'pre-wrap' }}>
                {selectedAppointment.purpose}
              </div>
            </div>

            {/* Operational Action Buttons (Only offered when permitted) */}
            {!activeAction && selectedAppointment.status === 'APPROVED' && (
              <div style={{ borderTop: '1px solid var(--color-border-subtle)', paddingTop: '12px', marginBottom: '16px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <Button
                  variant="primary"
                  size="sm"
                  leadingIcon={<CheckIcon size={14} />}
                  onClick={() => setActiveAction('complete')}
                >
                  Mark Completed
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleOpenReschedule}
                >
                  Reschedule Slot
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => {
                    setActiveAction('cancel');
                    setCancelReason('');
                  }}
                >
                  Cancel Consultation
                </Button>
              </div>
            )}

            {/* ACTIVE ACTION: COMPLETE */}
            {activeAction === 'complete' && (
              <div style={{ padding: '14px', backgroundColor: 'var(--color-bg-surface-subtle)', borderRadius: 'var(--radius-md)', marginBottom: '16px' }}>
                <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', marginBottom: '8px' }}>
                  Mark Consultation #{selectedAppointment.id} as Completed?
                </div>
                <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginBottom: '12px' }}>
                  This transitions the consultation to terminal COMPLETED state and records the academic outcome in the audit trail.
                </p>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <Button
                    variant="primary"
                    size="sm"
                    isLoading={actionSubmitting}
                    onClick={handleConfirmComplete}
                  >
                    Confirm Completion
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={actionSubmitting}
                    onClick={() => setActiveAction(null)}
                  >
                    Back
                  </Button>
                </div>
              </div>
            )}

            {/* ACTIVE ACTION: CANCEL */}
            {activeAction === 'cancel' && (
              <div style={{ padding: '14px', backgroundColor: 'var(--color-danger-50)', borderRadius: 'var(--radius-md)', marginBottom: '16px' }}>
                <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', color: 'var(--color-danger-800)', marginBottom: '8px' }}>
                  Confirm Cancellation of Consultation #{selectedAppointment.id}
                </div>
                <FormField
                  label="Cancellation Reason"
                  htmlFor="teacher-cancel-reason"
                  required
                  helperText="Explain reason (minimum 3 characters). Student will be notified and slot released."
                >
                  <TextInput
                    id="teacher-cancel-reason"
                    placeholder="e.g. Mandatory faculty department meeting"
                    value={cancelReason}
                    onChange={e => setCancelReason(e.target.value)}
                    autoFocus
                  />
                </FormField>
                <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                  <Button
                    variant="danger"
                    size="sm"
                    isLoading={actionSubmitting}
                    onClick={handleConfirmCancel}
                  >
                    Confirm Cancellation
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={actionSubmitting}
                    onClick={() => setActiveAction(null)}
                  >
                    Back
                  </Button>
                </div>
              </div>
            )}

            {/* ACTIVE ACTION: RESCHEDULE */}
            {activeAction === 'reschedule' && (
              <div style={{ padding: '14px', backgroundColor: 'var(--color-bg-surface-subtle)', borderRadius: 'var(--radius-md)', marginBottom: '16px' }}>
                <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', marginBottom: '8px' }}>
                  Reschedule Consultation #{selectedAppointment.id}
                </div>

                {slotsLoading ? (
                  <LoadingState message="Fetching your open availability slots..." />
                ) : availableSlots.length === 0 ? (
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginBottom: '8px' }}>
                    No alternative open availability slots found. Please add a new slot under Office Hours first.
                  </div>
                ) : (
                  <FormField label="Target Availability Slot" htmlFor="teacher-reschedule-slot" required>
                    <Select
                      id="teacher-reschedule-slot"
                      value={String(rescheduleSlotId ?? '')}
                      onChange={e => setRescheduleSlotId(parseInt(e.target.value, 10))}
                      options={availableSlots.map(s => ({
                        value: String(s.id),
                        label: `${s.slotDate} (${s.startTime.slice(0, 5)} - ${s.endTime.slice(0, 5)})`
                      }))}
                    />
                  </FormField>
                )}

                <FormField
                  label="Academic Reason for Rescheduling"
                  htmlFor="teacher-reschedule-reason"
                  required
                  helperText="Minimum 3 characters. Student will be notified of the time migration."
                >
                  <TextInput
                    id="teacher-reschedule-reason"
                    placeholder="e.g. Department committee session moved to morning"
                    value={rescheduleReason}
                    onChange={e => setRescheduleReason(e.target.value)}
                  />
                </FormField>

                <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                  <Button
                    variant="primary"
                    size="sm"
                    isLoading={actionSubmitting}
                    disabled={availableSlots.length === 0}
                    onClick={handleConfirmReschedule}
                  >
                    Submit Reschedule
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={actionSubmitting}
                    onClick={() => setActiveAction(null)}
                  >
                    Back
                  </Button>
                </div>
              </div>
            )}

            {/* Chronological Status Audit Ledger */}
            <div style={{ borderTop: '1px solid var(--color-border-subtle)', paddingTop: '12px' }}>
              <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', marginBottom: '8px' }}>
                Status Transition Audit Trail
              </div>

              {historyLoading ? (
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Loading transition history...</div>
              ) : history.length === 0 ? (
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>No status changes recorded.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {history.map(item => (
                    <div
                      key={item.id}
                      style={{
                        padding: '6px 8px',
                        backgroundColor: 'var(--color-bg-app)',
                        borderRadius: 'var(--radius-xs)',
                        fontSize: 'var(--font-size-xs)'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>
                          <strong>{item.previousStatus || 'REQUESTED'}</strong> &rarr; <span style={{ color: 'var(--color-primary-700)', fontWeight: 600 }}>{item.newStatus}</span>
                        </span>
                        <span style={{ color: 'var(--color-text-muted)' }}>{new Date(item.createdAt).toLocaleDateString()}</span>
                      </div>
                      {item.notes && (
                        <div style={{ color: 'var(--color-text-muted)', marginTop: '2px' }}>
                          {item.notes}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
};
