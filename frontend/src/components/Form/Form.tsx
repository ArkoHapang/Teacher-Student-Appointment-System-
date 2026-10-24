import React from 'react';
import { AlertTriangleIcon } from '../Icons/Icons';
import './Form.css';

export interface FormFieldProps {
  label: string;
  htmlFor: string;
  required?: boolean;
  helperText?: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}

export const FormField: React.FC<FormFieldProps> = ({
  label,
  htmlFor,
  required = false,
  helperText,
  error,
  className = '',
  children
}) => {
  const errorId = error ? `${htmlFor}-error` : undefined;
  const helperId = helperText ? `${htmlFor}-helper` : undefined;

  return (
    <div className={`ui-form-field ${className}`}>
      <label htmlFor={htmlFor} className="ui-form-label">
        <span>{label}</span>
        {required && <span className="ui-form-label__required" aria-hidden="true">*</span>}
      </label>
      <div className="ui-form-control-wrapper">{children}</div>
      {error && (
        <div id={errorId} className="ui-form-error" role="alert">
          <AlertTriangleIcon size={14} />
          <span>{error}</span>
        </div>
      )}
      {!error && helperText && (
        <div id={helperId} className="ui-form-helper">
          {helperText}
        </div>
      )}
    </div>
  );
};

export interface TextInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export const TextInput = React.forwardRef<HTMLInputElement, TextInputProps>(
  ({ error = false, className = '', ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={`ui-input ${error ? 'ui-input--error' : ''} ${className}`}
        aria-invalid={error ? 'true' : undefined}
        {...props}
      />
    );
  }
);
TextInput.displayName = 'TextInput';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean;
  options?: Array<{ value: string | number; label: string; disabled?: boolean }>;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ error = false, options, children, className = '', ...props }, ref) => {
    return (
      <select
        ref={ref}
        className={`ui-select ${error ? 'ui-select--error' : ''} ${className}`}
        aria-invalid={error ? 'true' : undefined}
        {...props}
      >
        {options
          ? options.map(opt => (
              <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                {opt.label}
              </option>
            ))
          : children}
      </select>
    );
  }
);
Select.displayName = 'Select';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ error = false, className = '', ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        className={`ui-textarea ${error ? 'ui-textarea--error' : ''} ${className}`}
        aria-invalid={error ? 'true' : undefined}
        {...props}
      />
    );
  }
);
Textarea.displayName = 'Textarea';
