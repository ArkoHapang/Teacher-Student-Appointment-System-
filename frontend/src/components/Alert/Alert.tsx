import React from 'react';
import { AlertVariant } from '../../types/designSystem';
import {
  InfoIcon,
  CheckIcon,
  AlertTriangleIcon,
  XIcon
} from '../Icons/Icons';
import './Alert.css';

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: AlertVariant;
  title?: string;
  onDismiss?: () => void;
  children: React.ReactNode;
}

export const Alert: React.FC<AlertProps> = ({
  variant = 'info',
  title,
  onDismiss,
  className = '',
  children,
  ...rest
}) => {
  const getIcon = () => {
    switch (variant) {
      case 'success':
        return <CheckIcon size={18} />;
      case 'warning':
        return <AlertTriangleIcon size={18} />;
      case 'error':
        return <AlertTriangleIcon size={18} />;
      case 'info':
      default:
        return <InfoIcon size={18} />;
    }
  };

  const classNames = ['ui-alert', `ui-alert--${variant}`, className]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      className={classNames}
      {...rest}
    >
      <div className="ui-alert__icon" aria-hidden="true">
        {getIcon()}
      </div>
      <div className="ui-alert__content">
        {title && <div className="ui-alert__title">{title}</div>}
        <div className="ui-alert__body">{children}</div>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="ui-alert__dismiss"
          aria-label="Dismiss alert"
        >
          <XIcon size={16} />
        </button>
      )}
    </div>
  );
};
