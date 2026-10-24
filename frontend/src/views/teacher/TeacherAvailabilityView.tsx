/**
 * Faculty / Teacher Availability & Office Hours View
 * Implements "Configure and update availability" workflow:
 * 1. View all consultation slots with status (Available, Booked, Inactive).
 * 2. Add new consultation slots with validation and interval-overlap conflict detection.
 * 3. Toggle slot active/inactive availability.
 * 4. Delete unbooked slots while protecting active bookings.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { teacherService } from '../../services/teacherService';
import { TeacherSlotItem } from '../../types/teacher';
import { Button } from '../../components/Button/Button';
import { FormField, TextInput, Select } from '../../components/Form/Form';
import { Table } from '../../components/Table/Table';
import { Badge } from '../../components/Badge/Badge';
import { Dialog } from '../../components/Dialog/Dialog';
import { Alert } from '../../components/Alert/Alert';
import { LoadingState, EmptyState, ErrorState } from '../../components/Feedback/Feedback';
import {
  CalendarIcon,
  ClockIcon,
  PlusIcon,
  CheckIcon
} from '../../components/Icons/Icons';
import { TableColumn } from '../../types/designSystem';

interface TeacherAvailabilityViewProps {
  teacherId: number;
}

export const TeacherAvailabilityView: React.FC<TeacherAvailabilityViewProps> = ({
  teacherId
}) => {
  const [slots, setSlots] = useState<TeacherSlotItem[]>([]);
  const [filter, setFilter] = useState<'all' | 'available' | 'booked' | 'inactive'>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Modal: Add New Slot
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newDate, setNewDate] = useState('');
  const [newStartTime, setNewStartTime] = useState('10:00');
  const [newEndTime, setNewEndTime] = useState('10:45');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ slotDate?: string; startTime?: string; endTime?: string }>({});

  // Confirmation: Delete Slot
  const [slotToDelete, setSlotToDelete] = useState<TeacherSlotItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadSlots = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const data = await teacherService.getSlots(teacherId, { all: true });
      setSlots(data);
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setErrorMessage(errorObj.message || 'Failed to retrieve your availability slots.');
    } finally {
      setIsLoading(false);
    }
  }, [teacherId]);

  useEffect(() => {
    loadSlots();
  }, [loadSlots]);

  const filteredSlots = slots.filter(s => {
    if (filter === 'available') return !s.isBooked && s.isActive;
    if (filter === 'booked') return s.isBooked;
    if (filter === 'inactive') return !s.isActive;
    return true;
  });

  // Calculate duration helper
  const getDurationMinutes = (start: string, end: string) => {
    if (!start || !end) return 0;
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) return 0;
    return (eh * 60 + em) - (sh * 60 + sm);
  };

  const validateNewSlot = () => {
    const errors: { slotDate?: string; startTime?: string; endTime?: string } = {};
    if (!newDate) {
      errors.slotDate = 'Consultation date is required.';
    } else {
      const today = new Date().toISOString().slice(0, 10);
      if (newDate < today) {
        errors.slotDate = 'Consultation date cannot be in the past.';
      }
    }

    if (!newStartTime) {
      errors.startTime = 'Start time is required.';
    }
    if (!newEndTime) {
      errors.endTime = 'End time is required.';
    }

    const duration = getDurationMinutes(newStartTime, newEndTime);
    if (duration <= 0) {
      errors.endTime = 'End time must be later than start time.';
    } else if (duration < 10 || duration > 180) {
      errors.endTime = `Slot duration must be between 10 and 180 minutes. Current: ${duration} mins.`;
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleCreateSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateNewSlot() || isSubmitting) return;

    setIsSubmitting(true);
    setModalError(null);

    try {
      await teacherService.createSlot(teacherId, {
        slotDate: newDate,
        startTime: newStartTime,
        endTime: newEndTime
      });

      setSuccessMessage('New consultation availability slot created successfully.');
      setIsAddModalOpen(false);
      setNewDate('');
      loadSlots();
    } catch (err: unknown) {
      const errorObj = err as { message?: string; code?: string; status?: number };
      if (errorObj.code === 'SLOT_OVERLAP' || errorObj.status === 409) {
        setModalError(errorObj.message || 'The proposed time slot overlaps with an existing availability slot.');
      } else {
        setModalError(errorObj.message || 'Failed to create availability slot.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleActive = async (slot: TeacherSlotItem) => {
    try {
      await teacherService.updateSlot(teacherId, slot.id, !slot.isActive);
      setSuccessMessage(`Slot on ${slot.slotDate} is now ${!slot.isActive ? 'active' : 'deactivated'}.`);
      loadSlots();
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setErrorMessage(errorObj.message || 'Failed to update slot status.');
    }
  };

  const handleConfirmDelete = async () => {
    if (!slotToDelete) return;
    setIsDeleting(true);
    setErrorMessage(null);

    try {
      await teacherService.deleteSlot(teacherId, slotToDelete.id);
      setSuccessMessage(`Availability slot #${slotToDelete.id} successfully removed.`);
      setSlotToDelete(null);
      loadSlots();
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setErrorMessage(errorObj.message || 'Failed to delete slot.');
    } finally {
      setIsDeleting(false);
    }
  };

  const columns: TableColumn<TeacherSlotItem>[] = [
    {
      key: 'id',
      header: 'Slot ID',
      width: '80px',
      render: row => <span className="code-identifier">#{row.id}</span>
    },
    {
      key: 'date',
      header: 'Consultation Date',
      render: row => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <CalendarIcon size={14} style={{ color: 'var(--color-text-muted)' }} />
          <span style={{ fontWeight: 600 }}>{row.slotDate}</span>
        </div>
      )
    },
    {
      key: 'time',
      header: 'Time Window',
      render: row => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <ClockIcon size={14} style={{ color: 'var(--color-primary-700)' }} />
          <span style={{ fontWeight: 500 }}>
            {row.startTime.slice(0, 5)} - {row.endTime.slice(0, 5)}
          </span>
          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
            ({getDurationMinutes(row.startTime, row.endTime)}m)
          </span>
        </div>
      )
    },
    {
      key: 'status',
      header: 'Availability Status',
      render: row => {
        if (row.isBooked) {
          return <Badge variant="pending">Booked by Student</Badge>;
        }
        if (!row.isActive) {
          return <Badge variant="inactive">Deactivated</Badge>;
        }
        return <Badge variant="approved">Available for Booking</Badge>;
      }
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: row => (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleToggleActive(row)}
            title={row.isActive ? 'Deactivate this slot' : 'Activate this slot'}
          >
            {row.isActive ? 'Deactivate' : 'Activate'}
          </Button>

          <Button
            variant="danger"
            size="sm"
            disabled={Boolean(row.isBooked)}
            onClick={() => setSlotToDelete(row)}
            title={row.isBooked ? 'Cannot delete slot with active booking' : 'Delete slot'}
          >
            Delete
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
          <h1 className="page-header__title">Office Hours & Availability Slots</h1>
          <p className="page-header__description">
            Configure consultation windows, manage active office hours, and prevent scheduling conflicts.
          </p>
        </div>
        <Button
          variant="primary"
          size="md"
          leadingIcon={<PlusIcon size={16} />}
          onClick={() => {
            setIsAddModalOpen(true);
            setModalError(null);
            setFieldErrors({});
          }}
        >
          Add Availability Slot
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

      {/* Filter Bar */}
      <div className="surface-card" style={{ marginBottom: '20px', padding: '16px' }}>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ maxWidth: '240px', width: '100%' }}>
            <FormField label="Filter by Status" htmlFor="slot-status-filter">
              <Select
                id="slot-status-filter"
                value={filter}
                onChange={e => setFilter(e.target.value as any)}
                options={[
                  { value: 'all', label: `All Slots (${slots.length})` },
                  { value: 'available', label: 'Available Only' },
                  { value: 'booked', label: 'Booked by Students' },
                  { value: 'inactive', label: 'Deactivated' }
                ]}
              />
            </FormField>
          </div>
          <Button variant="secondary" size="sm" onClick={loadSlots} disabled={isLoading}>
            Refresh
          </Button>
        </div>
      </div>

      {/* Table Display */}
      {isLoading ? (
        <LoadingState message="Fetching your office hour slots..." />
      ) : errorMessage && slots.length === 0 ? (
        <ErrorState
          title="Availability Unavailable"
          message={errorMessage}
          onRetry={loadSlots}
        />
      ) : slots.length === 0 ? (
        <EmptyState
          title="No Office Hour Slots Configured"
          description="You have not published any consultation availability slots. Add slots so students can schedule consultations with you."
          actionLabel="Add First Slot"
          onAction={() => setIsAddModalOpen(true)}
        />
      ) : (
        <Table<TeacherSlotItem>
          columns={columns}
          data={filteredSlots}
          keyExtractor={s => s.id}
          isLoading={isLoading}
          emptyMessage="No slots match the selected filter."
        />
      )}

      {/* -------------------------------------------------------------
       * Modal: Add Availability Slot
       * ----------------------------------------------------------- */}
      <Dialog
        isOpen={isAddModalOpen}
        onClose={() => {
          if (!isSubmitting) setIsAddModalOpen(false);
        }}
        title="Add Consultation Availability Slot"
        size="md"
        footer={
          <>
            <Button variant="secondary" size="md" disabled={isSubmitting} onClick={() => setIsAddModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="md"
              isLoading={isSubmitting}
              onClick={handleCreateSlot}
              leadingIcon={<CheckIcon size={16} />}
            >
              Publish Slot
            </Button>
          </>
        }
      >
        <form onSubmit={handleCreateSlot}>
          {modalError && (
            <div style={{ marginBottom: '16px' }}>
              <Alert variant="error" title="Slot Conflict Notice">
                {modalError}
              </Alert>
            </div>
          )}

          <FormField
            label="Consultation Date"
            htmlFor="new-slot-date"
            required
            error={fieldErrors.slotDate}
            helperText="Select a future date for this consultation window."
          >
            <TextInput
              id="new-slot-date"
              type="date"
              value={newDate}
              onChange={e => setNewDate(e.target.value)}
              disabled={isSubmitting}
              error={Boolean(fieldErrors.slotDate)}
            />
          </FormField>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '12px' }}>
            <FormField
              label="Start Time"
              htmlFor="new-slot-start"
              required
              error={fieldErrors.startTime}
            >
              <TextInput
                id="new-slot-start"
                type="time"
                value={newStartTime}
                onChange={e => setNewStartTime(e.target.value)}
                disabled={isSubmitting}
                error={Boolean(fieldErrors.startTime)}
              />
            </FormField>

            <FormField
              label="End Time"
              htmlFor="new-slot-end"
              required
              error={fieldErrors.endTime}
            >
              <TextInput
                id="new-slot-end"
                type="time"
                value={newEndTime}
                onChange={e => setNewEndTime(e.target.value)}
                disabled={isSubmitting}
                error={Boolean(fieldErrors.endTime)}
              />
            </FormField>
          </div>

          <div style={{ marginTop: '12px', padding: '10px 14px', backgroundColor: 'var(--color-bg-app)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
            <strong>Duration:</strong> {getDurationMinutes(newStartTime, newEndTime)} minutes (must be 10–180 minutes).
            The server automatically enforces interval collision detection against your existing schedule.
          </div>
        </form>
      </Dialog>

      {/* -------------------------------------------------------------
       * Modal: Confirm Delete Slot
       * ----------------------------------------------------------- */}
      <Dialog
        isOpen={Boolean(slotToDelete)}
        onClose={() => {
          if (!isDeleting) setSlotToDelete(null);
        }}
        title="Confirm Slot Deletion"
        size="sm"
        footer={
          <>
            <Button variant="secondary" size="md" disabled={isDeleting} onClick={() => setSlotToDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="md"
              isLoading={isDeleting}
              onClick={handleConfirmDelete}
            >
              Confirm Delete
            </Button>
          </>
        }
      >
        {slotToDelete && (
          <div>
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-main)', marginBottom: '8px' }}>
              Are you sure you want to remove the availability slot on <strong>{slotToDelete.slotDate}</strong> ({slotToDelete.startTime.slice(0, 5)} - {slotToDelete.endTime.slice(0, 5)})?
            </p>
            <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', margin: 0 }}>
              Students will no longer be able to select or book this consultation window.
            </p>
          </div>
        )}
      </Dialog>
    </div>
  );
};
