/**
 * Find Teachers View
 * Allows students to browse faculty directory, filter by academic department,
 * inspect teacher details and credentials, and book consultation slots.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { studentService } from '../../services/studentService';
import { TeacherDirectoryItem } from '../../types/student';
import { adminService } from '../../services/adminService';
import { Department } from '../../types/admin';
import { Button } from '../../components/Button/Button';
import { FormField, TextInput, Select } from '../../components/Form/Form';
import { Badge } from '../../components/Badge/Badge';
import { Alert } from '../../components/Alert/Alert';
import { LoadingState, EmptyState, ErrorState } from '../../components/Feedback/Feedback';
import { BookConsultationModal } from './BookConsultationModal';
import {
  CalendarIcon
} from '../../components/Icons/Icons';

interface FindTeachersViewProps {
  onAppointmentBooked?: () => void;
}

export const FindTeachersView: React.FC<FindTeachersViewProps> = ({
  onAppointmentBooked
}) => {
  const [teachers, setTeachers] = useState<TeacherDirectoryItem[]>([]);
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedTeacherForBooking, setSelectedTeacherForBooking] = useState<TeacherDirectoryItem | null>(null);
  const [isBookModalOpen, setIsBookModalOpen] = useState(false);

  const departments: Department[] = adminService.getDepartments();

  const loadTeachers = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const data = await studentService.getTeachers();
      setTeachers(data);
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      setErrorMessage(errorObj.message || 'Failed to load faculty directory.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTeachers();
  }, [loadTeachers]);

  const filteredTeachers = teachers.filter(t => {
    const term = search.toLowerCase().trim();
    const matchesSearch =
      !term ||
      `${t.firstName} ${t.lastName}`.toLowerCase().includes(term) ||
      t.email.toLowerCase().includes(term) ||
      t.designation.toLowerCase().includes(term) ||
      t.officeRoom.toLowerCase().includes(term) ||
      t.departmentName.toLowerCase().includes(term) ||
      t.departmentCode.toLowerCase().includes(term);

    const matchesDept =
      !departmentFilter || t.departmentCode === departmentFilter;

    return matchesSearch && matchesDept;
  });

  const handleOpenBooking = (teacher: TeacherDirectoryItem) => {
    setSelectedTeacherForBooking(teacher);
    setIsBookModalOpen(true);
  };

  return (
    <div>
      {/* Page Title */}
      <div className="page-header">
        <div>
          <h1 className="page-header__title">Faculty Directory & Office Hours</h1>
          <p className="page-header__description">
            Find faculty members by department, view credentials, and book consultation time slots.
          </p>
        </div>
      </div>

      {errorMessage && (
        <div style={{ marginBottom: '16px' }}>
          <Alert variant="error" onDismiss={() => setErrorMessage(null)}>
            {errorMessage}
          </Alert>
        </div>
      )}

      {/* Filter Bar */}
      <div className="surface-card" style={{ marginBottom: '24px', padding: '16px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
          <FormField label="Search Faculty" htmlFor="search-teachers-input">
            <TextInput
              id="search-teachers-input"
              placeholder="Search by name, email, department, or office room..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </FormField>

          <FormField label="Academic Department" htmlFor="filter-department-select">
            <Select
              id="filter-department-select"
              value={departmentFilter}
              onChange={e => setDepartmentFilter(e.target.value)}
              options={[
                { value: '', label: 'All Academic Departments' },
                ...departments.map(d => ({ value: d.code, label: `${d.name} (${d.code})` }))
              ]}
            />
          </FormField>
        </div>
      </div>

      {/* Teachers Grid */}
      {isLoading ? (
        <LoadingState message="Querying university faculty directory..." />
      ) : errorMessage && teachers.length === 0 ? (
        <ErrorState
          title="Directory Unavailable"
          message={errorMessage}
          onRetry={loadTeachers}
        />
      ) : filteredTeachers.length === 0 ? (
        <EmptyState
          title="No Faculty Members Found"
          description="No teachers matched your current search filters. Try clearing or expanding your search terms."
          actionLabel="Clear Filters"
          onAction={() => {
            setSearch('');
            setDepartmentFilter('');
          }}
        />
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: '20px'
          }}
        >
          {filteredTeachers.map(teacher => (
            <div
              key={teacher.teacherProfileId}
              className="surface-card"
              style={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between'
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                  <div>
                    <h2 style={{ fontSize: 'var(--font-size-base)', fontWeight: 600, color: 'var(--color-text-main)', margin: 0 }}>
                      {teacher.firstName} {teacher.lastName}
                    </h2>
                    <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-primary-700)', fontWeight: 500 }}>
                      {teacher.designation}
                    </div>
                  </div>
                  {teacher.isVerified ? (
                    <Badge variant="approved">Verified</Badge>
                  ) : null}
                </div>

                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginBottom: '8px' }}>
                  {teacher.departmentName} ({teacher.departmentCode})
                </div>

                <div
                  style={{
                    backgroundColor: 'var(--color-bg-app)',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: 'var(--font-size-xs)',
                    color: 'var(--color-text-body)',
                    marginBottom: '12px'
                  }}
                >
                  <div>
                    <strong>Office Room:</strong> {teacher.officeRoom}
                  </div>
                  <div>
                    <strong>Email:</strong> {teacher.email}
                  </div>
                </div>

                {teacher.bio && (
                  <p
                    style={{
                      fontSize: 'var(--font-size-xs)',
                      color: 'var(--color-text-body)',
                      marginBottom: '16px',
                      lineHeight: '1.4'
                    }}
                  >
                    {teacher.bio}
                  </p>
                )}
              </div>

              <div style={{ borderTop: '1px solid var(--color-border-subtle)', paddingTop: '12px', display: 'flex', justifyContent: 'flex-end' }}>
                <Button
                  variant="primary"
                  size="sm"
                  leadingIcon={<CalendarIcon size={14} />}
                  onClick={() => handleOpenBooking(teacher)}
                  aria-label={`View availability slots and book consultation with ${teacher.firstName} ${teacher.lastName}`}
                >
                  View Availability & Book
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Booking Consultation Modal */}
      <BookConsultationModal
        isOpen={isBookModalOpen}
        onClose={() => setIsBookModalOpen(false)}
        teacher={selectedTeacherForBooking}
        onAppointmentBooked={() => {
          if (onAppointmentBooked) {
            onAppointmentBooked();
          }
        }}
      />
    </div>
  );
};
