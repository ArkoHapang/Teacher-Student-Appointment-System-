/**
 * Book Consultation Modal
 * Implements "View teacher availability" and "Request appointments" workflows.
 * Fetches real availability slots, handles selection, validates title/purpose,
 * and intercepts HTTP 409 collision errors.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { studentService } from '../../services/studentService';
import { TeacherDirectoryItem, TeacherAvailabilitySlot } from '../../types/student';
import { Button } from '../../components/Button/Button';
import { FormField, TextInput, Textarea } from '../../components/Form/Form';
import { Dialog } from '../../components/Dialog/Dialog';
import { Alert } from '../../components/Alert/Alert';
import { LoadingState } from '../../components/Feedback/Feedback';
import { CalendarIcon, ClockIcon, CheckIcon } from '../../components/Icons/Icons';

interface BookConsultationModalProps {
  isOpen: boolean;
  onClose: () => void;
  teacher: TeacherDirectoryItem | null;
  onAppointmentBooked: () => void;
}

export const BookConsultationModal: React.FC<BookConsultationModalProps> = ({
  isOpen,
  onClose,
  teacher,
  onAppointmentBooked
}) => {
  const [slots, setSlots] = useState<TeacherAvailabilitySlot[]>([]);
  const [selectedSlotId, setSelectedSlotId] = useState<number | null>(null);
  const [title, setTitle] = useState('');
  const [purpose, setPurpose] = useState('');
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ title?: string; purpose?: string; slotId?: string }>({});

  const loadSlots = useCallback(async () => {
    if (!teacher) return;
    setIsLoadingSlots(true);
    setErrorMessage(null);
    try {
      const data = await studentService.getTeacherSlots(teacher.teacherProfileId);
      setSlots(data);
      if (data.length > 0) {
        setSelectedSlotId(data[0].id);
      } else {
        setSelectedSlotId(null);
      }
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setErrorMessage(errorObj.message || 'Failed to retrieve available slots for this faculty member.');
    } finally {
      setIsLoadingSlots(false);
    }
  }, [teacher]);

  useEffect(() => {
    if (isOpen && teacher) {
      setTitle('');
      setPurpose('');
      setErrorMessage(null);
      setSuccessMessage(null);
      setFieldErrors({});
      loadSlots();
    }
  }, [isOpen, teacher, loadSlots]);

  const validate = () => {
    const errors: { title?: string; purpose?: string; slotId?: string } = {};
    if (!selectedSlotId) {
      errors.slotId = 'Please select an available consultation slot.';
    }
    if (!title.trim() || title.trim().length < 3) {
      errors.title = 'Consultation subject must be at least 3 characters.';
    }
    if (!purpose.trim() || purpose.trim().length < 5) {
      errors.purpose = 'Purpose must describe your academic question (at least 5 characters).';
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate() || isSubmitting || !selectedSlotId) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      await studentService.requestAppointment({
        slotId: selectedSlotId,
        title: title.trim(),
        purpose: purpose.trim()
      });

      setSuccessMessage('Your appointment request has been submitted to the faculty member for confirmation.');
      onAppointmentBooked();
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err: unknown) {
      const errorObj = err as { message?: string; code?: string; status?: number };
      if (errorObj.code === 'SLOT_UNAVAILABLE' || errorObj.status === 409) {
        setErrorMessage('This consultation slot was just reserved or is no longer available. Please select another slot.');
        loadSlots(); // Refresh slots
      } else {
        setErrorMessage(errorObj.message || 'Failed to submit appointment request. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen || !teacher) return null;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={() => {
        if (!isSubmitting) onClose();
      }}
      title={`Book Consultation: ${teacher.firstName} ${teacher.lastName}`}
      size="md"
      footer={
        <>
          <Button variant="secondary" size="md" disabled={isSubmitting} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            isLoading={isSubmitting}
            disabled={slots.length === 0}
            onClick={handleSubmit}
            leadingIcon={<CheckIcon size={16} />}
          >
            Submit Request
          </Button>
        </>
      }
    >
      <div>
        {/* Teacher Snapshot */}
        <div
          style={{
            padding: '12px 16px',
            backgroundColor: 'var(--color-bg-surface-subtle)',
            borderRadius: 'var(--radius-md)',
            marginBottom: '16px',
            border: '1px solid var(--color-border-subtle)'
          }}
        >
          <div style={{ fontWeight: 600, color: 'var(--color-text-main)' }}>
            {teacher.firstName} {teacher.lastName}
          </div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
            {teacher.designation} &bull; {teacher.departmentName} ({teacher.departmentCode})
          </div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-body)', marginTop: '4px' }}>
            Office Room: <strong>{teacher.officeRoom}</strong> | Email: {teacher.email}
          </div>
        </div>

        {successMessage && (
          <div style={{ marginBottom: '16px' }}>
            <Alert variant="success" title="Request Submitted">
              {successMessage}
            </Alert>
          </div>
        )}

        {errorMessage && (
          <div style={{ marginBottom: '16px' }}>
            <Alert variant="error" title="Booking Notice">
              {errorMessage}
            </Alert>
          </div>
        )}

        {/* Slot Selection */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', fontSize: 'var(--font-size-sm)', fontWeight: 600, marginBottom: '8px' }}>
            Select Available Consultation Slot <span style={{ color: 'var(--color-danger-700)' }}>*</span>
          </label>

          {isLoadingSlots ? (
            <LoadingState message="Fetching live teacher availability windows..." />
          ) : slots.length === 0 ? (
            <div
              style={{
                padding: '24px',
                textAlign: 'center',
                backgroundColor: 'var(--color-bg-app)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--color-text-muted)',
                fontSize: 'var(--font-size-sm)'
              }}
            >
              No available consultation slots currently posted for this faculty member. Please check back soon or contact the department.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px', maxHeight: '180px', overflowY: 'auto', padding: '4px' }}>
              {slots.map(s => {
                const isSelected = selectedSlotId === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSelectedSlotId(s.id)}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      padding: '10px 12px',
                      borderRadius: 'var(--radius-sm)',
                      border: isSelected
                        ? '2px solid var(--color-primary-600)'
                        : '1px solid var(--color-border-default)',
                      backgroundColor: isSelected
                        ? 'var(--color-primary-50)'
                        : 'var(--color-bg-surface)',
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                    aria-pressed={isSelected}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--color-text-main)' }}>
                      <CalendarIcon size={14} /> {s.slotDate}
                    </div>
                    <div style={{ fontSize: 'var(--font-size-xs)', color: isSelected ? 'var(--color-primary-700)' : 'var(--color-text-muted)', marginTop: '2px', fontWeight: isSelected ? 600 : 400 }}>
                      <ClockIcon size={12} style={{ display: 'inline', marginRight: '3px' }} />
                      {s.startTime.slice(0, 5)} - {s.endTime.slice(0, 5)}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          {fieldErrors.slotId && (
            <div style={{ color: 'var(--color-danger-700)', fontSize: 'var(--font-size-xs)', marginTop: '4px' }}>
              {fieldErrors.slotId}
            </div>
          )}
        </div>

        {/* Appointment Topic & Purpose */}
        <form onSubmit={handleSubmit}>
          <FormField
            label="Consultation Topic / Subject"
            htmlFor="appt-title"
            required
            error={fieldErrors.title}
            helperText="e.g. Thesis Methodology Review, Midterm Clarification"
          >
            <TextInput
              id="appt-title"
              placeholder="Brief topic title..."
              value={title}
              onChange={e => setTitle(e.target.value)}
              disabled={isSubmitting || slots.length === 0}
              error={Boolean(fieldErrors.title)}
            />
          </FormField>

          <FormField
            label="Consultation Purpose & Questions"
            htmlFor="appt-purpose"
            required
            error={fieldErrors.purpose}
            helperText="Briefly describe the academic questions you plan to discuss (minimum 5 characters)."
          >
            <Textarea
              id="appt-purpose"
              placeholder="Detail your questions or topics..."
              value={purpose}
              onChange={e => setPurpose(e.target.value)}
              disabled={isSubmitting || slots.length === 0}
              error={Boolean(fieldErrors.purpose)}
              rows={3}
            />
          </FormField>
        </form>
      </div>
    </Dialog>
  );
};
