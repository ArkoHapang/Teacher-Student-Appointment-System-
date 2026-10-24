import React from 'react';
import { CalendarIcon, AlertTriangleIcon } from '../Icons/Icons';
import { Button } from '../Button/Button';
import './Feedback.css';

export interface EmptyStateProps {
  title: string;
  description: string;
  icon?: React.ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  icon,
  actionLabel,
  onAction,
  className = ''
}) => {
  return (
    <div className={`ui-feedback-state ${className}`}>
      <div className="ui-feedback-state__icon-wrapper" aria-hidden="true">
        {icon || <CalendarIcon size={24} />}
      </div>
      <h3 className="ui-feedback-state__title">{title}</h3>
      <p className="ui-feedback-state__description">{description}</p>
      {actionLabel && onAction && (
        <div className="ui-feedback-state__action">
          <Button variant="primary" size="md" onClick={onAction}>
            {actionLabel}
          </Button>
        </div>
      )}
    </div>
  );
};

export interface LoadingStateProps {
  message?: string;
  className?: string;
}

export const LoadingState: React.FC<LoadingStateProps> = ({
  message = 'Loading schedule records...',
  className = ''
}) => {
  return (
    <div className={`ui-feedback-state ${className}`} role="status" aria-live="polite">
      <div className="ui-loading-spinner" aria-hidden="true" />
      <p className="ui-feedback-state__description" style={{ marginBottom: 0 }}>
        {message}
      </p>
    </div>
  );
};

export interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  className?: string;
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  title = 'Unable to Load Information',
  message,
  onRetry,
  className = ''
}) => {
  return (
    <div className={`ui-feedback-state ui-feedback-state--error ${className}`} role="alert">
      <div className="ui-feedback-state__icon-wrapper" aria-hidden="true">
        <AlertTriangleIcon size={24} />
      </div>
      <h3 className="ui-feedback-state__title">{title}</h3>
      <p className="ui-feedback-state__description">{message}</p>
      {onRetry && (
        <div className="ui-feedback-state__action">
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Retry Request
          </Button>
        </div>
      )}
    </div>
  );
};
