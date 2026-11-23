/**
 * Student Appointments View
 * Implements:
 * 1. View student consultations with live status badges.
 * 2. Detailed consultation inspection with faculty location and slot interval.
 * 3. Chronological transition audit history ledger.
 * 4. Cancellation workflow with mandatory reason.
 * 5. Rescheduling workflow with faculty availability slots.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { studentService } from '../../services/studentService';
import { StudentAppointmentItem, TeacherAvailabilitySlot, FeedbackFetchState } from '../../types/student';
import { AppointmentHistoryRecord } from '../../types/admin';
import { Button } from '../../components/Button/Button';
import { FormField, TextInput, Select, Textarea } from '../../components/Form/Form';
import { StarRating, RatingBadge } from '../../components/Rating/StarRating';
import { Table } from '../../components/Table/Table';
import { AppointmentStatusBadge } from '../../components/Badge/Badge';
import { Dialog } from '../../components/Dialog/Dialog';
import { Alert } from '../../components/Alert/Alert';
import { LoadingState, EmptyState, ErrorState } from '../../components/Feedback/Feedback';
import {
  CalendarIcon
} from '../../components/Icons/Icons';
import { TableColumn } from '../../types/designSystem';

interface StudentAppointmentsViewProps {
  onNavigateToDirectory?: () => void;
}

export const StudentAppointmentsView: React.FC<StudentAppointmentsViewProps> = ({
  onNavigateToDirectory
}) => {
  const [appointments, setAppointments] = useState<StudentAppointmentItem[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Modal inspection state
  const [selectedAppointment, setSelectedAppointment] = useState<StudentAppointmentItem | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [history, setHistory] = useState<AppointmentHistoryRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Action states: 'cancel' | 'reschedule' | null
  const [activeAction, setActiveAction] = useState<'cancel' | 'reschedule' | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [rescheduleSlotId, setRescheduleSlotId] = useState<number | null>(null);
  const [rescheduleReason, setRescheduleReason] = useState('');
  const [availableSlots, setAvailableSlots] = useState<TeacherAvailabilitySlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Feedback state & caching (Phase 5)
  const [feedbackMap, setFeedbackMap] = useState<Record<number, FeedbackFetchState>>({});
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [feedbackAppointment, setFeedbackAppointment] = useState<StudentAppointmentItem | null>(null);
  const [feedbackRating, setFeedbackRating] = useState<number>(5);
  const [feedbackComments, setFeedbackComments] = useState('');
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  // Synchronized ref to feedbackMap for reading current cache state in callbacks/effects without dependency cycles
  const feedbackMapRef = useRef(feedbackMap);
  feedbackMapRef.current = feedbackMap;

  // Tracks in-flight request IDs to prevent duplicate concurrent network requests
  const inFlightRequestsRef = useRef<Set<number>>(new Set());

  // Tracks component mounted state to prevent state updates after unmount
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadFeedbackForAppointment = useCallback(async (appointmentId: number, force = false) => {
    // Prevent duplicate concurrent requests for the same appointment ID
    if (inFlightRequestsRef.current.has(appointmentId)) {
      return;
    }

    // Unless explicitly forced (e.g. retry after error), skip if already loading or successfully loaded
    if (!force) {
      const currentState = feedbackMapRef.current[appointmentId];
      if (currentState && (currentState.status === 'loading' || currentState.status === 'success')) {
        return;
      }
    }

    inFlightRequestsRef.current.add(appointmentId);
    setFeedbackMap(prev => ({
      ...prev,
      [appointmentId]: { status: 'loading' }
    }));

    try {
      const fb = await studentService.getFeedback(appointmentId);
      if (!isMountedRef.current) return;

      setFeedbackMap(prev => {
        // Stale guard: if feedback was already recorded/submitted with data, do not overwrite with null
        const existing = prev[appointmentId];
        if (existing?.status === 'success' && existing.data && !fb) {
          return prev;
        }
        return {
          ...prev,
          [appointmentId]: { status: 'success', data: fb }
        };
      });
    } catch (err: unknown) {
      if (!isMountedRef.current) return;
      const errorObj = err as { message?: string };
      setFeedbackMap(prev => ({
        ...prev,
        [appointmentId]: {
          status: 'error',
          error: errorObj.message || 'Failed to retrieve feedback record.'
        }
      }));
    } finally {
      inFlightRequestsRef.current.delete(appointmentId);
    }
  }, []);

  const loadAppointments = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await studentService.getAppointments(statusFilter || undefined);
      setAppointments(res.appointments);
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setErrorMessage(errorObj.message || 'Failed to retrieve your appointment records.');
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    loadAppointments();
  }, [loadAppointments]);

  // Proactively cache feedback for COMPLETED consultations without duplicate queries or invalidation cycles
  useEffect(() => {
    const completed = appointments.filter(a => a.status === 'COMPLETED');
    completed.forEach(a => {
      const currentState = feedbackMapRef.current[a.id];
      if (!currentState || currentState.status === 'idle') {
        loadFeedbackForAppointment(a.id);
      }
    });
  }, [appointments, loadFeedbackForAppointment]);

  const handleOpenDetails = async (appt: StudentAppointmentItem) => {
    setSelectedAppointment(appt);
    setIsDetailOpen(true);
    setActiveAction(null);
    setActionError(null);
    setHistory([]);
    setHistoryLoading(true);

    if (appt.status === 'COMPLETED') {
      const currentState = feedbackMapRef.current[appt.id];
      if (!currentState || currentState.status === 'idle') {
        loadFeedbackForAppointment(appt.id);
      }
    }

    try {
      const hist = await studentService.getAppointmentHistory(appt.id);
      setHistory(hist);
    } catch {
      // History optional or handled
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleOpenFeedback = (appt: StudentAppointmentItem) => {
    setFeedbackAppointment(appt);
    setFeedbackRating(5);
    setFeedbackComments('');
    setFeedbackError(null);
    setIsFeedbackOpen(true);
  };

  const handleSubmitFeedback = async () => {
    if (!feedbackAppointment) return;
    if (feedbackRating < 1 || feedbackRating > 5) {
      setFeedbackError('Please select a rating between 1 and 5 stars.');
      return;
    }

    setFeedbackSubmitting(true);
    setFeedbackError(null);

    try {
      const created = await studentService.submitFeedback(feedbackAppointment.id, {
        rating: feedbackRating,
        comments: feedbackComments.trim() || undefined
      });

      setFeedbackMap(prev => ({
        ...prev,
        [feedbackAppointment.id]: { status: 'success', data: created }
      }));

      setSuccessMessage('Thank you! Your consultation feedback has been submitted successfully.');
      setIsFeedbackOpen(false);
      setFeedbackAppointment(null);
    } catch (err: unknown) {
      const errorObj = err as { message?: string; code?: string; status?: number };
      if (errorObj.code === 'DUPLICATE_FEEDBACK' || errorObj.status === 409) {
        setFeedbackError('Feedback has already been submitted for this consultation.');
      } else {
        setFeedbackError(errorObj.message || 'Failed to submit feedback. Please try again.');
      }
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  // Open Cancel Prompt
  const handleOpenCancel = () => {
    setActiveAction('cancel');
    setCancelReason('');
    setActionError(null);
  };

  // Execute Cancel
  const handleConfirmCancel = async () => {
    if (!selectedAppointment) return;
    if (cancelReason.trim().length < 3) {
      setActionError('Please provide a reason for cancelling (minimum 3 characters).');
      return;
    }

    setActionSubmitting(true);
    setActionError(null);

    try {
      await studentService.cancelAppointment(selectedAppointment.id, cancelReason.trim());
      setSuccessMessage('Appointment has been cancelled and the slot released.');
      setIsDetailOpen(false);
      loadAppointments();
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setActionError(errorObj.message || 'Failed to cancel appointment.');
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
      const slots = await studentService.getTeacherSlots(selectedAppointment.teacherId);
      const eligibleSlots = slots.filter(s => s.id !== selectedAppointment.slotId);
      setAvailableSlots(eligibleSlots);
      if (eligibleSlots.length > 0) {
        setRescheduleSlotId(eligibleSlots[0].id);
      }
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setActionError(errorObj.message || 'Failed to fetch availability slots for this teacher.');
    } finally {
      setSlotsLoading(false);
    }
  };

  // Execute Reschedule
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
      await studentService.rescheduleAppointment(selectedAppointment.id, rescheduleSlotId, rescheduleReason.trim());
      setSuccessMessage('Your appointment has been successfully rescheduled.');
      setIsDetailOpen(false);
      loadAppointments();
    } catch (err: unknown) {
      const errorObj = err as { message?: string; code?: string; status?: number };
      if (errorObj.status === 409 || errorObj.code === 'SLOT_UNAVAILABLE') {
        setActionError('The proposed slot has already been reserved or conflicts with another consultation.');
      } else {
        setActionError(errorObj.message || 'Failed to reschedule appointment.');
      }
    } finally {
      setActionSubmitting(false);
    }
  };

  // Table Columns
  const columns: TableColumn<StudentAppointmentItem>[] = [
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
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {row.purpose}
          </div>
        </div>
      )
    },
    {
      key: 'teacher',
      header: 'Assigned Faculty',
      render: row => (
        <div>
          <div style={{ fontWeight: 500 }}>
            {row.teacherFirstName} {row.teacherLastName}
          </div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
            {row.designation} &bull; Room {row.officeRoom}
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
          <div style={{ fontWeight: 500 }}>{row.slotDate}</div>
          <div style={{ color: 'var(--color-primary-700)', fontWeight: 600 }}>
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
      width: '180px',
      render: row => {
        const fbState = feedbackMap[row.id];
        return (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', alignItems: 'center' }}>
            {row.status === 'COMPLETED' && (
              fbState?.status === 'success' && fbState.data ? (
                <RatingBadge rating={fbState.data.rating} />
              ) : fbState?.status === 'success' && fbState.data === null ? (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => handleOpenFeedback(row)}
                  aria-label={`Leave feedback for completed consultation #${row.id}`}
                >
                  Leave Feedback
                </Button>
              ) : fbState?.status === 'error' ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => loadFeedbackForAppointment(row.id, true)}
                  aria-label={`Retry loading feedback status for consultation #${row.id}`}
                >
                  Retry
                </Button>
              ) : null
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleOpenDetails(row)}
              aria-label={`View details and status history for appointment #${row.id}`}
            >
              Details
            </Button>
          </div>
        );
      }
    }
  ];

  return (
    <div>
      {/* Page Title */}
      <div className="page-header">
        <div>
          <h1 className="page-header__title">My Consultations</h1>
          <p className="page-header__description">
            Track your appointment requests, view faculty confirmations, and manage scheduled consultations.
          </p>
        </div>
        {onNavigateToDirectory && (
          <Button
            variant="primary"
            size="md"
            leadingIcon={<CalendarIcon size={16} />}
            onClick={onNavigateToDirectory}
          >
            Book New Consultation
          </Button>
        )}
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
          <div style={{ maxWidth: '240px', width: '100%' }}>
            <FormField label="Filter by Status" htmlFor="student-status-filter">
              <Select
                id="student-status-filter"
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                options={[
                  { value: '', label: 'All Consultations' },
                  { value: 'PENDING', label: 'Pending Faculty Approval' },
                  { value: 'APPROVED', label: 'Confirmed & Scheduled' },
                  { value: 'COMPLETED', label: 'Completed' },
                  { value: 'CANCELLED', label: 'Cancelled' },
                  { value: 'REJECTED', label: 'Rejected by Teacher' }
                ]}
              />
            </FormField>
          </div>
          <Button variant="secondary" size="sm" onClick={loadAppointments} disabled={isLoading}>
            Refresh
          </Button>
        </div>
      </div>

      {/* Table Display */}
      {isLoading ? (
        <LoadingState message="Fetching your consultation appointments..." />
      ) : errorMessage && appointments.length === 0 ? (
        <ErrorState
          title="Consultations Unavailable"
          message={errorMessage}
          onRetry={loadAppointments}
        />
      ) : appointments.length === 0 ? (
        <EmptyState
          title="No Scheduled Consultations"
          description="You currently have no appointments matching this status. Browse faculty office hours to request a slot."
          actionLabel="Browse Faculty Directory"
          onAction={onNavigateToDirectory}
        />
      ) : (
        <Table<StudentAppointmentItem>
          columns={columns}
          data={appointments}
          keyExtractor={a => a.id}
          isLoading={isLoading}
          emptyMessage="No consultations found."
        />
      )}

      {/* -------------------------------------------------------------
       * Modal: Detailed Inspection, Status History & Actions
       * ----------------------------------------------------------- */}
      <Dialog
        isOpen={isDetailOpen}
        onClose={() => {
          if (!actionSubmitting) setIsDetailOpen(false);
        }}
        title={`Consultation #${selectedAppointment?.id ?? ''}: ${selectedAppointment?.title ?? 'Consultation'}`}
        size="md"
        footer={
          <Button variant="secondary" size="md" onClick={() => setIsDetailOpen(false)}>
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

            {/* Consultation Card */}
            <div
              style={{
                backgroundColor: 'var(--color-bg-surface-subtle)',
                padding: '16px',
                borderRadius: 'var(--radius-md)',
                marginBottom: '16px',
                border: '1px solid var(--color-border-subtle)'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                <div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Assigned Faculty</div>
                  <div style={{ fontWeight: 600, fontSize: 'var(--font-size-base)', color: 'var(--color-text-main)' }}>
                    {selectedAppointment.teacherFirstName} {selectedAppointment.teacherLastName}
                  </div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                    {selectedAppointment.designation} &bull; Room {selectedAppointment.officeRoom}
                  </div>
                </div>
                <AppointmentStatusBadge status={selectedAppointment.status} />
              </div>

              <div style={{ borderTop: '1px solid var(--color-border-subtle)', paddingTop: '8px', marginTop: '8px', fontSize: 'var(--font-size-xs)' }}>
                <div>
                  <strong>Scheduled Date & Time:</strong> {selectedAppointment.slotDate} ({selectedAppointment.startTime.slice(0, 5)} - {selectedAppointment.endTime.slice(0, 5)})
                </div>
                <div>
                  <strong>Email:</strong> {selectedAppointment.teacherEmail}
                </div>
              </div>

              {selectedAppointment.cancellationReason && (
                <div style={{ marginTop: '8px', padding: '8px', backgroundColor: 'var(--color-danger-50)', color: 'var(--color-danger-700)', borderRadius: 'var(--radius-xs)', fontSize: 'var(--font-size-xs)' }}>
                  <strong>Cancellation Reason:</strong> {selectedAppointment.cancellationReason}
                </div>
              )}
            </div>

            {/* Purpose */}
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>
                Consultation Purpose & Questions
              </div>
              <div style={{ fontSize: 'var(--font-size-sm)', backgroundColor: 'var(--color-bg-app)', padding: '10px 12px', borderRadius: 'var(--radius-sm)', whiteSpace: 'pre-wrap' }}>
                {selectedAppointment.purpose}
              </div>
            </div>

            {/* Consultation Feedback Display (Only for COMPLETED) */}
            {selectedAppointment.status === 'COMPLETED' && (
              <div
                style={{
                  borderTop: '1px solid var(--color-border-subtle)',
                  paddingTop: '14px',
                  marginBottom: '16px'
                }}
              >
                <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', marginBottom: '8px' }}>
                  Consultation Feedback
                </div>
                {(() => {
                  const fbState = feedbackMap[selectedAppointment.id];
                  if (!fbState || fbState.status === 'loading') {
                    return (
                      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                        Checking feedback status...
                      </div>
                    );
                  }
                  if (fbState.status === 'error') {
                    return (
                      <div
                        style={{
                          padding: '12px',
                          backgroundColor: 'var(--color-danger-50)',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--color-danger-200)',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: '8px'
                        }}
                      >
                        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-danger-800)' }}>
                          <strong>Unable to load feedback:</strong> {fbState.error}
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => loadFeedbackForAppointment(selectedAppointment.id, true)}
                        >
                          Retry
                        </Button>
                      </div>
                    );
                  }
                  if (fbState.status === 'success' && fbState.data) {
                    return (
                      <div
                        style={{
                          padding: '12px',
                          backgroundColor: 'var(--color-bg-surface-subtle)',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--color-border-subtle)'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
                          <StarRating value={fbState.data.rating} disabled size={18} />
                          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                            Submitted on {new Date(fbState.data.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                        {fbState.data.comments ? (
                          <div
                            style={{
                              fontSize: 'var(--font-size-sm)',
                              backgroundColor: 'var(--color-bg-app)',
                              padding: '8px 10px',
                              borderRadius: 'var(--radius-xs)',
                              color: 'var(--color-text-main)',
                              whiteSpace: 'pre-wrap'
                            }}
                          >
                            {fbState.data.comments}
                          </div>
                        ) : (
                          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                            No written comments provided with this rating.
                          </div>
                        )}
                        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginTop: '8px' }}>
                          Feedback is permanently recorded and cannot be edited or deleted.
                        </div>
                      </div>
                    );
                  }
                  if (fbState.status === 'success' && fbState.data === null) {
                    return (
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '12px',
                          backgroundColor: 'var(--color-bg-surface-subtle)',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px dashed var(--color-border-subtle)'
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', color: 'var(--color-text-main)' }}>
                            Feedback Pending
                          </div>
                          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                            Share your feedback to help improve future consultations.
                          </div>
                        </div>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => {
                            setIsDetailOpen(false);
                            handleOpenFeedback(selectedAppointment);
                          }}
                        >
                          Leave Feedback
                        </Button>
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>
            )}

            {/* Action Buttons (Cancel / Reschedule) */}
            {(() => {
              if (activeAction) return null;
              if (!['PENDING', 'APPROVED', 'RESCHEDULE_PENDING'].includes(selectedAppointment.status)) return null;

              const slotEndTs = selectedAppointment.endTimestamp || `${selectedAppointment.slotDate} ${selectedAppointment.endTime}`;
              const isPast = new Date(slotEndTs).getTime() <= Date.now();

              if (isPast) {
                return (
                  <div style={{ borderTop: '1px solid var(--color-border-subtle)', paddingTop: '12px', marginBottom: '16px' }}>
                    <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                      This consultation occurred in the past and can no longer be cancelled or rescheduled.
                    </div>
                  </div>
                );
              }

              return (
                <div style={{ borderTop: '1px solid var(--color-border-subtle)', paddingTop: '12px', marginBottom: '16px', display: 'flex', gap: '8px' }}>
                  <Button variant="danger" size="sm" onClick={handleOpenCancel}>
                    Cancel Consultation
                  </Button>
                  <Button variant="secondary" size="sm" onClick={handleOpenReschedule}>
                    Reschedule to New Slot
                  </Button>
                </div>
              );
            })()}

            {/* ACTIVE ACTION: CANCEL */}
            {activeAction === 'cancel' && (
              <div style={{ padding: '12px', backgroundColor: 'var(--color-danger-50)', borderRadius: 'var(--radius-md)', marginBottom: '16px' }}>
                <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', color: 'var(--color-danger-800)', marginBottom: '8px' }}>
                  Confirm Cancellation of Consultation #{selectedAppointment.id}
                </div>
                <FormField
                  label="Cancellation Reason"
                  htmlFor="student-cancel-reason"
                  required
                  helperText="Minimum 3 characters. Faculty member will be notified."
                >
                  <TextInput
                    id="student-cancel-reason"
                    placeholder="e.g. Schedule conflict with laboratory exam"
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
              <div style={{ padding: '12px', backgroundColor: 'var(--color-bg-surface-subtle)', borderRadius: 'var(--radius-md)', marginBottom: '16px' }}>
                <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', marginBottom: '8px' }}>
                  Reschedule Consultation #{selectedAppointment.id}
                </div>

                {slotsLoading ? (
                  <LoadingState message="Fetching alternative slots for this teacher..." />
                ) : availableSlots.length === 0 ? (
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginBottom: '8px' }}>
                    No alternative slots currently posted for {selectedAppointment.teacherFirstName} {selectedAppointment.teacherLastName}.
                  </div>
                ) : (
                  <FormField label="Select Target Slot" htmlFor="reschedule-slot-select" required>
                    <Select
                      id="reschedule-slot-select"
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
                  htmlFor="reschedule-reason-input"
                  required
                  helperText="Explain why you need to move this appointment (minimum 3 characters)."
                >
                  <TextInput
                    id="reschedule-reason-input"
                    placeholder="e.g. Class schedule change"
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

            {/* Status Transition History */}
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
                        <span style={{ color: 'var(--color-text-muted)' }}>{new Date(item.createdAt).toLocaleString()}</span>
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

      {/* -------------------------------------------------------------
       * Modal: Consultation Feedback Dialog (Phase 5)
       * ----------------------------------------------------------- */}
      <Dialog
        isOpen={isFeedbackOpen}
        onClose={() => {
          if (!feedbackSubmitting) setIsFeedbackOpen(false);
        }}
        title={`Consultation Feedback #${feedbackAppointment?.id ?? ''}`}
        size="md"
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <Button
              variant="secondary"
              size="md"
              disabled={feedbackSubmitting}
              onClick={() => setIsFeedbackOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="md"
              isLoading={feedbackSubmitting}
              onClick={handleSubmitFeedback}
            >
              Submit Feedback
            </Button>
          </div>
        }
      >
        {feedbackAppointment && (
          <div>
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginBottom: '16px' }}>
              Please provide feedback for your consultation with{' '}
              <strong>
                {feedbackAppointment.teacherFirstName} {feedbackAppointment.teacherLastName}
              </strong>{' '}
              on {feedbackAppointment.slotDate} ({feedbackAppointment.startTime.slice(0, 5)} - {feedbackAppointment.endTime.slice(0, 5)}).
            </p>

            {feedbackError && (
              <div style={{ marginBottom: '16px' }}>
                <Alert variant="error">{feedbackError}</Alert>
              </div>
            )}

            <div style={{ marginBottom: '20px' }}>
              <FormField
                label="Rating"
                htmlFor="feedback-star-rating"
                required
                helperText="Select a rating from 1 to 5 stars."
              >
                <StarRating
                  id="feedback-star-rating"
                  value={feedbackRating}
                  onChange={r => setFeedbackRating(r)}
                  disabled={feedbackSubmitting}
                  size={28}
                />
              </FormField>
            </div>

            <div style={{ marginBottom: '8px' }}>
              <FormField
                label="Comments (Optional)"
                htmlFor="feedback-comments"
                helperText={`${feedbackComments.length}/1000 characters`}
              >
                <Textarea
                  id="feedback-comments"
                  placeholder="Share constructive feedback regarding the advice, clarity, or usefulness of this session..."
                  value={feedbackComments}
                  onChange={e => {
                    if (e.target.value.length <= 1000) {
                      setFeedbackComments(e.target.value);
                    }
                  }}
                  maxLength={1000}
                  rows={4}
                  disabled={feedbackSubmitting}
                />
              </FormField>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
};
