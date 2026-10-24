/**
 * Request Validation Middleware
 * Validates request payload against required rules and returns standard 400 errors.
 */

const HTTP_STATUS = require('../constants/httpStatusCodes');

/**
 * Higher-order middleware factory for validating body/query/params.
 * @param {Object} schema - Validation schema containing field rules
 * @param {string} source - 'body' | 'query' | 'params' (default: 'body')
 */
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const data = req[source] || {};
    const errors = [];

    for (const [field, rules] of Object.entries(schema)) {
      const value = data[field];

      // Required check
      if (rules.required && (value === undefined || value === null || value === '')) {
        errors.push({
          field,
          issue: `Field '${field}' is required.`
        });
        continue;
      }

      // If value is missing and not required, skip type/pattern checks
      if (value === undefined || value === null) {
        continue;
      }

      // Type check
      if (rules.type) {
        const actualType = typeof value;
        if (rules.type === 'array' && !Array.isArray(value)) {
          errors.push({ field, issue: `Field '${field}' must be an array.` });
        } else if (rules.type !== 'array' && actualType !== rules.type) {
          errors.push({ field, issue: `Field '${field}' must be of type ${rules.type}.` });
        }
      }

      // String length checks
      if (typeof value === 'string') {
        if (rules.minLength && value.length < rules.minLength) {
          errors.push({ field, issue: `Field '${field}' must be at least ${rules.minLength} characters.` });
        }
        if (rules.maxLength && value.length > rules.maxLength) {
          errors.push({ field, issue: `Field '${field}' cannot exceed ${rules.maxLength} characters.` });
        }
        if (rules.pattern && !rules.pattern.test(value)) {
          errors.push({ field, issue: rules.patternMessage || `Field '${field}' format is invalid.` });
        }
      }

      // Numeric range checks
      if (typeof value === 'number') {
        if (rules.min !== undefined && value < rules.min) {
          errors.push({ field, issue: `Field '${field}' cannot be less than ${rules.min}.` });
        }
        if (rules.max !== undefined && value > rules.max) {
          errors.push({ field, issue: `Field '${field}' cannot exceed ${rules.max}.` });
        }
      }

      // Enum check
      if (rules.enum && !rules.enum.includes(value)) {
        errors.push({ field, issue: `Field '${field}' must be one of: [${rules.enum.join(', ')}].` });
      }
    }

    if (errors.length > 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed for incoming request parameters.',
          details: errors
        }
      });
    }

    next();
  };
}

module.exports = {
  validate
};
