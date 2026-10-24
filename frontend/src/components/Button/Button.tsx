import React from 'react';
import { ButtonVariant, ButtonSize } from '../../types/designSystem';
import './Button.css';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  fullWidth?: boolean;
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
  children: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      isLoading = false,
      fullWidth = false,
      leadingIcon,
      trailingIcon,
      disabled,
      className = '',
      children,
      type = 'button',
      ...rest
    },
    ref
  ) => {
    const classNames = [
      'ui-button',
      `ui-button--${variant}`,
      `ui-button--${size}`,
      fullWidth ? 'ui-button--full-width' : '',
      isLoading ? 'ui-button--loading' : '',
      className
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <button
        ref={ref}
        type={type}
        className={classNames}
        disabled={disabled || isLoading}
        aria-busy={isLoading ? 'true' : undefined}
        {...rest}
      >
        {isLoading && <span className="ui-button__spinner" aria-hidden="true" />}
        {!isLoading && leadingIcon && <span className="ui-button__icon">{leadingIcon}</span>}
        <span className="ui-button__label">{children}</span>
        {!isLoading && trailingIcon && <span className="ui-button__icon">{trailingIcon}</span>}
      </button>
    );
  }
);

Button.displayName = 'Button';
