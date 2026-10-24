/**
 * Health & Diagnostics Routes
 */

const express = require('express');
const router = express.Router();
const healthController = require('../controllers/healthController');

// Liveness probe
router.get('/health', healthController.getHealth);

// Readiness probe
router.get('/ready', healthController.getReadiness);

module.exports = router;
