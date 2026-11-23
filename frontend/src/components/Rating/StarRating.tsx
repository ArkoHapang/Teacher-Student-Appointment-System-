import React, { useState, useRef } from 'react';
import { StarIcon } from '../Icons/Icons';
import './StarRating.css';

export interface StarRatingProps {
  value: number;
  onChange?: (rating: number) => void;
  maxRating?: number;
  size?: number;
  disabled?: boolean;
  id?: string;
  className?: string;
  showDescription?: boolean;
}

export const RATING_LABELS: Record<number, string> = {
  1: '1 star — Needs improvement',
  2: '2 stars — Fair',
  3: '3 stars — Good',
  4: '4 stars — Very good',
  5: '5 stars — Excellent'
};

export const StarRating: React.FC<StarRatingProps> = ({
  value,
  onChange,
  maxRating = 5,
  size = 24,
  disabled = false,
  id = 'consultation-star-rating',
  className = '',
  showDescription = true
}) => {
  const [hoveredValue, setHoveredValue] = useState<number | null>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const isInteractive = Boolean(onChange && !disabled);
  const activeRating = hoveredValue !== null ? hoveredValue : value;

  // Handle keyboard navigation for accessibility
  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (!isInteractive || !onChange) return;

    let targetStar: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      targetStar = Math.min(maxRating, index + 2);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      targetStar = Math.max(1, index);
    } else if (e.key === 'Home') {
      e.preventDefault();
      targetStar = 1;
    } else if (e.key === 'End') {
      e.preventDefault();
      targetStar = maxRating;
    }

    if (targetStar !== null) {
      onChange(targetStar);
      buttonRefs.current[targetStar - 1]?.focus();
    }
  };

  // Read-only presentation mode
  if (!isInteractive) {
    return (
      <div
        className={`ui-star-rating--readonly ${className}`}
        aria-label={`${value} out of ${maxRating} stars`}
        role="img"
      >
        <div className="ui-star-rating__stars">
          {Array.from({ length: maxRating }, (_, idx) => {
            const star = idx + 1;
            const isFilled = star <= value;
            return (
              <span
                key={star}
                className={isFilled ? 'ui-star-rating__star--active' : ''}
                style={{ display: 'inline-flex' }}
              >
                <StarIcon size={size} filled={isFilled} />
              </span>
            );
          })}
        </div>
        {showDescription && (
          <span className="ui-star-rating__description">
            {value > 0 ? `${value}/${maxRating} stars` : 'Not rated'}
          </span>
        )}
      </div>
    );
  }

  // Interactive selector mode
  const descriptionText =
    activeRating > 0
      ? RATING_LABELS[activeRating] || `${activeRating} of ${maxRating} stars`
      : 'Select a rating (1 to 5 stars)';

  return (
    <div className={`ui-star-rating ${className}`} id={id}>
      <div
        className="ui-star-rating__stars"
        role="radiogroup"
        aria-label="Consultation rating from 1 to 5 stars"
      >
        {Array.from({ length: maxRating }, (_, idx) => {
          const star = idx + 1;
          const isFilled = star <= activeRating;
          const isChecked = star === value;

          return (
            <button
              key={star}
              ref={el => (buttonRefs.current[idx] = el)}
              type="button"
              role="radio"
              aria-checked={isChecked}
              aria-label={`${star} star${star > 1 ? 's' : ''}: ${RATING_LABELS[star] || ''}`}
              tabIndex={isChecked || (value === 0 && star === 1) ? 0 : -1}
              disabled={disabled}
              className={`ui-star-rating__btn ${isFilled ? 'ui-star-rating__btn--active' : ''}`}
              onClick={() => onChange && onChange(star)}
              onMouseEnter={() => setHoveredValue(star)}
              onMouseLeave={() => setHoveredValue(null)}
              onKeyDown={e => handleKeyDown(e, idx)}
            >
              <StarIcon size={size} filled={isFilled} />
            </button>
          );
        })}
      </div>

      {showDescription && (
        <div className="ui-star-rating__description" aria-live="polite">
          {descriptionText}
        </div>
      )}
    </div>
  );
};

export const RatingBadge: React.FC<{ rating: number; className?: string }> = ({
  rating,
  className = ''
}) => (
  <span
    className={`ui-star-rating__badge ${className}`}
    aria-label={`Rating: ${rating} out of 5 stars`}
  >
    <StarIcon size={13} filled />
    <span>{rating}/5</span>
  </span>
);
