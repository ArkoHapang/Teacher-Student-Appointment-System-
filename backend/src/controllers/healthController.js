/**
 * Health & Readiness Controller
 * Implements standard liveness and readiness probes with live database diagnostics.
 */

const HTTP_STATUS = require('../constants/httpStatusCodes');
const db = require('../config/database');
const migrationService = require('../services/migrationService');
const env = require('../config/env');

const healthController = {
  /**
   * Liveness Probe (GET /api/v1/health)
   * Signals whether the HTTP server process is running and responding.
   */
  async getHealth(req, res) {
    const healthData = {
      status: 'UP',
      service: 'teacher-student-appointment-backend',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      environment: env.env,
      memoryUsage: {
        rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
      }
    };

    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: healthData
    });
  },

  /**
   * Readiness Probe (GET /api/v1/ready)
   * Signals whether the application is fully ready to receive traffic:
   * 1. Live database connectivity and round-trip ping.
   * 2. Schema migration status and version alignment.
   */
  async getReadiness(req, res, next) {
    try {
      const dbCheck = await db.ping();
      const migrationCheck = await migrationService.getStatus();

      const isReady = dbCheck.connected && migrationCheck.isUpToDate;
      const statusCode = isReady ? HTTP_STATUS.OK : HTTP_STATUS.SERVICE_UNAVAILABLE;

      const readinessData = {
        status: isReady ? 'READY' : 'DEGRADED',
        timestamp: new Date().toISOString(),
        checks: {
          database: {
            connected: dbCheck.connected,
            latencyMs: dbCheck.latencyMs,
            path: db.getPath()
          },
          migrations: {
            isUpToDate: migrationCheck.isUpToDate,
            totalAvailable: migrationCheck.totalAvailable,
            appliedCount: migrationCheck.appliedCount,
            pendingCount: migrationCheck.pendingCount,
            pending: migrationCheck.pending
          }
        }
      };

      res.status(statusCode).json({
        success: isReady,
        data: readinessData
      });
    } catch (err) {
      next(err);
    }
  }
};

module.exports = healthController;
