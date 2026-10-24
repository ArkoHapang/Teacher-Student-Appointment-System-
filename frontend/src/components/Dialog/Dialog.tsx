import React, { useEffect, useRef } from 'react';
import { XIcon } from '../Icons/Icons';
import './Dialog.css';

export interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
  footer?: React.ReactNode;
  closeOnBackdropClick?: boolean;
}

export const Dialog: React.FC<DialogProps> = ({
  isOpen,
  onClose,
  title,
  size = 'md',
  children,
  footer,
  closeOnBackdropClick = true
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = `dialog-title-${Math.random().toString(36).substring(2, 9)}`;

  // Handle Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="ui-dialog-backdrop"
      onClick={closeOnBackdropClick ? onClose : undefined}
      aria-hidden="true"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`ui-dialog ui-dialog--${size}`}
        onClick={e => e.stopPropagation()}
        tabIndex={-1}
      >
        <div className="ui-dialog__header">
          <h2 id={titleId} className="ui-dialog__title">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="ui-dialog__close"
            aria-label="Close dialog"
          >
            <XIcon size={20} />
          </button>
        </div>
        <div className="ui-dialog__body">{children}</div>
        {footer && <div className="ui-dialog__footer">{footer}</div>}
      </div>
    </div>
  );
};
