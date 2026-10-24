/**
 * Faculty / Teacher Appointment Requests View
 * Implements:
 * 1. View incoming student consultation requests (PENDING, RESCHEDULE_PENDING).
 * 2. Approve requests according to business rules (with optional preparation notes).
 * 3. Reject requests with mandatory explanatory reason (releasing the reserved slot).
 * 4. Inspect request details and chronological transition history.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { teacherService } from '../../services/teacherService';
import { TeacherAppointmentItem } from '../../types/teacher';
import { AppointmentHistoryRecord } from '../../types/admin';
import { Button } from '../../components/Button/Button';
import { FormField, TextInput, Textarea } from '../../components/Form/Form';
import { Table } from '../../components/Table/Table';
import { AppointmentStatusBadge } from '../../components/Badge/Badge';
import { Dialog } from '../../components/Dialog/Dialog';
import { Alert } from '../../components/Alert/Alert';
import { LoadingState, EmptyState, ErrorState } from '../../components/Feedback/Feedback';
import {
  CheckIcon,
  XIcon
} from '../../components/Icons/Icons';
import { TableColumn } from '../../types/designSystem';

interface TeacherRequestsViewProps {
  onNavigateToSchedule?: () => void;
}

export const TeacherRequestsView: React.FC<TeacherRequestsViewProps> = ({
  onNavigateToSchedule
}) => {
  const [requests, setRequests] = useState<TeacherAppointmentItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Approve Modal State
  const [appointmentToApprove, setAppointmentToApprove] = useState<TeacherAppointmentItem | null>(null);
  const [approveNotes, setApproveNotes] = useState('');
  const [isApproving, setIsApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);

  // Reject Modal State
  const [appointmentToReject, setAppointmentToReject] = useState<TeacherAppointmentItem | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectNotes, setRejectNotes] = useState('');
  const [isRejecting, setIsRejecting] = useState(false);
  const [rejectError, setRejectError] = useState<string | null>(null);

  // Details Modal State
  const [selectedAppointment, setSelectedAppointment] = useState<TeacherAppointmentItem | null>(null);
  const [history, setHistory] = useState<AppointmentHistoryRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const loadRequests = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      // Retrieve appointments in pending approval status
      const res = await teacherService.getAppointments();
      const pendingItems = res.appointments.filter(a =>
        a.status === 'PENDING' || a.status === 'RESCHEDULE_PENDING'
      );
      setRequests(pendingItems);
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setErrorMessage(errorObj.message || 'Failed to retrieve appointment requests.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  const handleOpenApprove = (appt: TeacherAppointmentItem) => {
    setAppointmentToApprove(appt);
    setApproveNotes('');
    setApproveError(null);
  };

  const handleConfirmApprove = async () => {
    if (!appointmentToApprove) return;
    setIsApproving(true);
    setApproveError(null);

    try {
      await teacherService.approveAppointment(appointmentToApprove.id, approveNotes.trim());
      setSuccessMessage(`Appointment #${appointmentToApprove.id} with ${appointmentToApprove.studentFirstName} ${appointmentToApprove.studentLastName} confirmed.`);
      setAppointmentToApprove(null);
      loadRequests();
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setApproveError(errorObj.message || 'Failed to approve appointment request.');
    } finally {
      setIsApproving(false);
    }
  };

  const handleOpenReject = (appt: TeacherAppointmentItem) => {
    setAppointmentToReject(appt);
    setRejectReason('');
    setRejectNotes('');
    setRejectError(null);
  };

  const handleConfirmReject = async () => {
    if (!appointmentToReject) return;
    if (rejectReason.trim().length < 3) {
      setRejectError('Please provide a reason for rejecting the request (minimum 3 characters).');
      return;
    }

    setIsRejecting(true);
    setRejectError(null);

    try {
      await teacherService.rejectAppointment(appointmentToReject.id, rejectReason.trim(), rejectNotes.trim());
      setSuccessMessage(`Appointment #${appointmentToReject.id} rejected and the slot has been released.`);
      setAppointmentToReject(null);
      loadRequests();
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setRejectError(errorObj.message || 'Failed to reject appointment request.');
    } finally {
      setIsRejecting(false);
    }
  };

  const handleOpenDetails = async (appt: TeacherAppointmentItem) => {
    setSelectedAppointment(appt);
    setHistory([]);
    setHistoryLoading(true);

    try {
      const hist = await teacherService.getAppointmentHistory(appt.id);
      setHistory(hist);
    } catch {
      // Optional history display
    } finally {
      setHistoryLoading(false);
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
      header: 'Requested Slot',
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
      width: '260px',
      render: row => (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
          <Button
            variant="primary"
            size="sm"
            leadingIcon={<CheckIcon size={14} />}
            onClick={() => handleOpenApprove(row)}
            aria-label={`Approve request #${row.id}`}
          >
            Approve
          </Button>

          <Button
            variant="danger"
            size="sm"
            leadingIcon={<XIcon size={14} />}
            onClick={() => handleOpenReject(row)}
            aria-label={`Reject request #${row.id}`}
          >
            Reject
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => handleOpenDetails(row)}
            aria-label={`View details for request #${row.id}`}
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
          <h1 className="page-header__title">
            Student Consultation Requests
          </h1>
          <p className="page-header__description">
            Review incoming student appointment requests, inspect questions, and approve or decline consultation slots.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={loadRequests} disabled={isLoading}>
          Refresh Requests
        </Button>
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

      {/* Requests Table */}
      {isLoading ? (
        <LoadingState message="Fetching pending consultation requests..." />
      ) : errorMessage && requests.length === 0 ? (
        <ErrorState
          title="Requests Unavailable"
          message={errorMessage}
          onRetry={loadRequests}
        />
      ) : requests.length === 0 ? (
        <EmptyState
          title="No Pending Appointment Requests"
          description="You currently have no student consultation requests waiting for review. You can check your confirmed schedule."
          actionLabel={onNavigateToSchedule ? 'View Confirmed Schedule' : undefined}
          onAction={onNavigateToSchedule}
        />
      ) : (
        <Table<TeacherAppointmentItem>
          columns={columns}
          data={requests}
          keyExtractor={a => a.id}
          isLoading={isLoading}
          emptyMessage="No pending requests found."
        />
      )}

      {/* -------------------------------------------------------------
       * Modal: Approve Request
       * ----------------------------------------------------------- */}
      <Dialog
        isOpen={Boolean(appointmentToApprove)}
        onClose={() => {
          if (!isApproving) setAppointmentToApprove(null);
        }}
        title={`Approve Consultation #${appointmentToApprove?.id ?? ''}`}
        size="md"
        footer={
          <>
            <Button variant="secondary" size="md" disabled={isApproving} onClick={() => setAppointmentToApprove(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="md"
              isLoading={isApproving}
              onClick={handleConfirmApprove}
              leadingIcon={<CheckIcon size={16} />}
            >
              Confirm & Schedule
            </Button>
          </>
        }
      >
        {appointmentToApprove && (
          <div>
            {approveError && (
              <div style={{ marginBottom: '16px' }}>
                <Alert variant="error">{approveError}</Alert>
              </div>
            )}

            <div
              style={{
                backgroundColor: 'var(--color-bg-surface-subtle)',
                padding: '14px',
                borderRadius: 'var(--radius-md)',
                marginBottom: '16px',
                border: '1px solid var(--color-border-subtle)',
                fontSize: 'var(--font-size-xs)'
              }}
            >
              <div><strong>Student:</strong> {appointmentToApprove.studentFirstName} {appointmentToApprove.studentLastName} ({appointmentToApprove.studentIdNumber})</div>
              <div><strong>Topic:</strong> {appointmentToApprove.title}</div>
              <div><strong>Scheduled Slot:</strong> {appointmentToApprove.slotDate} ({appointmentToApprove.startTime.slice(0, 5)} - {appointmentToApprove.endTime.slice(0, 5)})</div>
            </div>

            <FormField
              label="Preparation Guidance Notes for Student (Optional)"
              htmlFor="approve-notes-input"
              helperText="Share instructions (e.g. 'Please bring your draft code repository', 'Read Chapter 4 beforehand')."
            >
              <Textarea
                id="approve-notes-input"
                placeholder="Optional consultation notes..."
                value={approveNotes}
                onChange={e => setApproveNotes(e.target.value)}
                rows={3}
                disabled={isApproving}
              />
            </FormField>
          </div>
        )}
      </Dialog>

      {/* -------------------------------------------------------------
       * Modal: Reject Request
       * ----------------------------------------------------------- */}
      <Dialog
        isOpen={Boolean(appointmentToReject)}
        onClose={() => {
          if (!isRejecting) setAppointmentToReject(null);
        }}
        title={`Reject Consultation #${appointmentToReject?.id ?? ''}`}
        size="md"
        footer={
          <>
            <Button variant="secondary" size="md" disabled={isRejecting} onClick={() => setAppointmentToReject(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="md"
              isLoading={isRejecting}
              onClick={handleConfirmReject}
              leadingIcon={<XIcon size={16} />}
            >
              Confirm Rejection
            </Button>
          </>
        }
      >
        {appointmentToReject && (
          <div>
            {rejectError && (
              <div style={{ marginBottom: '16px' }}>
                <Alert variant="error">{rejectError}</Alert>
              </div>
            )}

            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-main)', marginBottom: '12px' }}>
              Rejecting will notify the student and release the consultation slot on <strong>{appointmentToReject.slotDate}</strong> back to your open availability.
            </p>

            <FormField
              label="Rejection Reason"
              htmlFor="reject-reason-input"
              required
              helperText="Explain why the consultation cannot proceed (minimum 3 characters)."
            >
              <TextInput
                id="reject-reason-input"
                placeholder="e.g. Schedule conflict with department faculty meeting"
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                disabled={isRejecting}
                autoFocus
              />
            </FormField>

            <div style={{ marginTop: '12px' }}>
              <FormField
                label="Alternative Guidance / Next Steps (Optional)"
                htmlFor="reject-notes-input"
              >
                <Textarea
                  id="reject-notes-input"
                  placeholder="e.g. Please book a slot on Thursday instead or email teaching assistants."
                  value={rejectNotes}
                  onChange={e => setRejectNotes(e.target.value)}
                  rows={2}
                  disabled={isRejecting}
                />
              </FormField>
            </div>
          </div>
        )}
      </Dialog>

      {/* -------------------------------------------------------------
       * Modal: Detailed Inspection & History
       * ----------------------------------------------------------- */}
      <Dialog
        isOpen={Boolean(selectedAppointment)}
        onClose={() => setSelectedAppointment(null)}
        title={`Consultation #${selectedAppointment?.id ?? ''}: ${selectedAppointment?.title ?? ''}`}
        size="md"
        footer={
          <Button variant="secondary" size="md" onClick={() => setSelectedAppointment(null)}>
            Close
          </Button>
        }
      >
        {selectedAppointment && (
          <div>
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
                  <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>
                    {selectedAppointment.studentFirstName} {selectedAppointment.studentLastName}
                  </div>
                  <div style={{ color: 'var(--color-text-muted)' }}>
                    Student ID: {selectedAppointment.studentIdNumber} &bull; {selectedAppointment.studentEmail}
                  </div>
                </div>
                <AppointmentStatusBadge status={selectedAppointment.status} />
              </div>

              <div style={{ borderTop: '1px solid var(--color-border-subtle)', paddingTop: '8px', marginTop: '8px' }}>
                <div><strong>Requested Slot:</strong> {selectedAppointment.slotDate} ({selectedAppointment.startTime.slice(0, 5)} - {selectedAppointment.endTime.slice(0, 5)})</div>
                <div><strong>Submitted:</strong> {new Date(selectedAppointment.createdAt).toLocaleString()}</div>
              </div>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>
                Consultation Purpose & Questions
              </div>
              <div style={{ fontSize: 'var(--font-size-sm)', backgroundColor: 'var(--color-bg-app)', padding: '10px 12px', borderRadius: 'var(--radius-sm)', whiteSpace: 'pre-wrap' }}>
                {selectedAppointment.purpose}
              </div>
            </div>

            {/* Chronological History */}
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
