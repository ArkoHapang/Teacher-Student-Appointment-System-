/**
 * Teacher Profile Routes (/api/v1/teachers)
 * Enforces boundary: Teachers must not manage other teachers unless explicitly authorized.
 */

const express = require('express');
const router = express.Router();
const teacherController = require('../controllers/teacherController');
const { authenticate } = require('../middlewares/authMiddleware');
const { authorizeTeacherManagement } = require('../middlewares/rbacMiddleware');

// Public / Directory queries
router.get('/', teacherController.listTeachers);
router.get('/:id', teacherController.getTeacher);
router.get('/:id/slots', teacherController.getTeacherSlots);

// Modification: Protected by Teacher Management Boundary
// (Admins can manage all teachers; Teachers can only manage themselves; Students blocked)
router.patch('/:id', authenticate, authorizeTeacherManagement(), teacherController.updateTeacher);

// Slot Management (Configure and manage availability slots)
router.post('/:id/slots', authenticate, authorizeTeacherManagement(), teacherController.createSlot);
router.patch('/:id/slots/:slotId', authenticate, authorizeTeacherManagement(), teacherController.updateSlot);
router.delete('/:id/slots/:slotId', authenticate, authorizeTeacherManagement(), teacherController.deleteSlot);

module.exports = router;
