/**
 * Appointment Management & Conflict Resolution Modal (GitHub Issues #38, #39, #40)
 *
 * Implements:
 * 1. Detailed inspection of student, teacher, slot interval, and current status.
 * 2. Immutable chronological status history ledger inspection.
 * 3. Lifecycle-compliant status transitions (Approve, Reject, Cancel, Complete).
 * 4. Permitted metadata correction (Title & Purpose).
 * 5. Reschedule consultation with conflict detection engine integration.
 * 6. Explicit display of HTTP 409 scheduling collisions with interval overlap explanation.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  AppointmentRecord,
  AppointmentHistoryRecord,
  ConflictDetectionResult
} from '../../types/admin';
import { adminService } from '../../services/adminService';
import { Button } from '../../components/Button/Button';
import { FormField, TextInput, Textarea } from '../../components/Form/Form';
import { Dialog } from '../../components/Dialog/Dialog';
import { AppointmentStatusBadge } from '../../components/Badge/Badge';
import { Alert } from '../../components/Alert/Alert';
import { LoadingState } from '../../components/Feedback/Feedback';
import {
  CalendarIcon,
  UserIcon,
  AlertTriangleIcon,
  CheckIcon,
  XIcon
} from '../../components/Icons/Icons';

interface AppointmentManageModalProps {
  isOpen: boolean;
  onClose: () => void;
  appointmentId: number | null;
  onAppointmentUpdated: () => void;
}

type ModalTab = 'details' | 'history' | 'edit_metadata' | 'reschedule';

export const AppointmentManageModal: React.FC<AppointmentManageModalProps> = ({
  isOpen,
  onClose,
  appointmentId,
  onAppointmentUpdated
}) => {
  const [activeTab, setActiveTab] = useState<ModalTab>('details');
  const [appointment, setAppointment] = useState<AppointmentRecord | null>(null);
  const [history, setHistory] = useState<AppointmentHistoryRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Metadata edit state
  const [editTitle, setEditTitle] = useState('');
  const [editPurpose, setEditPurpose] = useState('');

  // Reschedule & Conflict state
  const [rescheduleSlotId, setRescheduleSlotId] = useState('');
  const [rescheduleReason, setRescheduleReason] = useState('');
  const [isCheckingConflict, setIsCheckingConflict] = useState(false);
  const [conflictResult, setConflictResult] = useState<ConflictDetectionResult | null>(null);

  // Status Action prompt state
  const [actionConfirm, setActionConfirm] = useState<{
    action: 'approve' | 'reject' | 'cancel' | 'complete' | null;
    reasonText: string;
  }>({ action: null, reasonText: '' });

  // Load appointment details and history from backend API
  const loadData = useCallback(async () => {
    if (!appointmentId) return;
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const [apptData, histData] = await Promise.all([
        adminService.getAppointment(appointmentId),
        adminService.getAppointmentHistory(appointmentId)
      ]);
      setAppointment(apptData);
      setHistory(histData.history || []);
      setEditTitle(apptData.title);
      setEditPurpose(apptData.purpose);
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setErrorMessage(errorObj.message || 'Failed to load appointment details from server.');
    } finally {
      setIsLoading(false);
    }
  }, [appointmentId]);

  useEffect(() => {
    if (isOpen && appointmentId) {
      setActiveTab('details');
      setSuccessMessage(null);
      setErrorMessage(null);
      setConflictResult(null);
      setActionConfirm({ action: null, reasonText: '' });
      loadData();
    }
  }, [isOpen, appointmentId, loadData]);

  // Handle Save Metadata
  const handleSaveMetadata = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!appointmentId) return;
    if (editTitle.trim().length < 3 || editPurpose.trim().length < 5) {
      setErrorMessage('Title must be at least 3 characters and Purpose at least 5 characters.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await adminService.updateAppointmentMetadata(appointmentId, {
        title: editTitle.trim(),
        purpose: editPurpose.trim()
      });
      setSuccessMessage('Appointment metadata updated successfully.');
      setActiveTab('details');
      loadData();
      onAppointmentUpdated();
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setErrorMessage(errorObj.message || 'Failed to update metadata.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Pre-check conflict
  const handleCheckConflict = async () => {
    if (!appointment) return;
    const parsedSlot = parseInt(rescheduleSlotId, 10);
    if (!parsedSlot || isNaN(parsedSlot)) {
      setErrorMessage('Please enter a valid numeric slot ID to evaluate conflicts.');
      return;
    }

    setIsCheckingConflict(true);
    setErrorMessage(null);
    setConflictResult(null);

    try {
      const result = await adminService.checkConflict({
        slotId: parsedSlot,
        teacherId: appointment.teacher.profileId,
        excludeAppointmentId: appointment.id
      });
      setConflictResult(result);
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setErrorMessage(errorObj.message || 'Failed to evaluate conflict detection.');
    } finally {
      setIsCheckingConflict(false);
    }
  };

  // Submit Reschedule
  const handleRescheduleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!appointmentId) return;
    const parsedSlot = parseInt(rescheduleSlotId, 10);
    if (!parsedSlot || isNaN(parsedSlot)) {
      setErrorMessage('A valid proposed slot ID is required.');
      return;
    }
    if (rescheduleReason.trim().length < 3) {
      setErrorMessage('A valid reschedule reason (minimum 3 characters) is required.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      await adminService.rescheduleAppointment(appointmentId, {
        proposedSlotId: parsedSlot,
        reason: rescheduleReason.trim()
      });
      setSuccessMessage('Appointment rescheduled successfully.');
      setConflictResult(null);
      setActiveTab('details');
      loadData();
      onAppointmentUpdated();
    } catch (err: unknown) {
      const errorObj = err as { message?: string; code?: string; status?: number };
      setErrorMessage(errorObj.message || 'Reschedule request was rejected.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Execute Lifecycle Status Action
  const handleExecuteStatusAction = async () => {
    if (!appointmentId || !actionConfirm.action) return;
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const reason = actionConfirm.reasonText.trim();
      switch (actionConfirm.action) {
        case 'approve':
          await adminService.approveAppointment(appointmentId, reason || undefined);
          setSuccessMessage('Appointment has been APPROVED.');
          break;
        case 'reject':
          if (reason.length < 3) {
            throw new Error('A reason (minimum 3 characters) is required to reject an appointment.');
          }
          await adminService.rejectAppointment(appointmentId, { reason });
          setSuccessMessage('Appointment has been REJECTED.');
          break;
        case 'cancel':
          if (reason.length < 3) {
            throw new Error('A cancellation reason (minimum 3 characters) is required.');
          }
          await adminService.cancelAppointment(appointmentId, { cancellationReason: reason });
          setSuccessMessage('Appointment has been CANCELLED and time slot released.');
          break;
        case 'complete':
          await adminService.completeAppointment(appointmentId, { notes: reason || undefined });
          setSuccessMessage('Appointment has been marked COMPLETED.');
          break;
      }
      setActionConfirm({ action: null, reasonText: '' });
      loadData();
      onAppointmentUpdated();
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setErrorMessage(errorObj.message || 'Operation failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={`Appointment #${appointment?.id ?? ''}: ${appointment?.title ?? 'Loading...'}`}
      size="lg"
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
          <div>
            {appointment && (
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                Created: {new Date(appointment.createdAt).toLocaleString()} | ID #{appointment.id}
              </span>
            )}
          </div>
          <Button variant="secondary" size="md" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      {isLoading ? (
        <LoadingState message="Fetching appointment records, slot intervals, and status history..." />
      ) : appointment ? (
        <div>
          {/* Notification Banners */}
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

          {/* Tab Navigation */}
          <div
            style={{
              display: 'flex',
              gap: '8px',
              borderBottom: '1px solid var(--color-border-subtle)',
              marginBottom: '16px',
              paddingBottom: '8px'
            }}
          >
            <Button
              variant={activeTab === 'details' ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('details')}
            >
              Overview & Lifecycle
            </Button>
            <Button
              variant={activeTab === 'history' ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('history')}
            >
              Status History ({history.length})
            </Button>
            <Button
              variant={activeTab === 'edit_metadata' ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('edit_metadata')}
            >
              Edit Metadata
            </Button>
            <Button
              variant={activeTab === 'reschedule' ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('reschedule')}
            >
              Reschedule & Conflicts
            </Button>
          </div>

          {/* TAB 1: DETAILS & LIFECYCLE ACTIONS */}
          {activeTab === 'details' && (
            <div>
              {/* Header Details Card */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                  gap: '16px',
                  marginBottom: '20px',
                  backgroundColor: 'var(--color-bg-surface-subtle)',
                  padding: '16px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-border-subtle)'
                }}
              >
                {/* Student Info */}
                <div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <UserIcon size={14} /> Student
                  </div>
                  <div style={{ fontWeight: 600, fontSize: 'var(--font-size-base)', color: 'var(--color-text-main)' }}>
                    {appointment.student.firstName} {appointment.student.lastName}
                  </div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-body)' }}>
                    ID: {appointment.student.studentIdNumber} | {appointment.student.email}
                  </div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                    {appointment.student.department.name} ({appointment.student.department.code})
                  </div>
                </div>

                {/* Faculty Info */}
                <div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <UserIcon size={14} /> Faculty Member
                  </div>
                  <div style={{ fontWeight: 600, fontSize: 'var(--font-size-base)', color: 'var(--color-text-main)' }}>
                    {appointment.teacher.firstName} {appointment.teacher.lastName}
                  </div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-body)' }}>
                    {appointment.teacher.designation} | Office: {appointment.teacher.officeRoom}
                  </div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                    {appointment.teacher.department.name} ({appointment.teacher.department.code})
                  </div>
                </div>

                {/* Slot Interval */}
                <div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <CalendarIcon size={14} /> Scheduled Consultation Interval
                  </div>
                  <div style={{ fontWeight: 600, fontSize: 'var(--font-size-base)', color: 'var(--color-text-main)' }}>
                    {appointment.slot.slotDate}
                  </div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-primary-700)', fontWeight: 600 }}>
                    {appointment.slot.startTime} - {appointment.slot.endTime}
                  </div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                    Slot ID: #{appointment.slot.id} [start, end)
                  </div>
                </div>

                {/* Current Status */}
                <div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                    Current Status
                  </div>
                  <div style={{ marginTop: '4px' }}>
                    <AppointmentStatusBadge status={appointment.status} />
                  </div>
                  {appointment.cancellationReason && (
                    <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-danger-700)', marginTop: '4px' }}>
                      Reason: {appointment.cancellationReason}
                    </div>
                  )}
                </div>
              </div>

              {/* Consultation Subject & Purpose */}
              <div style={{ marginBottom: '20px' }}>
                <h3 style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
                  Consultation Purpose & Goals
                </h3>
                <div style={{ fontWeight: 600, fontSize: 'var(--font-size-base)', marginBottom: '4px' }}>
                  {appointment.title}
                </div>
                <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-body)', whiteSpace: 'pre-wrap', backgroundColor: 'var(--color-bg-app)', padding: '12px', borderRadius: 'var(--radius-sm)' }}>
                  {appointment.purpose}
                </div>
              </div>

              {/* Lifecycle Actions Section */}
              <div style={{ borderTop: '1px solid var(--color-border-subtle)', paddingTop: '16px' }}>
                <h3 style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text-main)', marginBottom: '8px' }}>
                  Authorized Administrative Lifecycle Transitions
                </h3>

                {actionConfirm.action ? (
                  <div className="surface-card surface-card--subtle" style={{ padding: '16px', marginBottom: '16px' }}>
                    <div style={{ fontWeight: 600, marginBottom: '8px' }}>
                      Confirm Action: {actionConfirm.action.toUpperCase()} Appointment #{appointment.id}
                    </div>
                    <FormField
                      label="Administrative Notes / Reason"
                      htmlFor="action-reason-input"
                      required={actionConfirm.action === 'reject' || actionConfirm.action === 'cancel'}
                      helperText="Recorded permanently in the status transition history ledger."
                    >
                      <TextInput
                        id="action-reason-input"
                        placeholder={
                          actionConfirm.action === 'cancel'
                            ? 'Reason for consultation cancellation...'
                            : actionConfirm.action === 'reject'
                            ? 'Reason for rejecting request...'
                            : 'Optional administrative notes...'
                        }
                        value={actionConfirm.reasonText}
                        onChange={e => setActionConfirm({ ...actionConfirm, reasonText: e.target.value })}
                        autoFocus
                      />
                    </FormField>
                    <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                      <Button
                        variant={actionConfirm.action === 'cancel' || actionConfirm.action === 'reject' ? 'danger' : 'primary'}
                        size="sm"
                        isLoading={isSubmitting}
                        onClick={handleExecuteStatusAction}
                      >
                        Confirm {actionConfirm.action.toUpperCase()}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={isSubmitting}
                        onClick={() => setActionConfirm({ action: null, reasonText: '' })}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {appointment.status === 'PENDING' && (
                      <>
                        <Button
                          variant="primary"
                          size="sm"
                          leadingIcon={<CheckIcon size={16} />}
                          onClick={() => setActionConfirm({ action: 'approve', reasonText: '' })}
                        >
                          Approve Request
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          leadingIcon={<XIcon size={16} />}
                          onClick={() => setActionConfirm({ action: 'reject', reasonText: '' })}
                        >
                          Reject Request
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => setActionConfirm({ action: 'cancel', reasonText: '' })}
                        >
                          Cancel Appointment
                        </Button>
                      </>
                    )}

                    {appointment.status === 'APPROVED' && (
                      <>
                        <Button
                          variant="primary"
                          size="sm"
                          leadingIcon={<CheckIcon size={16} />}
                          onClick={() => setActionConfirm({ action: 'complete', reasonText: '' })}
                        >
                          Mark as Completed
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => setActionConfirm({ action: 'cancel', reasonText: '' })}
                        >
                          Cancel Appointment
                        </Button>
                      </>
                    )}

                    {appointment.status === 'RESCHEDULE_PENDING' && (
                      <>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => setActionConfirm({ action: 'approve', reasonText: '' })}
                        >
                          Approve Reschedule
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => setActionConfirm({ action: 'reject', reasonText: '' })}
                        >
                          Reject Reschedule
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => setActionConfirm({ action: 'cancel', reasonText: '' })}
                        >
                          Cancel Appointment
                        </Button>
                      </>
                    )}

                    {['COMPLETED', 'CANCELLED', 'REJECTED'].includes(appointment.status) && (
                      <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                        This appointment is in a terminal status ({appointment.status}). Status cannot be altered.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: CHRONOLOGICAL STATUS HISTORY */}
          {activeTab === 'history' && (
            <div>
              <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginBottom: '16px' }}>
                Immutable audit ledger recording every status transition, timestamp, and actor ID.
              </p>
              {history.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '24px', color: 'var(--color-text-muted)' }}>
                  No historical status changes recorded for this appointment.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {history.map((item, idx) => (
                    <div
                      key={item.id || idx}
                      style={{
                        padding: '12px',
                        backgroundColor: 'var(--color-bg-app)',
                        borderRadius: 'var(--radius-sm)',
                        borderLeft: '4px solid var(--color-primary-600)'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600 }}>
                            {item.previousStatus || 'INITIAL'}
                          </span>
                          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>&rarr;</span>
                          <span style={{ fontSize: 'var(--font-size-xs)', fontWeight: 700, color: 'var(--color-primary-700)' }}>
                            {item.newStatus}
                          </span>
                        </div>
                        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                          {new Date(item.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-body)' }}>
                        <strong>Actor:</strong> {item.changedByName || `User #${item.changedBy}`} ({item.changedByRole || 'SYSTEM'})
                      </div>
                      {item.notes && (
                        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginTop: '4px' }}>
                          <strong>Notes:</strong> {item.notes}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: EDIT METADATA */}
          {activeTab === 'edit_metadata' && (
            <form onSubmit={handleSaveMetadata}>
              <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginBottom: '16px' }}>
                Authorized administrators may correct title and purpose without altering scheduled slots or status.
              </p>

              <FormField
                label="Consultation Title / Subject"
                htmlFor="edit-meta-title"
                required
                helperText="Must be between 3 and 200 characters."
              >
                <TextInput
                  id="edit-meta-title"
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  required
                />
              </FormField>

              <FormField
                label="Consultation Purpose"
                htmlFor="edit-meta-purpose"
                required
                helperText="Must be between 5 and 1000 characters."
              >
                <Textarea
                  id="edit-meta-purpose"
                  value={editPurpose}
                  onChange={e => setEditPurpose(e.target.value)}
                  rows={4}
                  required
                />
              </FormField>

              <div style={{ marginTop: '16px' }}>
                <Button
                  type="submit"
                  variant="primary"
                  size="md"
                  isLoading={isSubmitting}
                >
                  Save Metadata Changes
                </Button>
              </div>
            </form>
          )}

          {/* TAB 4: RESCHEDULE & CONFLICT DETECTION */}
          {activeTab === 'reschedule' && (
            <div>
              <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginBottom: '16px' }}>
                Reschedule this consultation to a new availability slot. The engine tests the interval-overlap rule:
                <code className="code-identifier" style={{ display: 'block', margin: '6px 0' }}>
                  existing_start &lt; requested_end AND requested_start &lt; existing_end
                </code>
                Half-open intervals [start, end) allow back-to-back bookings.
              </p>

              {/* Conflict Result Alert */}
              {conflictResult && (
                <div style={{ marginBottom: '16px' }}>
                  {conflictResult.hasConflict ? (
                    <Alert
                      variant="warning"
                      title={`Scheduling Collision Detected: ${conflictResult.code || 'APPOINTMENT_CONFLICT'}`}
                    >
                      <div>{conflictResult.message}</div>
                      {conflictResult.conflictingAppointments && conflictResult.conflictingAppointments.length > 0 && (
                        <div style={{ marginTop: '8px', fontSize: 'var(--font-size-xs)' }}>
                          <strong>Conflicting Consultations for Faculty Member:</strong>
                          <ul style={{ paddingLeft: '20px', marginTop: '4px' }}>
                            {conflictResult.conflictingAppointments.map(c => (
                              <li key={c.appointmentId}>
                                <strong>Appointment #{c.appointmentId}</strong> ({c.status}) with student {c.studentName} ({c.studentEmail}) — Interval: {c.start} to {c.end}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </Alert>
                  ) : (
                    <Alert variant="success" title="No Scheduling Collisions Detected">
                      The proposed slot interval is free of overlap conflicts for this faculty member.
                    </Alert>
                  )}
                </div>
              )}

              <form onSubmit={handleRescheduleSubmit}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '8px', alignItems: 'flex-end' }}>
                  <FormField
                    label="Proposed Slot ID"
                    htmlFor="reschedule-slot-id"
                    required
                    helperText={`Faculty member: ${appointment.teacher.firstName} ${appointment.teacher.lastName}`}
                  >
                    <TextInput
                      id="reschedule-slot-id"
                      placeholder="e.g. 2"
                      value={rescheduleSlotId}
                      onChange={e => {
                        setRescheduleSlotId(e.target.value);
                        setConflictResult(null);
                      }}
                      required
                    />
                  </FormField>
                  <div style={{ marginBottom: '16px' }}>
                    <Button
                      variant="secondary"
                      size="md"
                      isLoading={isCheckingConflict}
                      onClick={handleCheckConflict}
                      leadingIcon={<AlertTriangleIcon size={16} />}
                    >
                      Pre-Check Conflict
                    </Button>
                  </div>
                </div>

                <FormField
                  label="Administrative Reason for Rescheduling"
                  htmlFor="reschedule-reason"
                  required
                  helperText="Minimum 3 characters. Recorded in audit ledger."
                >
                  <TextInput
                    id="reschedule-reason"
                    placeholder="e.g. Faculty departmental meeting rescheduled"
                    value={rescheduleReason}
                    onChange={e => setRescheduleReason(e.target.value)}
                    required
                  />
                </FormField>

                <div style={{ marginTop: '16px', display: 'flex', gap: '8px' }}>
                  <Button
                    type="submit"
                    variant="primary"
                    size="md"
                    isLoading={isSubmitting}
                  >
                    Confirm Reschedule & Slot Migration
                  </Button>
                </div>
              </form>
            </div>
          )}
        </div>
      ) : null}
    </Dialog>
  );
};
