/**
 * Department Routes (/api/v1/departments)
 * Publicly accessible academic department listings.
 */

const express = require('express');
const router = express.Router();
const departmentController = require('../controllers/departmentController');

// Public directory of academic departments
router.get('/', departmentController.listDepartments);

module.exports = router;
