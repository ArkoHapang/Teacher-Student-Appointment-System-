/**
 * Appointment Lifecycle & Status Transition Model
 * Defines allowed status transitions and terminal states.
 * Arbitrary status transitions are strictly forbidden.
 */

const { APPOINTMENT_STATUS } = require('./roles');

/**
 * Valid directed graph of status transitions.
 * An appointment in state X can ONLY transition to state Y if Y is in ALLOWED_TRANSITIONS[X].
 */
const ALLOWED_TRANSITIONS = {
  [APPOINTMENT_STATUS.PENDING]: [
    APPOINTMENT_STATUS.APPROVED,
    APPOINTMENT_STATUS.REJECTED,
    APPOINTMENT_STATUS.CANCELLED
  ],
  [APPOINTMENT_STATUS.APPROVED]: [
    APPOINTMENT_STATUS.CANCELLED,
    APPOINTMENT_STATUS.RESCHEDULE_PENDING,
    APPOINTMENT_STATUS.COMPLETED
  ],
  [APPOINTMENT_STATUS.RESCHEDULE_PENDING]: [
    APPOINTMENT_STATUS.APPROVED,
    APPOINTMENT_STATUS.CANCELLED
  ],
  [APPOINTMENT_STATUS.REJECTED]: [],   // Terminal state
  [APPOINTMENT_STATUS.CANCELLED]: [],  // Terminal state
  [APPOINTMENT_STATUS.COMPLETED]: []   // Terminal state
};

/**
 * Check if transition from currentStatus to targetStatus is valid.
 * @param {string} currentStatus
 * @param {string} targetStatus
 * @returns {boolean}
 */
function isValidTransition(currentStatus, targetStatus) {
  if (!ALLOWED_TRANSITIONS[currentStatus]) {
    return false;
  }
  return ALLOWED_TRANSITIONS[currentStatus].includes(targetStatus);
}

/**
 * Check if a status is terminal (no further transitions allowed).
 * @param {string} status
 * @returns {boolean}
 */
function isTerminalStatus(status) {
  return [
    APPOINTMENT_STATUS.REJECTED,
    APPOINTMENT_STATUS.CANCELLED,
    APPOINTMENT_STATUS.COMPLETED
  ].includes(status);
}

module.exports = {
  ALLOWED_TRANSITIONS,
  isValidTransition,
  isTerminalStatus
};
